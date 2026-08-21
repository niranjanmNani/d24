var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var sse = require('../../core/events');

router.get('/order/:orderId', auth.authenticate, function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write('event: connected\ndata: {"orderId":"' + req.params.orderId + '"}\n\n');
  sse.addClient('orders', req.params.orderId, res);
  req.on('close', function() { sse.removeClient('orders', req.params.orderId, res); });
});

router.get('/shop/:shopId', auth.authenticate, function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write('event: connected\ndata: {"shopId":"' + req.params.shopId + '"}\n\n');
  sse.addClient('shops', req.params.shopId, res);
  req.on('close', function() { sse.removeClient('shops', req.params.shopId, res); });
});

router.get('/user/:userId', auth.authenticate, function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write('event: connected\ndata: {"userId":"' + req.params.userId + '"}\n\n');
  sse.addClient('users', req.params.userId, res);
  req.on('close', function() { sse.removeClient('users', req.params.userId, res); });
});

module.exports = router;
