const db = require('../../core/db/client');
const { distanceKm, deliveryCharge } = require('../../utils/geo');

const shopsService = {
  async listNearby(lat, lng, radius = 10, category = null) {
    let q = `
      SELECT s.*, u.name as merchant_name,
        (SELECT COUNT(*) FROM products WHERE shop_id=s.id AND is_active=true) as product_count
      FROM shops s
      JOIN users u ON u.id = s.merchant_id
      WHERE s.is_active = true AND s.blocked_at IS NULL
    `;
    const params = [];
    if (category) { params.push(category); q += ` AND s.category = $${params.length}`; }
    const shops = await db.many(q, params);
    // Filter by distance if lat/lng provided
    return shops.map(s => {
      const dist = (lat && lng && s.lat && s.lng)
        ? Math.round(distanceKm(lat, lng, s.lat, s.lng) * 10) / 10
        : null;
      return { ...s, distance_km: dist };
    }).filter(s => !lat || !s.lat || s.distance_km <= radius)
      .sort((a, b) => (a.distance_km || 999) - (b.distance_km || 999));
  },

  async getById(id) {
    return db.one(`SELECT s.*, u.name as merchant_name FROM shops s JOIN users u ON u.id=s.merchant_id WHERE s.id=$1`, [id]);
  },

  async register(merchantId, data) {
    return db.one(`
      INSERT INTO shops(merchant_id,name,description,category,address_line1,address_line2,city,pincode,lat,lng,phone,email,gstin,gst_percent,min_order_amt,delivery_radius,delivery_tiers,cashback_type,cashback_value,cashback_max)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *`,
      [merchantId, data.name, data.description, data.category, data.address_line1, data.address_line2,
       data.city, data.pincode, data.lat, data.lng, data.phone, data.email, data.gstin,
       data.gst_percent||5, data.min_order_amt||0, data.delivery_radius||5,
       JSON.stringify(data.delivery_tiers||[{upto_km:2,charge:20},{upto_km:5,charge:40},{upto_km:10,charge:60}]),
       data.cashback_type||'percent', data.cashback_value||2, data.cashback_max||50]
    );
  },

  async update(shopId, data) {
    const allowed = ['name','description','category','address_line1','address_line2','city','pincode','lat','lng','phone','email','gst_percent','min_order_amt','delivery_radius','delivery_tiers','cashback_type','cashback_value','cashback_max','is_open','logo_url','cover_url'];
    const fields = Object.keys(data).filter(k => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f,i) => `${f}=$${i+2}`).join(',');
    const vals = fields.map(f => data[f]);
    return db.one(`UPDATE shops SET ${sets} WHERE id=$1 RETURNING *`, [shopId, ...vals]);
  },

  async computeOrderSummary(shopId, items, deliveryLat, deliveryLng, walletBalance = 0) {
    const shop = await shopsService.getById(shopId);
    if (!shop) throw new Error('Shop not found');
    if (!shop.is_active) throw new Error('Shop is not active');
    if (shop.blocked_at) throw new Error('Shop is blocked');

    // Fetch products
    const ids = items.map(i => i.product_id);
    const products = await db.many(`SELECT * FROM products WHERE id=ANY($1) AND shop_id=$2 AND is_active=true`, [ids, shopId]);
    
    let subtotal = 0, gst_total = 0;
    const lineItems = items.map(item => {
      const p = products.find(x => x.id === item.product_id);
      if (!p) throw new Error(`Product ${item.product_id} not found`);
      if (p.stock < item.qty) throw new Error(`Only ${p.stock} units of "${p.name}" available`);
      const gst_pct = p.gst_percent || shop.gst_percent;
      const line_total = Math.round(p.price * item.qty * 100) / 100;
      const gst_amt = Math.round(line_total * gst_pct / (100 + gst_pct) * 100) / 100;
      subtotal += line_total;
      gst_total += gst_amt;
      return { product_id: p.id, name: p.name, price: p.price, mrp: p.mrp, gst_percent: gst_pct, gst_amount: gst_amt, qty: item.qty, total: line_total };
    });

    // Delivery charge
    let distance_km = null, del_charge = 0;
    if (deliveryLat && deliveryLng && shop.lat && shop.lng) {
      distance_km = Math.round(distanceKm(deliveryLat, deliveryLng, shop.lat, shop.lng) * 10) / 10;
      if (distance_km > shop.delivery_radius) throw new Error(`Delivery not available — ${distance_km}km exceeds shop range of ${shop.delivery_radius}km`);
      del_charge = deliveryCharge(distance_km, shop.delivery_tiers);
    }

    // Cashback preview (not credited yet — credited after payment)
    const { computeCashback } = require('../../utils/geo');
    const cashback = Math.round(computeCashback(subtotal, shop) * 100) / 100;

    const total = Math.round((subtotal + del_charge) * 100) / 100;
    const walletApplicable = Math.min(walletBalance, total);

    return {
      shop: { id: shop.id, name: shop.name, gst_percent: shop.gst_percent, gstin: shop.gstin },
      line_items: lineItems,
      summary: {
        subtotal: Math.round(subtotal * 100) / 100,
        gst_amount: Math.round(gst_total * 100) / 100,
        delivery_charge: del_charge,
        distance_km,
        total,
        cashback_on_payment: cashback,
        wallet_available: walletBalance,
        wallet_applicable: walletApplicable
      }
    };
  },

  // Blocks
  async blockCustomer(shopId, customerId, reason) {
    return db.one(`INSERT INTO shop_customer_blocks(shop_id,customer_id,reason) VALUES($1,$2,$3) ON CONFLICT(shop_id,customer_id) DO UPDATE SET reason=$3, blocked_at=now() RETURNING *`, [shopId, customerId, reason]);
  },
  async unblockCustomer(shopId, customerId) {
    return db.query(`DELETE FROM shop_customer_blocks WHERE shop_id=$1 AND customer_id=$2`, [shopId, customerId]);
  },
  async isCustomerBlocked(shopId, customerId) {
    return !!(await db.one(`SELECT id FROM shop_customer_blocks WHERE shop_id=$1 AND customer_id=$2`, [shopId, customerId]));
  },

  // Agents
  async addAgent(shopId, userId) {
    const user = await db.one(`SELECT id FROM users WHERE id=$1 AND role='agent'`, [userId]);
    if (!user) throw new Error('User must have agent role');
    return db.one(`INSERT INTO shop_agents(shop_id,user_id) VALUES($1,$2) ON CONFLICT(shop_id,user_id) DO UPDATE SET is_active=true RETURNING *`, [shopId, userId]);
  },
  async updateAgentLocation(shopId, userId, lat, lng) {
    return db.one(`UPDATE shop_agents SET current_lat=$3,current_lng=$4,location_at=now(),is_on_duty=true WHERE shop_id=$1 AND user_id=$2 RETURNING *`, [shopId, userId, lat, lng]);
  },
  async getAgents(shopId) {
    return db.many(`SELECT sa.*, u.name, u.phone FROM shop_agents sa JOIN users u ON u.id=sa.user_id WHERE sa.shop_id=$1`, [shopId]);
  }
};

module.exports = shopsService;
