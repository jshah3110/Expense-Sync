from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
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
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.liabilities_get_request import LiabilitiesGetRequest
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest

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
    access_token: str = None  # for Plaid update mode

class UpdateLinkTokenRequest(BaseModel):
    redirect_uri: str = None

class BulkDeleteRequest(BaseModel):
    tx_ids: list[int]

class BulkActionRequest(BaseModel):
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
        # Use a stable user ID in production for better session/item consistency
        stable_user_id = "user-1"
        request_params = {
            "client_name": "Expense Tracker",
            "country_codes": [CountryCode("US")],
            "language": "en",
            "user": LinkTokenCreateRequestUser(client_user_id=stable_user_id)
        }
        
        redirect_status = "omitted"
        if req and req.redirect_uri:
            request_params["redirect_uri"] = req.redirect_uri
            redirect_status = "accepted"

        if req and req.access_token:
            request_params["access_token"] = req.access_token
            # Products are not allowed when updating an existing item
            request_params.pop("products", None)
            current_products = []
        else:
            # We include 'auth' and 'liabilities' to ensure credit cards (like Bilt) are visible
            current_products = [Products("transactions"), Products("auth"), Products("balance"), Products("liabilities")]
        
        while True:
            try:
                if current_products:
                    request_params["products"] = current_products
                    
                # Filter out internal metadata from Plaid request params
                plaid_params = {k: v for k, v in request_params.items() if k != "rejected_products"}
                request = LinkTokenCreateRequest(**plaid_params)
                response = client.link_token_create(request)
                
                return {
                    "link_token": response['link_token'],
                    "oauth_redirect_missing": "redirect_uri" not in request_params,
                    "redirect_uri_status": redirect_status,
                    "accepted_products": [p.value for p in current_products],
                    "rejected_products": request_params.get("rejected_products", [])
                }
            except plaid.ApiException as e:
                import json as _json
                body = {}
                try:
                    body = _json.loads(e.body)
                except Exception:
                    pass
                
                error_code = body.get('error_code', '')
                error_msg = body.get('error_message', '').lower()

                # FOR BILT: Redirect URI is highly recommended for OAuth flow.
                # If it fails, we pop it and warn the user via metadata.
                if error_code == 'INVALID_FIELD' and 'redirect' in error_msg and request_params.get('redirect_uri'):
                    print(f"[Plaid] redirect_uri rejected, check Plaid Dashboard registration for {request_params.get('redirect_uri')}")
                    request_params.pop('redirect_uri')
                    redirect_status = "rejected"
                    continue

                # If a product is the problem, remove it and try again
                if error_code == 'INVALID_PRODUCT':
                    failed_product = None
                    for p in ["auth", "liabilities", "balance", "transactions"]:
                        if p in error_msg:
                            failed_product = p
                            break
                    
                    if failed_product:
                        # Add to rejected list for UI feedback
                        if "rejected_products" not in request_params:
                            request_params["rejected_products"] = []
                        if failed_product not in request_params["rejected_products"]:
                            request_params["rejected_products"].append(failed_product)
                            
                        print(f"[Plaid] Product '{failed_product}' rejected, removing from request.")
                        current_products = [p for p in current_products if p.value != failed_product]
                    elif len(current_products) > 1:
                        # Fallback: remove the last product that isn't transactions
                        remover = current_products.pop()
                        print(f"[Plaid] Retrying without product: {remover.value}")
                    else:
                        raise # Can't even do transactions? Raise it.
                    continue
                
                # If we get here, it's an unrecoverable error
                detail = body.get('error_message') or body.get('error_code') or str(e)
                raise HTTPException(status_code=400, detail=detail)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: int, db: Session = Depends(get_db)):
    """Remove a Plaid bank connection and its associated transactions."""
    conn = db.query(BankConnection).filter(BankConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    access_token = conn.access_token
    try:
        client.item_remove(ItemRemoveRequest(access_token=access_token))
    except Exception:
        pass  # If Plaid revocation fails, still clean up locally
    # Do NOT delete transactions — they retain their state (pushed/others/backlog)
    # so re-linking the same bank restores everything via plaid_transaction_id dedup
    db.delete(conn)
    # Also clear the legacy plaid_access_token so the status endpoint
    # doesn't recreate this connection via the migration path
    user = db.query(UserModel).filter(UserModel.id == 1).first()
    if user and user.plaid_access_token == access_token:
        user.plaid_access_token = None
    db.commit()
    return {"status": "deleted"}

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

            # Build account map {account_id: {mask, type, subtype}} before sync loop
            account_map = {}
            try:
                acc_res = client.accounts_balance_get(AccountsBalanceGetRequest(access_token=conn.access_token))
                for acc in (acc_res.to_dict() if hasattr(acc_res, 'to_dict') else acc_res).get('accounts', []):
                    account_map[acc.get('account_id')] = {
                        'mask': acc.get('mask'),
                        'type': str(acc.get('type', '')).lower(),
                        'subtype': str(acc.get('subtype', '')).lower().replace('_', ' '),
                    }
            except Exception:
                pass

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

                # DEBUG: Log sync progress
                added_count = len(res_dict.get('added', []))
                modified_count = len(res_dict.get('modified', []))
                removed_count = len(res_dict.get('removed', []))
                account_ids = set(tx.get('account_id') for tx in res_dict.get('added', []))
                print(f"[SYNC] {conn.institution_name}: +{added_count} ~{modified_count} -{removed_count} | Accounts: {account_ids}")

                for p_tx in res_dict.get('added', []):
                    try:
                        mapped = normalize_plaid_transaction(p_tx)
                        if mapped['amount'] <= 0: continue
                        if cutoff_date and mapped['date'] < cutoff_date: continue
                        
                        exists = db.query(Transaction).filter(Transaction.plaid_transaction_id == mapped['plaid_id']).first()
                        if not exists:
                            acc_info = account_map.get(mapped['account_id'], {})
                            new_tx = Transaction(
                                plaid_transaction_id=mapped['plaid_id'],
                                account_id=mapped['account_id'],
                                amount=mapped['amount'],
                                date=mapped['date'],
                                name=mapped['name'],
                                category=mapped['category'],
                                bank_name=conn.institution_name,
                                logo_url=mapped.get('logo_url'),
                                account_mask=acc_info.get('mask'),
                                account_type=acc_info.get('type'),
                                account_subtype=acc_info.get('subtype'),
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

                # Persist cursor after every page so a mid-sync failure
                # doesn't force a full restart next time
                if sync_cursor and conn.id:
                    conn.sync_cursor = sync_cursor
                    db.commit()

            # Backfill account_mask/type/subtype on existing transactions that lack it
            if account_map:
                existing_txs = db.query(Transaction).filter(
                    Transaction.account_id.in_(list(account_map.keys())),
                    Transaction.account_mask.is_(None)
                ).all()
                for tx in existing_txs:
                    acc_info = account_map.get(tx.account_id, {})
                    tx.account_mask = acc_info.get('mask')
                    tx.account_type = acc_info.get('type')
                    tx.account_subtype = acc_info.get('subtype')

            conn.last_sync_error = None
            db.commit()

            # --- NEW: Fetch Liabilities and Balance (Manual Only) ---
            try:
                # 1. Fetch Balances
                balance_req = AccountsBalanceGetRequest(access_token=conn.access_token)
                balance_res = client.accounts_balance_get(balance_req)
                
                # 2. Fetch Liabilities
                # Note: This may fail for some institutions, so we handle it gracefully
                lib_req = LiabilitiesGetRequest(access_token=conn.access_token)
                lib_res = client.liabilities_get(lib_req)
                
                # Update conn metadata based on the primary account (or first credit card found)
                primary_acc = None
                accounts = balance_res.get('accounts', [])
                
                # Prioritize credit card for Bilt users
                for acc in accounts:
                    if acc.get('type') == 'credit':
                        primary_acc = acc
                        break
                
                if not primary_acc and accounts:
                    primary_acc = accounts[0]
                
                if primary_acc:
                    conn.current_balance = primary_acc.get('balances', {}).get('current')
                    conn.available_balance = primary_acc.get('balances', {}).get('available')
                    
                    # Pull liability info if available
                    liabilities = lib_res.get('liabilities', {})
                    credit_libs = liabilities.get('credit', [])
                    for cl in credit_libs:
                        if cl.get('account_id') == primary_acc.get('account_id'):
                            conn.next_payment_date = str(cl.get('next_payment_due_date')) if cl.get('next_payment_due_date') else None
                            conn.minimum_payment = cl.get('minimum_payment_amount')
                            break
                    
                    db.commit()
                    print(f"[SYNC] {conn.institution_name} balance updated: {conn.current_balance}")
            except Exception as e_lib:
                # Log but don't fail the whole sync if liabilities/balance fails
                # (Some institutions might not support discovery products yet)
                print(f"[SYNC] Skipping liabilities for {conn.institution_name}: {str(e_lib)}")

        except plaid.ApiException as plaid_err:
            try:
                import json
                err_body = json.loads(plaid_err.body)
                error_code = err_body.get('error_code', 'PLAID_ERROR')
                error_msg = err_body.get('error_message', '')
            except Exception:
                error_code = 'PLAID_ERROR'
                error_msg = str(plaid_err)
            conn.last_sync_error = error_code
            db.commit()
            errors.append(f"{conn.institution_name}: {error_code} — {error_msg}")
            print(f"[SYNC ERROR] {conn.institution_name}: {error_code} — {error_msg}")
        except Exception as e:
            errors.append(f"Fatal remote hook: {str(e)}")
            print(f"[SYNC FATAL] {conn.institution_name}: {e}")

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
    db.refresh(new_tx)
    return {"status": "success", "id": new_tx.id, "transaction_id": new_tx.plaid_transaction_id}

@router.post("/import-csv")
async def import_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import transactions from Bilt CSV export (desktop export only)"""
    import csv
    from io import StringIO
    import hashlib

    try:
        contents = await file.read()
        csv_reader = csv.DictReader(StringIO(contents.decode('utf-8')))

        added = 0
        errors = []

        for row in csv_reader:
            try:
                # Map actual Bilt CSV columns
                date = row.get('Transaction Date')
                description = row.get('Description')
                raw_merchant = row.get('Raw Merchant Name', '')
                name = description or raw_merchant or 'Unknown'
                amount_str = row.get('Amount', '0')

                # Parse amount (handle potential formatting)
                amount = float(amount_str.replace('$', '').replace(',', ''))

                if amount <= 0: continue  # Skip refunds/payments/zero
                if not date: continue  # Skip rows without date

                # Generate unique ID from CSV row (dedup key)
                csv_id = hashlib.md5(f"{date}{name}{amount}".encode()).hexdigest()
                plaid_tx_id = f"csv_bilt_{csv_id}"

                exists = db.query(Transaction).filter(
                    Transaction.plaid_transaction_id == plaid_tx_id
                ).first()
                if exists: continue  # Skip duplicates

                new_tx = Transaction(
                    plaid_transaction_id=plaid_tx_id,
                    account_id="bilt_2.0_obsidian",
                    amount=amount,
                    date=date,
                    name=name,
                    category="General",  # Bilt CSV has no category
                    bank_name="Bilt 2.0 Obsidian",
                    is_synced=False
                )
                db.add(new_tx)
                added += 1

            except Exception as e:
                errors.append(f"Row error: {str(e)}")

        db.commit()
        return {"status": "success", "added": added, "errors": errors}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV import failed: {str(e)}")

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

@router.post("/bulk_ignore")
def bulk_ignore_transactions(request: BulkActionRequest, db: Session = Depends(get_db)):
    """Move multiple transactions to Others tab"""
    db.query(Transaction).filter(Transaction.id.in_(request.tx_ids)).update(
        {"is_ignored": True, "is_synced": False}, synchronize_session=False
    )
    db.commit()
    return {"status": "success", "updated": len(request.tx_ids)}

@router.post("/bulk_mark_synced")
def bulk_mark_synced_transactions(request: BulkActionRequest, db: Session = Depends(get_db)):
    """Mark multiple transactions as pushed (without Splitwise)"""
    db.query(Transaction).filter(Transaction.id.in_(request.tx_ids)).update(
        {"is_synced": True, "is_ignored": False}, synchronize_session=False
    )
    db.commit()
    return {"status": "success", "updated": len(request.tx_ids)}

@router.patch("/{tx_id}/mark_synced")
def mark_transaction_synced(tx_id: int, data: dict, db: Session = Depends(get_db)):
    """Mark a transaction as pushed to Splitwise."""
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    tx.is_synced = True
    tx.is_ignored = False
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

@router.patch("/connections/{connection_id}/clear_error")
def clear_connection_error(connection_id: int, db: Session = Depends(get_db)):
    conn = db.query(BankConnection).filter(BankConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    conn.last_sync_error = None
    conn.sync_cursor = None  # Reset cursor so full sync runs after re-authentication
    db.commit()
    return {"status": "ok"}

@router.post("/connections/{connection_id}/create_update_token")
def create_update_link_token(connection_id: int, req: UpdateLinkTokenRequest = None, db: Session = Depends(get_db)):
    conn = db.query(BankConnection).filter(BankConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    try:
        request_params = {
            "client_name": "Expense Tracker",
            "country_codes": [CountryCode("US")],
            "language": "en",
            "user": LinkTokenCreateRequestUser(client_user_id="user-1"),
            "access_token": conn.access_token,
        }
        
        redirect_status = "omitted"
        if req and req.redirect_uri:
            request_params["redirect_uri"] = req.redirect_uri
            redirect_status = "accepted"
        
        while True:
            try:
                request = LinkTokenCreateRequest(**request_params)
                response = client.link_token_create(request)
                return {
                    "link_token": response['link_token'],
                    "oauth_redirect_missing": "redirect_uri" not in request_params,
                    "redirect_uri_status": redirect_status,
                    "accepted_products": [] # Products not allowed in update mode
                }
            except plaid.ApiException as e:
                import json as _json
                body = {}
                try:
                    body = _json.loads(e.body)
                except Exception:
                    pass
                
                error_code = body.get('error_code', '')
                error_msg = body.get('error_message', '').lower()

                # Robust handling of redirect URIs in update mode too
                if error_code == 'INVALID_FIELD' and 'redirect' in error_msg and request_params.get('redirect_uri'):
                    print(f"[Plaid] update_mode redirect_uri rejected, retrying without it.")
                    request_params.pop('redirect_uri')
                    redirect_status = "rejected"
                    continue
                
                detail = body.get('error_message') or body.get('error_code') or str(e)
                raise HTTPException(status_code=400, detail=detail)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

    formatted = []
    for c in connections:
        conn_info = {
            "id": c.id,
            "institution_name": c.institution_name,
            "last_sync_error": c.last_sync_error,
            "plaid_item_error": None,
            "available_products": [],
            "billed_products": [],
            "needs_reconnect": False
        }
        # Check live Plaid item status to catch ITEM_LOGIN_REQUIRED etc.
        try:
            item_resp = client.item_get(ItemGetRequest(access_token=c.access_token))
            item = item_resp.to_dict().get('item', {}) if hasattr(item_resp, 'to_dict') else item_resp.get('item', {})
            item_error = item.get('error')
            conn_info["plaid_item_error"] = item_error.get('error_code') if item_error else None
            conn_info["available_products"] = [p.value if hasattr(p, 'value') else str(p) for p in item.get('available_products', [])]
            conn_info["billed_products"] = [p.value if hasattr(p, 'value') else str(p) for p in item.get('billed_products', [])]
            conn_info["needs_reconnect"] = conn_info["plaid_item_error"] in ["ITEM_LOGIN_REQUIRED", "INVALID_ACCESS_TOKEN"]
            
            # Add balance and liability metadata
            conn_info["current_balance"] = c.current_balance
            conn_info["available_balance"] = c.available_balance
            conn_info["next_payment_date"] = c.next_payment_date
            conn_info["minimum_payment"] = c.minimum_payment
        except Exception as e:
            conn_info["plaid_item_error"] = f"status_check_failed: {str(e)}"
            conn_info["needs_reconnect"] = True

        formatted.append(conn_info)

    connected = len(connections) > 0
    return {"connected": connected, "connections": formatted}

@router.get("/analytics")
def get_analytics(month: str = None, db: Session = Depends(get_db)):
    """Fetch aggregated analytics data for the dashboard. Accepts optional ?month=YYYY-MM to filter."""
    import calendar

    # Fetch all transactions (both synced and not synced/"Others")
    txs = db.query(Transaction).order_by(Transaction.date.asc()).all()

    today = datetime.datetime.now()
    current_month = today.strftime('%Y-%m')

    # Resolve target month (default to current)
    target_month = month if month else current_month
    try:
        target_dt = datetime.datetime.strptime(target_month + "-01", "%Y-%m-%d")
    except ValueError:
        target_dt = today
        target_month = current_month

    # Compute previous month
    prev_dt = target_dt.replace(day=1) - datetime.timedelta(days=1)
    prev_month = prev_dt.strftime('%Y-%m')

    # Days in each month
    days_in_target = calendar.monthrange(target_dt.year, target_dt.month)[1]
    days_in_prev = calendar.monthrange(prev_dt.year, prev_dt.month)[1]

    # For current month only go up to today; for past months use the full month
    target_last_day = today.day if target_month == current_month else days_in_target

    summary = {
        "total_this_month": 0,
        "total_last_month": 0,
        "total_all_time": 0,
        "transaction_count": 0,
        "synced_count": 0,
        "synced_total": 0,
        "synced_percentage": 0,
        "unsynced_total": 0,
        "unsynced_percentage": 0,
        "target_month": target_month,
        "prev_month": prev_month,
    }

    category_map = {}
    month_map = {}

    daily_sums_target = {str(d).zfill(2): 0 for d in range(1, 32)}
    daily_sums_prev   = {str(d).zfill(2): 0 for d in range(1, 32)}
    daily_synced_target = {str(d).zfill(2): 0 for d in range(1, 32)}
    daily_synced_prev   = {str(d).zfill(2): 0 for d in range(1, 32)}

    for t in txs:
        amount  = t.amount
        t_month = t.date[:7] if t.date else ''
        cat     = t.category or "General"

        summary["total_all_time"] += amount

        if t.date:
            day_str = t.date[8:10]
            if t_month == target_month:
                summary["total_this_month"] += amount
                summary["transaction_count"] += 1
                if day_str in daily_sums_target:
                    daily_sums_target[day_str] += amount
                if t.is_synced and day_str in daily_synced_target:
                    daily_synced_target[day_str] += amount
                # Category breakdown scoped to target month
                if cat not in category_map:
                    category_map[cat] = {"category": cat, "total": 0, "count": 0, "synced": 0, "synced_count": 0}
                category_map[cat]["total"] += amount
                category_map[cat]["count"] += 1
                if t.is_synced:
                    summary["synced_count"] += 1
                    summary["synced_total"] += amount
                    category_map[cat]["synced"] += amount
                    category_map[cat]["synced_count"] += 1

            elif t_month == prev_month:
                summary["total_last_month"] += amount
                if day_str in daily_sums_prev:
                    daily_sums_prev[day_str] += amount
                if t.is_synced and day_str in daily_synced_prev:
                    daily_synced_prev[day_str] += amount

        # Monthly grouping for bar chart (always all-time)
        if t_month:
            if t_month not in month_map:
                month_map[t_month] = {"month": t_month, "personal": 0, "synced": 0, "total": 0, "count": 0}
            if t.is_synced:
                month_map[t_month]["synced"] += amount
            else:
                month_map[t_month]["personal"] += amount
            month_map[t_month]["total"] += amount
            month_map[t_month]["count"] += 1

    if summary["total_this_month"] > 0:
        summary["synced_percentage"] = round((summary["synced_total"] / summary["total_this_month"]) * 100)
        summary["unsynced_total"] = summary["total_this_month"] - summary["synced_total"]
        summary["unsynced_percentage"] = 100 - summary["synced_percentage"]

    # Build cumulative pacing (target month vs previous month, with synced split)
    pacing_data = []
    cum_this = 0
    cum_last = 0
    cum_synced_this = 0
    cum_synced_last = 0
    max_day = max(target_last_day, days_in_prev)

    for d in range(1, max_day + 1):
        day_str = str(d).zfill(2)

        val_this = None
        val_synced_this = None
        if d <= target_last_day:
            cum_this += daily_sums_target.get(day_str, 0)
            cum_synced_this += daily_synced_target.get(day_str, 0)
            val_this = round(cum_this, 2)
            val_synced_this = round(cum_synced_this, 2)

        val_last = None
        val_synced_last = None
        if d <= days_in_prev:
            cum_last += daily_sums_prev.get(day_str, 0)
            cum_synced_last += daily_synced_prev.get(day_str, 0)
            val_last = round(cum_last, 2)
            val_synced_last = round(cum_synced_last, 2)

        pacing_data.append({
            "day": day_str,
            "this_month": val_this,
            "last_month": val_last,
            "synced_this_month": val_synced_this,
            "synced_last_month": val_synced_last,
        })

    by_category = sorted(list(category_map.values()), key=lambda x: x['total'], reverse=True)
    by_month    = sorted(list(month_map.values()),    key=lambda x: x['month'])

    # Limit bar chart to last 6 months
    if len(by_month) > 6:
        by_month = by_month[-6:]

    return {
        "summary":     summary,
        "by_category": by_category,
        "by_month":    by_month,
        "pacing":      pacing_data,
    }

@router.get("/")
def get_recorded_transactions(db: Session = Depends(get_db)):
    """Fetch all stored transactions from the local database"""
    txs = db.query(Transaction).order_by(Transaction.date.desc()).all()
    return txs
