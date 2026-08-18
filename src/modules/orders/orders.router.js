var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var ordersService = require('./orders.service');

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
router.post('/:id/cancel', auth.authenticate, function(req,res) {
  ordersService.cancel(req.params.id)
    .then(function(r){ ok(res,r); }).catch(function(e){ err(res,e.message,400); });
});
module.exports = router;
