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
    
    # App State
    is_synced = Column(Boolean, default=False)
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

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
