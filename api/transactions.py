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

from db.database import get_db, UserModel, Transaction, BankConnection

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
        
        # Determine institution name safely
        item_response = client.item_get(ItemGetRequest(access_token=access_token))
        institution_id = item_response['item']['institution_id']
        inst_req = InstitutionsGetByIdRequest(institution_id=institution_id, country_codes=[CountryCode('US')])
        bank_name = client.institutions_get_by_id(inst_req)['institution']['name']
        
        exists = db.query(BankConnection).filter(BankConnection.access_token == access_token).first()
        if not exists:
            conn = BankConnection(access_token=access_token, institution_name=bank_name)
            db.add(conn)
            
            # Legacy fallback bridging
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
def sync_transactions(days: str = '30', db: Session = Depends(get_db)):
    """Fetches new transactions concurrently across all registered Plaid items."""
    connections = db.query(BankConnection).all()
    
    import datetime
    cutoff_date = None
    if days != 'all':
        try:
            cutoff_date = (datetime.datetime.now() - datetime.timedelta(days=int(days))).strftime("%Y-%m-%d")
        except ValueError:
            pass
    user = db.query(UserModel).filter(UserModel.id == 1).first()
    
    # Fallback auto-bridging for edge testing
    if len(connections) == 0 and user and user.plaid_access_token:
        connections = [BankConnection(id=0, access_token=user.plaid_access_token, institution_name="Legacy Bank Mapping")]
    
    def normalize_plaid_transaction(p_tx):
        display_name = p_tx.get('merchant_name') or p_tx.get('name')
        category = p_tx.get('category', ['General'])[0] if p_tx.get('category') else "General"
        return {
            "plaid_id": p_tx['transaction_id'],
            "account_id": p_tx['account_id'],
            "amount": p_tx['amount'],
            "date": str(p_tx['date']),
            "name": display_name,
            "category": category
        }

    if not connections:
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
            if mapped['amount'] <= 0: continue
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

    # ITERATE REAL BANKS
    total_added = 0
    all_transactions_added = []
    
    for conn in connections:
        try:
            sync_cursor = getattr(conn, "sync_cursor", None) or ""
            has_more = True
            
            while has_more:
                request = TransactionsSyncRequest(
                    access_token=conn.access_token,
                    cursor=sync_cursor,
                    count=500
                )
                response = client.transactions_sync(request)
                
                for p_tx in response['added']:
                    mapped = normalize_plaid_transaction(p_tx)
                    if mapped['amount'] <= 0: continue
                    if cutoff_date and mapped['date'] < cutoff_date: continue
                    
                    exists = db.query(Transaction).filter(Transaction.plaid_transaction_id == mapped['plaid_id']).first()
                    if not exists:
                        new_tx = Transaction(
                            plaid_transaction_id=mapped['plaid_id'],
                            account_id=mapped['account_id'],
                            amount=mapped['amount'],
                            date=mapped['date'],
                            name=mapped['name'],
                            category=mapped['category'],
                            bank_name=conn.institution_name,
                            is_synced=False
                        )
                        db.add(new_tx)
                        all_transactions_added.append(mapped['name'])
                        total_added += 1

                for p_tx in response.get('modified', []):
                    mapped = normalize_plaid_transaction(p_tx)
                    existing_tx = db.query(Transaction).filter(Transaction.plaid_transaction_id == mapped['plaid_id']).first()
                    if existing_tx:
                        existing_tx.amount = mapped['amount']
                        existing_tx.name = mapped['name']
                        existing_tx.category = mapped['category']

                for p_tx in response.get('removed', []):
                    removed_id = p_tx.get('transaction_id')
                    if removed_id:
                        db.query(Transaction).filter(Transaction.plaid_transaction_id == removed_id).delete(synchronize_session=False)
                        
                sync_cursor = response['next_cursor']
                has_more = response['has_more']
                
            try:
                conn.sync_cursor = sync_cursor
            except Exception:
                pass
                
        except Exception as e:
            print(f"Failed sync for {conn.institution_name}: {e}")

    db.commit()
    return {"status": "success", "added": total_added, "transactions": all_transactions_added}

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
    """Check if Plaid is connected and migrate tokens gracefully"""
    connections = db.query(BankConnection).all()
    user = db.query(UserModel).filter(UserModel.id == 1).first()
    
    if len(connections) == 0 and user and user.plaid_access_token:
        # Zero-Friction Migration Array Backfilling!
        try:
            item_response = client.item_get(ItemGetRequest(access_token=user.plaid_access_token))
            institution_id = item_response['item']['institution_id']
            inst_req = InstitutionsGetByIdRequest(institution_id=institution_id, country_codes=[CountryCode('US')])
            bank_name = client.institutions_get_by_id(inst_req)['institution']['name']
            
            new_conn = BankConnection(access_token=user.plaid_access_token, institution_name=bank_name)
            db.add(new_conn)
            db.commit()
            connections = [new_conn]
        except Exception:
            pass

    formatted = [{"id": c.id, "institution_name": c.institution_name} for c in connections]
    connected = len(connections) > 0
    return {"connected": connected, "connections": formatted}

@router.get("/")
def get_recorded_transactions(db: Session = Depends(get_db)):
    """Fetch all stored transactions from the local database"""
    txs = db.query(Transaction).order_by(Transaction.date.desc()).all()
    return txs
