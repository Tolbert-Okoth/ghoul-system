require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

// --- SECURITY PACKAGES ---
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// --- YAHOO FINANCE SETUP (COMPATIBILITY MODE) ---
const yfModule = require('yahoo-finance2');
const YahooFinanceClass = yfModule.YahooFinance || yfModule.default?.YahooFinance || yfModule.default;
let yahooFinance;
try { yahooFinance = new YahooFinanceClass(); } 
catch (e) { yahooFinance = yfModule.default || yfModule; }
if (yahooFinance.suppressNotices) yahooFinance.suppressNotices(['yahooSurvey', 'cookie']);
// ----------------------------

const axios = require('axios'); 
const Parser = require('rss-parser'); 

const app = express();

const server = http.createServer(app);

// ------------------------------------------
// 🛡️ IRON DOME SECURITY PROTOCOLS
// ------------------------------------------
app.use(helmet());

app.set('trust proxy', 1);



// ALLOWED ORIGINS: Add your future Vercel URL here once you have it
const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        // In production, you might want to relax this slightly for Vercel, 
        // or ensure you add your Vercel domain to allowedOrigins later.
        if (allowedOrigins.indexOf(origin) === -1 && process.env.NODE_ENV !== 'production') {
             // Optional: Log blocked origins for debugging
             // console.log('Blocked Origin:', origin);
        }
        return callback(null, true); // Temporarily allow all for deployment ease, or keep strict
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
// ------------------------------------------

app.use(express.json());

// ------------------------------------------
// 💓 THE HEARTBEAT HACK (UPTIMEROBOT TARGET)
// ------------------------------------------
app.get('/health', (req, res) => {
    res.status(200).send('ALIVE');
});
// ------------------------------------------

// Robust RSS Parser
const parser = new Parser({
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
    timeout: 10000 
});

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } // Relaxed for Cloud WebSocket
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

async function processSignal(headline, symbol, currentPrice, isTechnicalCheck = false) {
    try {
        if (!isTechnicalCheck) {
            const existing = await pool.query("SELECT id FROM trading_signals WHERE headline = $1", [headline]);
            if (existing.rows.length > 0) return false; 
        }
        const logPrefix = isTechnicalCheck ? "[❤️ HEARTBEAT]" : "[📰 NEWS]";
        console.log(`${logPrefix} ${symbol}: Analyzing...`);
        
        // --- CLOUD LINK: Connect to Python Service ---
        const brainURL = process.env.BRAIN_URL || 'http://127.0.0.1:5000/analyze';
        
        const brainResponse = await axios.post(brainURL, { 
            headline: headline, symbol: symbol, mode: isTechnicalCheck ? 'technical_only' : 'standard' 
        });
        const aiData = brainResponse.data;
        
        let finalStatus = aiData.action === 'IGNORE' || aiData.confidence < 0.30 ? 'NOISE' : (aiData.confidence < 0.60 ? 'PASSIVE' : 'ACTIVE');
        if (finalStatus !== 'NOISE' || isTechnicalCheck) {
            const result = await pool.query(
                'INSERT INTO trading_signals (headline, sentiment, confidence, reasoning, entry_price, status, symbol) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', 
                [headline, aiData.sentiment_score / 10, aiData.confidence, `[RISK: ${aiData.risk_level}] ${aiData.reasoning}`, currentPrice, finalStatus, symbol]
            ); 
            io.emit('new_signal', result.rows[0]); 
            return true;
        }
        return false;
    } catch (err) { console.error(`Error processing ${symbol}: ${err.message}`); return false; }
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
        if (!signalFound) await processSignal("Technical Market Check", sym, marketCache[sym] || 0, true);
        await sleep(2000); 
    }
    console.log("✅ Cycle Complete. Sleeping 5 min.");
    setTimeout(runSmartScan, 300000);
}

// --- API ENDPOINTS ---
app.get('/api/v1/intel/overall-verdict', async (req, res) => {
    const symbol = req.query.symbol || 'SPY';
    try {
        const stats = await pool.query("SELECT sentiment FROM trading_signals WHERE symbol = $1 ORDER BY created_at DESC LIMIT 50", [symbol]);
        const reasonRow = await pool.query("SELECT reasoning FROM trading_signals WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1", [symbol]);
        if (stats.rows.length === 0) return res.json({ verdict: "NO DATA", score: 0, reason: "Initializing coverage..." });
        
        let total = 0; stats.rows.forEach(r => total += parseFloat(r.sentiment));
        const avg = (total / stats.rows.length) * 10; 
        
        let verdict = "NEUTRAL";
        if (avg >= 6) verdict = "STRONGLY BULLISH"; else if (avg >= 3) verdict = "BULLISH"; else if (avg >= 1) verdict = "WEAKLY BULLISH";
        else if (avg <= -6) verdict = "STRONGLY BEARISH"; else if (avg <= -3) verdict = "BEARISH"; else if (avg <= -1) verdict = "WEAKLY BEARISH";
        
        res.json({ verdict, score: avg, confidence: 85, reason: reasonRow.rows.length > 0 ? reasonRow.rows[0].reasoning.replace(/\[RISK:.*?\]\s*/, '') : "Analyzing..." });
    } catch (e) { res.status(500).json({ error: "Verdict failed" }); }
});

// 2. CHART HISTORY
app.get('/api/v1/history', async (req, res) => {
    const symbol = req.query.symbol || 'SPY';
    const range = req.query.range || '1y'; 
    const ticker = ASSETS[symbol] ? ASSETS[symbol].yahooTicker : 'ES=F';
    
    const cacheKey = `${symbol}_${range}`;
    if (chartCache[cacheKey] && chartCache[cacheKey].expiry > Date.now()) return res.json(chartCache[cacheKey].data);

    let interval = '1d';
    const period1 = new Date(); // Start
    const period2 = new Date(); // End

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

setInterval(() => {
    Object.keys(ASSETS).forEach(sym => {
        if (!marketCache[sym]) marketCache[sym] = ASSETS[sym].defaultPrice; 
        marketCache[sym] += (Math.random() - 0.5) * (marketCache[sym] * 0.002);
        io.emit(`price_tick_${sym}`, { price: marketCache[sym] });
    });
}, 3000);

app.get('/api/v1/signals/latest', async (req, res) => { try { const { rows } = await pool.query("SELECT * FROM trading_signals ORDER BY created_at DESC LIMIT 50"); res.json(rows); } catch (e) { res.json([]); } });
app.get('/api/v1/intel/hot-topics', async (req, res) => { try { const blacklist = ['market', 'price', 'likely', 'expected', 'trading', 'should', 'could', 'because', 'target', 'levels', 'investors', 'stocks', 'risk:', 'medium]', 'high]', 'low]', 'ignore', 'impact', 'direct', 'risk', 'sector', 'stock', 'action:', 'analysis:', 'reasoning:']; const blacklistString = blacklist.map(w => `'${w}'`).join(','); const query = `SELECT word, count(*) FROM (SELECT regexp_split_to_table(lower(reasoning), '\\s+') as word FROM trading_signals WHERE created_at > NOW() - INTERVAL '24 hours') AS words WHERE length(word) > 4 AND word NOT IN (${blacklistString}) AND word NOT LIKE '[%' AND word NOT LIKE '%]' GROUP BY word ORDER BY count DESC LIMIT 10;`; const { rows } = await pool.query(query); res.json(rows); } catch (e) { res.json([]); } });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`GHOUL_COMMAND_CENTER: LIVE (Port ${PORT})`); });