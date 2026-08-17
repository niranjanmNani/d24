const express = require('express');
const router = express.Router({ mergeParams: true }); // inherit :shopId
const Joi = require('joi');
const { validate } = require('../../middleware/validate');
const { authenticate, requireShopAccess } = require('../../middleware/auth');
const { ok, err } = require('../../utils/response');
const upload = require('../../middleware/upload');
const storage = require('../../core/storage');
const productsService = require('./products.service');

// GET /api/shops/:shopId/products
router.get('/', async (req, res) => {
  try {
    const products = await productsService.list(req.params.shopId, req.query);
    ok(res, products);
  } catch (e) { err(res, e.message); }
});

// GET /api/shops/:shopId/products/low-stock
router.get('/low-stock', authenticate, requireShopAccess, async (req, res) => {
  try {
    const products = await productsService.getLowStock(req.params.shopId);
    ok(res, products);
  } catch (e) { err(res, e.message); }
});

// GET /api/shops/:shopId/products/barcode/:barcode
router.get('/barcode/:barcode', authenticate, requireShopAccess, async (req, res) => {
  try {
    const product = await productsService.lookupBarcode(req.params.barcode, req.params.shopId);
    if (!product) return err(res, 'Product not found', 404);
    ok(res, product);
  } catch (e) { err(res, e.message); }
});

// GET /api/shops/:shopId/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await productsService.getById(req.params.id);
    if (!product) return err(res, 'Product not found', 404);
    ok(res, product);
  } catch (e) { err(res, e.message); }
});

// POST /api/shops/:shopId/products
router.post('/', authenticate, requireShopAccess, validate(Joi.object({
  name: Joi.string().min(2).max(200).required(),
  description: Joi.string().max(500),
  brand: Joi.string().max(100),
  category: Joi.string().max(50),
  barcode: Joi.string().max(50),
  price: Joi.number().min(0).required(),
  mrp: Joi.number().min(0),
  gst_percent: Joi.number().min(0).max(28).default(0),
  stock: Joi.number().min(0).default(0),
  low_stock_at: Joi.number().min(0).default(5),
  unit: Joi.string().default('piece'),
  sort_order: Joi.number().default(0)
})), async (req, res) => {
  try {
    const product = await productsService.create(req.params.shopId, req.body);
    ok(res, product, 201);
  } catch (e) { err(res, e.message); }
});

// PATCH /api/shops/:shopId/products/:id
router.patch('/:id', authenticate, requireShopAccess, async (req, res) => {
  try {
    const product = await productsService.update(req.params.id, req.body);
    ok(res, product);
  } catch (e) { err(res, e.message); }
});

// POST /api/shops/:shopId/products/:id/images (up to 5)
router.post('/:id/images', authenticate, requireShopAccess, upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files?.length) return err(res, 'No images uploaded');
    const urls = await storage.uploadProductImages(req.files);
    const images = await productsService.addImages(req.params.id, urls);
    ok(res, images);
  } catch (e) { err(res, e.message); }
});

// DELETE /api/shops/:shopId/products/:id/images/:imageId
router.delete('/:id/images/:imageId', authenticate, requireShopAccess, async (req, res) => {
  try {
    await productsService.removeImage(req.params.imageId, req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e.message); }
});

// PATCH /api/shops/:shopId/products/:id/image-order
router.patch('/:id/image-order', authenticate, requireShopAccess, async (req, res) => {
  try {
    await productsService.reorderImages(req.params.id, req.body.ordered_ids);
    ok(res, { reordered: true });
  } catch (e) { err(res, e.message); }
});

module.exports = router;
