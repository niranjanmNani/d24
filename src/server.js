require('./utils/keepalive');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();

// ── Security & middleware ─────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PATCH','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
app.use('/api/auth/otp', rateLimit({ windowMs: 15*60*1000, max: 10, message: 'Too many OTP requests' }));
app.use('/api/', rateLimit({ windowMs: 60*1000, max: 200 }));

// ── Health check ──────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const db = require('./core/db/client');
    await db.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',       require('./modules/auth/auth.router'));
app.use('/api/shops',      require('./modules/shops/shops.router'));
app.use('/api/shops/:shopId/products', (req, res, next) => { req.params.shopId = req.params.shopId; next(); }, require('./modules/products/products.router'));
app.use('/api/orders',     require('./modules/orders/orders.router'));
app.use('/api/wallet',     require('./modules/wallet/wallet.router'));
app.use('/api/delivery',   require('./modules/delivery/delivery.router'));
app.use('/api/addresses',  require('./modules/delivery/addresses.router'));
app.use('/api/admin',      require('./modules/admin/admin.router'));

// ── 404 & error handler ───────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Delivery24 API running on port ${PORT}`));

module.exports = app;
