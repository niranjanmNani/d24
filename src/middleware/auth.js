const jwt = require('jsonwebtoken');
const db = require('../core/db/client');

const SUPERADMIN_PHONE = process.env.SUPERADMIN_PHONE || '9949808388';

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.one('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.userId]);
    if (!user) return res.status(401).json({ error: 'User not found or inactive' });
    req.user = user;
    req.isSuperAdmin = user.phone === SUPERADMIN_PHONE;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.isSuperAdmin) return next(); // superadmin bypasses all
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

async function requireShopAccess(req, res, next) {
  // Merchant must own the shop; agent must be assigned to it
  const shopId = req.params.shopId || req.body.shopId;
  if (!shopId) return res.status(400).json({ error: 'shopId required' });
  if (req.isSuperAdmin) return next();
  if (req.user.role === 'merchant') {
    const shop = await db.one('SELECT id FROM shops WHERE id=$1 AND merchant_id=$2', [shopId, req.user.id]);
    if (!shop) return res.status(403).json({ error: 'Not your shop' });
  } else if (req.user.role === 'agent') {
    const a = await db.one('SELECT id FROM shop_agents WHERE shop_id=$1 AND user_id=$2 AND is_active=true', [shopId, req.user.id]);
    if (!a) return res.status(403).json({ error: 'Not assigned to this shop' });
  } else {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

module.exports = { authenticate, requireRole, requireShopAccess };
