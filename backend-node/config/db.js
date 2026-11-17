const { Pool } = require('pg');
require('dotenv').config();

// One shared connection pool for the whole backend.
// Managed hosts (Render, Neon) use TLS with certificates Node can't verify by default;
// set DB_SSL=false for a local database without TLS.
const useSsl = process.env.DB_SSL !== 'false';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
