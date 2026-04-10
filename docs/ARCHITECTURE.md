# Architecture

## Problem Statement
Manually tracking shared expenses is tedious. Bank transactions need to be copied into Splitwise one-by-one. This app automates that pipeline.

## System Design

```
┌─────────────┐     Plaid API      ┌──────────────┐
│  Your Bank  │ ────────────────► │   FastAPI    │
└─────────────┘                   │   Backend    │
                                  │  (main.py)   │
┌─────────────┐   Splitwise API   │              │
│  Splitwise  │ ◄───────────────► │  SQLAlchemy  │
└─────────────┘                   │     ORM      │
                                  └──────┬───────┘
                                         │ REST API
                                  ┌──────▼───────┐
                                  │ React 19 SPA │
                                  │  (Vite)      │
                                  └──────────────┘
```

## Modules

| Module | Path | Responsibility |
|--------|------|---------------|
| API — Transactions | `api/transactions.py` | Plaid sync, fetch, bulk actions, CSV |
| API — Splitwise | `api/splitwise.py` | OAuth, push expenses, pull expenses |
| API — Budgets | `api/budgets.py` | Per-category budget CRUD |
| Database | `db/database.py` | SQLAlchemy models + auto-migrations |
| Classifier | `engine/classifier.py` | ML merchant → category mapping |
| Service Worker | `client/public/sw.js` | Offline caching strategy |

## Data Flow

1. User connects bank → Plaid returns `access_token` stored in `BankConnection`
2. Sync triggered → Plaid returns transactions via cursor (incremental)
3. Classifier maps merchant names → categories
4. User reviews in Dashboard → pushes selected to Splitwise
5. Splitwise pull imports external expenses as `is_synced=True`

## Technology Choices
- **Plaid** — industry-standard bank data API, sandbox available for dev
- **FastAPI** — async-ready, auto docs, Pydantic validation
- **SQLAlchemy** — supports SQLite (dev) and PostgreSQL (prod) with same ORM
- **React + Vite** — fast HMR, modern bundler, no CRA overhead
- **Recharts** — lightweight charting, good React integration
- **Service Worker** — native offline support without extra dependencies
