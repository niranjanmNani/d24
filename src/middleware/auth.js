var jwt = require('jsonwebtoken');
var db = require('../core/db/client');
var SUPERADMIN_PHONE = process.env.SUPERADMIN_PHONE || '9949808388';

function authenticate(req, res, next) {
  var header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  var token = header.split(' ')[1];
  var payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); }
  catch(e) { return res.status(401).json({ error: 'Invalid or expired token' }); }
  db.one('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.userId])
    .then(function(user) {
      if (!user) return res.status(401).json({ error: 'User not found or inactive' });
      req.user = user;
      req.isSuperAdmin = (user.phone === SUPERADMIN_PHONE);
      next();
    }).catch(function(e) { res.status(500).json({ error: e.message }); });
}

function requireRole() {
  var roles = Array.prototype.slice.call(arguments);
  return function(req, res, next) {
    if (req.isSuperAdmin) return next();
    if (roles.indexOf(req.user.role) === -1) return res.status(403).json({ error: 'Requires role: ' + roles.join(' or ') });
    next();
  };
}

function requireShopAccess(req, res, next) {
  var shopId = req.params.shopId || req.body.shopId;
  if (!shopId) return res.status(400).json({ error: 'shopId required' });
  if (req.isSuperAdmin) return next();
  if (req.user.role === 'merchant') {
    db.one('SELECT id FROM shops WHERE id=$1 AND merchant_id=$2', [shopId, req.user.id])
      .then(function(shop) {
        if (!shop) return res.status(403).json({ error: 'Not your shop' });
        next();
      }).catch(function(e) { res.status(500).json({ error: e.message }); });
  } else if (req.user.role === 'agent') {
    db.one('SELECT id FROM shop_agents WHERE shop_id=$1 AND user_id=$2 AND is_active=true', [shopId, req.user.id])
      .then(function(a) {
        if (!a) return res.status(403).json({ error: 'Not assigned to this shop' });
        next();
      }).catch(function(e) { res.status(500).json({ error: e.message }); });
  } else {
    res.status(403).json({ error: 'Access denied' });
  }
}

module.exports = { authenticate: authenticate, requireRole: requireRole, requireShopAccess: requireShopAccess };
