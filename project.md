# ExpenseSync

**Status:** Active development
**Type:** Full-stack
**Tech Stack:** FastAPI + SQLAlchemy + Plaid + Splitwise API / React 19 + Vite + Recharts
**Owner:** Jay
**Created:** 2026-04-09

## Quick Reference
- Docs: `docs/`
- Setup: `docs/SETUP.md`
- Backend: `api/`, `db/`, `engine/`, `main.py`
- Frontend: `client/src/components/`
- Skills: `.claude/skills/`

## Key Decisions
- Plaid cursor-based incremental sync (not full re-fetch)
- SQLite for local dev, PostgreSQL for production
- ML classifier in `engine/classifier.py` for merchant → category
- Splitwise sync is two-way: push from app + pull from Splitwise
- Offline support via service worker + localStorage cache
- Budget limits stored per-category in `budgets` table

## Screens
- **Dashboard** (`Dashboard.jsx`) — transaction list, filters, swipe gestures, bulk actions, CSV export
- **Analytics** (`Analytics.jsx`) — spending chart, category breakdown, budget progress bars
- **Settings** (`Settings.jsx`) — Plaid bank connection, Splitwise OAuth, dark mode

## API Routes
| Endpoint | Purpose |
|----------|---------|
| `POST /api/transactions/sync` | Trigger Plaid sync |
| `POST /api/transactions/bulk_ignore` | Bulk ignore |
| `POST /api/transactions/bulk_mark_synced` | Bulk push |
| `POST /api/splitwise/pull` | Import Splitwise expenses |
| `GET/POST/DELETE /api/budgets/` | Budget CRUD |
