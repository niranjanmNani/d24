const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { validate } = require('../../middleware/validate');
const { authenticate, requireRole, requireShopAccess } = require('../../middleware/auth');
const { ok, err } = require('../../utils/response');
const upload = require('../../middleware/upload');
const storage = require('../../core/storage');
const shopsService = require('./shops.service');

// GET /api/shops — list nearby shops
router.get('/', async (req, res) => {
  try {
    const { lat, lng, radius = 10, category } = req.query;
    const shops = await shopsService.listNearby(parseFloat(lat), parseFloat(lng), parseFloat(radius), category);
    ok(res, shops);
  } catch (e) { err(res, e.message); }
});

// GET /api/shops/:shopId
router.get('/:shopId', async (req, res) => {
  try {
    const shop = await shopsService.getById(req.params.shopId);
    if (!shop) return err(res, 'Shop not found', 404);
    ok(res, shop);
  } catch (e) { err(res, e.message); }
});

// POST /api/shops — merchant registers a shop
router.post('/', authenticate, requireRole('merchant'), validate(Joi.object({
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
})), async (req, res) => {
  try {
    const shop = await shopsService.register(req.user.id, req.body);
    ok(res, shop, 201);
  } catch (e) { err(res, e.message); }
});

// PATCH /api/shops/:shopId — update shop
router.patch('/:shopId', authenticate, requireShopAccess, async (req, res) => {
  try {
    const shop = await shopsService.update(req.params.shopId, req.body);
    ok(res, shop);
  } catch (e) { err(res, e.message); }
});

// POST /api/shops/:shopId/logo
router.post('/:shopId/logo', authenticate, requireShopAccess, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return err(res, 'No image uploaded');
    const url = await storage.uploadShopImage(req.file.buffer, 'logo');
    await shopsService.update(req.params.shopId, { logo_url: url });
    ok(res, { url });
  } catch (e) { err(res, e.message); }
});

// POST /api/shops/:shopId/cover
router.post('/:shopId/cover', authenticate, requireShopAccess, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return err(res, 'No image uploaded');
    const url = await storage.uploadShopImage(req.file.buffer, 'cover');
    await shopsService.update(req.params.shopId, { cover_url: url });
    ok(res, { url });
  } catch (e) { err(res, e.message); }
});

// POST /api/shops/:shopId/order-summary — preview order before placing
router.post('/:shopId/order-summary', authenticate, async (req, res) => {
  try {
    const { items, delivery_lat, delivery_lng } = req.body;
    const wallet = await require('../../core/db/client').one(`SELECT balance FROM wallets WHERE user_id=$1`, [req.user.id]);
    const summary = await shopsService.computeOrderSummary(
      req.params.shopId, items, delivery_lat, delivery_lng,
      wallet ? Number(wallet.balance) : 0
    );
    ok(res, summary);
  } catch (e) { err(res, e.message, 400); }
});

// Customer block management
router.post('/:shopId/block-customer', authenticate, requireShopAccess, async (req, res) => {
  try {
    const result = await shopsService.blockCustomer(req.params.shopId, req.body.customer_id, req.body.reason);
    ok(res, result);
  } catch (e) { err(res, e.message); }
});
router.delete('/:shopId/block-customer/:customerId', authenticate, requireShopAccess, async (req, res) => {
  try {
    await shopsService.unblockCustomer(req.params.shopId, req.params.customerId);
    ok(res, { unblocked: true });
  } catch (e) { err(res, e.message); }
});

// Agent management
router.post('/:shopId/agents', authenticate, requireShopAccess, async (req, res) => {
  try {
    const agent = await shopsService.addAgent(req.params.shopId, req.body.user_id);
    ok(res, agent);
  } catch (e) { err(res, e.message); }
});
router.get('/:shopId/agents', authenticate, requireShopAccess, async (req, res) => {
  try {
    const agents = await shopsService.getAgents(req.params.shopId);
    ok(res, agents);
  } catch (e) { err(res, e.message); }
});
router.patch('/:shopId/agent-location', authenticate, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const result = await shopsService.updateAgentLocation(req.params.shopId, req.user.id, lat, lng);
    ok(res, result);
  } catch (e) { err(res, e.message); }
});

module.exports = router;
