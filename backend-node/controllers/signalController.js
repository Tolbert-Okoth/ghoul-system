const Signal = require('../models/signalModel');
const db = require('../config/db'); // Import DB to read data directly

let isAiOnline = true; // Local state for the Kill Switch

// 1. RECEIVE DATA (From Python)
exports.processSignal = async (req, res, io) => {
    if (!isAiOnline) {
        return res.status(503).json({ error: "System is Blind. Execution Paused." });
    }

    try {
        const result = await Signal.saveSignal(req.body);
        const savedSignal = result.rows[0];

        // Broadcast to the Frontend
        io.emit('new_signal', savedSignal);

        res.status(201).json(savedSignal);
    } catch (err) {
        console.error("Signal Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// 2. HEALTH CHECK (Keep Alive)
exports.updateHealth = (req, res, io) => {
    const { status } = req.body;
    isAiOnline = (status === 'HEALTHY');
    io.emit('system_status', { isAiOnline });
    res.json({ message: `System is now ${status}` });
};

// 3. GET VERDICT (The Missing Function causing the 500 Error)
exports.getOverallVerdict = async (req, res) => {
    try {
        const { symbol } = req.query;

        // Query the database for the latest signal for this stock
        // Note: We use 'trading_signals' because that's the table we made earlier
        const result = await db.query(
            `SELECT * FROM trading_signals WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1`,
            [symbol]
        );

        const latestSignal = result.rows[0];

        // === 🛡️ SAFETY AIRBAG: START ===
        // If DB is empty, return "NEUTRAL" instead of crashing
        if (!latestSignal) {
            console.log(`[VERDICT] No data found for ${symbol}. Returning Neutral.`);
            return res.status(200).json({
                symbol: symbol,
                verdict: 'NEUTRAL',
                score: 0,
                confidence: 0,
                explanation: "System initializing. Waiting for first data stream..."
            });
        }
        // === 🛡️ SAFETY AIRBAG: END ===

        // Return the real data
        res.json({
            symbol: symbol,
            verdict: latestSignal.verdict,
            score: latestSignal.sentiment_score || 0, // Note snake_case for Postgres
            confidence: latestSignal.confidence || 0,
            explanation: latestSignal.explanation
        });

    } catch (error) {
        console.error("[VERDICT ERROR]", error);
        res.status(200).json({ 
            symbol: req.query.symbol, 
            verdict: 'NEUTRAL', 
            explanation: "Temporary system error." 
        });
    }
};