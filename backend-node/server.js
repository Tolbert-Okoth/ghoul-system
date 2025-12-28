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
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } 
});

const io = new Server(server, { 
    cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] }
});

const parser = new Parser({
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36' },
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

// 🧠 SERVER MEMORY (CACHE)
let marketCache = {}; 
// 👇 NEW: Stores chart data to prevent banning
let historyCache = {}; 

// ------------------------------------------
// 🔌 WEBSOCKET CONNECTION
// ------------------------------------------
io.on('connection', async (socket) => {
    console.log('New client connected:', socket.id);

    try {
        console.log("🔍 Fetching history directly from DB...");
        const result = await pool.query("SELECT * FROM trading_signals ORDER BY timestamp DESC LIMIT 50");
        socket.emit('history_dump', { signals: result.rows });
    } catch (err) {
        console.error("❌ History Fetch Failed:", err.message);
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
        
        const brainResponse = await axios.post(brainURL, { 
            headline: headline, symbol: symbol, mode: isTechnicalCheck ? 'technical_only' : 'standard' 
        });
        
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

// === 🧠 DUAL-CORE SCANNER: NEWS + TECHNICALS ===
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
// 📈 CHART DATA (WITH SAFETY CACHE)
// ------------------------------------------
app.get('/api/v1/history', async (req, res) => {
    const symbol = req.query.symbol || 'SPY';
    const range = req.query.range || '1y'; 
    const ticker = ASSETS[symbol] ? ASSETS[symbol].yahooTicker : 'SPY';
    
    // 1. CHECK CACHE FIRST (The Safety Shield)
    const cacheKey = `${symbol}_${range}`;
    const now = Date.now();
    
    // If we have data less than 15 minutes old, return it instantly
    if (historyCache[cacheKey] && (now - historyCache[cacheKey].timestamp < 15 * 60 * 1000)) {
        console.log(`⚡ Serving Cached Data for ${symbol} (${range})`);
        return res.json(historyCache[cacheKey].data);
    }

    try {
        const endDate = new Date();
        const startDate = new Date();
        let interval = '1d';

        switch(range) {
            case '1d': startDate.setDate(endDate.getDate() - 2); interval = '15m'; break;
            case '1mo': startDate.setMonth(endDate.getMonth() - 1); interval = '1d'; break;
            case '3mo': startDate.setMonth(endDate.getMonth() - 3); interval = '1d'; break;
            case '1y': startDate.setFullYear(endDate.getFullYear() - 1); interval = '1wk'; break;
            case 'ytd': startDate.setMonth(0); startDate.setDate(1); interval = '1d'; break;
            default: startDate.setFullYear(endDate.getFullYear() - 1);
        }

        console.log(`📊 Fetching FRESH Yahoo data for ${ticker} (${range})...`);
        const queryOptions = { period1: startDate, period2: endDate, interval: interval };
        const result = await yahooFinance.historical(ticker, queryOptions);

        if (!result || result.length === 0) throw new Error("No data returned");

        const formattedData = result.map(quote => ({
            time: new Date(quote.date).getTime() / 1000,
            value: quote.close
        })).filter(p => p.value !== null); 

        // 2. SAVE TO CACHE
        historyCache[cacheKey] = {
            timestamp: now,
            data: formattedData
        };

        if (formattedData.length > 0) {
            marketCache[symbol] = formattedData[formattedData.length - 1].value;
        }

        res.json(formattedData);

    } catch (err) {
        console.error(`❌ Yahoo Data Error for ${symbol}:`, err.message);
        console.log("⚠️ Fallback to Simulation...");
        res.json(generateSimulationData(symbol, range));
    }
});

function generateSimulationData(symbol, range) {
    const data = [];
    let price = marketCache[symbol] || ASSETS[symbol].defaultPrice;
    let date = new Date();
    let points = range === '1d' ? 50 : 100;
    
    for(let i = 0; i < points; i++) {
        data.push({ time: Math.floor(date.getTime()/1000), value: parseFloat(price.toFixed(2)), isSimulated: true });
        price -= (Math.random() - 0.5) * 2;
        date.setMinutes(date.getMinutes() - 60);
    }
    return data.reverse();
}

// ------------------------------------------
// 🔌 STARTUP SEQUENCE
// ------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => { 
    console.log(`GHOUL_COMMAND_CENTER: LIVE (Port ${PORT})`);
    
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS trading_signals (id SERIAL PRIMARY KEY, symbol VARCHAR(10), headline TEXT, sentiment_score DECIMAL, confidence DECIMAL, verdict VARCHAR(20), status VARCHAR(20), reasoning TEXT, entry_price DECIMAL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        console.log("✅ DATABASE: Ready.");
    } catch (err) { console.error("DB Init Error:", err.message); }

    // Start Scan
    setTimeout(runSmartScan, 5000);
});