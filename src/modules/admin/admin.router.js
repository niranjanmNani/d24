var express = require('express');
var router = express.Router();
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var db = require('../../core/db/client');

function superadminOnly(req, res, next) {
  if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin only' });
  next();
}

router.get('/stats', auth.authenticate, superadminOnly, function(req,res) {
  Promise.all([
    db.one('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE role=\'customer\') as customers, COUNT(*) FILTER (WHERE role=\'merchant\') as merchants FROM users'),
    db.one('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active=true) as active FROM shops'),
    db.one('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status=\'delivered\') as delivered FROM orders'),
    db.one('SELECT COALESCE(SUM(total),0) as gmv FROM orders WHERE status=\'delivered\'')
  ]).then(function(r){ ok(res,{ users:r[0], shops:r[1], orders:r[2], gmv:r[3].gmv }); })
    .catch(function(e){ err(res,e.message); });
});
router.get('/shops', auth.authenticate, superadminOnly, function(req,res) {
  db.many('SELECT s.*, u.name as merchant_name, u.phone as merchant_phone FROM shops s JOIN users u ON u.id=s.merchant_id ORDER BY s.created_at DESC')
    .then(function(s){ ok(res,s); }).catch(function(e){ err(res,e.message); });
});
router.patch('/shops/:id/approve', auth.authenticate, superadminOnly, function(req,res) {
  db.one('UPDATE shops SET is_active=true,blocked_at=null WHERE id=$1 RETURNING *', [req.params.id])
    .then(function(s){ ok(res,s); }).catch(function(e){ err(res,e.message); });
});
router.patch('/shops/:id/block', auth.authenticate, superadminOnly, function(req,res) {
  db.one('UPDATE shops SET is_active=false,blocked_at=now(),blocked_reason=$1 WHERE id=$2 RETURNING *', [req.body.reason||'Blocked by admin', req.params.id])
    .then(function(s){ ok(res,s); }).catch(function(e){ err(res,e.message); });
});
router.get('/users', auth.authenticate, superadminOnly, function(req,res) {
  var q = 'SELECT * FROM users WHERE 1=1';
  var params = [];
  if (req.query.role) { params.push(req.query.role); q += ' AND role=$'+params.length; }
  q += ' ORDER BY created_at DESC LIMIT 50';
  db.many(q, params).then(function(u){ ok(res,u); }).catch(function(e){ err(res,e.message); });
});
router.patch('/users/:id/block', auth.authenticate, superadminOnly, function(req,res) {
  db.one('UPDATE users SET is_active=false,blocked_at=now(),blocked_reason=$1 WHERE id=$2 RETURNING *', [req.body.reason||'Blocked', req.params.id])
    .then(function(u){ ok(res,u); }).catch(function(e){ err(res,e.message); });
});
router.patch('/users/:id/unblock', auth.authenticate, superadminOnly, function(req,res) {
  db.one('UPDATE users SET is_active=true,blocked_at=null,blocked_reason=null WHERE id=$1 RETURNING *', [req.params.id])
    .then(function(u){ ok(res,u); }).catch(function(e){ err(res,e.message); });
});
router.patch('/users/:id/role', auth.authenticate, superadminOnly, function(req,res) {
  db.one('UPDATE users SET role=$1 WHERE id=$2 RETURNING *', [req.body.role, req.params.id])
    .then(function(u){ ok(res,u); }).catch(function(e){ err(res,e.message); });
});
module.exports = router;
