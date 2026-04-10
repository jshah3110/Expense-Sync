# Implementation

## Module Breakdown

### Backend (`/`)
- `main.py` — FastAPI app, CORS, router registration
- `api/transactions.py` — transaction endpoints (sync, fetch, bulk, CSV export)
- `api/splitwise.py` — Splitwise OAuth + push/pull
- `api/budgets.py` — budget CRUD (upsert on POST, DELETE clears limit)
- `db/database.py` — ORM models: Transaction, BankConnection, Budget, UserModel
- `engine/classifier.py` — scikit-learn merchant → category classifier

### Frontend (`client/src/`)
- `App.jsx` — router, shared state lifted here for cross-route persistence
- `components/Dashboard.jsx` — transaction list, filters, swipe gestures, offline banner, bulk actions, CSV export
- `components/Analytics.jsx` — bar chart, category rows, inline budget editor with progress bars
- `components/Settings.jsx` — Plaid link, Splitwise OAuth, dark mode toggle, pull-from-Splitwise button

### Offline Support
- `client/public/sw.js` — service worker: network-first for HTML, stale-while-revalidate for assets
- `localStorage` — caches transaction data for offline access, restored on mount before network fetch

## Key Patterns

**Incremental sync (Plaid cursor)**
```python
# api/transactions.py
cursor = bank.sync_cursor or ""
response = client.transactions_sync(access_token, cursor=cursor)
bank.sync_cursor = response.next_cursor
```

**Offline cache restore (Dashboard.jsx)**
```javascript
// On mount: restore cache first, then fetch fresh
const raw = localStorage.getItem('cached_transactions');
if (raw) { setTransactions(JSON.parse(raw).data); }
fetchTransactions(); // updates cache on success
```

**Budget progress bar color (Analytics.jsx)**
```javascript
const pct = (cat.displayTotal / budget) * 100;
const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#22c55e';
```

**Swipe gesture threshold (Dashboard.jsx)**
```javascript
const SWIPE_THRESHOLD = 80; // px
if (deltaX > SWIPE_THRESHOLD) handleSwipeRight(tx);
if (deltaX < -SWIPE_THRESHOLD) handleSwipeLeft(tx);
```

## Testing Strategy
- Backend: pytest with SQLite in-memory DB
- Frontend: Vitest + React Testing Library
- Manual: Plaid sandbox environment for bank flow testing
