from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File as FastAPIFile, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import os
import requests
from urllib.parse import urlencode
from db.database import get_db, UserModel, Transaction as TransactionModel

router = APIRouter()

# Constants
SPLITWISE_CLIENT_ID = os.getenv("SPLITWISE_CLIENT_ID")
SPLITWISE_CLIENT_SECRET = os.getenv("SPLITWISE_CLIENT_SECRET")
# Use env var in production, fallback to localhost for local dev
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
REDIRECT_URI = f"{BACKEND_URL}/api/splitwise/callback"
AUTHORIZE_URL = "https://secure.splitwise.com/oauth/authorize"
TOKEN_URL = "https://secure.splitwise.com/oauth/token"
API_BASE = "https://secure.splitwise.com/api/v3.0"

@router.get("/connect")
def connect_splitwise():
    """Redirects the user to Splitwise to authorize the application."""
    params = {
        "response_type": "code",
        "client_id": SPLITWISE_CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "state": "random_state_string" # Recommended by Splitwise for security and routing
    }
    auth_url = f"{AUTHORIZE_URL}?{urlencode(params)}"
    print(f"DEBUG: Redirecting to Splitwise Auth: {auth_url}")
    return RedirectResponse(url=auth_url)

@router.get("/status")
def check_status(db: Session = Depends(get_db)):
    """Checks if Splitwise is connected (token exists in DB or env var)."""
    user = db.query(UserModel).filter(UserModel.id == 1).first()
    token = (user.splitwise_access_token if user else None) or os.getenv("SPLITWISE_ACCESS_TOKEN")
    return {"connected": token is not None}

def get_splitwise_token(db: Session) -> str | None:
    """Get Splitwise token from DB, falling back to env var (for Render ephemeral filesystem)."""
    user = db.query(UserModel).filter(UserModel.id == 1).first()
    return (user.splitwise_access_token if user else None) or os.getenv("SPLITWISE_ACCESS_TOKEN")

@router.get("/callback")
def splitwise_callback(code: str, db: Session = Depends(get_db)):
    """Handles the redirect from Splitwise, exchanges code for access token."""
    data = {
        "grant_type": "authorization_code",
        "client_id": SPLITWISE_CLIENT_ID,
        "client_secret": SPLITWISE_CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "code": code
    }
    
    response = requests.post(TOKEN_URL, data=data)
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to retrieve Splitwise token")
        
    token_data = response.json()
    access_token = token_data.get("access_token")
    
    # In a real app with user login, we'd find the specific user. 
    # For MVP, we just use user ID 1.
    user_model = db.query(UserModel).filter(UserModel.id == 1).first()
    if not user_model:
        user_model = UserModel(id=1)
        db.add(user_model)
        
    user_model.splitwise_access_token = access_token
    db.commit()
    
    # Redirect back to frontend
    return RedirectResponse(url=f"{FRONTEND_URL}/settings?splitwise=success")

@router.get("/groups")
def get_groups(db: Session = Depends(get_db)):
    """Fetches the user's Splitwise groups."""
    token = get_splitwise_token(db)
    if not token:
        raise HTTPException(status_code=401, detail="Splitwise not connected")
        
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{API_BASE}/get_groups", headers=headers)
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch groups")
        
    return response.json()

@router.get("/current_user")
def get_current_user(db: Session = Depends(get_db)):
    """Fetches the current Splitwise user's profile."""
    token = get_splitwise_token(db)
    if not token:
        raise HTTPException(status_code=401, detail="Splitwise not connected")
        
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{API_BASE}/get_current_user", headers=headers)
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch user profile")
        
    return response.json()

@router.get("/reconcile")
def get_reconcile_suggestions(db: Session = Depends(get_db)):
    """Match unsynced local transactions against Splitwise expenses by amount + date proximity."""
    import datetime as dt
    token = get_splitwise_token(db)
    if not token:
        raise HTTPException(status_code=401, detail="Splitwise not connected")

    unsynced = db.query(TransactionModel).filter(
        TransactionModel.is_synced == False,
        TransactionModel.is_ignored == False,
    ).all()

    if not unsynced:
        return {"confident": [], "ambiguous": [], "total_checked": 0}

    # Fetch Splitwise expenses for the last 6 months (paginated)
    dated_after = (dt.datetime.now() - dt.timedelta(days=180)).strftime("%Y-%m-%dT00:00:00Z")
    headers = {"Authorization": f"Bearer {token}"}
    all_expenses = []
    offset = 0
    limit = 100
    while True:
        resp = requests.get(
            f"{API_BASE}/get_expenses",
            headers=headers,
            params={"dated_after": dated_after, "limit": limit, "offset": offset},
        )
        if resp.status_code != 200:
            break
        expenses = resp.json().get("expenses", [])
        if not expenses:
            break
        # Skip deleted or payment/settlement entries
        all_expenses.extend([
            e for e in expenses
            if not e.get("deleted_at") and not e.get("payment")
        ])
        if len(expenses) < limit:
            break
        offset += limit

    # Parse into lightweight dicts
    def parse_exp(e):
        try:
            return {
                "id": str(e["id"]),
                "description": e.get("description", ""),
                "cost": round(float(e.get("cost", "0")), 2),
                "date": (e.get("date") or "")[:10],
                "group_id": e.get("group_id"),
            }
        except Exception:
            return None

    parsed = [p for p in (parse_exp(e) for e in all_expenses) if p]

    confident = []
    ambiguous = []
    used_exp_ids = set()  # prevent same Splitwise expense matching multiple txns

    for tx in unsynced:
        try:
            tx_amount = round(tx.amount, 2)
            tx_date = dt.datetime.strptime((tx.date or "")[:10], "%Y-%m-%d").date()
        except ValueError:
            continue

        matches = []
        for exp in parsed:
            if abs(exp["cost"] - tx_amount) < 0.01:
                try:
                    exp_date = dt.datetime.strptime(exp["date"], "%Y-%m-%d").date()
                    if abs((exp_date - tx_date).days) <= 3:
                        matches.append(exp)
                except ValueError:
                    pass

        if not matches:
            continue

        tx_info = {
            "tx_id": tx.id,
            "tx_name": tx.name,
            "tx_amount": tx_amount,
            "tx_date": (tx.date or "")[:10],
        }

        if len(matches) == 1 and matches[0]["id"] not in used_exp_ids:
            used_exp_ids.add(matches[0]["id"])
            confident.append({
                **tx_info,
                "splitwise_expense_id": matches[0]["id"],
                "splitwise_description": matches[0]["description"],
                "splitwise_date": matches[0]["date"],
            })
        else:
            # Filter out already-claimed expenses
            available = [m for m in matches if m["id"] not in used_exp_ids]
            ambiguous.append({**tx_info, "matches": available if available else matches})

    return {"confident": confident, "ambiguous": ambiguous, "total_checked": len(unsynced)}


@router.post("/reconcile/apply")
def apply_reconcile(data: dict, db: Session = Depends(get_db)):
    """Mark a list of {tx_id, splitwise_expense_id} pairs as synced."""
    matches = data.get("matches", [])
    applied = 0
    for m in matches:
        tx = db.query(TransactionModel).filter(TransactionModel.id == m["tx_id"]).first()
        if tx:
            tx.is_synced = True
            tx.is_ignored = False
            tx.splitwise_expense_id = str(m["splitwise_expense_id"]) if m.get("splitwise_expense_id") else None
            applied += 1
    db.commit()
    return {"status": "success", "applied": applied}


@router.post("/pull")
def pull_splitwise_expenses(db: Session = Depends(get_db)):
    """Import Splitwise expenses created outside this app as synced local records."""
    import datetime as dt
    token = get_splitwise_token(db)
    if not token:
        raise HTTPException(status_code=401, detail="Splitwise not connected")

    dated_after = (dt.datetime.now() - dt.timedelta(days=180)).strftime("%Y-%m-%dT00:00:00Z")
    headers = {"Authorization": f"Bearer {token}"}
    all_expenses = []
    offset = 0
    limit = 100
    while True:
        resp = requests.get(
            f"{API_BASE}/get_expenses",
            headers=headers,
            params={"dated_after": dated_after, "limit": limit, "offset": offset},
        )
        if resp.status_code != 200:
            break
        expenses = resp.json().get("expenses", [])
        if not expenses:
            break
        all_expenses.extend([e for e in expenses if not e.get("deleted_at") and not e.get("payment")])
        if len(expenses) < limit:
            break
        offset += limit

    added = 0
    for e in all_expenses:
        exp_id = str(e["id"])
        existing = db.query(TransactionModel).filter(TransactionModel.splitwise_expense_id == exp_id).first()
        if existing:
            continue
        cost = round(float(e.get("cost", "0")), 2)
        if cost <= 0:
            continue
        date = (e.get("date") or "")[:10]
        group_id = e.get("group_id")
        new_tx = TransactionModel(
            plaid_transaction_id=f"sw_pull_{exp_id}",
            account_id="splitwise",
            amount=cost,
            date=date,
            name=e.get("description", "Splitwise Expense"),
            category="General",
            bank_name="Splitwise",
            is_synced=True,
            is_ignored=False,
            splitwise_expense_id=exp_id,
            splitwise_group_id=str(group_id) if group_id else None,
        )
        db.add(new_tx)
        added += 1

    db.commit()
    return {"status": "success", "added": added}


@router.post("/expense")
def add_expense(expense_data: dict, db: Session = Depends(get_db)):
    """Creates a new expense in Splitwise."""
    token = get_splitwise_token(db)
    if not token:
        # Mock successful push for testing when not connected
        return {"expenses": [{"id": "mock_expense_123", "cost": expense_data.get("cost"), "description": expense_data.get("description")}]}
        
    headers = {"Authorization": f"Bearer {token}"}
    
    # Splitwise create_expense uses form-encoded data with flat user keys
    # e.g. users__0__user_id, users__0__paid_share, users__0__owed_share
    payload = {
        "cost": str(expense_data.get("cost", "0")),
        "description": expense_data.get("description", ""),
        "group_id": expense_data.get("group_id"),
        "currency_code": "USD",
    }
    
    # Add optional date if provided
    if "date" in expense_data:
        payload["date"] = expense_data["date"]
    
    # Convert users array to Splitwise's flat form format
    users = expense_data.get("users", [])
    if users:
        for i, user in enumerate(users):
            payload[f"users__{i}__user_id"] = user.get("user_id")
            payload[f"users__{i}__paid_share"] = str(user.get("paid_share", "0.00"))
            payload[f"users__{i}__owed_share"] = str(user.get("owed_share", "0.00"))
    else:
        payload["split_equally"] = "true"

    print(f"DEBUG: Pushing to Splitwise with payload: {payload}")
    # Use data= (form-encoded) not json= — Splitwise requires form encoding for users
    response = requests.post(f"{API_BASE}/create_expense", headers=headers, data=payload)
    
    result = response.json()
    print(f"DEBUG: Splitwise response status: {response.status_code}, body: {result}")
    
    # Splitwise returns HTTP 200 even on failure - errors appear in response body
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Splitwise API error: {result}")
    
    if result.get("errors") and (result["errors"].get("base") or any(result["errors"].values())):
        raise HTTPException(status_code=400, detail=f"Splitwise rejected expense: {result['errors']}")

    return result


@router.post("/summary-expense")
async def create_summary_expense(
    tx_ids: str = Form(...),          # JSON-encoded list of int IDs: "[1,2,3]"
    description: str = Form(...),
    group_id: str = Form(...),
    users_json: str = Form(None),     # JSON-encoded users array [{user_id, paid_share, owed_share}]
    receipt: UploadFile = FastAPIFile(None),  # Optional receipt PNG
    db: Session = Depends(get_db)
):
    """Push multiple transactions as one summary expense to Splitwise."""
    import json

    ids = json.loads(tx_ids)
    txs = db.query(TransactionModel).filter(TransactionModel.id.in_(ids)).all()
    if not txs:
        raise HTTPException(status_code=404, detail="No transactions found")

    total = round(sum(t.amount for t in txs), 2)
    token = get_splitwise_token(db)

    payload = {
        "cost": str(total),
        "description": description,
        "group_id": group_id,
        "currency_code": "USD",
    }

    # Apply user split data if provided, else fall back to split_equally
    if users_json:
        users = json.loads(users_json)
        for i, user in enumerate(users):
            payload[f"users__{i}__user_id"] = user.get("user_id")
            payload[f"users__{i}__paid_share"] = str(user.get("paid_share", "0.00"))
            payload[f"users__{i}__owed_share"] = str(user.get("owed_share", "0.00"))
    else:
        payload["split_equally"] = "true"

    headers = {"Authorization": f"Bearer {token}"} if token else {}

    if token:
        # Try multipart if receipt provided, else standard form-encoded
        if receipt:
            receipt_bytes = await receipt.read()
            files = {"receipt": (receipt.filename, receipt_bytes, "image/png")}
            response = requests.post(f"{API_BASE}/create_expense", headers=headers, data=payload, files=files)
        else:
            response = requests.post(f"{API_BASE}/create_expense", headers=headers, data=payload)

        result = response.json()
        print(f"DEBUG summary-expense: status={response.status_code}, body={result}")

        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Splitwise API error: {result}")
        if result.get("errors") and any(result["errors"].values()):
            raise HTTPException(status_code=400, detail=f"Splitwise rejected expense: {result['errors']}")

        expense_id = str(result.get("expenses", [{}])[0].get("id", ""))
    else:
        # Mock mode (no Splitwise token)
        expense_id = "mock_summary_expense"

    # Mark all included transactions as synced
    for tx in txs:
        tx.is_synced = True
        tx.is_ignored = False
        tx.splitwise_expense_id = expense_id
        tx.splitwise_group_id = group_id
    db.commit()

    return {"status": "success", "expense_id": expense_id, "total": total, "synced_count": len(txs)}

