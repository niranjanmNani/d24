const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { ok, err } = require('../../utils/response');
const db = require('../../core/db/client');
const { refundSplit, t7date } = require('../../utils/refund');

// Returns CRUD
// POST /api/delivery/returns
router.post('/returns', authenticate, async (req, res) => {
  try {
    const { order_id, reason, items } = req.body;
    const order = await db.one(`SELECT * FROM orders WHERE id=$1 AND customer_id=$2`, [order_id, req.user.id]);
    if (!order) return err(res, 'Order not found', 404);
    if (order.status !== 'delivered') return err(res, 'Can only return delivered orders');
    if (order.refund_status === 'full') return err(res, 'Order already fully refunded');
    const ret = await db.one(`INSERT INTO returns(order_id,customer_id,items,reason) VALUES($1,$2,$3,$4) RETURNING *`,
      [order_id, req.user.id, JSON.stringify(items), reason]);
    await db.query(`UPDATE orders SET return_status='requested' WHERE id=$1`, [order_id]);
    ok(res, ret, 201);
  } catch (e) { err(res, e.message, 400); }
});

// GET /api/delivery/returns?shop_id=
router.get('/returns', authenticate, async (req, res) => {
  try {
    const { shop_id } = req.query;
    const returns = await db.many(`SELECT r.*, o.total, o.wallet_used, o.payment_method, o.refunded_amount, u.name as customer_name, u.phone as customer_phone FROM returns r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.customer_id WHERE o.shop_id=$1 ORDER BY r.created_at DESC`, [shop_id]);
    ok(res, returns);
  } catch (e) { err(res, e.message); }
});

// PATCH /api/delivery/returns/:id/approve
router.patch('/returns/:id/approve', authenticate, async (req, res) => {
  try {
    const ret = await db.one(`UPDATE returns SET status='approved' WHERE id=$1 RETURNING *`, [req.params.id]);
    await db.query(`UPDATE orders SET return_status='approved' WHERE id=$1`, [ret.order_id]);
    ok(res, ret);
  } catch (e) { err(res, e.message); }
});

// PATCH /api/delivery/returns/:id/pickup
router.patch('/returns/:id/pickup', authenticate, async (req, res) => {
  try {
    const { note } = req.body;
    const ret = await db.one(`UPDATE returns SET status='picked',pickup_note=$1 WHERE id=$2 RETURNING *`, [note, req.params.id]);
    const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [ret.order_id]);
    await db.query(`UPDATE orders SET return_status='picked' WHERE id=$1`, [ret.order_id]);

    // Credit wallet portion immediately on pickup
    const alreadyRefunded = Number(order.refunded_amount || 0);
    const toRefund = Number(order.total) - alreadyRefunded;
    const split = refundSplit(order, toRefund);

    if (split.walletRefund > 0) {
      await db.query(`UPDATE wallets SET balance=balance+$1 WHERE user_id=$2`, [split.walletRefund, order.customer_id]);
      await db.query(`INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,'refund','Return pickup — wallet refund',$3)`, [order.customer_id, split.walletRefund, order.id]);
      await db.query(`UPDATE orders SET refunded_amount=refunded_amount+$1 WHERE id=$2`, [split.walletRefund, order.id]);
    }
    ok(res, { return: ret, wallet_credited: split.walletRefund });
  } catch (e) { err(res, e.message); }
});

// PATCH /api/delivery/returns/:id/complete
router.patch('/returns/:id/complete', authenticate, async (req, res) => {
  try {
    const ret = await db.one(`UPDATE returns SET status='completed' WHERE id=$1 RETURNING *`, [req.params.id]);
    const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [ret.order_id]);
    const toRefund = Number(order.total) - Number(order.refunded_amount || 0);

    if (toRefund > 0) {
      const schedDate = t7date();
      await db.query(`INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status,scheduled_date) VALUES($1,$2,$3,'full','Return completed','source','pending',$4)`,
        [order.id, order.customer_id, toRefund, schedDate]);
    }
    await db.query(`UPDATE orders SET return_status='completed',refunded_amount=total,refund_status='full' WHERE id=$1`, [ret.order_id]);
    // Void scratch card
    await db.query(`UPDATE scratch_cards SET voided=true WHERE order_id=$1 AND collected=false`, [order.id]);
    ok(res, { return: ret, source_refund_due: toRefund, due_by: t7date() });
  } catch (e) { err(res, e.message); }
});

// PATCH /api/delivery/returns/:id/reject
router.patch('/returns/:id/reject', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const ret = await db.one(`UPDATE returns SET status='rejected',pickup_note=$1 WHERE id=$2 RETURNING *`, [reason, req.params.id]);
    await db.query(`UPDATE orders SET return_status='rejected' WHERE id=$1`, [ret.order_id]);
    ok(res, ret);
  } catch (e) { err(res, e.message); }
});

// PATCH /api/delivery/agent/location
router.patch('/agent/location', authenticate, async (req, res) => {
  try {
    const { shop_id, lat, lng } = req.body;
    await db.query(`UPDATE shop_agents SET current_lat=$1,current_lng=$2,location_at=now(),is_on_duty=true WHERE shop_id=$3 AND user_id=$4`, [lat, lng, shop_id, req.user.id]);
    ok(res, { updated: true });
  } catch (e) { err(res, e.message); }
});

module.exports = router;
