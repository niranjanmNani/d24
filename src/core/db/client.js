const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.SUPABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected DB client error', err);
});

const db = {
  query: async (text, params) => {
    const start = Date.now();
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DB] ${Date.now() - start}ms — ${text.slice(0, 80)}`);
    }
    return res;
  },
  one: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows[0] || null;
  },
  many: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows;
  },
  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  pool
};

module.exports = db;