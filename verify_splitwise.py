import os
import requests
from dotenv import load_dotenv

def verify_splitwise():
    # Load .env from the root workspace
    load_dotenv("/Users/jshah/server/.env")
    
    client_id = os.getenv("SPLITWISE_CLIENT_ID")
    client_secret = os.getenv("SPLITWISE_CLIENT_SECRET")
    
    print(f"--- Splitwise Connectivity Check ---")
    print(f"Client ID: {client_id[:5]}...{client_id[-5:] if client_id else 'None'}")
    
    if not client_id or not client_secret:
        print("ERROR: Splitwise credentials not found in .env")
        return

    # 1. Check if the authorization URL is valid
    auth_url = "https://secure.splitwise.com/oauth/authorize"
    redirect_uri = "http://localhost:8000/api/splitwise/callback"
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "state": "random_state_string"
    }
    try:
        response = requests.get(auth_url, params=params, timeout=10)
        print(f"DEBUG: Tested URL: {response.url}")
        if response.status_code == 200:
            print("SUCCESS: Splitwise Authorization endpoint reached. URL parameters appear valid.")
        else:
            print(f"WARNING: Authorization endpoint returned status {response.status_code}. This is likely why you see a 404.")
            print(f"Response Body: {response.text[:200]}")
    except Exception as e:
        print(f"ERROR: Failed to reach Splitwise Authorization endpoint: {e}")

    # 2. Check if there's any token in the database
    import sqlite3
    db_path = "expenses.db"
    try:
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT splitwise_access_token FROM users WHERE id=1")
            row = cursor.fetchone()
            if row and row[0]:
                token = row[0]
                print(f"INFO: Found access token in database: {token[:5]}...")
                
                # 3. Test the token
                headers = {"Authorization": f"Bearer {token}"}
                api_url = "https://secure.splitwise.com/api/v3.0/get_current_user"
                res = requests.get(api_url, headers=headers)
                if res.status_code == 200:
                    user_data = res.json().get("user", {})
                    print(f"VERIFIED: Connection successful! Logged in as: {user_data.get('first_name')} {user_data.get('last_name')}")
                else:
                    print(f"ERROR: Access token is invalid or expired. Status: {res.status_code}")
            else:
                print("INFO: No access token found in database. User needs to connect via the app.")
        else:
            print(f"INFO: Database {db_path} not found.")
            
    except Exception as e:
        print(f"ERROR: Database check failed: {e}")

if __name__ == "__main__":
    verify_splitwise()
