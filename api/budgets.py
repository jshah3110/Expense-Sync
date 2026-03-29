from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from db.database import get_db, Budget

router = APIRouter()

class BudgetRequest(BaseModel):
    category: str
    monthly_limit: float

@router.get("/")
def get_budgets(db: Session = Depends(get_db)):
    budgets = db.query(Budget).all()
    return {b.category: b.monthly_limit for b in budgets}

@router.post("/")
def upsert_budget(req: BudgetRequest, db: Session = Depends(get_db)):
    existing = db.query(Budget).filter(Budget.category == req.category).first()
    if existing:
        existing.monthly_limit = req.monthly_limit
    else:
        db.add(Budget(category=req.category, monthly_limit=req.monthly_limit))
    db.commit()
    return {"status": "ok"}

@router.delete("/{category}")
def delete_budget(category: str, db: Session = Depends(get_db)):
    db.query(Budget).filter(Budget.category == category).delete()
    db.commit()
    return {"status": "ok"}
