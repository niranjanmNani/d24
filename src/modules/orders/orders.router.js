var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var ordersService = require('./orders.service');
var db = require('../../core/db/client');
var sse = require('../../core/events');

router.post('/', auth.authenticate, auth.requireRole('customer'), function(req, res) {
  var d = req.body;
  if (!d.shop_id || !d.items || !d.items.length) return err(res, 'shop_id and items required');
  ordersService.place(req.user.id, d.shop_id, d)
    .then(function(order) {
      // Notify merchant shop instantly — new order arrived
      sse.broadcast('shops', order.shop_id, 'new_order', { order: order });
      ok(res, order, 201);
    }).catch(function(e) { err(res, e.message, 400); });
});

router.get('/my', auth.authenticate, function(req, res) {
  ordersService.listForCustomer(req.user.id, req.query)
    .then(function(o) { ok(res, o); }).catch(function(e) { err(res, e.message); });
});

router.get('/shop/:shopId', auth.authenticate, function(req, res) {
  ordersService.listForShop(req.params.shopId, req.query)
    .then(function(o) { ok(res, o); }).catch(function(e) { err(res, e.message); });
});

router.get('/:id', auth.authenticate, function(req, res) {
  ordersService.getOrder(req.params.id)
    .then(function(o) { if (!o) return err(res, 'Not found', 404); ok(res, o); })
    .catch(function(e) { err(res, e.message); });
});

router.patch('/:id/status', auth.authenticate, function(req, res) {
  ordersService.advance(req.params.id, req.body.status, { otp: req.body.otp, agentId: req.body.agent_id })
    .then(function(order) {
      // Notify customer and shop instantly — status changed
      sse.broadcast('orders', order.id, 'status_changed', { status: order.status, order: order });
      sse.broadcast('shops', order.shop_id, 'order_updated', { order: order });
      if (order.agent_id) sse.broadcast('users', order.agent_id, 'order_updated', { order: order });
      ok(res, order);
    }).catch(function(e) { err(res, e.message, 400); });
});

router.patch('/:id/mark-paid', auth.authenticate, function(req, res) {
  var method = req.body.method || 'cod';
  ordersService.markPaid(req.params.id, method)
    .then(function(order) {
      // Notify customer — payment confirmed
      sse.broadcast('orders', order.id, 'payment_confirmed', { payment_status: 'paid', order: order });
      sse.broadcast('users', order.customer_id, 'wallet_update', { type: 'scratch_card_issued' });
      ok(res, order);
    }).catch(function(e) { err(res, e.message, 400); });
});

router.post('/:id/cancel', auth.authenticate, function(req, res) {
  ordersService.getOrder(req.params.id).then(function(o) {
    return ordersService.cancel(req.params.id).then(function(r) {
      // Notify both merchant and customer
      sse.broadcast('orders', req.params.id, 'cancelled', { order_id: req.params.id });
      sse.broadcast('shops', o.shop_id, 'order_cancelled', { order_id: req.params.id });
      sse.broadcast('users', o.customer_id, 'wallet_update', { type: 'refund' });
      ok(res, r);
    });
  }).catch(function(e) { err(res, e.message, 400); });
});

router.post('/:id/refund', auth.authenticate, function(req, res) {
  var d = req.body;
  if (!d.amount || !d.reason) return err(res, 'amount and reason required');
  ordersService.getOrder(req.params.id).then(function(o) {
    return ordersService.issueRefund(req.params.id, req.user.id, d).then(function(r) {
      // Notify customer — refund issued
      sse.broadcast('orders', req.params.id, 'refund_issued', { amount: d.amount, reason: d.reason });
      sse.broadcast('users', o.customer_id, 'wallet_update', { type: 'refund', amount: d.amount });
      ok(res, r);
    });
  }).catch(function(e) { err(res, e.message, 400); });
});

module.exports = router;
