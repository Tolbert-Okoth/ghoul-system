const express = require('express');
const pool = require('../config/db');

const STOPWORDS = new Set(('a an and are as at be by for from has have in into is it its of on or that the to was were will with ' +
    'after amid over says said new stock stocks shares market markets technical check what why how this than more up down').split(' '));

module.exports = function createSignalRoutes(validSymbols) {
    const router = express.Router();
    const isValidSymbol = (s) => validSymbols.includes(s);

    // Latest verdict for one symbol
    router.get('/overall-verdict', async (req, res) => {
        const symbol = String(req.query.symbol || 'SPY').toUpperCase();
        if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'Unknown symbol' });
        try {
            const result = await pool.query(
                'SELECT * FROM trading_signals WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1',
                [symbol]
            );
            if (result.rows.length === 0) {
                return res.json({ verdict: 'NEUTRAL', score: 0, confidence: 0, reason: 'Waiting for first AI scan...' });
            }
            const signal = result.rows[0];
            res.json({
                verdict: signal.verdict || 'NEUTRAL',
                score: parseFloat(signal.sentiment_score || 0),
                confidence: parseFloat(signal.confidence || 0) * 100, // frontend expects 0-100
                reason: signal.reasoning || 'No clear signal detected.',
            });
        } catch (err) {
            console.error('Verdict route error:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    });

    // Most frequent words in the last 24 hours of news headlines (replaces a hard-coded list)
    router.get('/hot-topics', async (req, res) => {
        try {
            const result = await pool.query(
                "SELECT headline FROM trading_signals WHERE timestamp > NOW() - INTERVAL '24 hours' AND headline <> 'Technical Market Check' LIMIT 200"
            );
            const counts = new Map();
            for (const { headline } of result.rows) {
                for (const raw of String(headline).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
                    const w = raw.replace(/'s$/, '');
                    if (!STOPWORDS.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
                }
            }
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            const max = top.length ? top[0][1] : 1;
            res.json(top.map(([word, n]) => ({ word: word.toUpperCase(), score: Number((n / max).toFixed(2)) })));
        } catch (err) {
            console.error('Hot topics error:', err.message);
            res.json([]);
        }
    });

    // Latest signals for the feed
    router.get('/latest', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM trading_signals ORDER BY timestamp DESC LIMIT 20');
            res.json(result.rows);
        } catch (err) {
            console.error('Latest route error:', err.message);
            res.json([]);
        }
    });

    return router;
};
