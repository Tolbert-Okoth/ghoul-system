import os
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq 
import yfinance as yf
import pandas as pd

# --- CONFIGURATION ---
# Locate the .env file in the sibling 'backend-node' directory
env_path = Path(__file__).parent.parent / 'backend-node' / '.env'
load_dotenv(dotenv_path=env_path)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    print(f"⚠️ WARNING: Could not find GROQ_API_KEY in {env_path}")

app = Flask(__name__)
CORS(app)

# Initialize Groq Client
client = Groq(api_key=GROQ_API_KEY)

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

# --- AI ANALYST (GROQ / LLAMA 3.3) ---
@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    headline = data.get('headline', '')
    symbol = data.get('symbol', 'SPY')
    mode = data.get('mode', 'standard') # 'standard' (News) or 'technical_only' (Heartbeat)

    print(f"🧠 ANALYZING [{mode.upper()}]: {symbol}")

    # 1. Fetch Technicals
    techs = get_technicals(symbol)
    
    tech_context = "MARKET DATA: UNAVAILABLE"
    if techs:
        tech_context = f"""
        LIVE MARKET DATA FOR {symbol}:
        - PRICE: ${techs['price']}
        - RSI (14): {techs['rsi']} (>70 Overbought, <30 Oversold)
        - MOMENTUM (MACD): {techs['macd_trend']}
        - BANDS: {techs['bb_status']}
        """

    # 2. Select the Correct Prompt based on Mode
    if mode == 'technical_only':
        # --- HEARTBEAT MODE (No News) ---
        prompt = f"""
        You are a Quant Algorithm.
        Context: There is NO significant news for {symbol} right now. Analyze the TECHNICAL STRUCTURE only.
        Data: {tech_context}
        
        LOGIC:
        1. If RSI > 70 or < 30, flag it as High Risk.
        2. If MACD is Bullish and RSI is neutral (40-60), sentiment is Bullish.
        3. Write a rationale focusing PURELY on price action (e.g., "Technical breakout immanent").
        
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
        
        SCORING GUIDELINES (Strictly follow this for sentiment_score):
        - +/- 8 to 10: STRONGLY BULLISH/BEARISH (News is major AND Technicals agree).
        - +/- 4 to 7:  BULLISH/BEARISH (Standard signal).
        - +/- 1 to 3:  WEAKLY BULLISH/BEARISH (News opposes Technicals, or low conviction).
        
        LOGIC:
        - IF News is Good but RSI > 75 (Overbought) -> Score should be LOW positive (1 to 3) -> "WEAKLY BULLISH" (Caution).
        - IF News is Bad but RSI < 25 (Oversold) -> Score should be LOW negative (-1 to -3) -> "WEAKLY BEARISH" (Bounce risk).
        - IF News matches Technicals -> Score HIGH (8 to 10).
        
        RESPONSE FORMAT (JSON ONLY):
        {{
            "sentiment_score": (int -10 to 10),
            "confidence": (float 0.0 to 1.0),
            "risk_level": "LOW" | "MEDIUM" | "HIGH",
            "action": "BUY" | "SELL" | "WATCH" | "IGNORE",
            "reasoning": "Explain WHY it is Weak/Strong. Reference RSI or MACD explicitly."
        }}
        """

    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a JSON-only financial trading bot."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile", # Latest supported model
            temperature=0.3,
        )

        content = chat_completion.choices[0].message.content
        
        # Clean Code Block Syntax
        import json
        import re
        
        clean_content = re.sub(r'```json\s*|\s*```', '', content)
        
        match = re.search(r'\{.*\}', clean_content, re.DOTALL)
        if match:
            result = json.loads(match.group(0))
            return jsonify(result)
        else:
            print("Groq Response Error:", content)
            return jsonify({"error": "Failed to parse JSON"})

    except Exception as e:
        print(f"Groq API Error: {e}")
        return jsonify({"sentiment_score": 0, "confidence": 0, "action": "IGNORE", "reasoning": "Connection Failed", "risk_level": "UNKNOWN"})

if __name__ == '__main__':
    app.run(port=5000)