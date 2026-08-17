const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { ok, err } = require('../../utils/response');
const db = require('../../core/db/client');

router.get('/', authenticate, async (req, res) => {
  try {
    const addresses = await db.many(`SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC`, [req.user.id]);
    ok(res, addresses);
  } catch (e) { err(res, e.message); }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { label, line1, line2, city, pincode, lat, lng, is_default } = req.body;
    if (!line1 || !city) return err(res, 'line1 and city required');
    if (is_default) await db.query(`UPDATE addresses SET is_default=false WHERE user_id=$1`, [req.user.id]);
    const addr = await db.one(`INSERT INTO addresses(user_id,label,line1,line2,city,pincode,lat,lng,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, label||'Home', line1, line2, city, pincode, lat, lng, !!is_default]);
    ok(res, addr, 201);
  } catch (e) { err(res, e.message); }
});

router.patch('/:id/default', authenticate, async (req, res) => {
  try {
    await db.query(`UPDATE addresses SET is_default=false WHERE user_id=$1`, [req.user.id]);
    const addr = await db.one(`UPDATE addresses SET is_default=true WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, req.user.id]);
    ok(res, addr);
  } catch (e) { err(res, e.message); }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await db.query(`DELETE FROM addresses WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    ok(res, { deleted: true });
  } catch (e) { err(res, e.message); }
});

module.exports = router;
