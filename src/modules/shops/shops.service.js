var db = require('../../core/db/client');
var geo = require('../../utils/geo');

var shopsService = {
  listNearby: function(lat, lng, radius, category) {
    radius = radius || 10;
    var q = 'SELECT s.*, u.name as merchant_name FROM shops s JOIN users u ON u.id=s.merchant_id WHERE s.is_active=true AND s.blocked_at IS NULL';
    var params = [];
    if (category) { params.push(category); q += ' AND s.category=$' + params.length; }
    return db.many(q, params).then(function(shops) {
      return shops.map(function(s) {
        var dist = (lat && lng && s.lat && s.lng) ? Math.round(geo.distanceKm(lat, lng, s.lat, s.lng)*10)/10 : null;
        return Object.assign({}, s, { distance_km: dist });
      }).filter(function(s) { return !lat || !s.lat || s.distance_km <= radius; })
        .sort(function(a,b) { return (a.distance_km||999)-(b.distance_km||999); });
    });
  },

  getById: function(id) {
    return db.one('SELECT s.*, u.name as merchant_name FROM shops s JOIN users u ON u.id=s.merchant_id WHERE s.id=$1', [id]);
  },

  register: function(merchantId, data) {
    var tiers = JSON.stringify(data.delivery_tiers || [{upto_km:2,charge:20},{upto_km:5,charge:40},{upto_km:10,charge:60}]);
    return db.one(
      'INSERT INTO shops(merchant_id,name,description,category,address_line1,address_line2,city,pincode,lat,lng,phone,email,gstin,gst_percent,min_order_amt,delivery_radius,delivery_tiers,cashback_type,cashback_value,cashback_max) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *',
      [merchantId, data.name, data.description||null, data.category||'grocery',
       data.address_line1, data.address_line2||null, data.city, data.pincode||null,
       data.lat||null, data.lng||null, data.phone||null, data.email||null, data.gstin||null,
       data.gst_percent||5, data.min_order_amt||0, data.delivery_radius||5, tiers,
       data.cashback_type||'percent', data.cashback_value||2, data.cashback_max||50]
    );
  },

  update: function(shopId, data) {
    var allowed = ['name','description','category','address_line1','address_line2','city','pincode','lat','lng','phone','email','gst_percent','min_order_amt','delivery_radius','delivery_tiers','cashback_type','cashback_value','cashback_max','is_open','logo_url','cover_url'];
    var fields = Object.keys(data).filter(function(k){ return allowed.indexOf(k)!==-1; });
    if (!fields.length) return Promise.resolve(null);
    var sets = fields.map(function(f,i){ return f+'=$'+(i+2); }).join(',');
    return db.one('UPDATE shops SET '+sets+' WHERE id=$1 RETURNING *', [shopId].concat(fields.map(function(f){ return data[f]; })));
  },

  computeOrderSummary: function(shopId, items, deliveryLat, deliveryLng, walletBalance) {
    walletBalance = walletBalance || 0;
    return shopsService.getById(shopId).then(function(shop) {
      if (!shop) throw new Error('Shop not found');
      if (!shop.is_active) throw new Error('Shop is not active');
      var ids = items.map(function(i){ return i.product_id; });
      return db.many('SELECT * FROM products WHERE id=ANY($1) AND shop_id=$2 AND is_active=true', [ids, shopId])
        .then(function(products) {
          var subtotal = 0, gst_total = 0;
          var lineItems = items.map(function(item) {
            var p = products.filter(function(x){ return x.id===item.product_id; })[0];
            if (!p) throw new Error('Product ' + item.product_id + ' not found');
            if (p.stock < item.qty) throw new Error('Only ' + p.stock + ' units of ' + p.name + ' available');
            var gst_pct = p.gst_percent || shop.gst_percent;
            var line_total = Math.round(p.price * item.qty * 100) / 100;
            var gst_amt = Math.round(line_total * gst_pct / (100 + gst_pct) * 100) / 100;
            subtotal += line_total;
            gst_total += gst_amt;
            return { product_id: p.id, name: p.name, price: p.price, mrp: p.mrp, gst_percent: gst_pct, gst_amount: gst_amt, qty: item.qty, total: line_total };
          });
          var del_charge = 0, distance_km = null;
          if (deliveryLat && deliveryLng && shop.lat && shop.lng) {
            distance_km = Math.round(geo.distanceKm(deliveryLat, deliveryLng, shop.lat, shop.lng)*10)/10;
            del_charge = geo.deliveryCharge(distance_km, shop.delivery_tiers);
          }
          var cashback = Math.round(geo.computeCashback(subtotal, shop)*100)/100;
          var total = Math.round((subtotal + del_charge)*100)/100;
          return {
            shop: { id: shop.id, name: shop.name, gst_percent: shop.gst_percent, gstin: shop.gstin },
            line_items: lineItems,
            summary: { subtotal: Math.round(subtotal*100)/100, gst_amount: Math.round(gst_total*100)/100, delivery_charge: del_charge, distance_km: distance_km, total: total, cashback_on_payment: cashback, wallet_available: walletBalance, wallet_applicable: Math.min(walletBalance, total) }
          };
        });
    });
  },

  blockCustomer: function(shopId, customerId, reason) {
    return db.one('INSERT INTO shop_customer_blocks(shop_id,customer_id,reason) VALUES($1,$2,$3) ON CONFLICT(shop_id,customer_id) DO UPDATE SET reason=$3,blocked_at=now() RETURNING *', [shopId, customerId, reason]);
  },
  unblockCustomer: function(shopId, customerId) {
    return db.query('DELETE FROM shop_customer_blocks WHERE shop_id=$1 AND customer_id=$2', [shopId, customerId]);
  },
  isCustomerBlocked: function(shopId, customerId) {
    return db.one('SELECT id FROM shop_customer_blocks WHERE shop_id=$1 AND customer_id=$2', [shopId, customerId]).then(function(r){ return !!r; });
  },
  addAgent: function(shopId, userId) {
    return db.one('SELECT id FROM users WHERE id=$1 AND role=$2', [userId, 'agent']).then(function(user) {
      if (!user) throw new Error('User must have agent role');
      return db.one('INSERT INTO shop_agents(shop_id,user_id) VALUES($1,$2) ON CONFLICT(shop_id,user_id) DO UPDATE SET is_active=true RETURNING *', [shopId, userId]);
    });
  },
  getAgents: function(shopId) {
    return db.many('SELECT sa.*, u.name, u.phone FROM shop_agents sa JOIN users u ON u.id=sa.user_id WHERE sa.shop_id=$1', [shopId]);
  }
};
module.exports = shopsService;
