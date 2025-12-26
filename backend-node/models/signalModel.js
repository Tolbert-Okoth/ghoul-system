const pool = require('../config/db');

const createSignalTable = async () => {
    const queryText = `
        CREATE TABLE IF NOT EXISTS ghoul_signals (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ DEFAULT NOW(),
            headline TEXT NOT NULL,
            sentiment FLOAT NOT NULL,
            confidence FLOAT,
            reasoning TEXT,
            status TEXT DEFAULT 'ACTIVE'
        );
    `;
    await pool.query(queryText);
};

// Initialize table on startup
createSignalTable();

module.exports = {
    saveSignal: (data) => {
        return pool.query(
            'INSERT INTO ghoul_signals (headline, sentiment, confidence, reasoning) VALUES ($1, $2, $3, $4) RETURNING *',
            [data.headline, data.sentiment, data.confidence, data.reasoning]
        );
    }
};