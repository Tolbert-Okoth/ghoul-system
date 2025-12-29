import os
import re
import json
import time
import logging
import requests
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq 
import google.generativeai as genai
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta

# --- CONFIGURATION & ENV SETUP ---
env_path = Path(__file__).parent.parent / 'backend-node' / '.env'
if not env_path.exists():
    env_path = Path('.env')
load_dotenv(dotenv_path=env_path)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# 1. SETUP GROQ (Primary Brain)
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY, max_retries=0) if GROQ_API_KEY else None

# 2. SETUP GEMINI (Backup Brain)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_model = None

def setup_gemini():
    if not GEMINI_API_KEY: return None
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        all_models = list(genai.list_models())
        available_names = [m.name for m in all_models if 'generateContent' in m.supported_generation_methods]
        chosen = next((n for n in available_names if 'flash' in n.lower()), available_names[0])
        return genai.GenerativeModel(chosen)
    except: return None

gemini_model = setup_gemini()

# 3. SETUP ALPACA (Primary Data)
# Matching the variables used in Node.js
ALPACA_KEY = os.getenv("APCA_API_KEY_ID") 
ALPACA_SECRET = os.getenv("APCA_API_SECRET_KEY")
# Data URL is different from Trading URL for v2
ALPACA_DATA_URL = "https://data.alpaca.markets/v2/stocks/bars"

# 4. SETUP FINNHUB (Spare Tire)
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")

TECHNICAL_CACHE = {}
CACHE_DURATION = 900 

# ==============================
# 📊 DATA ENGINE (Alpaca -> Yahoo -> Finnhub)
# ==============================

def fetch_alpaca(symbol):
    """Fetch 3 months of daily candles from Alpaca"""
    if not ALPACA_KEY or not ALPACA_SECRET: return None
    
    try:
        # Calculate dates
        end_dt = datetime.utcnow()
        start_dt = end_dt - timedelta(days=120) # Get enough buffer for EMA/MACD
        
        headers = {
            "APCA-API-KEY-ID": ALPACA_KEY,
            "APCA-API-SECRET-KEY": ALPACA_SECRET
        }
        
        params = {
            "symbols": symbol,
            "timeframe": "1Day",
            "start": start_dt.strftime('%Y-%m-%d'),
            "end": end_dt.strftime('%Y-%m-%d'),
            "limit": 1000,
            "adjustment": "split",
            "feed": "iex"  # <--- 🚨 CRITICAL FIX: FORCE FREE DATA FEED
        }

        r = requests.get(ALPACA_DATA_URL, headers=headers, params=params, timeout=5)
        
        if r.status_code != 200:
            logger.warning(f"Alpaca Error {r.status_code}: {r.text}")
            return None
            
        data = r.json()
        if "bars" not in data or symbol not in data["bars"]:
            return None
            
        bars = data["bars"][symbol]
        if not bars: return None

        # Convert to DataFrame
        df = pd.DataFrame(bars)
        df.rename(columns={"c": "Close"}, inplace=True)
        return df[["Close"]]

    except Exception as e:
        logger.warning(f"Alpaca Exception: {e}")
        return None

def fetch_yahoo(symbol):
    """Backup: Yahoo Finance"""
    try:
        t = 'ES=F' if symbol == 'SPY' else symbol
        df = yf.download(t, period="6mo", interval="1d", progress=False)
        if isinstance(df.columns, pd.MultiIndex): df.columns = df.columns.get_level_values(0)
        return df if not df.empty else None
    except: return None

def fetch_finnhub(symbol):
    """Spare Tire: Finnhub"""
    if not FINNHUB_API_KEY: return None
    try:
        t = symbol.replace("=F", "").replace("-USD", "")
        end = int(time.time())
        start = end - (120 * 86400)
        url = f"https://finnhub.io/api/v1/stock/candle?symbol={t}&resolution=D&from={start}&to={end}&token={FINNHUB_API_KEY}"
        r = requests.get(url, timeout=5)
        js = r.json()
        if js.get('s') == 'ok': return pd.DataFrame({'Close': js['c']})
        return None
    except: return None

def calculate_indicators(df):
    if df is None or df.empty or len(df) < 20: return None
    try:
        # RSI
        delta = df['Close'].diff()
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)
        avg_gain = gain.ewm(alpha=1/14, min_periods=14).mean()
        avg_loss = loss.ewm(alpha=1/14, min_periods=14).mean()
        rs = avg_gain / avg_loss
        df['RSI'] = 100 - (100 / (1 + rs))

        # MACD
        k = df['Close'].ewm(span=12).mean()
        d = df['Close'].ewm(span=26).mean()
        macd = k - d
        signal = macd.ewm(span=9).mean()

        # Bollinger Bands
        sma = df['Close'].rolling(20).mean()
        std = df['Close'].rolling(20).std()
        upper = sma + (std * 2)
        lower = sma - (std * 2)
        
        # Latest Values
        curr_rsi = float(df['RSI'].iloc[-1]) if not pd.isna(df['RSI'].iloc[-1]) else 50.0
        curr_macd = float(macd.iloc[-1])
        curr_sig = float(signal.iloc[-1])
        macd_trend = "BULLISH" if curr_macd > curr_sig else "BEARISH"

        close = float(df['Close'].iloc[-1])
        upper_v = float(upper.iloc[-1])
        lower_v = float(lower.iloc[-1])
        
        bb_status = "NEUTRAL"
        if close > upper_v: bb_status = "OVEREXTENDED (UPPER)"
        if close < lower_v: bb_status = "OVERSOLD (LOWER)"

        return { "rsi": round(curr_rsi, 2), "macd_trend": macd_trend, "bb_status": bb_status, "price": round(close, 2) }
    except: return None

def get_technicals(symbol):
    global TECHNICAL_CACHE
    if symbol in TECHNICAL_CACHE and (time.time() - TECHNICAL_CACHE[symbol]['timestamp'] < CACHE_DURATION):
        return TECHNICAL_CACHE[symbol]['data']

    # 1. Try Alpaca (Cleanest)
    df = fetch_alpaca(symbol)
    
    # 2. Try Yahoo (Backup)
    if df is None or df.empty:
        df = fetch_yahoo(symbol)
        
    # 3. Try Finnhub (Last Resort)
    if df is None or df.empty:
        df = fetch_finnhub(symbol)

    if df is not None:
        res = calculate_indicators(df)
        if res:
            TECHNICAL_CACHE[symbol] = { 'data': res, 'timestamp': time.time() }
            return res
    return None

# ==============================
# 🧠 AI PROVIDERS (The Brains)
# ==============================

def clean_json(text):
    try:
        clean = re.sub(r'```json\s*|\s*```', '', text)
        match = re.search(r'\{.*\}', clean, re.DOTALL)
        return json.loads(match.group(0)) if match else None
    except: return None

def ask_groq(sys, user):
    if not groq_client: return None
    try:
        return groq_client.chat.completions.create(
            messages=[{"role":"system","content":sys},{"role":"user","content":user}],
            model="llama-3.3-70b-versatile", temperature=0.3, response_format={"type":"json_object"}
        ).choices[0].message.content
    except Exception as e:
        logger.error(f"Groq Error: {e}")
        return None

def ask_pollinations(sys, user):
    """Level 2: Unlimited Backup"""
    try:
        r = requests.post("https://text.pollinations.ai/", json={
            "messages": [{"role":"system","content":sys},{"role":"user","content":user}],
            "model": "openai", "jsonMode": True
        }, timeout=20)
        return r.text if r.status_code == 200 else None
    except: return None

def ask_gemini(sys, user):
    """Level 3: Gemini Backup"""
    if not gemini_model: return None
    try:
        return gemini_model.generate_content(f"{sys}\n\nUSER: {user}").text
    except: return None

def emergency_keyword_analysis(headline):
    """Level 4: Dumb Keywords"""
    hl = headline.lower()
    bull = ["surge", "record", "high", "beat", "buy", "growth", "strong"]
    bear = ["crash", "drop", "low", "miss", "sell", "fear", "weak"]
    b_score = sum(1 for w in bull if w in hl)
    br_score = sum(1 for w in bear if w in hl)
    
    if b_score > br_score: return { "action": "BUY", "confidence": 0.5, "sentiment_score": 5, "reasoning": "Keywords detected: Positive" }
    elif br_score > b_score: return { "action": "SELL", "confidence": 0.5, "sentiment_score": -5, "reasoning": "Keywords detected: Negative" }
    return { "action": "HOLD", "confidence": 0.0, "sentiment_score": 0, "reasoning": "Keywords: Neutral" }

# ==============================
# 🚀 API ROUTES
# ==============================

@app.route('/analyze', methods=['POST'])
def analyze():
    d = request.json
    headline = d.get('headline', '')
    symbol = d.get('symbol', 'SPY')
    mode = d.get('mode', 'standard')

    print(f"🧠 ANALYZING [{mode.upper()}]: {symbol}")
    tech = get_technicals(symbol)
    tech_txt = f"PRICE: ${tech['price']}, RSI: {tech['rsi']}, MACD: {tech['macd_trend']}, BANDS: {tech['bb_status']}" if tech else "DATA UNAVAILABLE"

    sys_p = "You are a JSON-only financial trading bot."
    if mode == 'technical_only':
        user_p = f"Analyze TECHNICALS for {symbol}. Data: {tech_txt}. Logic: RSI>70/30< Risk. JSON OUTPUT: {{ 'sentiment_score': 0, 'confidence': 0.9, 'risk_level': 'MED', 'action': 'WATCH', 'reasoning': 'Summary' }}"
    else:
        user_p = f"Analyze: '{headline}' for {symbol}. Data: {tech_txt}. JSON OUTPUT: {{ 'sentiment_score': (-10 to 10), 'confidence': (0.0-1.0), 'risk_level': 'LOW/MED/HIGH', 'action': 'BUY/SELL/WATCH', 'reasoning': 'Why?' }}"

    # 1. GROQ
    raw = ask_groq(sys_p, user_p)
    
    # 2. POLLINATIONS (Unlimited)
    if not raw:
        print("⚠️ GROQ DOWN. TRYING POLLINATIONS...")
        raw = ask_pollinations(sys_p, user_p)

    # 3. GEMINI
    if not raw:
        print("⚠️ POLLINATIONS DOWN. TRYING GEMINI...")
        raw = ask_gemini(sys_p, user_p)

    if raw:
        res = clean_json(raw)
        if res: return jsonify(res)

    # 4. KEYWORDS
    print("🚨 ALL AI DOWN. KEYWORDS ENGAGED.")
    if mode == 'standard' and headline:
        return jsonify({**emergency_keyword_analysis(headline), "risk_level": "UNKNOWN"})
        
    return jsonify({"action": "IGNORE", "reasoning": "SYSTEM FAILURE", "confidence": 0, "sentiment_score": 0, "risk_level": "UNKNOWN"})

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "HEALTHY", 
        "alpaca": bool(ALPACA_KEY),
        "groq": bool(groq_client), 
        "pollinations": True,
        "gemini": bool(gemini_model)
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))