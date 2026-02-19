"""
Data Scout - Backend API
FastAPI + Polars for fast dataset exploration, EDA, and filtering.
"""

import io
import os
import uuid
import tempfile
from typing import Optional

import polars as pl
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Data Scout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory dataset store (session-based for localhost)
datasets: dict[str, pl.DataFrame] = {}
dataset_filenames: dict[str, str] = {}

CATEGORICAL_THRESHOLD = 20
SAMPLE_SIZE_FOR_CORR = 50_000
HISTOGRAM_BINS = 30
NUMERIC_COERCION_THRESHOLD = 0.90


# ── Models ──────────────────────────────────────────────────────────────

class FilterSpec(BaseModel):
    column: str
    op: str  # "in", "not_in", "range", "is_null", "not_null", "contains"
    values: Optional[list] = None
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    pattern: Optional[str] = None


class FilterRequest(BaseModel):
    filters: list[FilterSpec] = []


# ── Helpers ─────────────────────────────────────────────────────────────

def coerce_string_columns(df: pl.DataFrame) -> pl.DataFrame:
    """Attempt to cast Utf8 columns to Float64 if ≥90% of non-null values are numeric."""
    for col in df.columns:
        if df[col].dtype != pl.Utf8:
            continue

        original_non_null = df[col].drop_nulls().len()
        if original_non_null == 0:
            continue

        # Strip formatting: $, commas, and convert parenthesized negatives (1234.56) -> -1234.56
        cleaned = (
            df[col]
            .str.strip_chars()
            .str.replace_all(r"[$,]", "")
            .str.replace(r"^\((.+)\)$", r"-$1")
        )

        numeric = cleaned.cast(pl.Float64, strict=False)
        converted_non_null = numeric.drop_nulls().len()

        if converted_non_null >= NUMERIC_COERCION_THRESHOLD * original_non_null:
            df = df.with_columns(numeric.alias(col))

    return df


def classify_column(df: pl.DataFrame, col: str) -> str:
    """Classify column as 'numeric_continuous', 'numeric_categorical', 'categorical', 'datetime', 'boolean'."""
    dtype = df[col].dtype

    if dtype == pl.Boolean:
        return "boolean"
    if dtype in (pl.Date, pl.Datetime, pl.Time):
        return "datetime"
    if dtype in (pl.Utf8, pl.Categorical):
        return "categorical"
    if dtype.is_numeric():
        n_unique = df[col].drop_nulls().n_unique()
        if n_unique <= CATEGORICAL_THRESHOLD:
            return "numeric_categorical"
        return "numeric_continuous"
    return "categorical"


def compute_histogram(series: pl.Series, col_type: str) -> dict:
    """Compute histogram data for a single column."""
    non_null = series.drop_nulls()
    total = len(series)
    null_count = total - len(non_null)

    if len(non_null) == 0:
        return {"type": col_type, "bins": [], "null_count": null_count, "total": total}

    if col_type in ("categorical", "numeric_categorical", "boolean"):
        counts = non_null.value_counts().sort("count", descending=True)
        col_name = counts.columns[0]
        bins = [
            {"label": str(row[col_name]), "count": int(row["count"])}
            for row in counts.head(50).iter_rows(named=True)
        ]
        remaining = len(counts) - 50
        return {
            "type": "categorical",
            "bins": bins,
            "null_count": null_count,
            "total": total,
            "n_unique": int(non_null.n_unique()),
            "truncated": remaining if remaining > 0 else 0,
        }

    if col_type == "numeric_continuous":
        values = non_null.cast(pl.Float64).to_numpy()
        hist_counts, bin_edges = np.histogram(values, bins=HISTOGRAM_BINS)
        bins = [
            {
                "label": f"{bin_edges[i]:.4g}–{bin_edges[i+1]:.4g}",
                "low": float(bin_edges[i]),
                "high": float(bin_edges[i + 1]),
                "count": int(hist_counts[i]),
            }
            for i in range(len(hist_counts))
        ]
        return {
            "type": "numeric",
            "bins": bins,
            "null_count": null_count,
            "total": total,
            "min": float(np.min(values)),
            "max": float(np.max(values)),
            "mean": float(np.mean(values)),
            "median": float(np.median(values)),
            "std": float(np.std(values)),
            "n_unique": int(non_null.n_unique()),
        }

    if col_type == "datetime":
        # Treat as categorical with formatted strings
        formatted = non_null.cast(pl.Utf8)
        counts = formatted.value_counts().sort("count", descending=True)
        col_name = counts.columns[0]
        bins = [
            {"label": str(row[col_name]), "count": int(row["count"])}
            for row in counts.head(50).iter_rows(named=True)
        ]
        return {
            "type": "datetime",
            "bins": bins,
            "null_count": null_count,
            "total": total,
            "n_unique": int(non_null.n_unique()),
        }

    return {"type": "unknown", "bins": [], "null_count": null_count, "total": total}


def compute_pearson_correlation(df: pl.DataFrame) -> dict:
    """Pearson correlation for numeric continuous columns (pairwise null handling)."""
    numeric_cols = [
        c for c in df.columns if classify_column(df, c) == "numeric_continuous"
    ]
    if len(numeric_cols) < 2:
        return {"columns": [], "matrix": []}

    sample = df.select(numeric_cols)
    if len(sample) > SAMPLE_SIZE_FOR_CORR:
        sample = sample.sample(SAMPLE_SIZE_FOR_CORR, seed=42)

    sample = sample.cast({c: pl.Float64 for c in numeric_cols})

    size = len(numeric_cols)
    matrix = [[1.0] * size for _ in range(size)]

    for i in range(size):
        for j in range(i + 1, size):
            pair = sample.select([numeric_cols[i], numeric_cols[j]]).drop_nulls()
            if len(pair) < 3:
                matrix[i][j] = matrix[j][i] = 0.0
            else:
                arr = pair.to_numpy()
                r = np.corrcoef(arr, rowvar=False)[0, 1]
                matrix[i][j] = matrix[j][i] = round(float(np.nan_to_num(r, 0.0)), 4)

    return {
        "columns": numeric_cols,
        "matrix": matrix,
    }


def compute_cramers_v(df: pl.DataFrame) -> dict:
    """Cramér's V for categorical columns."""
    cat_cols = [
        c for c in df.columns
        if classify_column(df, c) in ("categorical", "numeric_categorical", "boolean")
    ]
    if len(cat_cols) < 2:
        return {"columns": [], "matrix": []}

    sample = df.select(cat_cols)
    if len(sample) > SAMPLE_SIZE_FOR_CORR:
        sample = sample.sample(SAMPLE_SIZE_FOR_CORR, seed=42)

    # Build matrix
    size = len(cat_cols)
    matrix = [[1.0] * size for _ in range(size)]

    for i in range(size):
        for j in range(i + 1, size):
            try:
                pair = sample.select([cat_cols[i], cat_cols[j]]).drop_nulls()
                n = len(pair)

                if n < 3:
                    matrix[i][j] = matrix[j][i] = 0.0
                    continue

                col_i = pair[cat_cols[i]].cast(pl.Utf8)
                col_j = pair[cat_cols[j]].cast(pl.Utf8)

                ct = (
                    pl.DataFrame({"a": col_i, "b": col_j})
                    .group_by(["a", "b"])
                    .agg(pl.len().alias("count"))
                )

                # Pivot to contingency table
                cats_a = col_i.unique().sort().to_list()
                cats_b = col_j.unique().sort().to_list()
                r, k = len(cats_a), len(cats_b)

                if r <= 1 or k <= 1:
                    matrix[i][j] = matrix[j][i] = 0.0
                    continue

                # Build observed matrix
                ct_dict = {}
                for row in ct.iter_rows(named=True):
                    ct_dict[(row["a"], row["b"])] = row["count"]

                observed = np.array([
                    [ct_dict.get((a, b), 0) for b in cats_b]
                    for a in cats_a
                ], dtype=float)

                # Chi-squared
                row_sums = observed.sum(axis=1, keepdims=True)
                col_sums = observed.sum(axis=0, keepdims=True)
                expected = row_sums * col_sums / n

                # Avoid division by zero
                mask = expected > 0
                chi2 = np.sum((observed[mask] - expected[mask]) ** 2 / expected[mask])

                v = np.sqrt(chi2 / (n * (min(r, k) - 1))) if min(r, k) > 1 else 0
                v = min(v, 1.0)  # Clamp
                matrix[i][j] = matrix[j][i] = round(float(np.nan_to_num(v, 0.0)), 4)

            except Exception:
                matrix[i][j] = matrix[j][i] = 0.0

    return {
        "columns": cat_cols,
        "matrix": matrix,
    }


def apply_filters(df: pl.DataFrame, filters: list[FilterSpec]) -> pl.DataFrame:
    """Apply filter specs to dataframe."""
    for f in filters:
        if f.column not in df.columns:
            continue

        col = pl.col(f.column)

        if f.op == "is_null":
            df = df.filter(col.is_null())
        elif f.op == "not_null":
            df = df.filter(col.is_not_null())
        elif f.op == "in" and f.values is not None:
            col_type = classify_column(df, f.column)
            if col_type in ("numeric_continuous", "numeric_categorical"):
                try:
                    cast_vals = [float(v) for v in f.values]
                    df = df.filter(col.cast(pl.Float64).is_in(cast_vals))
                except (ValueError, TypeError):
                    df = df.filter(col.cast(pl.Utf8).is_in([str(v) for v in f.values]))
            else:
                df = df.filter(col.cast(pl.Utf8).is_in([str(v) for v in f.values]))
        elif f.op == "not_in" and f.values is not None:
            df = df.filter(~col.cast(pl.Utf8).is_in([str(v) for v in f.values]))
        elif f.op == "range":
            if f.min_val is not None:
                df = df.filter(col.cast(pl.Float64) >= f.min_val)
            if f.max_val is not None:
                df = df.filter(col.cast(pl.Float64) <= f.max_val)
        elif f.op == "contains" and f.pattern:
            df = df.filter(col.cast(pl.Utf8).str.contains(f.pattern, literal=False))

    return df


# ── Endpoints ───────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload CSV or Excel file, return dataset ID and column info."""
    dataset_id = str(uuid.uuid4())[:8]
    content = await file.read()
    filename = file.filename or "unknown"

    try:
        if filename.endswith((".xlsx", ".xls")):
            df = pl.read_excel(io.BytesIO(content))
        elif filename.endswith(".parquet"):
            df = pl.read_parquet(io.BytesIO(content))
        elif filename.endswith((".tsv", ".tab")):
            df = pl.read_csv(io.BytesIO(content), separator="\t", infer_schema_length=None)
        else:
            df = pl.read_csv(io.BytesIO(content), infer_schema_length=None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    df = coerce_string_columns(df)
    datasets[dataset_id] = df
    dataset_filenames[dataset_id] = filename

    columns = []
    for col in df.columns:
        col_type = classify_column(df, col)
        null_count = int(df[col].null_count())
        columns.append({
            "name": col,
            "dtype": str(df[col].dtype),
            "col_type": col_type,
            "null_count": null_count,
            "null_pct": round(null_count / len(df) * 100, 2) if len(df) > 0 else 0,
            "n_unique": int(df[col].n_unique()),
        })

    return {
        "dataset_id": dataset_id,
        "filename": filename,
        "n_rows": len(df),
        "n_cols": len(df.columns),
        "columns": columns,
    }


@app.get("/eda/{dataset_id}")
async def get_eda(dataset_id: str):
    """Full EDA: histograms for every column + missing data summary."""
    if dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = datasets[dataset_id]
    histograms = {}

    for col in df.columns:
        col_type = classify_column(df, col)
        histograms[col] = compute_histogram(df[col], col_type)

    return {"histograms": histograms}


@app.get("/correlation/{dataset_id}")
async def get_correlation(dataset_id: str, method: str = Query("pearson")):
    """Correlation matrix. method=pearson or cramers_v."""
    if dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = datasets[dataset_id]

    if method == "cramers_v":
        return compute_cramers_v(df)
    else:
        return compute_pearson_correlation(df)


@app.post("/filter/{dataset_id}")
async def filter_data(dataset_id: str, request: FilterRequest):
    """Apply filters and return row count + preview."""
    if dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = datasets[dataset_id]
    filtered = apply_filters(df, request.filters)

    # Return preview (first 100 rows)
    preview = filtered.head(100)
    rows = preview.to_dicts()

    # Recompute column stats on filtered data
    columns = []
    for col in filtered.columns:
        col_type = classify_column(filtered, col)
        null_count = int(filtered[col].null_count())
        columns.append({
            "name": col,
            "dtype": str(filtered[col].dtype),
            "col_type": col_type,
            "null_count": null_count,
            "null_pct": round(null_count / len(filtered) * 100, 2) if len(filtered) > 0 else 0,
            "n_unique": int(filtered[col].n_unique()),
        })

    return {
        "n_rows": len(filtered),
        "n_rows_original": len(df),
        "columns": columns,
        "preview": rows,
    }


@app.post("/export/{dataset_id}")
async def export_data(dataset_id: str, request: FilterRequest, format: str = Query("csv")):
    """Export filtered dataset as CSV or Parquet."""
    if dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = datasets[dataset_id]
    filtered = apply_filters(df, request.filters)

    if format == "parquet":
        buf = io.BytesIO()
        filtered.write_parquet(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=filtered_data.parquet"},
        )
    else:
        buf = io.BytesIO()
        filtered.write_csv(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=filtered_data.csv"},
        )


@app.get("/column-values/{dataset_id}/{column}")
async def get_column_values(dataset_id: str, column: str, limit: int = Query(200)):
    """Get unique values for a column (for filter dropdowns)."""
    if dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = datasets[dataset_id]
    if column not in df.columns:
        raise HTTPException(status_code=404, detail="Column not found")

    values = df[column].drop_nulls().unique().sort()
    has_nulls = int(df[column].null_count()) > 0
    truncated = len(values) > limit

    return {
        "values": [str(v) for v in values.head(limit).to_list()],
        "has_nulls": has_nulls,
        "total_unique": int(df[column].n_unique()),
        "truncated": truncated,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "datasets_loaded": len(datasets)}
