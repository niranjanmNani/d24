require('./utils/keepalive');
require('dotenv').config();
var express = require('express');
var cors = require('cors');
var helmet = require('helmet');
var morgan = require('morgan');
var compression = require('compression');
var rateLimit = require('express-rate-limit');

var app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false }));
app.use('/api/', rateLimit({ windowMs: 60*1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.get('/health', function(req, res) {
  var db = require('./core/db/client');
  db.query('SELECT 1').then(function() {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  }).catch(function(e) {
    res.status(503).json({ status: 'error', error: e.message });
  });
});

app.use('/api/auth',                         require('./modules/auth/auth.router'));
app.use('/api/shops',                        require('./modules/shops/shops.router'));
app.use('/api/shops/:shopId/products',       require('./modules/products/products.router'));
app.use('/api/orders',                       require('./modules/orders/orders.router'));
app.use('/api/wallet',                       require('./modules/wallet/wallet.router'));
app.use('/api/delivery',                     require('./modules/delivery/delivery.router'));
app.use('/api/addresses',                    require('./modules/delivery/addresses.router'));
app.use('/api/admin',                        require('./modules/admin/admin.router'));

app.use(function(req, res) { res.status(404).json({ error: 'Route not found' }); });
app.use(function(err, req, res, next) { console.error(err); res.status(500).json({ error: err.message }); });

var PORT = process.env.PORT || 4000;
app.listen(PORT, function() { console.log('Delivery24 API running on port ' + PORT); });
module.exports = app;
