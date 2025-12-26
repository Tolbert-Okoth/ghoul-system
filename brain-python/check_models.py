import os
from google import genai
from dotenv import load_dotenv
from pathlib import Path

# Load API Key
env_path = Path(__file__).parent.parent / "backend-node" / ".env"
load_dotenv(dotenv_path=env_path)
api_key = os.getenv("GEMINI_API_KEY")

client = genai.Client(api_key=api_key)

print("🔎 SCANNING FOR AVAILABLE MODELS...")
print("-" * 40)

try:
    # Just list everything without filtering attributes
    for m in client.models.list():
        # Safely get the name
        name = getattr(m, 'name', 'UNKNOWN_MODEL')
        print(f"✅ FOUND: {name}")
            
except Exception as e:
    print(f"❌ ERROR: {e}")

print("-" * 40)
print("TIP: Look for 'gemini-2.0-flash-exp' or 'gemini-1.5-flash'")