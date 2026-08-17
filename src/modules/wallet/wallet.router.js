const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { ok, err } = require('../../utils/response');
const db = require('../../core/db/client');

// GET /api/wallet
router.get('/', authenticate, async (req, res) => {
  try {
    const wallet = await db.one(`SELECT * FROM wallets WHERE user_id=$1`, [req.user.id]);
    const txns = await db.many(`SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
    ok(res, { balance: wallet?.balance || 0, transactions: txns });
  } catch (e) { err(res, e.message); }
});

// GET /api/wallet/cards — scratch cards
router.get('/cards', authenticate, async (req, res) => {
  try {
    const cards = await db.many(`SELECT sc.*, s.name as shop_name FROM scratch_cards sc JOIN shops s ON s.id=sc.shop_id WHERE sc.user_id=$1 AND sc.voided=false ORDER BY sc.created_at DESC`, [req.user.id]);
    ok(res, cards);
  } catch (e) { err(res, e.message); }
});

// POST /api/wallet/cards/:id/scratch
router.post('/cards/:id/scratch', authenticate, async (req, res) => {
  try {
    const card = await db.one(`SELECT * FROM scratch_cards WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!card) return err(res, 'Card not found', 404);
    if (card.voided) return err(res, 'Card has been voided');
    if (card.collected) return err(res, 'Already collected');
    const updated = await db.one(`UPDATE scratch_cards SET scratched=true, scratched_at=now() WHERE id=$1 RETURNING *`, [card.id]);
    ok(res, updated);
  } catch (e) { err(res, e.message); }
});

// POST /api/wallet/cards/:id/collect
router.post('/cards/:id/collect', authenticate, async (req, res) => {
  try {
    const card = await db.one(`SELECT * FROM scratch_cards WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!card) return err(res, 'Card not found', 404);
    if (!card.scratched) return err(res, 'Scratch the card first');
    if (card.collected) return err(res, 'Already collected');
    if (card.voided) return err(res, 'Card voided');
    await db.transaction(async (client) => {
      await client.query(`UPDATE scratch_cards SET collected=true,collected_at=now() WHERE id=$1`, [card.id]);
      await client.query(`UPDATE wallets SET balance=balance+$1 WHERE user_id=$2`, [card.amount, req.user.id]);
      await client.query(`INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,'cashback','Scratch card cashback',$3)`,
        [req.user.id, card.amount, card.order_id]);
    });
    const wallet = await db.one(`SELECT balance FROM wallets WHERE user_id=$1`, [req.user.id]);
    ok(res, { collected: true, amount: card.amount, new_balance: wallet.balance });
  } catch (e) { err(res, e.message); }
});

module.exports = router;
