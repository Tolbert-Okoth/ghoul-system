import os
import re
import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq 
import google.generativeai as genai
import yfinance as yf
import pandas as pd

# --- CONFIGURATION ---
# Locate the .env file in the sibling 'backend-node' directory
env_path = Path(__file__).parent.parent / 'backend-node' / '.env'
load_dotenv(dotenv_path=env_path)

# Logging Setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# 1. SETUP GROQ (Primary Brain)
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = None
if GROQ_API_KEY:
    groq_client = Groq(api_key=GROQ_API_KEY)
else:
    logger.warning("⚠️ GROQ_API_KEY missing. Primary brain offline.")

# 2. SETUP GEMINI (Backup Brain)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_model = None
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    # FIX: Switched to 'gemini-pro' which is universally available on free tier
    try:
        gemini_model = genai.GenerativeModel('gemini-pro')
    except Exception as e:
        logger.error(f"Failed to load Gemini model: {e}")
else:
    logger.warning("⚠️ GEMINI_API_KEY missing. Backup brain offline.")


# --- LIGHTWEIGHT QUANT ENGINE (Pandas Only) ---
def get_technicals(symbol):
    try:
        if symbol == 'SPY': ticker = 'ES=F'
        else: ticker = symbol

        # Fetch Data (3 months is enough for indicators)
        df = yf.download(ticker, period="3mo", interval="1d", progress=False)
        
        # FIX: Flatten Multi-Index Columns (Critical for recent yfinance updates)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        if df.empty: return None

        # 1. RSI (14)
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI'] = 100 - (100 / (1 + rs))
        current_rsi = float(df['RSI'].iloc[-1])

        # 2. MACD (12, 26, 9)
        k = df['Close'].ewm(span=12, adjust=False, min_periods=12).mean()
        d = df['Close'].ewm(span=26, adjust=False, min_periods=26).mean()
        macd = k - d
        signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()
        macd_val = float(macd.iloc[-1])
        sig_val = float(signal.iloc[-1])
        macd_trend = "BULLISH" if macd_val > sig_val else "BEARISH"

        # 3. Bollinger Bands
        sma = df['Close'].rolling(window=20).mean()
        std = df['Close'].rolling(window=20).std()
        upper = sma + (std * 2)
        lower = sma - (std * 2)
        
        close = float(df['Close'].iloc[-1])
        upper_val = float(upper.iloc[-1])
        lower_val = float(lower.iloc[-1])
        
        bb_status = "NEUTRAL"
        if close > upper_val: bb_status = "OVEREXTENDED (UPPER BAND)"
        if close < lower_val: bb_status = "OVERSOLD (LOWER BAND)"

        return {
            "rsi": round(current_rsi, 2),
            "macd_trend": macd_trend,
            "bb_status": bb_status,
            "price": round(close, 2)
        }
    except Exception as e:
        print(f"Stats Error: {e}")
        return None

# --- AI HELPER FUNCTIONS ---

def ask_groq(system_prompt, user_prompt):
    """Attempt to get analysis from Groq (Llama 3)."""
    if not groq_client: return None
    try:
        completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            response_format={"type": "json_object"} 
        )
        return completion.choices[0].message.content
    except Exception as e:
        logger.error(f"❌ GROQ FAILED (Likely Rate Limit): {str(e)}")
        return None  # Signal failure so we can switch to Gemini

def ask_gemini(system_prompt, user_prompt):
    """Attempt to get analysis from Gemini Pro."""
    if not gemini_model: return None
    try:
        # Combine prompts for Gemini
        full_prompt = f"{system_prompt}\n\nUSER INPUT: {user_prompt}"
        response = gemini_model.generate_content(full_prompt)
        
        # Clean markdown syntax often returned by Gemini
        text = response.text.replace("```json", "").replace("```", "").strip()
        return text
    except Exception as e:
        logger.error(f"❌ GEMINI FAILED: {str(e)}")
        return None

def clean_and_parse_json(content):
    """Robust JSON extraction from AI response."""
    try:
        # Remove code blocks if present
        clean_content = re.sub(r'```json\s*|\s*```', '', content)
        # Find the JSON object
        match = re.search(r'\{.*\}', clean_content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return None
    except Exception:
        return None

# --- MAIN ROUTE ---
@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    headline = data.get('headline', '')
    symbol = data.get('symbol', 'SPY')
    mode = data.get('mode', 'standard') 

    print(f"🧠 ANALYZING [{mode.upper()}]: {symbol}")

    # 1. Fetch Technicals
    technicals = get_technicals(symbol)
    
    tech_context = "MARKET DATA: UNAVAILABLE"
    if technicals:
        tech_context = f"""
        LIVE MARKET DATA FOR {symbol}:
        - PRICE: ${technicals['price']}
        - RSI (14): {technicals['rsi']} (>70 Overbought, <30 Oversold)
        - MOMENTUM (MACD): {technicals['macd_trend']}
        - BANDS: {technicals['bb_status']}
        """

    # 2. Select the Correct Prompt based on Mode
    system_instruction = "You are a JSON-only financial trading bot."
    
    if mode == 'technical_only':
        # --- HEARTBEAT MODE (No News) ---
        prompt = f"""
        You are a Quant Algorithm.
        Context: There is NO significant news for {symbol} right now. Analyze the TECHNICAL STRUCTURE only.
        Data: {tech_context}
        
        LOGIC:
        1. If RSI > 70 or < 30, flag it as High Risk.
        2. If MACD is Bullish and RSI is neutral (40-60), sentiment is Bullish.
        3. Write a rationale focusing PURELY on price action.
        
        OUTPUT JSON:
        {{
            "sentiment_score": (int -10 to 10 based on technicals),
            "confidence": 0.9,
            "risk_level": "LOW/MEDIUM/HIGH",
            "action": "WATCH",
            "reasoning": "Short technical summary (under 15 words)."
        }}
        """
    else:
        # --- STANDARD MODE (News + Technicals) ---
        prompt = f"""
        You are a Quant Risk Manager. Analyze this trading signal.
        
        HEADLINE: "{headline}"
        {tech_context}
        
        SCORING GUIDELINES:
        - +/- 8 to 10: STRONGLY BULLISH/BEARISH (News is major AND Technicals agree).
        - +/- 4 to 7:  BULLISH/BEARISH (Standard signal).
        - +/- 1 to 3:  WEAKLY BULLISH/BEARISH (Mixed signals).
        
        RESPONSE FORMAT (JSON ONLY):
        {{
            "sentiment_score": (int -10 to 10),
            "confidence": (float 0.0 to 1.0),
            "risk_level": "LOW" | "MEDIUM" | "HIGH",
            "action": "BUY" | "SELL" | "WATCH" | "IGNORE",
            "reasoning": "Explain WHY. Reference RSI or MACD explicitly."
        }}
        """

    # 3. EXECUTE DUAL-CORE BRAIN LOGIC
    
    # Attempt 1: Groq
    raw_response = ask_groq(system_instruction, prompt)
    
    # Attempt 2: Gemini (Failover)
    if not raw_response:
        print("⚠️ SWITCHING TO BACKUP BRAIN (GEMINI)...")
        raw_response = ask_gemini(system_instruction, prompt)
        
    # 4. Final Processing
    if raw_response:
        result = clean_and_parse_json(raw_response)
        if result:
            return jsonify(result)
        else:
            print("❌ JSON PARSE ERROR:", raw_response)
            return jsonify({"error": "Failed to parse JSON output"})
            
    # If both failed
    return jsonify({
        "sentiment_score": 0, 
        "confidence": 0, 
        "action": "IGNORE", 
        "reasoning": "SYSTEM FAILURE: All AI models offline.", 
        "risk_level": "UNKNOWN"
    })

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "HEALTHY", "groq": bool(groq_client), "gemini": bool(gemini_model)})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)