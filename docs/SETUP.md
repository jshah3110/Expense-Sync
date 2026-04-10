# Setup

## Requirements
- Python 3.11+
- Node 18+
- Plaid developer account (free sandbox at plaid.com)
- Splitwise account + API token (optional)

## Installation

### 1. Backend
```bash
cd server
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Frontend
```bash
cd client
npm install
```

### 3. Environment
```bash
cp .env.example .env
# Fill in your values
```

Required keys:
| Key | Where to get it |
|-----|----------------|
| `PLAID_CLIENT_ID` | plaid.com → Team Settings → Keys |
| `PLAID_SECRET` | plaid.com → Team Settings → Keys |
| `PLAID_ENV` | `sandbox` for dev, `production` for live |
| `DATABASE_URL` | skip for SQLite default |
| `FRONTEND_URL` | `http://localhost:5173` for local dev |

### 4. Run

```bash
# Terminal 1 — Backend (port 8001)
source venv/bin/activate
uvicorn main:app --reload --port 8001

# Terminal 2 — Frontend (port 5173)
cd client
npm run dev
```

Open `http://localhost:5173`

## Common Commands

```bash
# Backend
uvicorn main:app --reload --port 8001   # dev server
pytest tests/                            # run tests (when added)

# Frontend
npm run dev      # dev server with HMR
npm run build    # production build → dist/
npm run preview  # preview production build locally
```

## Production Deploy

**Backend** — Railway, Render, Fly.io, or any Python host:
```bash
DATABASE_URL=postgresql://... uvicorn main:app --host 0.0.0.0 --port 8000
```

**Frontend** — Vercel, Netlify, or any static host:
```bash
cd client && npm run build
# deploy dist/
```
