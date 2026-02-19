# Data Scout

Lightweight dataset explorer for EDA, filtering, and export. Handles datasets well beyond Excel's 1M row limit.

## Quick Start

```bash
./start.sh
```

Then open **http://localhost:3000**

## What It Does

### EDA Tab
- **Missing data summary** — % null by column, sorted by severity, color-coded bars
- **Distributions** — histogram per column. Numeric columns with ≤20 unique values are treated as categorical. Continuous numerics get binned histograms with mean/median/std. Categoricals show value counts (top 50).
- **Correlation matrix** — toggle between:
  - **Pearson** for numeric continuous columns
  - **Cramér's V** for categorical columns
  - Sampled at 50k rows for performance on large datasets

### Filter & Export Tab
- Column-level filters (expand any column in the sidebar):
  - **Categorical/boolean**: multi-select chip UI with search
  - **Numeric continuous**: min/max range inputs
  - **Text/datetime**: contains-pattern search
  - **Null handling**: exclude nulls / only nulls toggle per column
- Live row count showing filter impact (count + %)
- Preview table (first 100 filtered rows)
- Export to **CSV** or **Parquet**

### File Support
CSV, TSV, Excel (.xlsx/.xls), Parquet

## Architecture

```
data-scout/
├── backend/
│   ├── main.py              # FastAPI — upload, EDA, correlation, filter, export
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Upload + tab router
│   │   ├── components/
│   │   │   ├── EDATab.jsx    # Missing data, histograms, correlation
│   │   │   └── FilterTab.jsx # Filter sidebar, preview table, export
│   │   ├── utils/api.js      # API client
│   │   └── index.css         # Full stylesheet
│   ├── index.html
│   ├── vite.config.js        # Dev server + API proxy
│   └── package.json
└── start.sh                  # Starts both servers
```

**Backend**: FastAPI + Polars (fast columnar operations, handles large files)
**Frontend**: React + Vite + Recharts

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Upload file, returns dataset ID + column metadata |
| GET | `/eda/{id}` | Histograms for all columns |
| GET | `/correlation/{id}?method=pearson\|cramers_v` | Correlation matrix |
| POST | `/filter/{id}` | Apply filters, get row count + preview |
| POST | `/export/{id}?format=csv\|parquet` | Download filtered data |
| GET | `/column-values/{id}/{col}` | Unique values for filter dropdowns |

Interactive API docs at **http://localhost:8000/docs** (Swagger UI).

## Design Decisions

- **Polars over Pandas**: Better performance on 1M+ row datasets, especially for group-by and filter operations
- **Categorical threshold = 20**: Numeric columns with ≤20 unique values render as bar charts instead of histograms
- **Correlation sampling**: Caps at 50k rows to keep the UI responsive; sufficient for stable estimates
- **In-memory storage**: Datasets live in a dict keyed by UUID. Fine for localhost single-user; swap to Redis/disk for multi-user deployment
- **Vite proxy**: Frontend dev server proxies `/api/*` to the backend, avoiding CORS complexity

## Future Considerations

If you want to deploy this beyond localhost:
- Add authentication
- Swap in-memory dict for temp file storage or Redis
- Add file size limits and cleanup
- Consider WebSocket for progress on large file uploads
