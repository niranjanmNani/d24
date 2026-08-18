const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', function(err) { console.error('DB pool error', err); });

const db = {
  query: function(text, params) { return pool.query(text, params); },
  one: function(text, params) {
    return pool.query(text, params).then(function(r) { return r.rows[0] || null; });
  },
  many: function(text, params) {
    return pool.query(text, params).then(function(r) { return r.rows; });
  },
  transaction: function(fn) {
    return pool.connect().then(function(client) {
      return client.query('BEGIN')
        .then(function() { return fn(client); })
        .then(function(result) { return client.query('COMMIT').then(function() { return result; }); })
        .catch(function(err) { return client.query('ROLLBACK').then(function() { throw err; }); })
        .finally(function() { client.release(); });
    });
  },
  pool: pool
};
module.exports = db;
