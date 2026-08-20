var db = require('../../core/db/client');
var geo = require('../../utils/geo');
var refundUtil = require('../../utils/refund');

var ordersService = {

  place: function(customerId, shopId, data) {
    return db.transaction(function(client) {
      var shop, lineItems = [], subtotal = 0, gst_total = 0;
      return client.query('SELECT * FROM shops WHERE id=$1 AND is_active=true', [shopId]).then(function(r) {
        shop = r.rows[0];
        if (!shop) throw new Error('Shop not found or inactive');
        if (shop.blocked_at) throw new Error('Shop is currently unavailable');
        if (shop.is_open === false) throw new Error('This shop is currently closed');
        return client.query('SELECT id FROM shop_customer_blocks WHERE shop_id=$1 AND customer_id=$2', [shopId, customerId]);
      }).then(function(r) {
        if (r.rows[0]) throw new Error('You are restricted from ordering at this store');
        var items = data.items || [];
        return items.reduce(function(chain, item) {
          return chain.then(function() {
            return client.query('SELECT * FROM products WHERE id=$1 AND shop_id=$2 AND is_active=true FOR UPDATE', [item.product_id, shopId]).then(function(r) {
              var p = r.rows[0];
              if (!p) throw new Error('Product not found: ' + item.product_id);
              if (p.stock < item.qty) throw new Error('Only ' + p.stock + ' units of ' + p.name + ' available');
              return client.query('UPDATE products SET stock=stock-$1 WHERE id=$2', [item.qty, p.id]).then(function() {
                var gst_pct = p.gst_percent || shop.gst_percent;
                var line_total = Math.round(p.price * item.qty * 100) / 100;
                var gst_amt = Math.round(line_total * gst_pct / (100 + gst_pct) * 100) / 100;
                subtotal += line_total;
                gst_total += gst_amt;
                lineItems.push({ product_id: p.id, name: p.name, price: p.price, mrp: p.mrp, gst_percent: gst_pct, gst_amount: gst_amt, qty: item.qty, total: line_total });
              });
            });
          });
        }, Promise.resolve());
      }).then(function() {
        var del_charge = 0, distance_km = null;
        if (data.delivery_lat && data.delivery_lng && shop.lat && shop.lng) {
          distance_km = Math.round(geo.distanceKm(data.delivery_lat, data.delivery_lng, shop.lat, shop.lng)*10)/10;
          del_charge = geo.deliveryCharge(distance_km, shop.delivery_tiers);
        }
        var total = Math.round((subtotal + del_charge)*100)/100;
        var wallet_used = 0;
        return (data.wallet_use > 0
          ? client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [customerId]).then(function(r) {
              wallet_used = Math.min(r.rows[0] ? r.rows[0].balance : 0, data.wallet_use, total);
              if (wallet_used > 0) {
                return client.query('UPDATE wallets SET balance=balance-$1 WHERE user_id=$2', [wallet_used, customerId])
                  .then(function() { return client.query('INSERT INTO wallet_transactions(user_id,amount,type,description) VALUES($1,$2,$3,$4)', [customerId, -wallet_used, 'payment', 'Wallet used for order']); });
              }
            })
          : Promise.resolve()
        ).then(function() {
          var cashback_amt = Math.round(geo.computeCashback(subtotal, shop)*100)/100;
          var payNow = data.payment_method === 'wallet' || data.payment_method === 'upi' || data.payment_method === 'card';
          var delivery_otp = String(Math.floor(1000 + Math.random() * 9000));
          return client.query(
            'INSERT INTO orders(shop_id,customer_id,status,payment_status,payment_method,subtotal,gst_amount,delivery_charge,wallet_used,cashback_amount,total,delivery_otp,delivery_address,delivery_lat,delivery_lng,delivery_distance,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',
            [shopId, customerId, 'placed', payNow?'paid':'pending', data.payment_method||null,
             Math.round(subtotal*100)/100, Math.round(gst_total*100)/100, del_charge, wallet_used, cashback_amt,
             total-wallet_used, delivery_otp, JSON.stringify(data.delivery_address||null),
             data.delivery_lat||null, data.delivery_lng||null, distance_km, data.notes||null]
          ).then(function(r) {
            var order = r.rows[0];
            return lineItems.reduce(function(chain, li) {
              return chain.then(function() {
                return client.query('INSERT INTO order_items(order_id,product_id,name,price,mrp,gst_percent,gst_amount,qty,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
                  [order.id, li.product_id, li.name, li.price, li.mrp||null, li.gst_percent, li.gst_amount, li.qty, li.total]);
              });
            }, Promise.resolve()).then(function() {
              if (payNow && cashback_amt > 0) {
                return client.query('INSERT INTO scratch_cards(user_id,shop_id,order_id,amount) VALUES($1,$2,$3,$4)', [customerId, shopId, order.id, cashback_amt]);
              }
            }).then(function() { return Object.assign({}, order, { line_items: lineItems }); });
          });
        });
      });
    });
  },

  getOrder: function(id) {
    return db.one('SELECT o.*, s.name as shop_name, u.name as customer_name, u.phone as customer_phone FROM orders o JOIN shops s ON s.id=o.shop_id JOIN users u ON u.id=o.customer_id WHERE o.id=$1', [id])
      .then(function(order) {
        if (!order) return null;
        return db.many('SELECT * FROM order_items WHERE order_id=$1', [id]).then(function(items) {
          order.items = items;
          return order;
        });
      });
  },

  listForCustomer: function(customerId, opts) {
    opts = opts || {};
    var page = opts.page || 1, limit = opts.limit || 20;
    return db.many('SELECT o.*, s.name as shop_name, s.logo_url as shop_logo FROM orders o JOIN shops s ON s.id=o.shop_id WHERE o.customer_id=$1 ORDER BY o.placed_at DESC LIMIT $2 OFFSET $3',
      [customerId, limit, (page-1)*limit]);
  },

  listForShop: function(shopId, opts) {
    opts = opts || {};
    var page = opts.page || 1, limit = opts.limit || 50;
    var q = 'SELECT o.*, u.name as customer_name, u.phone as customer_phone FROM orders o JOIN users u ON u.id=o.customer_id WHERE o.shop_id=$1';
    var params = [shopId];
    if (opts.status) { params.push(opts.status); q += ' AND o.status=$' + params.length; }
    q += ' ORDER BY o.placed_at DESC LIMIT $' + (params.length+1) + ' OFFSET $' + (params.length+2);
    params.push(limit, (page-1)*limit);
    return db.many(q, params);
  },

  advance: function(orderId, newStatus, extra) {
    extra = extra || {};
    var allowed = { placed:'confirmed', confirmed:'packed', packed:'assigned', assigned:'picked_up', picked_up:'delivered' };
    return db.one('SELECT * FROM orders WHERE id=$1', [orderId]).then(function(order) {
      if (!order) throw new Error('Order not found');
      if (allowed[order.status] !== newStatus) throw new Error('Cannot move from ' + order.status + ' to ' + newStatus);
      if (newStatus === 'delivered') {
        if (!extra.otp) throw new Error('Delivery OTP required');
        if (extra.otp !== order.delivery_otp) throw new Error('Wrong delivery OTP');
      }
      var timeMap = { confirmed:'confirmed_at', packed:'packed_at', assigned:'assigned_at', picked_up:'picked_at', delivered:'delivered_at' };
      if (extra.agentId) {
        return db.one('UPDATE orders SET status=$2,' + timeMap[newStatus] + '=now(),agent_id=$3 WHERE id=$1 RETURNING *', [orderId, newStatus, extra.agentId]);
      }
      return db.one('UPDATE orders SET status=$2,' + timeMap[newStatus] + '=now() WHERE id=$1 RETURNING *', [orderId, newStatus]);
    });
  },

  cancel: function(orderId) {
    return ordersService.getOrder(orderId).then(function(order) {
      if (!order) throw new Error('Order not found');
      if (order.status === 'delivered' || order.status === 'cancelled') throw new Error('Cannot cancel');
      return db.transaction(function(client) {
        return client.query(
          'UPDATE orders SET status=$1,cancelled_at=now(),refund_status=$2,refunded_amount=$3 WHERE id=$4',
          ['cancelled', order.payment_status==='paid'?'full':'none', order.payment_status==='paid'?order.total:0, orderId]
        ).then(function() {
          return order.items.reduce(function(chain, item) {
            return chain.then(function() { return client.query('UPDATE products SET stock=stock+$1 WHERE id=$2', [item.qty, item.product_id]); });
          }, Promise.resolve());
        }).then(function() {
          if (order.payment_status !== 'paid') return;
          var split = refundUtil.refundSplit(order, Number(order.total));
          var p = split.walletRefund > 0
            ? client.query('UPDATE wallets SET balance=balance+$1 WHERE user_id=$2', [split.walletRefund, order.customer_id])
                .then(function() { return client.query('INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,$3,$4,$5)', [order.customer_id, split.walletRefund, 'refund', 'Order cancelled - wallet refund', orderId]); })
            : Promise.resolve();
          return p.then(function() {
            if (split.sourceRefund <= 0) return;
            return client.query('INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status,scheduled_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [orderId, order.customer_id, split.sourceRefund, 'full', 'Order cancelled', 'source', 'pending', split.schedDate]);
          }).then(function() {
            return client.query('UPDATE scratch_cards SET voided=true WHERE order_id=$1 AND collected=false', [orderId]);
          });
        }).then(function() { return { cancelled: true }; });
      });
    });
  },

  issueRefund: function(orderId, adminId, data) {
    var amount = Number(data.amount);
    var reason = data.reason;
    return ordersService.getOrder(orderId).then(function(order) {
      if (!order) throw new Error('Order not found');
      var maxRefund = Number(order.total) - Number(order.refunded_amount || 0);
      if (amount > maxRefund) throw new Error('Max refundable: ' + maxRefund);
      return db.transaction(function(client) {
        var newRefunded = Number(order.refunded_amount || 0) + amount;
        var newStatus = newRefunded >= Number(order.total) ? 'full' : 'partial';
        return client.query('UPDATE orders SET refunded_amount=$1,refund_status=$2 WHERE id=$3', [newRefunded, newStatus, orderId])
          .then(function() {
            var split = refundUtil.refundSplit(order, amount);
            var p = split.walletRefund > 0
              ? client.query('UPDATE wallets SET balance=balance+$1 WHERE user_id=$2', [split.walletRefund, order.customer_id])
                  .then(function() { return client.query('INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,$3,$4,$5)', [order.customer_id, split.walletRefund, 'refund', reason, orderId]); })
                  .then(function() { return client.query('INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status) VALUES($1,$2,$3,$4,$5,$6,$7)', [orderId, order.customer_id, split.walletRefund, data.type||'partial', reason, 'wallet', 'processed']); })
              : Promise.resolve();
            return p.then(function() {
              if (split.sourceRefund <= 0) return;
              return client.query('INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status,scheduled_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
                [orderId, order.customer_id, split.sourceRefund, data.type||'partial', reason, 'source', 'pending', split.schedDate]);
            });
          })
          .then(function() { return { refunded: true, amount: amount }; });
      });
    });
  },

  markPaid: function(orderId, method) {
    method = method || 'cod';
    return db.one('SELECT * FROM orders WHERE id=$1', [orderId]).then(function(order) {
      if (!order) throw new Error('Order not found');
      if (order.status === 'cancelled') throw new Error('Cannot mark a cancelled order as paid');
      if (order.payment_status === 'paid') throw new Error('Order is already marked as paid');
      return db.query('UPDATE orders SET payment_status=$1,payment_method=$2 WHERE id=$3', ['paid', method, orderId])
        .then(function() {
          return db.one('SELECT id FROM scratch_cards WHERE order_id=$1', [orderId])
            .then(function(existing) {
              if (existing) return null;
              return db.one('SELECT * FROM shops WHERE id=$1', [order.shop_id]).then(function(shop) {
                if (!shop || shop.cashback_value <= 0) return null;
                var cashback = shop.cashback_type === 'percent'
                  ? Math.min(Number(order.subtotal) * shop.cashback_value / 100, shop.cashback_max)
                  : Math.min(shop.cashback_value, shop.cashback_max);
                cashback = Math.round(cashback * 100) / 100;
                if (cashback <= 0) return null;
                return db.query('INSERT INTO scratch_cards(user_id,shop_id,order_id,amount) VALUES($1,$2,$3,$4)',
                  [order.customer_id, order.shop_id, orderId, cashback]);
              });
            });
        })
        .then(function() { return db.one('SELECT * FROM orders WHERE id=$1', [orderId]); });
    });
  }

};

module.exports = ordersService;
