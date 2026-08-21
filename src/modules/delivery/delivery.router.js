var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var db = require('../../core/db/client');
var refundUtil = require('../../utils/refund');
var sse = require('../../core/events');

router.post('/returns', auth.authenticate, function(req,res) {
  var d = req.body;
  db.one('SELECT * FROM orders WHERE id=$1 AND customer_id=$2', [d.order_id, req.user.id])
    .then(function(order) {
      if (!order) throw new Error('Order not found');
      if (order.status !== 'delivered') throw new Error('Can only return delivered orders');
      return db.one('INSERT INTO returns(order_id,customer_id,items,reason) VALUES($1,$2,$3,$4) RETURNING *',
        [d.order_id, req.user.id, JSON.stringify(d.items||[]), d.reason]);
    })
    .then(function(r) { return db.query('UPDATE orders SET return_status=\'requested\' WHERE id=$1', [r.order_id]).then(function(){ return r; }); })
    .then(function(r){ ok(res,r,201); }).catch(function(e){ err(res,e.message,400); });
});

router.get('/returns', auth.authenticate, function(req,res) {
  db.many('SELECT r.*, o.total, o.wallet_used, o.payment_method, o.refunded_amount, u.name as customer_name, u.phone as customer_phone FROM returns r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.customer_id WHERE o.shop_id=$1 ORDER BY r.created_at DESC', [req.query.shop_id])
    .then(function(r){ ok(res,r); }).catch(function(e){ err(res,e.message); });
});

router.patch('/returns/:id/approve', auth.authenticate, function(req,res) {
  db.one('UPDATE returns SET status=\'approved\' WHERE id=$1 RETURNING *', [req.params.id])
    .then(function(r) { return db.query('UPDATE orders SET return_status=\'approved\' WHERE id=$1', [r.order_id]).then(function(){ return r; }); })
    .then(function(r){ ok(res,r); }).catch(function(e){ err(res,e.message); });
});

router.patch('/returns/:id/pickup', auth.authenticate, function(req,res) {
  var ret;
  db.one('UPDATE returns SET status=\'picked\',pickup_note=$1 WHERE id=$2 RETURNING *', [req.body.note||'', req.params.id])
    .then(function(r) {
      ret = r;
      return db.one('SELECT * FROM orders WHERE id=$1', [r.order_id]);
    })
    .then(function(order) {
      return db.query('UPDATE orders SET return_status=\'picked\' WHERE id=$1', [order.id]).then(function() {
        if (order.payment_status !== 'paid') return 0;
        var already = Number(order.refunded_amount || 0);
        var toRefund = Number(order.total) - already;
        var split = refundUtil.refundSplit(order, toRefund);
        if (split.walletRefund <= 0) return 0;
        return db.query('UPDATE wallets SET balance=balance+$1 WHERE user_id=$2', [split.walletRefund, order.customer_id])
          .then(function() { return db.query('INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,$3,$4,$5)', [order.customer_id, split.walletRefund, 'refund', 'Return picked up - wallet refund', order.id]); })
          .then(function() { return db.query('UPDATE orders SET refunded_amount=refunded_amount+$1 WHERE id=$2', [split.walletRefund, order.id]); })
          .then(function() { return split.walletRefund; });
      });
    })
    .then(function(credited){ ok(res, { return: ret, wallet_credited: credited }); })
    .catch(function(e){ err(res,e.message); });
});

router.patch('/returns/:id/complete', auth.authenticate, function(req,res) {
  var ret;
  db.one('UPDATE returns SET status=\'completed\' WHERE id=$1 RETURNING *', [req.params.id])
    .then(function(r) {
      ret = r;
      return db.one('SELECT * FROM orders WHERE id=$1', [r.order_id]);
    })
    .then(function(order) {
      var toRefund = Number(order.total) - Number(order.refunded_amount||0);
      var schedDate = refundUtil.t7date();
      var p = toRefund > 0
        ? db.query('INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status,scheduled_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [order.id, order.customer_id, toRefund, 'full', 'Return completed', 'source', 'pending', schedDate])
        : Promise.resolve();
      return p.then(function() {
        return db.query('UPDATE orders SET return_status=\'completed\',refunded_amount=total,refund_status=\'full\' WHERE id=$1', [order.id]);
      }).then(function() {
        return db.query('UPDATE scratch_cards SET voided=true WHERE order_id=$1 AND collected=false', [order.id]);
      }).then(function() { return { toRefund: toRefund, schedDate: schedDate }; });
    })
    .then(function(r){ ok(res, { return: ret, source_refund_due: r.toRefund, due_by: r.schedDate }); })
    .catch(function(e){ err(res,e.message); });
});

router.patch('/returns/:id/reject', auth.authenticate, function(req,res) {
  db.one('UPDATE returns SET status=\'rejected\',pickup_note=$1 WHERE id=$2 RETURNING *', [req.body.reason||'', req.params.id])
    .then(function(r) { return db.query('UPDATE orders SET return_status=\'rejected\' WHERE id=$1', [r.order_id]).then(function(){ return r; }); })
    .then(function(r){ ok(res,r); }).catch(function(e){ err(res,e.message); });
});

router.patch('/agent/location', auth.authenticate, function(req,res) {
  db.query('UPDATE shop_agents SET current_lat=$1,current_lng=$2,location_at=now(),is_on_duty=true WHERE shop_id=$3 AND user_id=$4',
    [req.body.lat, req.body.lng, req.body.shop_id, req.user.id])
    .then(function(){ ok(res,{updated:true}); }).catch(function(e){ err(res,e.message); });
});

module.exports = router;
