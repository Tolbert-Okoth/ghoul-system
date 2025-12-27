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

# 2. SETUP GEMINI (Backup Brain with AUTO-DISCOVERY)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_model = None

def setup_gemini():
    """Dynamically finds a working Gemini model to avoid 404 errors."""
    if not GEMINI_API_KEY:
        logger.warning("⚠️ GEMINI_API_KEY missing. Backup brain offline.")
        return None
    
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        
        # Step A: Ask Google for all available models
        all_models = list(genai.list_models())
        
        # Step B: Filter for models that can actually write text
        available_names = [
            m.name for m in all_models 
            if 'generateContent' in m.supported_generation_methods
        ]
        
        if not available_names:
            logger.error("❌ No Gemini models found. Check API Key permissions.")
            return None

        # Step C: Smart Selection (Prefer 'Flash' -> 'Pro' -> First Available)
        chosen_model_name = None
        
        # Priority 1: Flash (Fastest)
        for name in available_names:
            if 'flash' in name.lower():
                chosen_model_name = name
                break
        
        # Priority 2: Pro (Smarter)
        if not chosen_model_name:
            for name in available_names:
                if 'pro' in name.lower():
                    chosen_model_name = name
                    break
        
        # Priority 3: Anything that works
        if not chosen_model_name:
            chosen_model_name = available_names[0]

        logger.info(f"✅ GEMINI ONLINE. Using Model: {chosen_model_name}")
        return genai.GenerativeModel(chosen_model_name)

    except Exception as e:
        logger.error(f"❌ Gemini Setup Failed: {str(e)}")
        return None

# Initialize Gemini
gemini_model = setup_gemini()


# --- LIGHTWEIGHT QUANT ENGINE ---
def get_technicals(symbol):
    try:
        if symbol == 'SPY': ticker = 'ES=F'
        else: ticker = symbol

        df = yf.download(ticker, period="3mo", interval="1d", progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        if df.empty: return None

        # RSI (14)
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI'] = 100 - (100 / (1 + rs))
        current_rsi = float(df['RSI'].iloc[-1])

        # MACD
        k = df['Close'].ewm(span=12, adjust=False, min_periods=12).mean()
        d = df['Close'].ewm(span=26, adjust=False, min_periods=26).mean()
        macd = k - d
        signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()
        macd_trend = "BULLISH" if float(macd.iloc[-1]) > float(signal.iloc[-1]) else "BEARISH"

        # Bollinger Bands
        sma = df['Close'].rolling(window=20).mean()
        std = df['Close'].rolling(window=20).std()
        upper = sma + (std * 2)
        lower = sma - (std * 2)
        close = float(df['Close'].iloc[-1])
        
        bb_status = "NEUTRAL"
        if close > float(upper.iloc[-1]): bb_status = "OVEREXTENDED (UPPER BAND)"
        if close < float(lower.iloc[-1]): bb_status = "OVERSOLD (LOWER BAND)"

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

# --- MAIN ROUTE ---
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
        OUTPUT JSON: {{ "sentiment_score": (int), "confidence": 0.9, "risk_level": "LOW/MED/HIGH", "action": "WATCH", "reasoning": "Technical summary." }}
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
    
    # 2. Try Gemini (Auto-Discovered Model)
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