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

// --- IMPORTS FOR ROUTING ---
const signalRoutes = require('./routes/signalRoutes'); 

// --- YAHOO FINANCE SETUP ---
const yfModule = require('yahoo-finance2');
const YahooFinanceClass = yfModule.YahooFinance || yfModule.default?.YahooFinance || yfModule.default;
let yahooFinance;
try { yahooFinance = new YahooFinanceClass(); } 
catch (e) { yahooFinance = yfModule.default || yfModule; }
if (yahooFinance.suppressNotices) yahooFinance.suppressNotices(['yahooSurvey', 'cookie']);

const app = express();
const server = http.createServer(app);

// ------------------------------------------
// 🛡️ SECURITY & PROXY SETTINGS
// ------------------------------------------
app.use(helmet());
app.set('trust proxy', 1); 

const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://frontend-ghoul.vercel.app'];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1 && process.env.NODE_ENV !== 'production') { }
        return callback(null, true);
    },
    methods: ["GET", "POST"],
    credentials: true
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    standardHeaders: true, 
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});
app.use('/api', limiter);
app.use(express.json());

// ------------------------------------------
// 🚦 ROUTES & CONTROLLERS
// ------------------------------------------
app.get('/health', (req, res) => {
    res.status(200).send('ALIVE');
});

app.use('/api/v1/intel', signalRoutes);

// ------------------------------------------
// ⚙️ BACKGROUND SYSTEM SETUP
// ------------------------------------------
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const parser = new Parser({
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36' },
    timeout: 10000 
});

const ASSETS = {
    'SPY':  { rss: 'https://finance.yahoo.com/rss/topstories', yahooTicker: 'ES=F', defaultPrice: 595.00 },
    'NVDA': { rss: 'https://finance.yahoo.com/rss/headline?s=NVDA', yahooTicker: 'NVDA', defaultPrice: 135.00 },
    'TSLA': { rss: 'https://finance.yahoo.com/rss/headline?s=TSLA', yahooTicker: 'TSLA', defaultPrice: 240.00 },
    'COIN': { rss: 'https://finance.yahoo.com/rss/headline?s=COIN', yahooTicker: 'COIN', defaultPrice: 190.00 },
    'PLTR': { rss: 'https://finance.yahoo.com/rss/headline?s=PLTR', yahooTicker: 'PLTR', defaultPrice: 42.00 },
    'AMD':  { rss: 'https://finance.yahoo.com/rss/headline?s=AMD',  yahooTicker: 'AMD', defaultPrice: 155.00 }
};

// 🧠 SERVER MEMORY
let signalHistory = [];  // Stores last 50 signals for live broadcasting
let marketCache = {}; 
let chartCache = {}; 

// ------------------------------------------
// 🔌 WEBSOCKET CONNECTION (The "Live Truth" Fix)
// ------------------------------------------
io.on('connection', async (socket) => {
    console.log('New client connected:', socket.id);

    try {
        // 🔍 DEBUG: Log that we are trying to fetch
        console.log("🔍 Fetching history from DB for new client...");

        // 🧠 ALWAYS Ask Database for the latest 50 signals
        // This ensures reloading the page ALWAYS gets the saved data
        const result = await pool.query("SELECT * FROM trading_signals ORDER BY id DESC LIMIT 50");
        
        console.log(`📤 Sending ${result.rows.length} signals to client.`);

        // ⚡ Send the fresh DB data
        socket.emit('history_dump', {
            signals: result.rows
        });

    } catch (err) {
        console.error("❌ History Fetch Failed:", err.message);
        // Fallback to RAM if DB fails
        socket.emit('history_dump', { signals: signalHistory });
    }

    socket.on('disconnect', () => console.log('Client disconnected'));
});

// ------------------------------------------
// 🧠 BACKGROUND WORKER LOGIC
// ------------------------------------------
async function processSignal(headline, symbol, currentPrice, isTechnicalCheck = false) {
    try {
        if (!isTechnicalCheck) {
            try {
                const existing = await pool.query("SELECT id FROM trading_signals WHERE headline = $1", [headline]);
                if (existing.rows.length > 0) return false; 
            } catch (dbErr) {
                console.log("⚠️ DB Table might be missing. Skipping duplicate check.");
            }
        }
        
        const logPrefix = isTechnicalCheck ? "[❤️ HEARTBEAT]" : "[📰 NEWS]";
        console.log(`${logPrefix} ${symbol}: Analyzing...`);
        
        const brainURL = process.env.PYTHON_MICROSERVICE_URL 
            ? `${process.env.PYTHON_MICROSERVICE_URL}/analyze` 
            : 'http://127.0.0.1:5000/analyze';
        
        const brainResponse = await axios.post(brainURL, { 
            headline: headline, symbol: symbol, mode: isTechnicalCheck ? 'technical_only' : 'standard' 
        });
        const aiData = brainResponse.data;
        
        let finalStatus = aiData.action === 'IGNORE' || aiData.confidence < 0.30 ? 'NOISE' : (aiData.confidence < 0.60 ? 'PASSIVE' : 'ACTIVE');
        
        if (finalStatus !== 'NOISE' || isTechnicalCheck) {
            const result = await pool.query(
                'INSERT INTO trading_signals (headline, sentiment_score, confidence, reasoning, entry_price, status, symbol, verdict) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *', 
                [headline, aiData.sentiment_score, aiData.confidence, `[RISK: ${aiData.risk_level}] ${aiData.reasoning}`, currentPrice, finalStatus, symbol, aiData.action]
            ); 
            
            const newSignal = result.rows[0];

            // 1. SAVE TO RAM (For live buffering)
            signalHistory.unshift(newSignal);
            if (signalHistory.length > 50) signalHistory.pop();

            // 2. BROADCAST LIVE
            io.emit('new_signal', newSignal); 
            
            return true;
        }
        return false;
    } catch (err) { 
        console.error(`Error processing ${symbol}: ${err.message}`); 
        return false; 
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// === 🐢 ECONOMY MODE ===
async function runSmartScan() {
    console.log("📡 PULSE: Cycling through Asset Watchlist (Economy Mode)...");
    for (const sym of Object.keys(ASSETS)) {
        let signalFound = false;
        try {
            const feed = await parser.parseURL(ASSETS[sym].rss);
            for (const item of feed.items.slice(0, 1)) { 
                if (await processSignal(item.title, sym, marketCache[sym] || 0)) signalFound = true;
            }
        } catch (e) { }
        
        if (!signalFound) await processSignal("Technical Market Check", sym, marketCache[sym] || 0, true);
        console.log(`[WAIT] Cooling down for 20s...`);
        await sleep(20000); 
    }
    console.log("✅ Cycle Complete. Sleeping 30 min.");
    setTimeout(runSmartScan, 1800000);
}

// ------------------------------------------
// 🛠️ UTILITY ROUTES
// ------------------------------------------
app.get('/api/force-scan', async (req, res) => {
    console.log("[MANUAL OVERRIDE] 🔴 Force triggering AI Scan...");
    runSmartScan(); 
    res.json({ message: "Manual scan triggered. Check Render logs." });
});

app.get('/setup-db', async (req, res) => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS trading_signals (id SERIAL PRIMARY KEY, symbol VARCHAR(10), headline TEXT, sentiment_score DECIMAL, confidence DECIMAL, verdict VARCHAR(20), status VARCHAR(20), reasoning TEXT, entry_price DECIMAL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        res.send("✅ SUCCESS: Database Ready.");
    } catch (error) { res.status(500).send("❌ ERROR: " + error.message); }
});

app.get('/api/backfill', async (req, res) => {
    console.log("[BACKFILL] 🕰️ Starting Deep History Scan...");
    res.send("✅ Backfill started!");
    (async () => {
        for (const sym of Object.keys(ASSETS)) {
            try {
                const feed = await parser.parseURL(ASSETS[sym].rss);
                for (const item of feed.items.slice(0, 10)) {
                    const existing = await pool.query("SELECT id FROM trading_signals WHERE headline = $1", [item.title]);
                    if (existing.rows.length === 0) {
                        await processSignal(item.title, sym, marketCache[sym] || 0);
                        await sleep(6000); 
                    }
                }
            } catch (e) {}
            await sleep(10000);
        }
        console.log("✅ [BACKFILL] COMPLETE.");
    })();
});

// ------------------------------------------
// 📈 CHART DATA
// ------------------------------------------
app.get('/api/v1/history', async (req, res) => {
    const symbol = req.query.symbol || 'SPY';
    const range = req.query.range || '1y'; 
    const ticker = ASSETS[symbol] ? ASSETS[symbol].yahooTicker : 'ES=F';
    
    const cacheKey = `${symbol}_${range}`;
    if (chartCache[cacheKey] && chartCache[cacheKey].expiry > Date.now()) return res.json(chartCache[cacheKey].data);

    let interval = '1d';
    const period1 = new Date(); 
    const period2 = new Date(); 

    if (range === '1d') { period1.setDate(period1.getDate() - 1); interval = '15m'; }
    else if (range === '5d') { period1.setDate(period1.getDate() - 5); interval = '15m'; }
    else if (range === '1mo') { period1.setMonth(period1.getMonth() - 1); interval = '60m'; }
    else if (range === '3mo') { period1.setMonth(period1.getMonth() - 3); interval = '60m'; }
    else if (range === '1y') { period1.setFullYear(period1.getFullYear() - 1); interval = '1d'; }
    else { period1.setFullYear(period1.getFullYear() - 1); } 

    try {
        console.log(`[FETCHING] Downloading data for ${symbol} (Interval: ${interval})...`);
        const result = await yahooFinance.chart(ticker, { period1: period1, period2: period2, interval: interval });
        const formatted = result.quotes.filter(q => q.close).map(d => ({ time: Math.floor(new Date(d.date).getTime()/1000), value: d.close }));
        
        if(formatted.length > 0) {
            marketCache[symbol] = formatted[formatted.length-1].value;
            chartCache[cacheKey] = { data: formatted, expiry: Date.now() + (interval === '1d' ? 3600000 : 300000) };
            res.json(formatted);
        } else { throw new Error("Empty Data"); }
    } catch (err) {
        console.log(`⚠️ Yahoo Error (${symbol}): ${err.message}. Switching to Simulation.`);
        const simData = generateSimulationData(symbol, range);
        if(simData.length > 0) marketCache[symbol] = simData[simData.length-1].value;
        res.json(simData);
    }
});

function generateSimulationData(symbol, range) {
    const data = [];
    let price = marketCache[symbol] || ASSETS[symbol].defaultPrice;
    let date = new Date();
    let points = range === '1d' ? 78 : (range === '5d' ? 100 : (range === '1mo' ? 30 : 252));
    let intervalMinutes = (range === '1d' || range === '5d') ? (range === '1d' ? 5 : 60) : 1440;
    
    for(let i = 0; i < points; i++) {
        data.push({ time: Math.floor(date.getTime()/1000), value: parseFloat(price.toFixed(2)) });
        price -= (Math.random() * price * (range === '1d' ? 0.002 : 0.02) * 2) - (price * (range === '1d' ? 0.002 : 0.02));
        date.setMinutes(date.getMinutes() - intervalMinutes);
    }
    return data.reverse();
}

// ------------------------------------------
// 🔌 STARTUP SEQUENCE
// ------------------------------------------
setInterval(() => {
    Object.keys(ASSETS).forEach(sym => {
        if (!marketCache[sym]) marketCache[sym] = ASSETS[sym].defaultPrice; 
        marketCache[sym] += (Math.random() - 0.5) * (marketCache[sym] * 0.002);
        io.emit(`price_tick_${sym}`, { price: marketCache[sym] });
    });
}, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => { 
    console.log(`GHOUL_COMMAND_CENTER: LIVE (Port ${PORT})`);

    // 1. Ensure Table Exists
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS trading_signals (id SERIAL PRIMARY KEY, symbol VARCHAR(10), headline TEXT, sentiment_score DECIMAL, confidence DECIMAL, verdict VARCHAR(20), status VARCHAR(20), reasoning TEXT, entry_price DECIMAL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        console.log("✅ SUCCESS: Database Ready.");
    } catch (err) { console.error("DB Init Error:", err.message); }
    
    // 3. Start AI Scan
    setTimeout(runSmartScan, 10000);
});