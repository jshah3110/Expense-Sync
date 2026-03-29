from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

import os

# Load environment variables
load_dotenv()

app = FastAPI(title="Expense Automation Tracker API")

# Setup CORS for the Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://127.0.0.1:5173",
        os.getenv("FRONTEND_URL", "*") # Allow production URL from env
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Expense Tracker API is running"}

from api.splitwise import router as splitwise_router
from api.transactions import router as transactions_router
from api.budgets import router as budgets_router

app.include_router(splitwise_router, prefix="/api/splitwise")
app.include_router(transactions_router, prefix="/api/transactions")
app.include_router(budgets_router, prefix="/api/budgets")
