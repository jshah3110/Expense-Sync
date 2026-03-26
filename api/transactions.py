from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import os
import datetime
from pydantic import BaseModel
import plaid
from plaid.api import plaid_api
import certifi
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.item_get_request import ItemGetRequest
from plaid.model.institutions_get_by_id_request import InstitutionsGetByIdRequest

from db.database import get_db, UserModel, Transaction

router = APIRouter()

PLAID_CLIENT_ID = os.getenv('PLAID_CLIENT_ID')
PLAID_SECRET = os.getenv('PLAID_SECRET')
PLAID_ENV = os.getenv('PLAID_ENV', 'sandbox')

# Plaid configuration
if PLAID_ENV == 'production':
    host_env = plaid.Environment.Production
elif PLAID_ENV == 'development':
    host_env = plaid.Environment.Development
else:
    host_env = plaid.Environment.Sandbox

configuration = plaid.Configuration(
    host=host_env,
    api_key={
        'clientId': PLAID_CLIENT_ID,
        'secret': PLAID_SECRET,
    }
)
configuration.ssl_ca_cert = certifi.where()

api_client = plaid.ApiClient(configuration)
client = plaid_api.PlaidApi(api_client)

class LinkTokenRequest(BaseModel):
    redirect_uri: str = None

class BulkDeleteRequest(BaseModel):
    tx_ids: list[int]

class PublicTokenRequest(BaseModel):
    public_token: str

class MockTransactionRequest(BaseModel):
    name: str
    amount: float
    category: str
    date: str = None

@router.post("/create_link_token")
def create_link_token(req: LinkTokenRequest = None):
    try:
        # Use a more unique user ID to avoid "Remember Me" friction in sandbox
        unique_user_id = f"user-{datetime.datetime.now().strftime('%M%S')}"
        request_params = {
            "products": [Products("transactions")],
            "client_name": "Expense Tracker",
            "country_codes": [CountryCode("US")],
            "language": "en",
            "user": LinkTokenCreateRequestUser(client_user_id=unique_user_id)
        }
        
        if req and req.redirect_uri:
            request_params["redirect_uri"] = req.redirect_uri
            
        request = LinkTokenCreateRequest(**request_params)
        response = client.link_token_create(request)
        return {"link_token": response['link_token']}
    except plaid.ApiException as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/set_access_token")
def set_access_token(request: PublicTokenRequest, db: Session = Depends(get_db)):
    try:
        exchange_request = ItemPublicTokenExchangeRequest(
            public_token=request.public_token
        )
        response = client.item_public_token_exchange(exchange_request)
        access_token = response['access_token']
        
        # Save token for user
        user = db.query(UserModel).filter(UserModel.id == 1).first()
        if not user:
            user = UserModel(id=1)
            db.add(user)
        
        user.plaid_access_token = access_token
        db.commit()
        
        return {"status": "success"}
    except plaid.ApiException as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/sync")
def sync_transactions(db: Session = Depends(get_db)):
    """Fetches new transactions from Plaid using transactions_sync endpoint"""
    user = db.query(UserModel).filter(UserModel.id == 1).first()
    
    def normalize_plaid_transaction(p_tx):
        # Prefer merchant_name if Plaid provided it, otherwise use 'name'
        display_name = p_tx.get('merchant_name') or p_tx.get('name')
        # Standardize category (Plaid returns a list, we just want the first item)
        category = p_tx.get('category', ['General'])[0] if p_tx.get('category') else "General"
        return {
            "plaid_id": p_tx['transaction_id'],
            "account_id": p_tx['account_id'],
            "amount": p_tx['amount'],
            "date": str(p_tx['date']),
            "name": display_name,
            "category": category
        }

    if not user or not user.plaid_access_token:
        # RETURN MOCK DATA FOR TESTING
        mock_raw = [
            {"transaction_id": "mock1", "account_id": "acc1", "amount": 24.50, "date": "2026-03-14", "name": "Uber 063015 SF", "merchant_name": "Uber", "category": ["Transport"]},
            {"transaction_id": "mock2", "account_id": "acc1", "amount": 142.10, "date": "2026-03-13", "name": "Whole Foods Market", "merchant_name": "Whole Foods", "category": ["Groceries"]},
            {"transaction_id": "mock3", "account_id": "acc1", "amount": 15.99, "date": "2026-03-12", "name": "Netflix.com", "merchant_name": "Netflix", "category": ["Entertainment"]},
            {"transaction_id": "mock4", "account_id": "acc1", "amount": 32.00, "date": "2026-03-10", "name": "AMC Theatres 1234", "merchant_name": "AMC Theatres", "category": ["Entertainment"]},
        ]
        
        added_count = 0
        for raw_tx in mock_raw:
            mapped = normalize_plaid_transaction(raw_tx)
            if mapped['amount'] <= 0:  # Skip credits/income
                continue
            exists = db.query(Transaction).filter(Transaction.plaid_transaction_id == mapped['plaid_id']).first()
            if not exists:
                new_tx = Transaction(
                    plaid_transaction_id=mapped['plaid_id'],
                    account_id=mapped['account_id'],
                    amount=mapped['amount'],
                    date=mapped['date'],
                    name=mapped['name'],
                    category=mapped['category'],
                    bank_name="Mock Bank",
                    is_synced=False
                )
                db.add(new_tx)
                added_count += 1
        
        db.commit()
        return {"status": "success", "added": added_count}

    try:
        # Get Institution Name for Bank Label
        item_response = client.item_get(ItemGetRequest(access_token=user.plaid_access_token))
        institution_id = item_response['item']['institution_id']
        inst_req = InstitutionsGetByIdRequest(institution_id=institution_id, country_codes=[CountryCode('US')])
        inst_response = client.institutions_get_by_id(inst_req)
        bank_name = inst_response['institution']['name']

        # In a real app we would track the cursor
        cursor = "" 
        
        request = TransactionsSyncRequest(
            access_token=user.plaid_access_token,
            cursor=cursor,
            count=100
        )
        response = client.transactions_sync(request)
        
        transactions_added = []
        for p_tx in response['added']:
            mapped = normalize_plaid_transaction(p_tx)
            if mapped['amount'] <= 0:  # Skip credits/income (Plaid: positive = debit, negative = credit)
                continue
            # Check if exists
            exists = db.query(Transaction).filter(Transaction.plaid_transaction_id == mapped['plaid_id']).first()
            if not exists:
                new_tx = Transaction(
                    plaid_transaction_id=mapped['plaid_id'],
                    account_id=mapped['account_id'],
                    amount=mapped['amount'],
                    date=mapped['date'],
                    name=mapped['name'],
                    category=mapped['category'],
                    bank_name=bank_name,
                    is_synced=False
                )
                db.add(new_tx)
                transactions_added.append(mapped['name'])
                
        db.commit()
        return {"status": "success", "added": len(transactions_added), "transactions": transactions_added}

    except plaid.ApiException as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/mock")
def add_manual_mock_transaction(request: MockTransactionRequest, db: Session = Depends(get_db)):
    """Allows manual injection of mock transactions for testing."""
    timestamp = datetime.datetime.now().strftime("%f")
    new_tx = Transaction(
        plaid_transaction_id=f"mock_manual_{timestamp}",
        account_id="manual_acc",
        amount=request.amount,
        date=request.date or datetime.datetime.now().strftime("%Y-%m-%d"),
        name=request.name,
        category=request.category,
        bank_name="Manual Entry",
        is_synced=False
    )
    db.add(new_tx)
    db.commit()
    return {"status": "success", "transaction_id": new_tx.plaid_transaction_id}

@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Delete a transaction from the database"""
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    db.delete(tx)
    db.commit()
    return {"status": "success"}

@router.post("/bulk_delete")
def bulk_delete_transactions(request: BulkDeleteRequest, db: Session = Depends(get_db)):
    """Delete multiple transactions simultaneously"""
    db.query(Transaction).filter(Transaction.id.in_(request.tx_ids)).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "deleted": len(request.tx_ids)}

@router.patch("/{tx_id}/mark_synced")
def mark_transaction_synced(tx_id: int, data: dict, db: Session = Depends(get_db)):
    """Mark a transaction as pushed to Splitwise."""
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    tx.is_synced = True
    tx.splitwise_expense_id = data.get("splitwise_expense_id")
    tx.splitwise_group_id = str(data.get("group_id", ""))
    db.commit()
    return {"status": "success"}

@router.get("/status")
def get_plaid_status(db: Session = Depends(get_db)):
    """Check if Plaid is connected (token exists)"""
    user = db.query(UserModel).filter(UserModel.id == 1).first()
    connected = user is not None and user.plaid_access_token is not None
    return {"connected": connected}

@router.get("/")
def get_recorded_transactions(db: Session = Depends(get_db)):
    """Fetch all stored transactions from the local database"""
    txs = db.query(Transaction).order_by(Transaction.date.desc()).all()
    return txs
