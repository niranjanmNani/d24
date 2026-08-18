var express = require('express');
var router = express.Router();
var Joi = require('joi');
var validate = require('../../middleware/validate').validate;
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var upload = require('../../middleware/upload');
var storage = require('../../core/storage');
var shopsService = require('./shops.service');
var db = require('../../core/db/client');

// GET /api/shops — list nearby shops
router.get('/', function(req, res) {
  var q = req.query;
  shopsService.listNearby(parseFloat(q.lat), parseFloat(q.lng), parseFloat(q.radius)||10, q.category)
    .then(function(shops) { ok(res, shops); })
    .catch(function(e) { err(res, e.message); });
});

// GET /api/shops/:shopId
router.get('/:shopId', function(req, res) {
  shopsService.getById(req.params.shopId)
    .then(function(shop) { if (!shop) return err(res, 'Shop not found', 404); ok(res, shop); })
    .catch(function(e) { err(res, e.message); });
});

// POST /api/shops — any logged-in user can register a shop (they sign up as merchant)
router.post('/', auth.authenticate, validate(Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500),
  category: Joi.string().valid('grocery','pharmacy','bakery','general','restaurant').default('grocery'),
  address_line1: Joi.string().required(),
  address_line2: Joi.string(),
  city: Joi.string().required(),
  pincode: Joi.string(),
  lat: Joi.number(),
  lng: Joi.number(),
  phone: Joi.string(),
  email: Joi.string().email(),
  gstin: Joi.string(),
  gst_percent: Joi.number().min(0).max(28).default(5),
  min_order_amt: Joi.number().min(0).default(0),
  delivery_radius: Joi.number().min(1).max(50).default(5),
  delivery_tiers: Joi.array(),
  cashback_type: Joi.string().valid('percent','fixed').default('percent'),
  cashback_value: Joi.number().min(0).default(2),
  cashback_max: Joi.number().min(0).default(50)
})), function(req, res) {
  shopsService.register(req.user.id, req.body)
    .then(function(shop) { ok(res, shop, 201); })
    .catch(function(e) { err(res, e.message); });
});

// PATCH /api/shops/:shopId
router.patch('/:shopId', auth.authenticate, auth.requireShopAccess, function(req, res) {
  shopsService.update(req.params.shopId, req.body)
    .then(function(shop) { ok(res, shop); })
    .catch(function(e) { err(res, e.message); });
});

// POST /api/shops/:shopId/order-summary
router.post('/:shopId/order-summary', auth.authenticate, function(req, res) {
  var body = req.body;
  db.one('SELECT balance FROM wallets WHERE user_id=$1', [req.user.id])
    .then(function(w) {
      return shopsService.computeOrderSummary(
        req.params.shopId, body.items,
        body.delivery_lat, body.delivery_lng,
        w ? Number(w.balance) : 0
      );
    })
    .then(function(summary) { ok(res, summary); })
    .catch(function(e) { err(res, e.message, 400); });
});

// POST /api/shops/:shopId/block-customer
router.post('/:shopId/block-customer', auth.authenticate, auth.requireShopAccess, function(req, res) {
  shopsService.blockCustomer(req.params.shopId, req.body.customer_id, req.body.reason)
    .then(function(r) { ok(res, r); })
    .catch(function(e) { err(res, e.message); });
});

// DELETE /api/shops/:shopId/block-customer/:customerId
router.delete('/:shopId/block-customer/:customerId', auth.authenticate, auth.requireShopAccess, function(req, res) {
  shopsService.unblockCustomer(req.params.shopId, req.params.customerId)
    .then(function() { ok(res, { unblocked: true }); })
    .catch(function(e) { err(res, e.message); });
});

// POST /api/shops/:shopId/agents
router.post('/:shopId/agents', auth.authenticate, auth.requireShopAccess, function(req, res) {
  shopsService.addAgent(req.params.shopId, req.body.user_id)
    .then(function(a) { ok(res, a); })
    .catch(function(e) { err(res, e.message); });
});

// GET /api/shops/:shopId/agents
router.get('/:shopId/agents', auth.authenticate, auth.requireShopAccess, function(req, res) {
  shopsService.getAgents(req.params.shopId)
    .then(function(agents) { ok(res, agents); })
    .catch(function(e) { err(res, e.message); });
});

module.exports = router;
