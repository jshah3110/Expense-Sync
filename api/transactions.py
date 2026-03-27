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
    force_reset = False
    errors = []
    
    if days == 'all':
        force_reset = True
    else:
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
        
        pf_cat = p_tx.get('personal_finance_category')
        if pf_cat and pf_cat.get('primary'):
            category = pf_cat['primary'].replace('_', ' ').title()
        else:
            category = p_tx.get('category', ['General'])[0] if p_tx.get('category') else "General"
            
        return {
            "plaid_id": p_tx['transaction_id'],
            "account_id": p_tx['account_id'],
            "amount": p_tx['amount'],
            "date": str(p_tx['date']),
            "name": display_name,
            "category": category,
            "logo_url": p_tx.get('logo_url')
        }

    if not connections:
        # RETURN MOCK DATA FOR TESTING — use relative dates so filters always show them
        today = datetime.datetime.now()
        mock_raw = [
            {"transaction_id": "mock1", "account_id": "acc1", "amount": 24.50, "date": (today - datetime.timedelta(days=2)).strftime("%Y-%m-%d"), "name": "Uber 063015 SF", "merchant_name": "Uber", "category": ["Transport"]},
            {"transaction_id": "mock2", "account_id": "acc1", "amount": 142.10, "date": (today - datetime.timedelta(days=4)).strftime("%Y-%m-%d"), "name": "Whole Foods Market", "merchant_name": "Whole Foods", "category": ["Groceries"]},
            {"transaction_id": "mock3", "account_id": "acc1", "amount": 15.99, "date": (today - datetime.timedelta(days=6)).strftime("%Y-%m-%d"), "name": "Netflix.com", "merchant_name": "Netflix", "category": ["Entertainment"]},
            {"transaction_id": "mock4", "account_id": "acc1", "amount": 32.00, "date": (today - datetime.timedelta(days=10)).strftime("%Y-%m-%d"), "name": "AMC Theatres 1234", "merchant_name": "AMC Theatres", "category": ["Entertainment"]},
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
                    logo_url=mapped.get('logo_url'),
                    is_synced=False
                )
                db.add(new_tx)
                added_count += 1
            else:
                # Update date to keep it fresh (relative to today)
                exists.date = mapped['date']
        
        db.commit()
        return {"status": "success", "added": added_count}

    # ITERATE REAL BANKS
    total_added = 0
    all_transactions_added = []
    
    for conn in connections:
        try:
            if force_reset:
                conn.sync_cursor = None
                db.commit()
                
            sync_cursor = getattr(conn, "sync_cursor", None) or ""
            has_more = True
            
            while has_more:
                request = TransactionsSyncRequest(
                    access_token=conn.access_token,
                    cursor=sync_cursor,
                    count=500
                )
                response = client.transactions_sync(request)
                
                # The Plaid python SDK returns un-iterable class objects. Recursing into pure dicts natively!
                try:
                    res_dict = response.to_dict()
                except AttributeError:
                    res_dict = response

                for p_tx in res_dict.get('added', []):
                    try:
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
                                logo_url=mapped.get('logo_url'),
                                is_synced=False
                            )
                            db.add(new_tx)
                            all_transactions_added.append(mapped['name'])
                            total_added += 1
                    except Exception as loop_e:
                        errors.append(f"Parsing skip: {str(loop_e)}")

                for p_tx in res_dict.get('modified', []):
                    try:
                        mapped = normalize_plaid_transaction(p_tx)
                        existing_tx = db.query(Transaction).filter(Transaction.plaid_transaction_id == mapped['plaid_id']).first()
                        if existing_tx:
                            existing_tx.amount = mapped['amount']
                            existing_tx.name = mapped['name']
                            existing_tx.category = mapped['category']
                    except Exception:
                        pass

                for p_tx in res_dict.get('removed', []):
                    try:
                        removed_id = p_tx.get('transaction_id')
                        if removed_id:
                            db.query(Transaction).filter(Transaction.plaid_transaction_id == removed_id).delete(synchronize_session=False)
                    except Exception:
                        pass
                        
                sync_cursor = res_dict.get('next_cursor', '')
                has_more = res_dict.get('has_more', False)
                
            try:
                conn.sync_cursor = sync_cursor
            except Exception:
                pass
                
        except Exception as e:
            errors.append(f"Fatal remote hook: {str(e)}")
            print(f"Failed sync for {conn.institution_name}: {e}")

    db.commit()
    return {"status": "success", "added": total_added, "transactions": all_transactions_added, "errors": errors}

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

@router.patch("/{tx_id}/unmark_synced")
def unmark_transaction_synced(tx_id: int, db: Session = Depends(get_db)):
    """Revert a transaction's synced status (move back to backlog)."""
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    tx.is_synced = False
    tx.splitwise_expense_id = None
    db.commit()
    return {"status": "success"}

@router.patch("/{tx_id}/ignore")
def ignore_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Mark a transaction as ignored (others tab)."""
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    tx.is_ignored = True
    tx.is_synced = False
    db.commit()
    return {"status": "success"}

@router.patch("/{tx_id}/unignore")
def unignore_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Restore an ignored transaction to the backlog."""
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    tx.is_ignored = False
    tx.is_synced = False
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

@router.get("/analytics")
def get_analytics(db: Session = Depends(get_db)):
    """Fetch aggregated analytics data for the dashboard"""
    # Fetch all except ignored transactions
    txs = db.query(Transaction).filter(Transaction.is_ignored == False).order_by(Transaction.date.asc()).all()
    
    today = datetime.datetime.now()
    current_month = today.strftime('%Y-%m')
    last_month_date = (today.replace(day=1) - datetime.timedelta(days=1))
    last_month = last_month_date.strftime('%Y-%m')
    
    summary = {
        "total_this_month": 0,
        "total_last_month": 0,
        "total_all_time": 0,
        "transaction_count": len(txs),
        "synced_count": 0,
        "synced_total": 0,
        "synced_percentage": 0
    }
    
    category_map = {}
    month_map = {}
    
    # Store raw daily sums
    daily_sums_this_month = {str(d).zfill(2): 0 for d in range(1, 32)}
    daily_sums_last_month = {str(d).zfill(2): 0 for d in range(1, 32)}

    for t in txs:
        amount = t.amount
        t_month = t.date[:7] if t.date else ''
        cat = t.category or "General"

        # Overall summary aggregation
        summary["total_all_time"] += amount
        
        # Pacing data
        if t.date:
            day_str = t.date[8:10]
            if t_month == current_month:
                summary["total_this_month"] += amount
                if day_str in daily_sums_this_month:
                    daily_sums_this_month[day_str] += amount
            elif t_month == last_month:
                summary["total_last_month"] += amount
                if day_str in daily_sums_last_month:
                    daily_sums_last_month[day_str] += amount

        if t_month == current_month and t.is_synced:
            summary["synced_count"] += 1
            summary["synced_total"] += amount

        # Category grouping (All Time for now, could be scoped to current month if preferred later)
        if cat not in category_map:
            category_map[cat] = {"category": cat, "total": 0, "count": 0}
        category_map[cat]["total"] += amount
        category_map[cat]["count"] += 1
        
        # Monthly grouping
        if t_month:
            if t_month not in month_map:
                month_map[t_month] = {"month": t_month, "personal": 0, "synced": 0, "total": 0, "count": 0}
            if t.is_synced:
                month_map[t_month]["synced"] += amount
            else:
                month_map[t_month]["personal"] += amount
            month_map[t_month]["total"] += amount
            month_map[t_month]["count"] += 1
            
    # Calculate percentage
    if summary["total_this_month"] > 0:
        summary["synced_percentage"] = round((summary["synced_total"] / summary["total_this_month"]) * 100)

    # Build cumulative pacing arrays (carry forward logic)
    pacing_data = []
    cum_this = 0
    cum_last = 0
    
    last_day_of_last_month = last_month_date.day
    current_day = today.day

    for d in range(1, 32):
        day_str = str(d).zfill(2)
        
        # Determine if we should plot this point
        val_this = None
        if d <= current_day:
            cum_this += daily_sums_this_month[day_str]
            val_this = round(cum_this, 2)
            
        val_last = None
        if d <= last_day_of_last_month:
            cum_last += daily_sums_last_month[day_str]
            val_last = round(cum_last, 2)
            
        # Only add valid days (e.g. stop at 30 for April)
        if d <= max(current_day, last_day_of_last_month):
            pacing_data.append({
                "day": day_str,
                "this_month": val_this,
                "last_month": val_last
            })

    # Sort categories, months chronologically
    by_category = sorted(list(category_map.values()), key=lambda x: x['total'], reverse=True)
    by_month = sorted(list(month_map.values()), key=lambda x: x['month'])[-6:] # Last 6 months

    return {
        "summary": summary,
        "by_category": by_category,
        "by_month": by_month,
        "pacing": pacing_data
    }

@router.get("/")
def get_recorded_transactions(db: Session = Depends(get_db)):
    """Fetch all stored transactions from the local database"""
    txs = db.query(Transaction).order_by(Transaction.date.desc()).all()
    return txs
