var db = require('../../core/db/client');

var productsService = {
  list: function(shopId, opts) {
    opts = opts || {};
    var page = opts.page || 1, limit = opts.limit || 50;
    var q = 'SELECT p.*, COALESCE(json_agg(pi.url ORDER BY pi.sort_order) FILTER (WHERE pi.id IS NOT NULL),\'[]\') as images FROM products p LEFT JOIN product_images pi ON pi.product_id=p.id WHERE p.shop_id=$1 AND p.is_active=true';
    var params = [shopId];
    if (opts.category) { params.push(opts.category); q += ' AND p.category=$' + params.length; }
    if (opts.search) { params.push('%'+opts.search+'%'); q += ' AND p.name ILIKE $' + params.length; }
    q += ' GROUP BY p.id ORDER BY p.sort_order,p.name LIMIT $' + (params.length+1) + ' OFFSET $' + (params.length+2);
    params.push(limit, (page-1)*limit);
    return db.many(q, params);
  },
  getById: function(id) {
    return db.one('SELECT p.*, COALESCE(json_agg(pi.url ORDER BY pi.sort_order) FILTER (WHERE pi.id IS NOT NULL),\'[]\') as images FROM products p LEFT JOIN product_images pi ON pi.product_id=p.id WHERE p.id=$1 GROUP BY p.id', [id]);
  },
  create: function(shopId, data) {
    return db.one('INSERT INTO products(shop_id,name,description,brand,category,barcode,price,mrp,gst_percent,stock,low_stock_at,unit,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [shopId, data.name, data.description||null, data.brand||null, data.category||null, data.barcode||null, data.price, data.mrp||null, data.gst_percent||0, data.stock||0, data.low_stock_at||5, data.unit||'piece', data.sort_order||0]);
  },
  update: function(id, data) {
    var allowed = ['name','description','brand','category','barcode','price','mrp','gst_percent','stock','low_stock_at','unit','sort_order','is_active'];
    var fields = Object.keys(data).filter(function(k){ return allowed.indexOf(k)!==-1; });
    if (!fields.length) return Promise.resolve(null);
    var sets = fields.map(function(f,i){ return f+'=$'+(i+2); }).join(',');
    return db.one('UPDATE products SET '+sets+' WHERE id=$1 RETURNING *', [id].concat(fields.map(function(f){ return data[f]; })));
  },
  addImages: function(productId, urls) {
    return db.many('SELECT id FROM product_images WHERE product_id=$1', [productId]).then(function(existing) {
      if (existing.length + urls.length > 5) throw new Error('Maximum 5 images per product');
      var startOrder = existing.length;
      return Promise.all(urls.map(function(url, i) {
        return db.one('INSERT INTO product_images(product_id,url,sort_order) VALUES($1,$2,$3) RETURNING *', [productId, url, startOrder+i]);
      }));
    });
  },
  removeImage: function(imageId, productId) {
    return db.query('DELETE FROM product_images WHERE id=$1 AND product_id=$2', [imageId, productId]);
  },
  lookupBarcode: function(barcode, shopId) {
    return db.one('SELECT * FROM products WHERE barcode=$1 AND shop_id=$2', [barcode, shopId]);
  },
  getLowStock: function(shopId) {
    return db.many('SELECT * FROM products WHERE shop_id=$1 AND stock<=low_stock_at AND is_active=true ORDER BY stock', [shopId]);
  }
};
module.exports = productsService;
