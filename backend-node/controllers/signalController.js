const Signal = require('../models/signalModel');
const db = require('../config/db'); 

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

// 3. GET VERDICT (The Bulletproof Version)
exports.getOverallVerdict = async (req, res) => {
    try {
        const { symbol } = req.query;
        console.log(`[VERDICT] Requested for: ${symbol}`);

        // Try to query the database
        let latestSignal = null;
        try {
            const result = await db.query(
                "SELECT * FROM trading_signals WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1",
                [symbol]
            );
            if (result.rows.length > 0) {
                latestSignal = result.rows[0];
            }
        } catch (dbError) {
            console.error("[DB ERROR] Database query failed:", dbError.message);
            // We swallow the DB error here so the frontend doesn't crash
        }

        // === 🛡️ FALLBACK MODE ===
        // If DB failed OR returned no data, send valid "Neutral" data
        if (!latestSignal) {
            console.log(`[VERDICT] Using fallback data for ${symbol}`);
            return res.json({
                symbol: symbol || "UNKNOWN",
                verdict: 'NEUTRAL',
                score: 0,
                confidence: 0,
                explanation: "System initializing. Waiting for live data stream..."
            });
        }
        // =======================

        // If we have real data, send it
        res.json({
            symbol: symbol,
            verdict: latestSignal.verdict,
            score: latestSignal.sentiment_score || 0, 
            confidence: latestSignal.confidence || 0,
            explanation: latestSignal.explanation
        });

    } catch (criticalError) {
        console.error("[CRITICAL VERDICT ERROR]", criticalError);
        // Absolute last resort response
        res.status(200).json({ 
            symbol: req.query.symbol || "ERROR", 
            verdict: 'NEUTRAL', 
            explanation: "Temporary connection error." 
        });
    }
};