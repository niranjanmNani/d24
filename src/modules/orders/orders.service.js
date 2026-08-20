var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var ordersService = require('./orders.service');
var db = require('../../core/db/client');

router.post('/', auth.authenticate, auth.requireRole('customer'), function(req,res) {
  var d = req.body;
  if (!d.shop_id || !d.items || !d.items.length) return err(res,'shop_id and items required');
  ordersService.place(req.user.id, d.shop_id, d)
    .then(function(o){ ok(res,o,201); }).catch(function(e){ err(res,e.message,400); });
});

router.get('/my', auth.authenticate, function(req,res) {
  ordersService.listForCustomer(req.user.id, req.query)
    .then(function(o){ ok(res,o); }).catch(function(e){ err(res,e.message); });
});

router.get('/shop/:shopId', auth.authenticate, function(req,res) {
  ordersService.listForShop(req.params.shopId, req.query)
    .then(function(o){ ok(res,o); }).catch(function(e){ err(res,e.message); });
});

router.get('/:id', auth.authenticate, function(req,res) {
  ordersService.getOrder(req.params.id)
    .then(function(o){ if(!o) return err(res,'Not found',404); ok(res,o); })
    .catch(function(e){ err(res,e.message); });
});

router.patch('/:id/status', auth.authenticate, function(req,res) {
  ordersService.advance(req.params.id, req.body.status, { otp: req.body.otp, agentId: req.body.agent_id })
    .then(function(o){ ok(res,o); }).catch(function(e){ err(res,e.message,400); });
});

// PATCH /api/orders/:id/mark-paid — merchant marks COD order as collected
router.patch('/:id/mark-paid', auth.authenticate, function(req,res) {
  var method = req.body.method || 'cod';
  db.one('SELECT * FROM orders WHERE id=$1', [req.params.id])
    .then(function(order) {
      if (!order) throw new Error('Order not found');
      if (order.status === 'cancelled') throw new Error('Cannot mark a cancelled order as paid');
      if (order.payment_status === 'paid') throw new Error('Order is already marked as paid');
      // Update payment status and issue scratch card if not already issued
      return db.query(
        'UPDATE orders SET payment_status=$1, payment_method=$2 WHERE id=$3',
        ['paid', method, order.id]
      ).then(function() {
        // Issue scratch card on payment if not already issued
        return db.one('SELECT id FROM scratch_cards WHERE order_id=$1', [order.id])
          .then(function(existing) {
            if (existing) return null;
            // Get shop cashback config
            return db.one('SELECT * FROM shops WHERE id=$1', [order.shop_id])
              .then(function(shop) {
                if (!shop || shop.cashback_value <= 0) return null;
                var cashback = shop.cashback_type === 'percent'
                  ? Math.min(Number(order.subtotal) * shop.cashback_value / 100, shop.cashback_max)
                  : Math.min(shop.cashback_value, shop.cashback_max);
                cashback = Math.round(cashback * 100) / 100;
                if (cashback <= 0) return null;
                return db.query(
                  'INSERT INTO scratch_cards(user_id,shop_id,order_id,amount) VALUES($1,$2,$3,$4)',
                  [order.customer_id, order.shop_id, order.id, cashback]
                );
              });
          });
      }).then(function() {
        return db.one('SELECT * FROM orders WHERE id=$1', [order.id]);
      });
    })
    .then(function(o){ ok(res, o); })
    .catch(function(e){ err(res, e.message, 400); });
});

router.post('/:id/cancel', auth.authenticate, function(req,res) {
  ordersService.cancel(req.params.id)
    .then(function(r){ ok(res,r); }).catch(function(e){ err(res,e.message,400); });
});

router.post('/:id/refund', auth.authenticate, function(req,res) {
  var d = req.body;
  if (!d.amount || !d.reason) return err(res, 'amount and reason required');
  ordersService.issueRefund(req.params.id, req.user.id, d)
    .then(function(r){ ok(res,r); }).catch(function(e){ err(res,e.message,400); });
});

module.exports = router;
