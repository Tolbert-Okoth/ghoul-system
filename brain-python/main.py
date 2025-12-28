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

# --- ENV SETUP ---
env_path = Path(__file__).parent.parent / 'backend-node' / '.env'
if not env_path.exists():
    env_path = Path('.env')
load_dotenv(env_path)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# --- GROQ ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY, max_retries=0) if GROQ_API_KEY else None

# --- GEMINI ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_model = None

def setup_gemini():
    if not GEMINI_API_KEY:
        return None
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        models = list(genai.list_models())
        name = next(m.name for m in models if "generateContent" in m.supported_generation_methods)
        return genai.GenerativeModel(name)
    except Exception as e:
        logger.error(f"Gemini init failed: {e}")
        return None

gemini_model = setup_gemini()

# --- ALPACA ---
ALPACA_KEY = os.getenv("ALPACA_API_KEY")
ALPACA_SECRET = os.getenv("ALPACA_SECRET_KEY")
ALPACA_BASE = os.getenv("ALPACA_BASE_URL", "https://data.alpaca.markets")

ALPACA_HEADERS = {
    "APCA-API-KEY-ID": ALPACA_KEY,
    "APCA-API-SECRET-KEY": ALPACA_SECRET
}

# --- FINNHUB ---
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")

TECHNICAL_CACHE = {}
CACHE_DURATION = 900  # 15 min

# ==============================
# 📊 DATA FETCHERS
# ==============================

def fetch_yahoo(symbol):
    try:
        ticker = "ES=F" if symbol == "SPY" else symbol
        df = yf.download(ticker, period="3mo", interval="1d", progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df if not df.empty else None
    except Exception as e:
        logger.warning(f"Yahoo failed: {e}")
        return None

def fetch_alpaca(symbol):
    if not ALPACA_KEY or not ALPACA_SECRET:
        return None

    try:
        end = datetime.utcnow()
        start = end - timedelta(days=90)

        url = f"{ALPACA_BASE}/v2/stocks/bars"
        params = {
            "symbols": symbol,
            "timeframe": "1Day",
            "start": start.isoformat() + "Z",
            "end": end.isoformat() + "Z",
            "adjustment": "raw",
            "limit": 500
        }

        r = requests.get(url, headers=ALPACA_HEADERS, params=params, timeout=10)
        r.raise_for_status()
        bars = r.json().get("bars", {}).get(symbol)

        if not bars:
            return None

        df = pd.DataFrame(bars)
        df["Close"] = df["c"]
        return df[["Close"]]

    except Exception as e:
        logger.warning(f"Alpaca failed: {e}")
        return None

def fetch_finnhub(symbol):
    if not FINNHUB_API_KEY:
        return None
    try:
        end = int(time.time())
        start = end - 90 * 24 * 60 * 60
        url = f"https://finnhub.io/api/v1/stock/candle"
        params = {
            "symbol": symbol,
            "resolution": "D",
            "from": start,
            "to": end,
            "token": FINNHUB_API_KEY
        }
        r = requests.get(url, params=params, timeout=10)
        data = r.json()
        if data.get("s") == "ok":
            return pd.DataFrame({"Close": data["c"]})
    except Exception as e:
        logger.warning(f"Finnhub failed: {e}")
    return None

# ==============================
# 📈 INDICATORS
# ==============================

def calculate_indicators(df):
    if df is None or df.empty or len(df) < 20:
        return None

    delta = df["Close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1/14, min_periods=14).mean()
    avg_loss = loss.ewm(alpha=1/14, min_periods=14).mean()
    rs = avg_gain / avg_loss

    rsi = 100 - (100 / (1 + rs))

    ema12 = df["Close"].ewm(span=12).mean()
    ema26 = df["Close"].ewm(span=26).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9).mean()

    sma = df["Close"].rolling(20).mean()
    std = df["Close"].rolling(20).std()

    close = float(df["Close"].iloc[-1])
    rsi_val = float(rsi.iloc[-1]) if not pd.isna(rsi.iloc[-1]) else 50

    macd_trend = "BULLISH" if macd.iloc[-1] > signal.iloc[-1] else "BEARISH"

    bb_status = "NEUTRAL"
    if close > sma.iloc[-1] + 2 * std.iloc[-1]:
        bb_status = "OVEREXTENDED"
    elif close < sma.iloc[-1] - 2 * std.iloc[-1]:
        bb_status = "OVERSOLD"

    return {
        "price": round(close, 2),
        "rsi": round(rsi_val, 2),
        "macd_trend": macd_trend,
        "bb_status": bb_status
    }

# ==============================
# 🧠 TECHNICAL ENGINE
# ==============================

def get_technicals(symbol):
    now = time.time()
    if symbol in TECHNICAL_CACHE:
        cached = TECHNICAL_CACHE[symbol]
        if now - cached["timestamp"] < CACHE_DURATION:
            return cached["data"]

    df = fetch_yahoo(symbol)
    if df is None:
        df = fetch_alpaca(symbol)
    if df is None:
        df = fetch_finnhub(symbol)

    if df is not None:
        indicators = calculate_indicators(df)
        if indicators:
            TECHNICAL_CACHE[symbol] = {
                "data": indicators,
                "timestamp": now
            }
            return indicators
    return None

# ==============================
# 🧠 AI ROUTES (UNCHANGED)
# ==============================

@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.json
    headline = data.get("headline", "")
    symbol = data.get("symbol", "SPY")
    mode = data.get("mode", "standard")

    technicals = get_technicals(symbol)

    tech_context = "NO DATA"
    if technicals:
        tech_context = f"""
        PRICE: {technicals['price']}
        RSI: {technicals['rsi']}
        MACD: {technicals['macd_trend']}
        BANDS: {technicals['bb_status']}
        """

    return jsonify({
        "sentiment_score": 0,
        "confidence": 0.8,
        "action": "WATCH",
        "risk_level": "MED",
        "reasoning": tech_context
    })

@app.route("/health")
def health():
    return jsonify({
        "status": "HEALTHY",
        "alpaca": bool(ALPACA_KEY),
        "groq": bool(groq_client),
        "gemini": bool(gemini_model)
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
