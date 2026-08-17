const db = require('../../core/db/client');

const productsService = {
  async list(shopId, { category, search, page = 1, limit = 50 } = {}) {
    let q = `SELECT p.*, COALESCE(json_agg(pi.url ORDER BY pi.sort_order) FILTER (WHERE pi.id IS NOT NULL),'[]') as images
             FROM products p LEFT JOIN product_images pi ON pi.product_id=p.id
             WHERE p.shop_id=$1 AND p.is_active=true`;
    const params = [shopId];
    if (category) { params.push(category); q += ` AND p.category=$${params.length}`; }
    if (search)   { params.push(`%${search}%`); q += ` AND p.name ILIKE $${params.length}`; }
    q += ` GROUP BY p.id ORDER BY p.sort_order, p.name LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, (page-1)*limit);
    return db.many(q, params);
  },

  async getById(id) {
    return db.one(`SELECT p.*, COALESCE(json_agg(pi.url ORDER BY pi.sort_order) FILTER (WHERE pi.id IS NOT NULL),'[]') as images
                   FROM products p LEFT JOIN product_images pi ON pi.product_id=p.id
                   WHERE p.id=$1 GROUP BY p.id`, [id]);
  },

  async create(shopId, data) {
    return db.one(
      `INSERT INTO products(shop_id,name,description,brand,category,barcode,price,mrp,gst_percent,stock,low_stock_at,unit,sort_order)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [shopId, data.name, data.description, data.brand, data.category, data.barcode,
       data.price, data.mrp, data.gst_percent||0, data.stock||0, data.low_stock_at||5,
       data.unit||'piece', data.sort_order||0]
    );
  },

  async update(id, data) {
    const allowed = ['name','description','brand','category','barcode','price','mrp','gst_percent','stock','low_stock_at','unit','sort_order','is_active'];
    const fields = Object.keys(data).filter(k => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f,i) => `${f}=$${i+2}`).join(',');
    return db.one(`UPDATE products SET ${sets} WHERE id=$1 RETURNING *`, [id, ...fields.map(f => data[f])]);
  },

  async addImages(productId, urls) {
    // Max 5 images total
    const existing = await db.many(`SELECT id FROM product_images WHERE product_id=$1`, [productId]);
    if (existing.length + urls.length > 5) throw new Error('Maximum 5 images per product');
    const startOrder = existing.length;
    const rows = await Promise.all(urls.map((url, i) =>
      db.one(`INSERT INTO product_images(product_id,url,sort_order) VALUES($1,$2,$3) RETURNING *`,
             [productId, url, startOrder + i])
    ));
    return rows;
  },

  async removeImage(imageId, productId) {
    return db.query(`DELETE FROM product_images WHERE id=$1 AND product_id=$2`, [imageId, productId]);
  },

  async reorderImages(productId, orderedIds) {
    await Promise.all(orderedIds.map((id, i) =>
      db.query(`UPDATE product_images SET sort_order=$1 WHERE id=$2 AND product_id=$3`, [i, id, productId])
    ));
  },

  async lookupBarcode(barcode, shopId) {
    return db.one(`SELECT * FROM products WHERE barcode=$1 AND shop_id=$2`, [barcode, shopId]);
  },

  async adjustStock(productId, delta, client = db) {
    const p = await client.one(`UPDATE products SET stock=stock+$1 WHERE id=$2 RETURNING stock`, [delta, productId]);
    return p;
  },

  async getLowStock(shopId) {
    return db.many(`SELECT * FROM products WHERE shop_id=$1 AND stock<=low_stock_at AND is_active=true ORDER BY stock`, [shopId]);
  }
};

module.exports = productsService;
