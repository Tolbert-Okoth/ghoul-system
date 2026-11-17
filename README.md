# Ghoul System: Market Intelligence Dashboard

<img width="1888" height="885" alt="Image" src="https://github.com/user-attachments/assets/4e3613b7-53a5-4309-b369-715ef86aee52" />

**Built in 2025.** Ghoul System is a full-stack market-intelligence prototype. It pulls live prices and financial news, runs technical indicators and LLM sentiment analysis in a Python service, stores the resulting signals in PostgreSQL, and streams them to a real-time dashboard.

> **Prototype, not a trading system.** Signals combine technical indicators with LLM-generated sentiment and confidence scores. They have not been backtested or validated, and nothing here places trades. For my later, statistically validated research, see [propsim](https://github.com/Tolbert-Okoth/propfirm-pass-sim) and the [Hurst/DFA study](https://github.com/Tolbert-Okoth/Gold--hurst--daily-classifier).

## What it does

- **Data with failover:** prices come from Alpaca (IEX feed), fall back to Yahoo Finance, and finally to a simulation mode flagged with `isSimulated`, so the dashboard keeps working when a provider fails.
- **Analysis service (Python):** computes RSI, MACD and Bollinger Bands with pandas/TA-Lib and asks an LLM (Groq) to summarise news sentiment.
- **Orchestration (Node.js):** schedules scans, calls the Python service, saves signals to PostgreSQL and broadcasts updates over Socket.io.
- **Retention job:** a scheduled cleanup deletes signals older than 7 days to stay within free-tier database limits.
- **Dashboard (React):** live charts, a signal feed and real-time updates; responsive on mobile.

## Architecture

```
frontend-react  <--Socket.io/REST-->  backend-node  --HTTP-->  brain-python
  (React,                             (Express,                (Flask, pandas,
   Recharts)                           PostgreSQL)              TA-Lib, Groq)
```

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React (Create React App), Recharts, Socket.io client |
| Backend | Node.js, Express, Socket.io, PostgreSQL (`pg`), RSS parser |
| Analysis service | Python, Flask, pandas, TA-Lib, yfinance, Groq API |
| Data providers | Alpaca (primary), Yahoo Finance (backup) |

## Run locally

Requirements: Node.js 18+, Python 3.10+, PostgreSQL, and TA-Lib's C library (needed by the Python package).

```bash
git clone https://github.com/Tolbert-Okoth/ghoul-system.git
cd ghoul-system

# 1. Analysis service
cd brain-python
pip install -r requirements.txt
python main.py                      # serves on PORT (default 5000)

# 2. Backend (new terminal)
cd backend-node
npm install
npm start

# 3. Dashboard (new terminal)
cd frontend-react/frontend-ghoul
npm install
npm start
```

### Environment variables

**backend-node/.env**
```env
DATABASE_URL=postgres://user:password@host:5432/ghoul
PYTHON_MICROSERVICE_URL=http://localhost:5000
APCA_API_KEY_ID=your_alpaca_key
APCA_API_SECRET_KEY=your_alpaca_secret
FRONTEND_URL=http://localhost:3000
PORT=4000
```

**brain-python/.env**
```env
GROQ_API_KEY=your_groq_key
APCA_API_KEY_ID=your_alpaca_key
APCA_API_SECRET_KEY=your_alpaca_secret
FINNHUB_API_KEY=optional
GEMINI_API_KEY=optional
```

The backend creates its `trading_signals` table on startup.

## Known limitations

- The admin reset route is protected only by a hard-coded query key; it needs proper authentication before any public deployment.
- LLM confidence scores are model output, not calibrated probabilities.
- The simulation fallback produces synthetic prices (returned with `isSimulated: true`); they should never be read as market data.

## Author

Built by **Tolbert Okoth**: [Portfolio](https://tolbert-portfolio.vercel.app) · [GitHub](https://github.com/Tolbert-Okoth) · [LinkedIn](https://www.linkedin.com/in/tolbert-asumba-542b3b344)
