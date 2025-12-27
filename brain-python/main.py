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

# --- CONFIGURATION & ENV SETUP ---
# [FIX] Robust Env Loading: Tries parent folder first (Local), then current folder (Cloud)
env_path = Path(__file__).parent.parent / 'backend-node' / '.env'
if not env_path.exists():
    env_path = Path('.env')
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
    # max_retries=0 prevents hanging workers during rate limits
    groq_client = Groq(api_key=GROQ_API_KEY, max_retries=0)
else:
    logger.warning("⚠️ GROQ_API_KEY missing. Primary brain offline.")

# 2. SETUP GEMINI (Backup Brain)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_model = None

def setup_gemini():
    if not GEMINI_API_KEY:
        logger.warning("⚠️ GEMINI_API_KEY missing. Backup brain offline.")
        return None
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        # Fallback logic to find ANY working model
        all_models = list(genai.list_models())
        available_names = [m.name for m in all_models if 'generateContent' in m.supported_generation_methods]
        
        chosen_model_name = next((n for n in available_names if 'flash' in n.lower()), 
                            next((n for n in available_names if 'pro' in n.lower()), available_names[0]))

        logger.info(f"✅ GEMINI ONLINE. Using Model: {chosen_model_name}")
        return genai.GenerativeModel(chosen_model_name)
    except Exception as e:
        logger.error(f"❌ Gemini Setup Failed: {str(e)}")
        return None

gemini_model = setup_gemini()

# 3. SETUP FINNHUB (Spare Tire)
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")
TECHNICAL_CACHE = {}
CACHE_DURATION = 900 # 15 minutes

# --- 🧠 DATA ENGINE ---

def fetch_finnhub_data(symbol):
    """Fallback: Fetch candles from Finnhub if Yahoo fails."""
    if not FINNHUB_API_KEY: return None
    
    # Map symbols to standard US tickers for Finnhub Free Tier
    ticker_map = { 'ES=F': 'SPY', 'BTC-USD': 'COIN' }
    ticker = ticker_map.get(symbol, symbol).replace("=F", "").replace("-USD", "")
    
    print(f"🛞 USING SPARE TIRE: Fetching {ticker} from Finnhub...")
    try:
        end = int(time.time())
        start = end - (90 * 24 * 60 * 60)
        url = f"https://finnhub.io/api/v1/stock/candle?symbol={ticker}&resolution=D&from={start}&to={end}&token={FINNHUB_API_KEY}"
        r = requests.get(url)
        data = r.json()
        if data.get('s') == 'ok':
            return pd.DataFrame({'Close': data['c']})
        return None
    except Exception as e:
        print(f"❌ Finnhub Request Failed: {e}")
        return None

def calculate_indicators(df):
    """
    🧮 TRADINGVIEW-COMPLIANT MATH
    Uses Wilder's Smoothing for RSI and prevents NaN crashes.
    """
    if df.empty or len(df) < 20: 
        print("⚠️ Dataframe too short for indicators.")
        return None

    try:
        # 1. RSI (14) - Wilder's Smoothing (The "Real" RSI)
        delta = df['Close'].diff()
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)
        
        # [FIX] Use EWM with alpha=1/14 to match TradingView
        avg_gain = gain.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        
        rs = avg_gain / avg_loss
        df['RSI'] = 100 - (100 / (1 + rs))

        # 2. MACD (12, 26, 9)
        k = df['Close'].ewm(span=12, adjust=False, min_periods=12).mean()
        d = df['Close'].ewm(span=26, adjust=False, min_periods=26).mean()
        macd = k - d
        signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()

        # 3. Bollinger Bands (20, 2)
        sma = df['Close'].rolling(window=20).mean()
        std = df['Close'].rolling(window=20).std()
        upper = sma + (std * 2)
        lower = sma - (std * 2)
        
        # 4. [FIX] SAFETY: Handle NaNs for the final row
        current_rsi = float(df['RSI'].iloc[-1])
        if pd.isna(current_rsi): current_rsi = 50.0 # Default to Neutral

        current_macd = float(macd.iloc[-1])
        current_signal = float(signal.iloc[-1])
        if pd.isna(current_macd) or pd.isna(current_signal): 
            macd_trend = "NEUTRAL"
        else:
            macd_trend = "BULLISH" if current_macd > current_signal else "BEARISH"

        close = float(df['Close'].iloc[-1])
        upper_val = float(upper.iloc[-1])
        lower_val = float(lower.iloc[-1])
        
        bb_status = "NEUTRAL"
        if not pd.isna(upper_val) and close > upper_val: bb_status = "OVEREXTENDED (UPPER BAND)"
        if not pd.isna(lower_val) and close < lower_val: bb_status = "OVERSOLD (LOWER BAND)"

        return {
            "rsi": round(current_rsi, 2),
            "macd_trend": macd_trend,
            "bb_status": bb_status,
            "price": round(close, 2)
        }
    except Exception as e:
        print(f"❌ Math Error: {e}")
        return None

def get_technicals(symbol):
    global TECHNICAL_CACHE
    current_time = time.time()
    
    # 1. CACHE CHECK
    if symbol in TECHNICAL_CACHE:
        entry = TECHNICAL_CACHE[symbol]
        if (current_time - entry['timestamp']) < CACHE_DURATION:
            print(f"⚡ CACHE HIT: {symbol}")
            return entry['data']

    df = None
    # 2. TRY YAHOO FINANCE
    try:
        ticker = 'ES=F' if symbol == 'SPY' else symbol
        df = yf.download(ticker, period="3mo", interval="1d", progress=False)
        if isinstance(df.columns, pd.MultiIndex): df.columns = df.columns.get_level_values(0)
    except Exception as e:
        print(f"⚠️ Yahoo Failed: {e}")
    
    # 3. TRY FINNHUB
    if df is None or df.empty:
        df = fetch_finnhub_data(symbol)

    if df is not None and not df.empty:
        result = calculate_indicators(df)
        if result:
            TECHNICAL_CACHE[symbol] = { 'data': result, 'timestamp': current_time }
            return result
    return None

# --- AI HELPERS ---
def ask_groq(system_prompt, user_prompt):
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
        logger.error(f"❌ GROQ FAILED: {str(e)}")
        return None

def ask_gemini(system_prompt, user_prompt):
    if not gemini_model: return None
    try:
        full_prompt = f"{system_prompt}\n\nUSER INPUT: {user_prompt}"
        response = gemini_model.generate_content(full_prompt)
        text = response.text.replace("```json", "").replace("```", "").strip()
        return text
    except Exception as e:
        logger.error(f"❌ GEMINI FAILED: {str(e)}")
        return None

def clean_and_parse_json(content):
    try:
        clean_content = re.sub(r'```json\s*|\s*```', '', content)
        match = re.search(r'\{.*\}', clean_content, re.DOTALL)
        if match: return json.loads(match.group(0))
        return None
    except Exception: return None

# --- API ROUTES ---
@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    headline = data.get('headline', '')
    symbol = data.get('symbol', 'SPY')
    mode = data.get('mode', 'standard')

    print(f"🧠 ANALYZING [{mode.upper()}]: {symbol}")

    technicals = get_technicals(symbol)
    
    tech_context = "MARKET DATA: UNAVAILABLE"
    if technicals:
        tech_context = f"""
        LIVE MARKET DATA FOR {symbol}:
        - PRICE: ${technicals['price']}
        - RSI (14): {technicals['rsi']}
        - MACD: {technicals['macd_trend']}
        - BANDS: {technicals['bb_status']}
        """

    system_instruction = "You are a JSON-only financial trading bot."
    
    if mode == 'technical_only':
        prompt = f"""
        Context: NO news. Analyze TECHNICALS ONLY for {symbol}.
        Data: {tech_context}
        LOGIC: RSI>70 or <30 is High Risk.
        OUTPUT JSON: {{ "sentiment_score": (int 0), "confidence": 0.9, "risk_level": "LOW/MED/HIGH", "action": "WATCH", "reasoning": "Technical summary." }}
        """
    else:
        prompt = f"""
        Analyze this signal for {symbol}.
        HEADLINE: "{headline}"
        {tech_context}
        OUTPUT JSON: {{ "sentiment_score": (int -10 to 10), "confidence": (0.0-1.0), "risk_level": "LOW/MED/HIGH", "action": "BUY/SELL/WATCH", "reasoning": "Why?" }}
        """

    # 1. Try Groq
    raw_response = ask_groq(system_instruction, prompt)
    
    # 2. Try Gemini
    if not raw_response:
        print("⚠️ SWITCHING TO BACKUP BRAIN (GEMINI)...")
        raw_response = ask_gemini(system_instruction, prompt)

    if raw_response:
        result = clean_and_parse_json(raw_response)
        if result: return jsonify(result)
        
    return jsonify({
        "sentiment_score": 0, "confidence": 0, "action": "IGNORE", 
        "reasoning": "SYSTEM FAILURE: All AI models offline.", "risk_level": "UNKNOWN"
    })

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "HEALTHY", "groq": bool(groq_client), "gemini": bool(gemini_model)})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)