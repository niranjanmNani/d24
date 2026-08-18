var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var db = require('../../core/db/client');

router.get('/', auth.authenticate, function(req,res) {
  db.many('SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC', [req.user.id])
    .then(function(a){ ok(res,a); }).catch(function(e){ err(res,e.message); });
});
router.post('/', auth.authenticate, function(req,res) {
  var d = req.body;
  if (!d.line1 || !d.city) return err(res,'line1 and city required');
  var doDefault = !!d.is_default;
  var p = doDefault
    ? db.query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.user.id])
    : Promise.resolve();
  p.then(function() {
    return db.one('INSERT INTO addresses(user_id,label,line1,line2,city,pincode,lat,lng,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.user.id, d.label||'Home', d.line1, d.line2||null, d.city, d.pincode||null, d.lat||null, d.lng||null, doDefault]);
  }).then(function(a){ ok(res,a,201); }).catch(function(e){ err(res,e.message); });
});
router.patch('/:id/default', auth.authenticate, function(req,res) {
  db.query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.user.id])
    .then(function() { return db.one('UPDATE addresses SET is_default=true WHERE id=$1 AND user_id=$2 RETURNING *', [req.params.id, req.user.id]); })
    .then(function(a){ ok(res,a); }).catch(function(e){ err(res,e.message); });
});
router.delete('/:id', auth.authenticate, function(req,res) {
  db.query('DELETE FROM addresses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
    .then(function(){ ok(res,{deleted:true}); }).catch(function(e){ err(res,e.message); });
});
module.exports = router;
