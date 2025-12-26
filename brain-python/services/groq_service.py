import os
import json
from pathlib import Path
from groq import Groq
from dotenv import load_dotenv

# --- DYNAMIC PATH RESOLUTION ---
current_file = Path(__file__).resolve()
project_root = current_file.parent.parent.parent
env_path = project_root / "backend-node" / ".env"

load_dotenv(dotenv_path=env_path)

class GroqBrain:
    def __init__(self):
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError(f"GROQ_API_KEY not found at {env_path}")

        self.client = Groq(api_key=api_key)
        self.model_id = "llama-3.3-70b-versatile" 

    def analyze_headline(self, headline: str):
        prompt = f"""
        ROLE: Senior Financial Analyst & Risk Advisor.
        TASK: Analyze this news headline for a human trader. Provide strategic context.
        
        HEADLINE: "{headline}"
        
        CONTEXT: 
        The user trades S&P 500 Futures (ES=F). They need to know the 'Why' and the 'Risk', not just 'Buy/Sell'.
        
        OUTPUT RULES:
        1. sentiment_score: -10 (Market Crash) to +10 (Moon).
        2. confidence: 0.0 to 1.0. (0.5+ is actionable).
        3. risk_level: "LOW", "MEDIUM", "HIGH" (High risk = volatile/uncertainty).
        4. action: "LONG", "SHORT", "WATCH", "HEDGE", "IGNORE".
        5. reasoning: Concise strategic summary (max 20 words).
        
        RETURN JSON OBJECT ONLY:
        {{
            "sentiment_score": float,
            "confidence": float,
            "risk_level": "string",
            "action": "string",
            "reasoning": "string"
        }}
        """
        try:
            completion = self.client.chat.completions.create(
                model=self.model_id,
                messages=[
                    {"role": "system", "content": "You are a financial advisor AI. Output valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2, # Slightly more creative for analysis
                response_format={"type": "json_object"}
            )
            return json.loads(completion.choices[0].message.content)
            
        except Exception as e:
            print(f"[BRAIN_FAULT] Groq Error: {e}")
            return {"sentiment_score": 0, "confidence": 0, "risk_level": "LOW", "reasoning": "AI_ERROR", "action": "IGNORE"}