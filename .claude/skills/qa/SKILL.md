---
name: qa
description: Validate ExpenseSync before deploy. Check API wiring, DB models, env vars, frontend build.
---

# QA Checklist

## Backend
- [ ] All routers registered in `main.py`
- [ ] DB models match actual schema (run migration check)
- [ ] `.env` has all required keys from `.env.example`
- [ ] `uvicorn main:app` starts without errors
- [ ] `/api/transactions/`, `/api/budgets/`, `/api/splitwise/` all respond 200

## Frontend
- [ ] `npm run build` succeeds (no TS/lint errors)
- [ ] Dashboard loads transactions
- [ ] Swipe gestures fire correct actions
- [ ] Offline banner appears when backend down
- [ ] Budget progress bars render correctly

## Integration
- [ ] Plaid sandbox link flow completes
- [ ] Sync pulls transactions and saves to DB
- [ ] Push to Splitwise creates expense
- [ ] Pull from Splitwise imports correctly (dedup check)
