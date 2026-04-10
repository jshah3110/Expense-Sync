---
name: add-module
description: Scaffold a new API route or React component for ExpenseSync.
---

# Add Module

## New API Route
1. Create `api/<name>.py` with FastAPI router
2. Add models to `db/database.py` if needed
3. Register router in `main.py`: `app.include_router(<name>_router, prefix="/api/<name>")`
4. Add to `project.md` API routes table

## New React Component
1. Create `client/src/components/<Name>.jsx`
2. Add route in `App.jsx`
3. Add nav link to navbar if top-level screen
4. Follow existing pattern: fetch on mount, handle loading/error state

## Checklist
- [ ] Backend: router created, registered in main.py
- [ ] Frontend: component created, route added
- [ ] DB: models added + migration handled
- [ ] project.md updated
