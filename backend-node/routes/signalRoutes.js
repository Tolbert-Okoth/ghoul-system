const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

// Create a database connection specifically for these routes
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ---------------------------------------------------------
// 1. OVERALL VERDICT (Fixes "Analyzing market data...")
// ---------------------------------------------------------
router.get('/overall-verdict', async (req, res) => {
    try {
        const { symbol } = req.query;
        // Get the very latest signal for this symbol
        const result = await pool.query(
            "SELECT * FROM trading_signals WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1",
            [symbol || 'SPY']
        );

        if (result.rows.length > 0) {
            const signal = result.rows[0];
            res.json({
                verdict: signal.verdict || "NEUTRAL",
                score: parseFloat(signal.sentiment_score || 0),
                confidence: parseFloat(signal.confidence || 0) * 100, // Frontend expects 0-100
                reason: signal.reasoning || "No clear signal detected."
            });
        } else {
            // Default if no data exists yet
            res.json({
                verdict: "NEUTRAL",
                score: 0,
                confidence: 0,
                reason: "Waiting for first AI scan..."
            });
        }
    } catch (err) {
        console.error("Verdict Route Error:", err);
        res.status(500).json({ error: "DB Error" });
    }
});

// ---------------------------------------------------------
// 2. HOT TOPICS (Fixes the Tags section)
// ---------------------------------------------------------
router.get('/hot-topics', async (req, res) => {
    // Return dummy tags for now to prevent errors
    res.json([
        { word: "INFLATION", score: 0.9 },
        { word: "FED_RATE", score: 0.8 },
        { word: "EARNINGS", score: 0.75 },
        { word: "AI_BUBBLE", score: 0.6 },
        { word: "VOLATILITY", score: 0.5 }
    ]);
});

// ---------------------------------------------------------
// 3. LATEST SIGNALS (Fixes the scrolling feed)
// ---------------------------------------------------------
router.get('/latest', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM trading_signals ORDER BY timestamp DESC LIMIT 20");
        res.json(result.rows);
    } catch (err) {
        console.error("Latest Route Error:", err);
        res.json([]);
    }
});

module.exports = router;