# Expense Automation Tracker

> Stop manually copying bank transactions into Splitwise. This app syncs your bank automatically, categorizes expenses with ML, and lets you push shared expenses to Splitwise in one click.

Built for people who share expenses with roommates or partners and want to stop doing it manually.

---

## What it does

```mermaid
flowchart LR
    Bank["🏦 Your Bank"] -->|Plaid API| Sync["🔄 Auto Sync"]
    Sync --> Categorize["🤖 ML Categorization"]
    Categorize --> Review["👀 You Review"]
    Review -->|One click| Splitwise["💸 Splitwise"]
    Review -->|Download| CSV["📄 CSV Export"]
    Review -->|Set limits| Budget["📊 Budget Tracker"]
```

1. **Connect your bank** — Plaid securely links any US bank. Transactions sync automatically.
2. **Review & categorize** — Expenses get auto-tagged (Food, Transport, etc.) via ML. You can override anything.
3. **Push to Splitwise** — Hit sync to create Splitwise expenses for anything shared.
4. **Track budgets** — Set monthly limits per category. Watch progress bars fill up.

---

## Features

| Feature | What it does |
|---------|-------------|
| Bank Sync | Connects to any US bank via Plaid. Pulls new transactions incrementally. |
| Two-way Splitwise Sync | Push expenses out, or pull in expenses added on Splitwise directly |
| Smart Categorization | ML classifier maps merchant names to spending categories automatically |
| Budget Tracking | Set monthly limits per category with color-coded progress bars (green → amber → red) |
| Offline Support | App works without internet — loads cached transactions from last sync |
| Swipe Gestures | On mobile: swipe right to push to Splitwise, swipe left to ignore |
| Bulk Actions | Select multiple transactions for batch ignore, mark-pushed, or delete |
| CSV Export | Download any filtered view as a spreadsheet |

---

## How the sync works

```mermaid
sequenceDiagram
    participant App
    participant Plaid
    participant DB
    participant Splitwise

    App->>Plaid: Request new transactions (with cursor)
    Plaid-->>App: Return only new/changed transactions
    App->>DB: Save transactions (dedup by plaid_transaction_id)
    
    Note over App: User reviews in Dashboard
    
    App->>Splitwise: POST expense (name, amount, date)
    Splitwise-->>App: Return expense ID
    App->>DB: Mark transaction as synced
```

Plaid uses a **cursor** — so each sync only fetches what changed since last time, not your entire history.

---

## Getting Started

### What you need

- Python 3.11+
- Node 18+
- A free [Plaid developer account](https://plaid.com) for bank connections
- A Splitwise account + API token (optional, for expense sharing)

### Setup

**1. Clone the repo and install dependencies**

```bash
# Backend
cd server
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd client
npm install
```

**2. Add your API keys**

Create a `.env` file in the `server/` folder:

```env
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret_key
PLAID_ENV=sandbox                          # use 'production' when ready
DATABASE_URL=sqlite:///./expenses.db       # or a PostgreSQL URL
FRONTEND_URL=http://localhost:5173
```

**3. Start both servers**

```bash
# Terminal 1 — Backend API
source venv/bin/activate
uvicorn main:app --reload
# Runs at http://localhost:8000

# Terminal 2 — Frontend
cd client
npm run dev
# Runs at http://localhost:5173
```

Open `http://localhost:5173` and connect your bank.

---

## App screens

```
Dashboard               Analytics               Settings
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ [Backlog][Pushed]│    │ Spending by      │    │ Connected Banks │
│                 │    │ Category (chart) │    │  • Chase ✓      │
│ ☐ Chipotle $14  │    │                 │    │  • Add Bank +   │
│ ☐ Uber   $22   │    │ Food      ████░ │    │                 │
│ ☐ Amazon  $67  │    │ Transport ██░░░ │    │ Splitwise       │
│                 │    │ Shopping  ███░░ │    │  • Connected ✓  │
│ [Export CSV]    │    │                 │    │  • Pull Expenses│
│ [Bulk Actions]  │    │ Click to set    │    │                 │
└─────────────────┘    │ monthly budgets │    └─────────────────┘
                       └─────────────────┘
```

---

## Project structure

```
server/
├── main.py               # App entry point, CORS setup
├── requirements.txt      # Python dependencies
├── api/
│   ├── transactions.py   # Fetch, sync, bulk actions, CSV export
│   ├── splitwise.py      # Push/pull Splitwise expenses
│   └── budgets.py        # Budget CRUD
├── db/
│   └── database.py       # Database models + auto-migrations
├── engine/
│   └── classifier.py     # ML merchant → category classifier
└── client/               # React frontend
    ├── src/
    │   └── components/
    │       ├── Dashboard.jsx    # Transaction list, filters, swipe
    │       ├── Analytics.jsx    # Charts, budget editor
    │       ├── Settings.jsx     # Bank + Splitwise connections
    │       └── App.jsx          # Routing, shared state
    └── public/
        └── sw.js               # Service worker (offline support)
```

---

## Data model

```mermaid
erDiagram
    Transaction {
        int id
        string plaid_transaction_id
        string name
        float amount
        string date
        string category
        bool is_synced
        bool is_ignored
        string splitwise_expense_id
    }
    BankConnection {
        int id
        string institution_name
        string access_token
        string sync_cursor
    }
    Budget {
        int id
        string category
        float monthly_limit
    }
    UserModel {
        int id
        string splitwise_access_token
    }
```

---

## Deployment

### Backend (any Python host — Railway, Render, Fly.io)

```bash
# Set these environment variables on your host:
DATABASE_URL=postgresql://user:pass@host/dbname
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=production

# Start command:
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend (Vercel, Netlify, etc.)

```bash
cd client
npm run build
# Deploy the generated dist/ folder
```

---

## Tech stack

**Backend:** FastAPI · SQLAlchemy · Plaid Python SDK · scikit-learn

**Frontend:** React 19 · Vite · Recharts · Axios · Service Worker

**Database:** SQLite (local dev) or PostgreSQL (production)

---

## License

ISC
