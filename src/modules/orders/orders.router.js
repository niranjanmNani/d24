const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const { ok, err } = require('../../utils/response');
const ordersService = require('./orders.service');
const db = require('../../core/db/client');

// POST /api/orders — place order
router.post('/', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { shop_id, items, payment_method, wallet_use, delivery_address, delivery_lat, delivery_lng, notes } = req.body;
    if (!shop_id || !items?.length) return err(res, 'shop_id and items required');
    const order = await ordersService.place(req.user.id, shop_id, req.body);
    ok(res, order, 201);
  } catch (e) { err(res, e.message, 400); }
});

// GET /api/orders/my — customer's own orders
router.get('/my', authenticate, async (req, res) => {
  try {
    const orders = await ordersService.listForCustomer(req.user.id, req.query);
    ok(res, orders);
  } catch (e) { err(res, e.message); }
});

// GET /api/orders/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const order = await ordersService.getOrder(req.params.id);
    if (!order) return err(res, 'Not found', 404);
    // Only customer, shop merchant/agent, or superadmin can view
    if (!req.isSuperAdmin && order.customer_id !== req.user.id) {
      const access = await db.one(`SELECT id FROM shops WHERE id=$1 AND merchant_id=$2`, [order.shop_id, req.user.id]);
      if (!access) return err(res, 'Access denied', 403);
    }
    ok(res, order);
  } catch (e) { err(res, e.message); }
});

// PATCH /api/orders/:id/status — advance status
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, otp, agent_id } = req.body;
    const order = await ordersService.advance(req.params.id, status, { otp, agentId: agent_id });
    ok(res, order);
  } catch (e) { err(res, e.message, 400); }
});

// POST /api/orders/:id/cancel
router.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    const result = await ordersService.cancel(req.params.id, req.user.id);
    ok(res, result);
  } catch (e) { err(res, e.message, 400); }
});

// POST /api/orders/:id/refund
router.post('/:id/refund', authenticate, async (req, res) => {
  try {
    const { amount, type = 'partial', reason } = req.body;
    if (!amount || !reason) return err(res, 'amount and reason required');
    const result = await ordersService.issueRefund(req.params.id, req.user.id, { amount, type, reason });
    ok(res, result);
  } catch (e) { err(res, e.message, 400); }
});

// GET /api/orders/shop/:shopId — shop's orders
router.get('/shop/:shopId', authenticate, async (req, res) => {
  try {
    const orders = await ordersService.listForShop(req.params.shopId, req.query);
    ok(res, orders);
  } catch (e) { err(res, e.message); }
});

module.exports = router;
