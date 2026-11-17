require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios'); 
const Parser = require('rss-parser'); 

// 🚨 VERSION CHECK: Look for this in your Render Logs to confirm update!
console.log("🚀 GHOUL SERVER V2.2 (AUTO-CLEANUP ENABLED) STARTING...");

// --- 🦙 ALPACA SETUP (Primary Data) ---
// Direct REST call to Alpaca's market-data API (free IEX feed); no SDK needed.
async function fetchAlpacaBars(symbol, { start, end, timeframe }) {
  if (!process.env.APCA_API_KEY_ID || !process.env.APCA_API_SECRET_KEY) throw new Error('Alpaca keys not set');
  const bars = [];
  let pageToken;
  do {
    const { data } = await axios.get(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`, {
      headers: {
        'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
      },
      params: { start, end, timeframe, limit: 1000, adjustment: 'split', feed: 'iex', page_token: pageToken },
      timeout: 10000,
    });
    bars.push(...(data.bars || []));
    pageToken = data.next_page_token;
  } while (pageToken && bars.length < 5000);
  return bars;
}

// --- 💜 YAHOO FINANCE SETUP (Backup Data) ---
const yfModule = require('yahoo-finance2');
const YahooFinanceClass = yfModule.YahooFinance || yfModule.default?.YahooFinance || yfModule.default;
let yahooFinance;
try { yahooFinance = new YahooFinanceClass(); } 
catch (e) { yahooFinance = yfModule.default || yfModule; }
if (yahooFinance && yahooFinance.suppressNotices) yahooFinance.suppressNotices(['yahooSurvey', 'cookie']);

// --- IMPORTS FOR ROUTING ---
const createSignalRoutes = require('./routes/signalRoutes');

const app = express();
const server = http.createServer(app);

// ------------------------------------------
// 🛡️ SECURITY & PROXY SETTINGS
// ------------------------------------------
const ALLOWED_ORIGINS = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : '*';

app.use(cors({
    origin: ALLOWED_ORIGINS, 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(helmet());
app.set('trust proxy', 1); 

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 200, 
    standardHeaders: true, 
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});
app.use('/api', limiter);
app.use(express.json({ limit: '50kb' }));

// ------------------------------------------
// ⚙️ BACKGROUND SYSTEM SETUP
// ------------------------------------------
const pool = require('./config/db');

const io = new Server(server, { 
    cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] }
});

const parser = new Parser({
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000 
});

const ASSETS = {
    'SPY':  { rss: 'https://finance.yahoo.com/rss/topstories', yahooTicker: 'SPY', defaultPrice: 595.00 },
    'NVDA': { rss: 'https://finance.yahoo.com/rss/headline?s=NVDA', yahooTicker: 'NVDA', defaultPrice: 135.00 },
    'TSLA': { rss: 'https://finance.yahoo.com/rss/headline?s=TSLA', yahooTicker: 'TSLA', defaultPrice: 240.00 },
    'COIN': { rss: 'https://finance.yahoo.com/rss/headline?s=COIN', yahooTicker: 'COIN', defaultPrice: 190.00 },
    'PLTR': { rss: 'https://finance.yahoo.com/rss/headline?s=PLTR', yahooTicker: 'PLTR', defaultPrice: 42.00 },
    'AMD':  { rss: 'https://finance.yahoo.com/rss/headline?s=AMD',  yahooTicker: 'AMD', defaultPrice: 155.00 }
};

const VALID_RANGES = ['1d', '1mo', '3mo', '1y', 'ytd'];
let marketCache = {}; 
let historyCache = {}; 

// ------------------------------------------
// 🚦 ROUTES & CONTROLLERS
// ------------------------------------------
app.get('/health', (req, res) => {
    res.status(200).send('ALIVE');
});

// ADMIN: wipe stored signals.
// Disabled unless ADMIN_RESET_KEY is set. Call with:
//   curl -X POST -H "X-Admin-Key: $ADMIN_RESET_KEY" https://<host>/api/admin/reset
function isAdminKeyValid(provided) {
    const expected = process.env.ADMIN_RESET_KEY;
    if (!expected || expected.length < 16 || typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/api/admin/reset', async (req, res) => {
    if (!process.env.ADMIN_RESET_KEY) return res.status(404).json({ error: 'Not found' });
    if (!isAdminKeyValid(req.get('X-Admin-Key'))) return res.status(403).json({ error: 'Forbidden' });
    try {
        await pool.query('TRUNCATE TABLE trading_signals RESTART IDENTITY');
        console.log('Admin reset: trading_signals cleared');
        io.emit('history_dump', { signals: [] });
        res.json({ message: 'Signals cleared.' });
    } catch (error) {
        console.error('Admin reset failed:', error.message);
        res.status(500).json({ error: 'Reset failed' });
    }
});

app.use('/api/v1/intel', createSignalRoutes(Object.keys(ASSETS)));

// ------------------------------------------
// 🔌 WEBSOCKET CONNECTION
// ------------------------------------------
io.on('connection', async (socket) => {
    console.log('New client connected:', socket.id);
    try {
        const result = await pool.query("SELECT * FROM trading_signals ORDER BY timestamp DESC LIMIT 50");
        socket.emit('history_dump', { signals: result.rows });
    } catch (err) {
        socket.emit('history_dump', { signals: [] });
    }
    socket.on('disconnect', () => console.log('Client disconnected'));
});

// ------------------------------------------
// 🧠 BACKGROUND WORKER LOGIC
// ------------------------------------------
async function processSignal(headline, symbol, currentPrice, isTechnicalCheck = false) {
    try {
        const logPrefix = isTechnicalCheck ? "[❤️ HEARTBEAT]" : "[📰 NEWS]";
        console.log(`${logPrefix} ${symbol}: Sending to Brain...`);
        
        const brainURL = process.env.PYTHON_MICROSERVICE_URL 
            ? `${process.env.PYTHON_MICROSERVICE_URL}/analyze` 
            : 'http://127.0.0.1:5000/analyze';
        
        const brainHeaders = process.env.BRAIN_SHARED_SECRET ? { 'X-Brain-Key': process.env.BRAIN_SHARED_SECRET } : {};
        const brainResponse = await axios.post(brainURL, { 
            headline: headline, symbol: symbol, mode: isTechnicalCheck ? 'technical_only' : 'standard' 
        }, { headers: brainHeaders, timeout: 45000 });
        
        if (!brainResponse.data) return false;

        const aiData = brainResponse.data;
        console.log(`${logPrefix} ${symbol}: 🧠 Brain Replied -> ${aiData.action} (${aiData.confidence})`);
        
        const safePrice = isNaN(parseFloat(currentPrice)) ? 0.0 : parseFloat(currentPrice);
        const safeScore = isNaN(parseFloat(aiData.sentiment_score)) ? 0.0 : parseFloat(aiData.sentiment_score);
        const safeConf = isNaN(parseFloat(aiData.confidence)) ? 0.0 : parseFloat(aiData.confidence);
        const safeVerdict = aiData.action || "NEUTRAL";
        const safeReason = aiData.reasoning || "No reasoning provided.";
        
        let finalStatus = safeVerdict === 'IGNORE' || safeConf < 0.30 ? 'NOISE' : (safeConf < 0.60 ? 'PASSIVE' : 'ACTIVE');
        
        if (finalStatus !== 'NOISE' || isTechnicalCheck) {
            try {
                const result = await pool.query(
                    'INSERT INTO trading_signals (headline, sentiment_score, confidence, reasoning, entry_price, status, symbol, verdict) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *', 
                    [headline, safeScore, safeConf, `[RISK: ${aiData.risk_level}] ${safeReason}`, safePrice, finalStatus, symbol, safeVerdict]
                ); 
                
                const newSignal = result.rows[0];
                io.emit('new_signal', newSignal); 
                return true;
            } catch (dbErr) {
                console.error(`❌ DB INSERT FAILED: ${dbErr.message}`);
                io.emit('new_signal', {
                    id: Date.now(), symbol, headline, verdict: safeVerdict, confidence: safeConf, reasoning: safeReason + " (Live Only)", timestamp: new Date()
                });
            }
        }
        return false;
    } catch (err) { 
        console.error(`Error processing ${symbol}: ${err.message}`); 
        return false; 
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runSmartScan() {
    console.log("📡 PULSE: Starting Dual-Scan Cycle...");
    
    for (const sym of Object.keys(ASSETS)) {
        try {
            const feed = await parser.parseURL(ASSETS[sym].rss);
            const latestItem = feed.items[0]; 

            if (latestItem) {
                console.log(`📰 NEWS DETECTED: "${latestItem.title}"`);
                await processSignal(latestItem.title, sym, marketCache[sym] || 0, false);
                await sleep(2000);
            }
        } catch (err) { console.error(`❌ RSS Error for ${sym}: ${err.message}`); }

        console.log(`📈 INITIATING TECHNICAL CHECK for ${sym}...`);
        await processSignal("Technical Market Check", sym, marketCache[sym] || 0, true);
        await sleep(5000); 
    }

    console.log("\n✅ SCAN COMPLETE. Sleeping 30 minutes.");
    setTimeout(runSmartScan, 1800000);
}

// ------------------------------------------
// 📈 CHART DATA (MULTI-TIERED FETCH)
// ------------------------------------------
app.get('/api/v1/history', async (req, res) => {
    const symbol = String(req.query.symbol || 'SPY').toUpperCase();
    const range = String(req.query.range || '1y');
    // Only serve the tracked watchlist and known ranges: keeps the cache bounded
    // and stops arbitrary input reaching the data providers.
    if (!ASSETS[symbol]) return res.status(400).json({ error: 'Unknown symbol' });
    if (!VALID_RANGES.includes(range)) return res.status(400).json({ error: 'Unknown range' });
    const ticker = ASSETS[symbol].yahooTicker;
    const cacheKey = `${symbol}_${range}`;
    const now = Date.now();

    // 1. CHECK CACHE FIRST (The Shield)
    if (historyCache[cacheKey] && (now - historyCache[cacheKey].timestamp < 15 * 60 * 1000)) {
        console.log(`⚡ Serving Cached Data for ${symbol} (${range})`);
        return res.json(historyCache[cacheKey].data);
    }

    // ATTEMPT 1: ALPACA (Primary)
    try {
        console.log(`🦙 Fetching ALPACA data for ${symbol}...`);
        const endDate = new Date();
        const startDate = new Date();
        let timeframe = '1Day'; 

        switch(range) {
            case '1d': startDate.setDate(endDate.getDate() - 2); timeframe = '15Min'; break;
            case '1mo': startDate.setMonth(endDate.getMonth() - 1); break;
            case '3mo': startDate.setMonth(endDate.getMonth() - 3); break;
            case 'ytd': startDate.setMonth(0, 1); break;
            case '1y': startDate.setFullYear(endDate.getFullYear() - 1); break;
            default: startDate.setFullYear(endDate.getFullYear() - 1);
        }

        const bars = await fetchAlpacaBars(symbol, {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            timeframe,
        });

        const formattedData = bars.map(bar => ({ time: new Date(bar.t).getTime() / 1000, value: bar.c }));

        if (formattedData.length === 0) throw new Error("No data from Alpaca");
        
        // Cache & Return
        historyCache[cacheKey] = { timestamp: now, data: formattedData };
        if (formattedData.length > 0) marketCache[symbol] = formattedData[formattedData.length - 1].value;
        return res.json(formattedData);

    } catch (alpacaErr) {
        console.error(`❌ ALPACA FAILED (code: ${alpacaErr.code || 'N/A'}, message: ${alpacaErr.message}). Switching to YAHOO...`);
        
        // ATTEMPT 2: YAHOO (Backup)
        try {
            const endDate = new Date();
            const startDate = new Date();
            let interval = '1d';

            switch(range) {
                case '1d': startDate.setDate(endDate.getDate() - 2); interval = '15m'; break;
                case '1mo': startDate.setMonth(endDate.getMonth() - 1); break;
                case '3mo': startDate.setMonth(endDate.getMonth() - 3); break;
                case 'ytd': startDate.setMonth(0, 1); break;
                case '1y': startDate.setFullYear(endDate.getFullYear() - 1); interval = '1wk'; break;
                default: startDate.setFullYear(endDate.getFullYear() - 1);
            }

            console.log(`💜 Fetching YAHOO data for ${ticker}...`);
            const result = await yahooFinance.historical(ticker, {
                period1: startDate, period2: endDate, interval: interval
            });

            const formattedData = result.map(q => ({
                time: new Date(q.date).getTime() / 1000, value: q.close
            })).filter(p => p.value !== null);

            if (formattedData.length === 0) throw new Error("No data from Yahoo");

            // Cache & Return
            historyCache[cacheKey] = { timestamp: now, data: formattedData };
            return res.json(formattedData);

        } catch (yahooErr) {
            console.error(`❌ YAHOO FAILED (${yahooErr.message}). Engaging SIMULATION.`);
            
            // ATTEMPT 3: SIMULATION (Doomsday)
            res.json(generateSimulationData(symbol, range));
        }
    }
});

// PURE MATH SIMULATION (Prevents 404s)
function generateSimulationData(symbol, range) {
    const data = [];
    let price = marketCache[symbol] || ASSETS[symbol].defaultPrice;
    let date = new Date();
    let points = range === '1d' ? 50 : 100;
    
    for(let i = 0; i < points; i++) {
        const move = (Math.random() - 0.5) * (price * 0.02);
        price += move;
        data.push({ 
            time: Math.floor(date.getTime()/1000), 
            value: parseFloat(price.toFixed(2)), 
            isSimulated: true 
        });
        if (range === '1d') date.setMinutes(date.getMinutes() - 15);
        else date.setDate(date.getDate() - 1);
    }
    return data.reverse();
}

// ------------------------------------------
// 🗑️ GARBAGE COLLECTOR (Auto-Purge)
// ------------------------------------------
const RETENTION_DAYS = 7; // Keep only 7 days of history on free tier
async function runGarbageCollector() {
    try {
        const result = await pool.query(
            "DELETE FROM trading_signals WHERE timestamp < NOW() - make_interval(days => $1)",
            [RETENTION_DAYS]
        );
        if (result.rowCount > 0) {
            console.log(`🧹 GARBAGE COLLECTOR: Purged ${result.rowCount} old signals.`);
        }
    } catch (error) {
        console.error('❌ GC FAILED:', error.message);
    }
}
// Run once every 24 hours
setInterval(runGarbageCollector, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => { 
    console.log(`GHOUL_COMMAND_CENTER: LIVE (Port ${PORT})`);
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS trading_signals (id SERIAL PRIMARY KEY, symbol VARCHAR(10), headline TEXT, sentiment_score DECIMAL, confidence DECIMAL, verdict VARCHAR(20), status VARCHAR(20), reasoning TEXT, entry_price DECIMAL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        console.log("✅ DATABASE: Ready.");
        
        // Run Cleanup on Startup
        await runGarbageCollector();

    } catch (err) { console.error("DB Init Error:", err.message); }
    setTimeout(runSmartScan, 5000);
});