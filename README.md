# Ghoul System: Market Intelligence Dashboard

<img width="1888" height="885" alt="Image" src="https://github.com/user-attachments/assets/4e3613b7-53a5-4309-b369-715ef86aee52" />

**Built in 2025.** Ghoul System is a full-stack market-intelligence prototype. It pulls live prices and financial news, runs technical indicators and LLM sentiment analysis in a Python service, stores the resulting signals in PostgreSQL, and streams them to a real-time dashboard.

> **Prototype, not a trading system.** Signals combine technical indicators with LLM-generated sentiment and confidence scores. They have not been backtested or validated, and nothing here places trades. For my later, statistically validated research, see [propsim](https://github.com/Tolbert-Okoth/propfirm-pass-sim) and the [Hurst/DFA study](https://github.com/Tolbert-Okoth/Gold--hurst--daily-classifier).

## What it does

- **Data with failover:** prices come from Alpaca (IEX feed), fall back to Yahoo Finance, and finally to a simulation mode flagged with `isSimulated`, so the dashboard keeps working when a provider fails.
- **Analysis service (Python):** computes RSI, MACD and Bollinger Bands with pandas and asks an LLM (Groq, with fallbacks) to score news sentiment.
- **Orchestration (Node.js):** schedules scans, calls the Python service, saves signals to PostgreSQL and broadcasts updates over Socket.io.
- **Retention job:** a scheduled cleanup deletes signals older than 7 days to stay within free-tier database limits.
- **Dashboard (React):** live charts, a signal feed and real-time updates; responsive on mobile.

## Architecture

```
frontend-react  <--Socket.io/REST-->  backend-node  --HTTP-->  brain-python
  (React,                             (Express,                (Flask, pandas,
   Recharts)                           PostgreSQL)              Groq)
```

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React (Create React App), Recharts, Socket.io client |
| Backend | Node.js, Express, Socket.io, PostgreSQL (`pg`), RSS parser |
| Analysis service | Python, Flask, pandas, yfinance, Groq API |
| Data providers | Alpaca (primary), Yahoo Finance (backup) |

## Run locally

Requirements: Node.js 18+, Python 3.10+ and PostgreSQL.

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

Copy each `.env.example` to `.env` and fill it in:

- `backend-node/.env.example`: database, data providers, the shared secret for the analysis service, and the optional admin key
- `brain-python/.env.example`: LLM and data keys, plus the same shared secret
- `frontend-react/frontend-ghoul/.env.example`: `REACT_APP_API_URL` for local development

The backend creates its `trading_signals` table on startup.

## Security

- **Admin reset** is disabled unless `ADMIN_RESET_KEY` is set (16+ characters). It only accepts `POST` with the key in an `X-Admin-Key` header, compared in constant time.
- **Analysis service** rejects requests without the shared `X-Brain-Key` when `BRAIN_SHARED_SECRET` is set, so the public URL can't be used to spend the LLM quota. It validates symbols, modes and headline length.
- **Chart API** only serves the tracked watchlist and known ranges, which keeps the cache bounded.
- Helmet headers, CORS restricted to `FRONTEND_URL`, and rate limiting on `/api`.

## Known limitations

- LLM confidence scores are model output, not calibrated probabilities.
- The simulation fallback produces synthetic prices (returned with `isSimulated: true`); they should never be read as market data.
- Headlines are sent to third-party LLM providers.

## Author

Built by **Tolbert Okoth**: [Portfolio](https://tolbert-portfolio.vercel.app) · [GitHub](https://github.com/Tolbert-Okoth) · [LinkedIn](https://www.linkedin.com/in/tolbert-asumba-542b3b344)
