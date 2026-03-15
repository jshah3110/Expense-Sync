from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import os
import requests
from urllib.parse import urlencode
from db.database import get_db, UserModel

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

@router.post("/expense")
def add_expense(expense_data: dict, db: Session = Depends(get_db)):
    """Creates a new expense in Splitwise."""
    token = get_splitwise_token(db)
    if not token:
        # Mock successful push for testing when not connected
        return {"expenses": [{"id": "mock_expense_123", "cost": expense_data.get("cost"), "description": expense_data.get("description")}]}
        
    headers = {"Authorization": f"Bearer {token}"}
    
    # Basic mapping, this would need to adhere to Splitwise's complex payload structure
    # https://dev.splitwise.com/#tag/expenses/paths/~1get_expenses/get
    payload = {
        "cost": expense_data.get("cost"),
        "description": expense_data.get("description"),
        "group_id": expense_data.get("group_id"),
        "currency_code": "USD" # Default to USD for now
    }
    
    # Add optional date if provided
    if "date" in expense_data:
        payload["date"] = expense_data["date"]
    
    # If the user provides an explicit 'users' list (for custom/share splits)
    if "users" in expense_data:
        payload["users"] = expense_data["users"]
    else:
        # Fallback to simple logic if 'users' not provided
        payload["split_equally"] = expense_data.get("split_equally", True)
        # If a specific payer is provided but using split_equally
        if "payer_id" in expense_data:
            # We'd normally need to calculate shares even for simple payer override in JSON API
            # For simplicity, we'll let the frontend handle building the 'users' array for most cases
            pass

    print(f"DEBUG: Pushing to Splitwise with payload: {payload}")
    response = requests.post(f"{API_BASE}/create_expense", headers=headers, json=payload)
    
    result = response.json()
    print(f"DEBUG: Splitwise response status: {response.status_code}, body: {result}")
    
    # Splitwise returns HTTP 200 even on failure - errors appear in response body
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Splitwise API error: {result}")
    
    if result.get("errors") and (result["errors"].get("base") or any(result["errors"].values())):
        raise HTTPException(status_code=400, detail=f"Splitwise rejected expense: {result['errors']}")
        
    return result
