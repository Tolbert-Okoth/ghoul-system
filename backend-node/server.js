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
// ----------------------------

const app = express();
const server = http.createServer(app);

// ------------------------------------------
// 🛡️ SECURITY & PROXY SETTINGS
// ------------------------------------------
app.use(helmet());
app.set('trust proxy', 1); // CRITICAL: Fixes the rate limit error on Render

const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1 && process.env.NODE_ENV !== 'production') {
             // console.log('Blocked Origin:', origin);
        }
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
// 🚦 ROUTES & CONTROLLERS (The Fix)
// ------------------------------------------

// 1. HEALTH CHECK (UptimeRobot Target)
app.get('/health', (req, res) => {
    res.status(200).send('ALIVE');
});

// 2. CONNECT THE SIGNAL ROUTES (Fixes 500 Error)
// This hands off "/api/v1/intel" requests to your new signalController.js
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

let marketCache = {}; 
let chartCache = {}; 

// ------------------------------------------
// 🧠 BACKGROUND WORKER LOGIC
// ------------------------------------------
async function processSignal(headline, symbol, currentPrice, isTechnicalCheck = false) {
    try {
        if (!isTechnicalCheck) {
            const existing = await pool.query("SELECT id FROM trading_signals WHERE headline = $1", [headline]);
            if (existing.rows.length > 0) return false; 
        }
        
        const logPrefix = isTechnicalCheck ? "[❤️ HEARTBEAT]" : "[📰 NEWS]";
        console.log(`${logPrefix} ${symbol}: Analyzing...`);
        
        // --- CLOUD LINK: Connect to Python Service ---
        // Uses the ENV variable we set in Render
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
            io.emit('new_signal', result.rows[0]); 
            return true;
        }
        return false;
    } catch (err) { 
        console.error(`Error processing ${symbol}: ${err.message}`); 
        return false; 
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runSmartScan() {
    console.log("📡 PULSE: Cycling through Asset Watchlist...");
    for (const sym of Object.keys(ASSETS)) {
        let signalFound = false;
        try {
            const feed = await parser.parseURL(ASSETS[sym].rss);
            for (const item of feed.items.slice(0, 2)) { 
                if (await processSignal(item.title, sym, marketCache[sym] || 0)) signalFound = true;
            }
        } catch (e) { }
        
        // If no news, run a technical check so the system doesn't look dead
        if (!signalFound) await processSignal("Technical Market Check", sym, marketCache[sym] || 0, true);
        
        await sleep(2000); 
    }
    console.log("✅ Cycle Complete. Sleeping 5 min.");
    
    // Schedule next run
    setTimeout(runSmartScan, 300000);
}

// ------------------------------------------
// 🕹️ MANUAL OVERRIDE (Kickstarter)
// ------------------------------------------
app.get('/api/force-scan', async (req, res) => {
    console.log("[MANUAL OVERRIDE] 🔴 Force triggering AI Scan...");
    try {
        // Run the scan immediately without waiting for timer
        runSmartScan(); 
        res.json({ message: "Manual scan triggered. Check Render logs for [NEWS] or [HEARTBEAT] entries." });
    } catch (error) {
        console.error("[MANUAL FAIL]", error);
        res.status(500).json({ error: error.message });
    }
});

// ------------------------------------------
// 📈 CHART DATA ENDPOINT
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

// Start the ticker (Price Updates)
setInterval(() => {
    Object.keys(ASSETS).forEach(sym => {
        if (!marketCache[sym]) marketCache[sym] = ASSETS[sym].defaultPrice; 
        marketCache[sym] += (Math.random() - 0.5) * (marketCache[sym] * 0.002);
        io.emit(`price_tick_${sym}`, { price: marketCache[sym] });
    });
}, 3000);

// Start the Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { 
    console.log(`GHOUL_COMMAND_CENTER: LIVE (Port ${PORT})`);
    
    // Initial Scan on Startup (Delayed by 10s to ensure DB connection)
    setTimeout(runSmartScan, 10000);
});