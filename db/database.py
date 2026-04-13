from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
import datetime
import os

# Use PostgreSQL (Supabase) in production, SQLite locally
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./expenses.db")

# SQLAlchemy needs psycopg2 for postgres; SQLite needs check_same_thread
if DATABASE_URL.startswith("postgresql"):
    engine = create_engine(DATABASE_URL)
else:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    plaid_transaction_id = Column(String, unique=True, index=True)
    account_id = Column(String, index=True)
    amount = Column(Float)
    date = Column(String) # YYYY-MM-DD
    name = Column(String) # Merchant Name
    merchant_name = Column(String, nullable=True)
    category = Column(String, nullable=True)
    bank_name = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    account_mask = Column(String, nullable=True)      # Last 4 digits, e.g. "4242"
    account_type = Column(String, nullable=True)      # "credit" or "depository"
    account_subtype = Column(String, nullable=True)   # "credit card", "checking", "savings"
    
    # App State
    is_synced = Column(Boolean, default=False)
    is_ignored = Column(Boolean, default=False)
    splitwise_expense_id = Column(String, nullable=True)
    splitwise_group_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class UserModel(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    plaid_access_token = Column(String, nullable=True) # Legacy mapping
    splitwise_access_token = Column(String, nullable=True)

class BankConnection(Base):
    __tablename__ = "bank_connections"
    id = Column(Integer, primary_key=True, index=True)
    access_token = Column(String, unique=True, index=True)
    institution_name = Column(String)
    sync_cursor = Column(String, nullable=True)
    last_sync_error = Column(String, nullable=True)
    
    # Financial Snapshot (New)
    current_balance = Column(Float, nullable=True)
    available_balance = Column(Float, nullable=True)
    next_payment_date = Column(String, nullable=True)
    minimum_payment = Column(Float, nullable=True)

class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, unique=True, nullable=False)
    monthly_limit = Column(Float, nullable=False)

# Create all tables
Base.metadata.create_all(bind=engine)

from sqlalchemy import text
try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN bank_name VARCHAR"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN logo_url VARCHAR"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE bank_connections ADD COLUMN sync_cursor VARCHAR"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN is_ignored BOOLEAN DEFAULT FALSE"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE bank_connections ADD COLUMN last_sync_error VARCHAR"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE bank_connections ADD COLUMN current_balance FLOAT"))
        conn.execute(text("ALTER TABLE bank_connections ADD COLUMN available_balance FLOAT"))
        conn.execute(text("ALTER TABLE bank_connections ADD COLUMN next_payment_date VARCHAR"))
        conn.execute(text("ALTER TABLE bank_connections ADD COLUMN minimum_payment FLOAT"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN account_mask VARCHAR"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN account_type VARCHAR"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN account_subtype VARCHAR"))
except Exception:
    pass

from sqlalchemy import inspect as sa_inspect
if 'budgets' not in sa_inspect(engine).get_table_names():
    Budget.__table__.create(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
