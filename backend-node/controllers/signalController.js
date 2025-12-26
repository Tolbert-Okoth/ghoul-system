const Signal = require('../models/signalModel');
const db = require('../config/db'); // <--- CRITICAL: Import the Database Connection

let isAiOnline = true;

// 1. PROCESS SIGNAL (Writes to DB)
exports.processSignal = async (req, res, io) => {
    if (!isAiOnline) {
        return res.status(503).json({ error: "System is Blind. Execution Paused." });
    }

    try {
        const result = await Signal.saveSignal(req.body);
        const savedSignal = result.rows[0];

        io.emit('new_signal', savedSignal);
        res.status(201).json(savedSignal);
    } catch (err) {
        console.error("Signal Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// 2. HEALTH CHECK
exports.updateHealth = (req, res, io) => {
    const { status } = req.body;
    isAiOnline = (status === 'HEALTHY');
    io.emit('system_status', { isAiOnline });
    res.json({ message: `System is now ${status}` });
};

// 3. GET VERDICT (Reads from DB) - FIXED FOR SQL
exports.getOverallVerdict = async (req, res) => {
    try {
        const { symbol } = req.query;

        // SQL Query: Get the latest signal for the requested symbol
        const result = await db.query(
            "SELECT * FROM trading_signals WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1",
            [symbol]
        );

        const latestSignal = result.rows[0];

        // === 🛡️ SAFETY AIRBAG ===
        // If no data exists, return NEUTRAL instead of crashing
        if (!latestSignal) {
            return res.json({
                symbol: symbol,
                verdict: 'NEUTRAL',
                score: 0,
                confidence: 0,
                explanation: "Initializing... Waiting for market data."
            });
        }
        // =======================

        res.json({
            symbol: symbol,
            verdict: latestSignal.verdict,
            score: latestSignal.sentiment_score || 0, // Note: Postgres uses snake_case
            confidence: latestSignal.confidence || 0,
            explanation: latestSignal.explanation
        });

    } catch (error) {
        console.error("[VERDICT ERROR]", error);
        // Fallback response so the Frontend never breaks
        res.json({ 
            symbol: req.query.symbol, 
            verdict: 'NEUTRAL', 
            explanation: "Temporary system error." 
        });
    }
};