const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.on('connect', () => {
    console.log('--- [GHOUL_DB] Connected to the Void ---');
});

module.exports = pool;