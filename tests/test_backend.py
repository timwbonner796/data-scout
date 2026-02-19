import io
import math
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from backend.main import app

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "npdb_sample.csv"

client = TestClient(app)


@pytest.fixture(scope="module")
def uploaded():
    """Upload the fixture CSV once and return the JSON response."""
    with open(FIXTURE_PATH, "rb") as f:
        res = client.post("/upload", files={"file": ("npdb_sample.csv", f, "text/csv")})
    assert res.status_code == 200
    return res.json()


@pytest.fixture(scope="module")
def dataset_id(uploaded):
    return uploaded["dataset_id"]


# ── 1. Upload validation ────────────────────────────────────────────────

def test_upload(uploaded):
    assert uploaded["n_rows"] == 8538
    assert uploaded["n_cols"] == 54
    assert isinstance(uploaded["dataset_id"], str)
    assert len(uploaded["dataset_id"]) > 0


# ── 2. Column classification ────────────────────────────────────────────

def test_column_types(uploaded):
    cols = {c["name"]: c for c in uploaded["columns"]}

    # SEQNO is an integer with 8538 unique values (> 20) → numeric_continuous
    assert cols["SEQNO"]["col_type"] == "numeric_continuous"
    assert cols["RECTYPE"]["col_type"] == "categorical"
    assert cols["PAYMENT"]["col_type"] == "numeric_continuous"
    assert cols["LICNSTAT"]["col_type"] == "categorical"


# ── 3. Missing data percentages ─────────────────────────────────────────

def test_missing_data(uploaded):
    cols = {c["name"]: c for c in uploaded["columns"]}

    # OUTCOME has ~45.33% nulls (the fixture has no PYTYPE column)
    assert cols["OUTCOME"]["null_pct"] == pytest.approx(45.3, abs=0.5)
    assert cols["NUMBPRSN"]["null_pct"] == pytest.approx(4.7, abs=0.5)


# ── 4. EDA histograms ───────────────────────────────────────────────────

def test_eda_histograms(dataset_id):
    res = client.get(f"/eda/{dataset_id}")
    assert res.status_code == 200
    data = res.json()
    histograms = data["histograms"]

    assert len(histograms) == 54

    assert histograms["PAYMENT"]["type"] == "numeric"
    assert len(histograms["PAYMENT"]["bins"]) > 0

    assert histograms["RECTYPE"]["type"] == "categorical"
    assert len(histograms["RECTYPE"]["bins"]) > 0


# ── 5. Pearson correlation ──────────────────────────────────────────────

def test_pearson_correlation(dataset_id):
    res = client.get(f"/correlation/{dataset_id}?method=pearson")
    assert res.status_code == 200
    data = res.json()

    columns = data["columns"]
    matrix = data["matrix"]
    assert len(columns) > 0

    assert "PAYMENT" in columns
    assert "TOTALPMT" in columns

    i = columns.index("PAYMENT")
    j = columns.index("TOTALPMT")
    r = matrix[i][j]
    assert r == pytest.approx(0.96, abs=0.03)

    # No NaN values anywhere in the matrix
    for row in matrix:
        for v in row:
            assert not math.isnan(v), f"NaN found in Pearson matrix"


# ── 6. Cramér's V correlation ───────────────────────────────────────────

def test_cramers_v(dataset_id):
    res = client.get(f"/correlation/{dataset_id}?method=cramers_v")
    assert res.status_code == 200
    data = res.json()

    columns = data["columns"]
    matrix = data["matrix"]
    assert len(columns) > 0

    # Matrix should have at least some non-zero off-diagonal values
    off_diag = [
        matrix[i][j]
        for i in range(len(columns))
        for j in range(len(columns))
        if i != j
    ]
    assert any(v > 0 for v in off_diag), "Cramér's V matrix is all zeros off-diagonal"


# ── 7. Filter by categorical value ──────────────────────────────────────

def test_filter_categorical(dataset_id):
    res = client.post(
        f"/filter/{dataset_id}",
        json={"filters": [{"column": "RECTYPE", "op": "in", "values": ["M"]}]},
    )
    assert res.status_code == 200
    data = res.json()

    assert data["n_rows"] == 3870
    assert data["n_rows_original"] == 8538
    assert len(data["preview"]) > 0


# ── 8. Filter returns full dataset with no filters ──────────────────────

def test_filter_empty(dataset_id):
    res = client.post(f"/filter/{dataset_id}", json={"filters": []})
    assert res.status_code == 200
    assert res.json()["n_rows"] == 8538


# ── 9. Export produces valid CSV ────────────────────────────────────────

def test_export_csv(dataset_id):
    res = client.post(
        f"/export/{dataset_id}?format=csv",
        json={"filters": [{"column": "RECTYPE", "op": "in", "values": ["M"]}]},
    )
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]

    text = res.content.decode("utf-8")
    lines = [l for l in text.splitlines() if l.strip()]
    # 1 header + 3870 data rows
    assert len(lines) == 3871


# ── 10. Column values endpoint ──────────────────────────────────────────

def test_column_values(dataset_id):
    res = client.get(f"/column-values/{dataset_id}/RECTYPE")
    assert res.status_code == 200
    data = res.json()

    assert "values" in data
    assert "M" in data["values"]
