require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const Parser = require('rss-parser');

/* ---------------- ROUTES ---------------- */
const signalRoutes = require('./routes/signalRoutes');

/* ---------------- YAHOO FINANCE ---------------- */
const yfModule = require('yahoo-finance2');
const YahooFinanceClass =
  yfModule.YahooFinance ||
  yfModule.default?.YahooFinance ||
  yfModule.default;

let yahooFinance;
try {
  yahooFinance = new YahooFinanceClass();
} catch {
  yahooFinance = yfModule.default || yfModule;
}
if (yahooFinance.suppressNotices) {
  yahooFinance.suppressNotices(['yahooSurvey', 'cookie']);
}

/* ---------------- ALPACA CONFIG ---------------- */
const ALPACA = {
  key: process.env.ALPACA_API_KEY,
  secret: process.env.ALPACA_SECRET_KEY,
  base: process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets'
};

const alpacaClient = axios.create({
  baseURL: ALPACA.base,
  timeout: 10000,
  headers: {
    'APCA-API-KEY-ID': ALPACA.key,
    'APCA-API-SECRET-KEY': ALPACA.secret
  }
});

/* ---------------- APP INIT ---------------- */
const app = express();
const server = http.createServer(app);

/* ---------------- SECURITY ---------------- */
const ALLOWED_ORIGINS = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : '*';

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(helmet());
app.set('trust proxy', 1);

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.json());

/* ---------------- ROUTES ---------------- */
app.get('/health', (_, res) => res.status(200).send('ALIVE'));
app.use('/api/v1/intel', signalRoutes);

/* ---------------- DB ---------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ---------------- SOCKET ---------------- */
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS }
});

/* ---------------- RSS ---------------- */
const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0' }
});

/* ---------------- ASSETS ---------------- */
const ASSETS = {
  SPY:  { rss: 'https://finance.yahoo.com/rss/topstories', yahoo: 'SPY', alpaca: 'SPY', default: 595 },
  NVDA: { rss: 'https://finance.yahoo.com/rss/headline?s=NVDA', yahoo: 'NVDA', alpaca: 'NVDA', default: 135 },
  TSLA: { rss: 'https://finance.yahoo.com/rss/headline?s=TSLA', yahoo: 'TSLA', alpaca: 'TSLA', default: 240 },
  COIN: { rss: 'https://finance.yahoo.com/rss/headline?s=COIN', yahoo: 'COIN', alpaca: 'COIN', default: 190 },
  PLTR: { rss: 'https://finance.yahoo.com/rss/headline?s=PLTR', yahoo: 'PLTR', alpaca: 'PLTR', default: 42 },
  AMD:  { rss: 'https://finance.yahoo.com/rss/headline?s=AMD',  yahoo: 'AMD',  alpaca: 'AMD',  default: 155 }
};

let marketCache = {};
let historyCache = {};

/* ---------------- SOCKET INIT ---------------- */
io.on('connection', async socket => {
  try {
    const result = await pool.query(
      'SELECT * FROM trading_signals ORDER BY timestamp DESC LIMIT 50'
    );
    socket.emit('history_dump', { signals: result.rows });
  } catch {
    socket.emit('history_dump', { signals: [] });
  }
});

/* ---------------- UTILS ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- ALPACA FETCH ---------------- */
async function fetchFromAlpaca(symbol, start, end, timeframe) {
  const tf = timeframe === '15m' ? '15Min' : timeframe === '1wk' ? '1Week' : '1Day';

  const res = await alpacaClient.get('/v2/stocks/bars', {
    params: {
      symbols: symbol,
      timeframe: tf,
      start: start.toISOString(),
      end: end.toISOString(),
      adjustment: 'raw',
      limit: 1000
    }
  });

  const bars = res.data?.bars?.[symbol];
  if (!bars || !bars.length) throw new Error('Alpaca empty');

  return bars.map(b => ({
    time: Math.floor(new Date(b.t).getTime() / 1000),
    value: b.c
  }));
}

/* ---------------- HISTORY ENDPOINT ---------------- */
app.get('/api/v1/history', async (req, res) => {
  const symbol = req.query.symbol || 'SPY';
  const range = req.query.range || '1y';
  const asset = ASSETS[symbol] || ASSETS.SPY;

  const cacheKey = `${symbol}_${range}`;
  const now = Date.now();

  if (historyCache[cacheKey] && now - historyCache[cacheKey].timestamp < 15 * 60 * 1000) {
    return res.json(historyCache[cacheKey].data);
  }

  let start = new Date();
  let end = new Date();
  let interval = '1d';

  switch (range) {
    case '1d': start.setDate(end.getDate() - 2); interval = '15m'; break;
    case '1mo': start.setMonth(end.getMonth() - 1); break;
    case '3mo': start.setMonth(end.getMonth() - 3); break;
    case '1y': start.setFullYear(end.getFullYear() - 1); interval = '1wk'; break;
    case 'ytd': start = new Date(end.getFullYear(), 0, 1); break;
  }

  /* ---------- TRY YAHOO ---------- */
  try {
    const data = await yahooFinance.historical(asset.yahoo, {
      period1: start,
      period2: end,
      interval
    });

    if (!data?.length) throw new Error('Yahoo empty');

    const formatted = data
      .filter(d => d.close !== null)
      .map(d => ({ time: d.date.getTime() / 1000, value: d.close }));

    historyCache[cacheKey] = { timestamp: now, data: formatted };
    marketCache[symbol] = formatted.at(-1)?.value;
    return res.json(formatted);
  } catch (yErr) {
    console.error('Yahoo failed → Alpaca', yErr.message);
  }

  /* ---------- FALLBACK: ALPACA ---------- */
  try {
    const formatted = await fetchFromAlpaca(asset.alpaca, start, end, interval);
    historyCache[cacheKey] = { timestamp: now, data: formatted };
    marketCache[symbol] = formatted.at(-1)?.value;
    return res.json(formatted);
  } catch (aErr) {
    console.error('Alpaca failed → Simulation', aErr.message);
  }

  return res.json(generateSimulationData(symbol, range));
});

/* ---------------- SIMULATION ---------------- */
function generateSimulationData(symbol, range) {
  let price = marketCache[symbol] || ASSETS[symbol]?.default || 100;
  const data = [];
  const points = range === '1d' ? 50 : 100;
  let time = Date.now();

  for (let i = 0; i < points; i++) {
    data.push({
      time: Math.floor(time / 1000),
      value: Number(price.toFixed(2)),
      isSimulated: true
    });
    price += (Math.random() - 0.5) * 2;
    time -= 60 * 60 * 1000;
  }
  return data.reverse();
}

/* ---------------- START ---------------- */
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trading_signals (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10),
      headline TEXT,
      sentiment_score DECIMAL,
      confidence DECIMAL,
      verdict VARCHAR(20),
      status VARCHAR(20),
      reasoning TEXT,
      entry_price DECIMAL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log(`✅ GHOUL_COMMAND_CENTER LIVE ON ${PORT}`);
});
