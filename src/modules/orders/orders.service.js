const db = require('../../core/db/client');
const { computeCashback } = require('../../utils/geo');
const { refundSplit, t7date } = require('../../utils/refund');

const ordersService = {
  async place(customerId, shopId, data) {
    const { items, payment_method, wallet_use, delivery_address, delivery_lat, delivery_lng, notes } = data;

    return db.transaction(async (client) => {
      // 1. Load shop
      const shop = await client.query(`SELECT * FROM shops WHERE id=$1 AND is_active=true`, [shopId]).then(r => r.rows[0]);
      if (!shop) throw new Error('Shop not found or inactive');
      if (shop.blocked_at) throw new Error('Shop is currently unavailable');

      // 2. Check customer block
      const blocked = await client.query(`SELECT id FROM shop_customer_blocks WHERE shop_id=$1 AND customer_id=$2`, [shopId, customerId]).then(r => r.rows[0]);
      if (blocked) throw new Error('You are restricted from ordering at this store');

      // 3. Build line items, reserve stock
      let subtotal = 0, gst_total = 0;
      const lineItems = [];
      for (const item of items) {
        const p = await client.query(`SELECT * FROM products WHERE id=$1 AND shop_id=$2 AND is_active=true FOR UPDATE`, [item.product_id, shopId]).then(r => r.rows[0]);
        if (!p) throw new Error(`Product not found: ${item.product_id}`);
        if (p.stock < item.qty) throw new Error(`Only ${p.stock} units of "${p.name}" available`);
        await client.query(`UPDATE products SET stock=stock-$1 WHERE id=$2`, [item.qty, p.id]);
        const gst_pct = p.gst_percent || shop.gst_percent;
        const line_total = Math.round(p.price * item.qty * 100) / 100;
        const gst_amt = Math.round(line_total * gst_pct / (100 + gst_pct) * 100) / 100;
        subtotal += line_total;
        gst_total += gst_amt;
        lineItems.push({ product_id: p.id, name: p.name, price: p.price, mrp: p.mrp, gst_percent: gst_pct, gst_amount: gst_amt, qty: item.qty, total: line_total });
      }

      // 4. Delivery charge
      let del_charge = 0, distance_km = null;
      if (delivery_lat && delivery_lng && shop.lat && shop.lng) {
        const { distanceKm, deliveryCharge } = require('../../utils/geo');
        distance_km = Math.round(distanceKm(delivery_lat, delivery_lng, shop.lat, shop.lng) * 10) / 10;
        del_charge = deliveryCharge(distance_km, shop.delivery_tiers);
      }

      const total = Math.round((subtotal + del_charge) * 100) / 100;

      // 5. Wallet deduction
      let wallet_used = 0;
      if (wallet_use && wallet_use > 0) {
        const wallet = await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [customerId]).then(r => r.rows[0]);
        wallet_used = Math.min(wallet?.balance || 0, wallet_use, total);
        if (wallet_used > 0) {
          await client.query(`UPDATE wallets SET balance=balance-$1 WHERE user_id=$2`, [wallet_used, customerId]);
          await client.query(`INSERT INTO wallet_transactions(user_id,amount,type,description) VALUES($1,$2,'payment','Wallet used for order')`, [customerId, -wallet_used]);
        }
      }

      // 6. Cashback
      const cashback_amt = Math.round(computeCashback(subtotal, shop) * 100) / 100;

      // 7. Delivery OTP
      const delivery_otp = String(Math.floor(1000 + Math.random() * 9000));

      const payNow = payment_method === 'wallet' || payment_method === 'upi' || payment_method === 'card';

      // 8. Create order
      const order = await client.query(`
        INSERT INTO orders(shop_id,customer_id,status,payment_status,payment_method,subtotal,gst_amount,delivery_charge,wallet_used,cashback_amount,total,delivery_otp,delivery_address,delivery_lat,delivery_lng,delivery_distance,notes)
        VALUES($1,$2,'placed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [shopId, customerId, payNow ? 'paid' : 'pending', payment_method,
         Math.round(subtotal*100)/100, Math.round(gst_total*100)/100, del_charge,
         wallet_used, cashback_amt, total - wallet_used,
         delivery_otp, JSON.stringify(delivery_address), delivery_lat, delivery_lng, distance_km, notes]
      ).then(r => r.rows[0]);

      // 9. Insert line items
      for (const li of lineItems) {
        await client.query(`INSERT INTO order_items(order_id,product_id,name,price,mrp,gst_percent,gst_amount,qty,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [order.id, li.product_id, li.name, li.price, li.mrp, li.gst_percent, li.gst_amount, li.qty, li.total]);
      }

      // 10. Issue scratch card if paid
      if (payNow && cashback_amt > 0) {
        await client.query(`INSERT INTO scratch_cards(user_id,shop_id,order_id,amount) VALUES($1,$2,$3,$4)`,
          [customerId, shopId, order.id, cashback_amt]);
      }

      return { ...order, line_items: lineItems };
    });
  },

  async getOrder(id, withItems = true) {
    const order = await db.one(`SELECT o.*, s.name as shop_name, s.logo_url as shop_logo, u.name as customer_name, u.phone as customer_phone FROM orders o JOIN shops s ON s.id=o.shop_id JOIN users u ON u.id=o.customer_id WHERE o.id=$1`, [id]);
    if (!order) return null;
    if (withItems) {
      order.items = await db.many(`SELECT * FROM order_items WHERE order_id=$1`, [id]);
    }
    return order;
  },

  async listForCustomer(customerId, { page=1, limit=20 } = {}) {
    return db.many(`SELECT o.*, s.name as shop_name, s.logo_url as shop_logo FROM orders o JOIN shops s ON s.id=o.shop_id WHERE o.customer_id=$1 ORDER BY o.placed_at DESC LIMIT $2 OFFSET $3`,
      [customerId, limit, (page-1)*limit]);
  },

  async listForShop(shopId, { status, page=1, limit=50 } = {}) {
    let q = `SELECT o.*, u.name as customer_name, u.phone as customer_phone FROM orders o JOIN users u ON u.id=o.customer_id WHERE o.shop_id=$1`;
    const params = [shopId];
    if (status) { params.push(status); q += ` AND o.status=$${params.length}`; }
    q += ` ORDER BY o.placed_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, (page-1)*limit);
    return db.many(q, params);
  },

  async advance(orderId, newStatus, extra = {}) {
    const allowed = { placed:'confirmed', confirmed:'packed', packed:'assigned', assigned:'picked_up', picked_up:'delivered' };
    const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [orderId]);
    if (!order) throw new Error('Order not found');
    if (allowed[order.status] !== newStatus) throw new Error(`Cannot move from ${order.status} to ${newStatus}`);
    if (newStatus === 'delivered') {
      if (!extra.otp) throw new Error('Delivery OTP required');
      if (extra.otp !== order.delivery_otp) throw new Error('Wrong delivery OTP');
    }
    const timeCol = { confirmed:'confirmed_at', packed:'packed_at', assigned:'assigned_at', picked_up:'picked_at', delivered:'delivered_at' };
    const agentSet = extra.agentId ? `, agent_id='${extra.agentId}'` : '';
    return db.one(`UPDATE orders SET status=$2, ${timeCol[newStatus]}=now()${agentSet} WHERE id=$1 RETURNING *`, [orderId, newStatus]);
  },

  async cancel(orderId, cancelledBy) {
    const order = await ordersService.getOrder(orderId);
    if (!order) throw new Error('Order not found');
    if (['delivered','cancelled'].includes(order.status)) throw new Error('Cannot cancel this order');

    return db.transaction(async (client) => {
      // Mark cancelled
      await client.query(`UPDATE orders SET status='cancelled',cancelled_at=now(),refund_status=$1,refunded_amount=$2 WHERE id=$3`,
        [order.payment_status==='paid'?'full':'none', order.payment_status==='paid'?order.total:0, orderId]);

      // Restore stock
      for (const item of order.items) {
        await client.query(`UPDATE products SET stock=stock+$1 WHERE id=$2`, [item.qty, item.product_id]);
      }

      // Refund if paid
      if (order.payment_status === 'paid') {
        const split = refundSplit(order, Number(order.total));
        if (split.walletRefund > 0) {
          await client.query(`UPDATE wallets SET balance=balance+$1 WHERE user_id=$2`, [split.walletRefund, order.customer_id]);
          await client.query(`INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,'refund','Order cancelled — wallet refund',$3)`, [order.customer_id, split.walletRefund, orderId]);
        }
        if (split.sourceRefund > 0) {
          await client.query(`INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status,scheduled_date) VALUES($1,$2,$3,'full','Order cancelled','source','pending',$4)`,
            [orderId, order.customer_id, split.sourceRefund, split.schedDate]);
        }
        // Void scratch card
        await client.query(`UPDATE scratch_cards SET voided=true WHERE order_id=$1 AND collected=false`, [orderId]);
        // If card already collected, debit customer + credit shop merchant
        const collected = await client.query(`SELECT * FROM scratch_cards WHERE order_id=$1 AND collected=true AND voided=false`, [orderId]).then(r => r.rows[0]);
        if (collected) {
          const amt = Number(collected.amount);
          await client.query(`UPDATE wallets SET balance=balance-$1 WHERE user_id=$2`, [amt, order.customer_id]);
          await client.query(`INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,'reversal','Cashback reversed — order cancelled',$3)`, [order.customer_id, -amt, orderId]);
          // Credit admin of shop
          const shop = await client.query(`SELECT merchant_id FROM shops WHERE id=$1`, [order.shop_id]).then(r => r.rows[0]);
          if (shop) {
            await client.query(`UPDATE wallets SET balance=balance+$1 WHERE user_id=$2`, [amt, shop.merchant_id]);
            await client.query(`INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,'adjustment','Cashback recovered',$3)`, [shop.merchant_id, amt, orderId]);
          }
          await client.query(`UPDATE scratch_cards SET voided=true WHERE id=$1`, [collected.id]);
        }
      }
      return { cancelled: true };
    });
  },

  async issueRefund(orderId, adminId, { amount, type, reason }) {
    const order = await ordersService.getOrder(orderId);
    if (!order) throw new Error('Order not found');
    const maxRefund = Number(order.total) - Number(order.refunded_amount);
    if (amount > maxRefund) throw new Error(`Max refundable: ${maxRefund}`);

    return db.transaction(async (client) => {
      const newRefunded = Number(order.refunded_amount) + amount;
      const newStatus = newRefunded >= Number(order.total) ? 'full' : 'partial';
      await client.query(`UPDATE orders SET refunded_amount=$1,refund_status=$2 WHERE id=$3`, [newRefunded, newStatus, orderId]);
      
      const split = refundSplit(order, amount);
      if (split.walletRefund > 0) {
        await client.query(`UPDATE wallets SET balance=balance+$1 WHERE user_id=$2`, [split.walletRefund, order.customer_id]);
        await client.query(`INSERT INTO wallet_transactions(user_id,amount,type,description,order_id) VALUES($1,$2,'refund',$3,$4)`, [order.customer_id, split.walletRefund, `Refund: ${reason}`, orderId]);
        await client.query(`INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status) VALUES($1,$2,$3,$4,$5,'wallet','processed')`,
          [orderId, order.customer_id, split.walletRefund, type, reason]);
      }
      if (split.sourceRefund > 0) {
        await client.query(`INSERT INTO refunds(order_id,customer_id,amount,type,reason,destination,status,scheduled_date) VALUES($1,$2,$3,$4,$5,'source','pending',$6)`,
          [orderId, order.customer_id, split.sourceRefund, type, reason, split.schedDate]);
      }
      if (newStatus === 'full') {
        await client.query(`UPDATE scratch_cards SET voided=true WHERE order_id=$1 AND collected=false`, [orderId]);
      }
      return { refunded: true, split };
    });
  }
};

module.exports = ordersService;
