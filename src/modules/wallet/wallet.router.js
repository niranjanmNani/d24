var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var db = require('../../core/db/client');

router.get('/', auth.authenticate, function(req,res) {
  Promise.all([
    db.one('SELECT * FROM wallets WHERE user_id=$1', [req.user.id]),
    db.many('SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id])
  ]).then(function(r) { ok(res, { balance: r[0] ? r[0].balance : 0, transactions: r[1] }); })
    .catch(function(e){ err(res,e.message); });
});
router.get('/cards', auth.authenticate, function(req,res) {
  db.many('SELECT sc.*, s.name as shop_name FROM scratch_cards sc JOIN shops s ON s.id=sc.shop_id WHERE sc.user_id=$1 AND sc.voided=false ORDER BY sc.created_at DESC', [req.user.id])
    .then(function(cards){ ok(res,cards); }).catch(function(e){ err(res,e.message); });
});
router.post('/cards/:id/scratch', auth.authenticate, function(req,res) {
  db.one('SELECT * FROM scratch_cards WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
    .then(function(card) {
      if (!card) throw new Error('Card not found');
      if (card.voided) throw new Error('Card has been voided');
      if (card.collected) throw new Error('Already collected');
      return db.one('UPDATE scratch_cards SET scratched=true,scratched_at=now() WHERE id=$1 RETURNING *', [card.id]);
    })
    .then(function(c){ ok(res,c); }).catch(function(e){ err(res,e.message); });
});
router.post('/cards/:id/collect', auth.authenticate, function(req,res) {
  db.one('SELECT * FROM scratch_cards WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
    .then(function(card) {
      if (!card) throw new Error('Card not found');
      if (!card.scratched) throw new Error('Scratch the card first');
      if (card.collected) throw new Error('Already collected');
      if (card.voided) throw new Error('Card voided');
      return db.transaction(function(client) {
        return client.query('UPDATE scratch_cards SET collected=true,collected_at=now() WHERE id=$1', [card.id])
          .then(function() { return client.query('UPDATE wallets SET balance=balance+$1 WHERE user_id=$2', [card.amount, req.user.id]); })
          .then(function() { return client.query('INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,$3,$4,$5)', [req.user.id, card.amount, 'cashback', 'Scratch card cashback', card.order_id]); })
          .then(function() { return db.one('SELECT balance FROM wallets WHERE user_id=$1', [req.user.id]); });
      });
    })
    .then(function(w){ ok(res, { collected: true, new_balance: w.balance }); })
    .catch(function(e){ err(res,e.message); });
});
module.exports = router;
