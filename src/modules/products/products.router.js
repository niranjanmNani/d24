var express = require('express');
var router = express.Router({ mergeParams: true });
var Joi = require('joi');
var validate = require('../../middleware/validate').validate;
var auth = require('../../middleware/auth');
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var upload = require('../../middleware/upload');
var storage = require('../../core/storage');
var productsService = require('./products.service');

router.get('/', function(req, res) {
  productsService.list(req.params.shopId, req.query)
    .then(function(p){ ok(res,p); }).catch(function(e){ err(res,e.message); });
});
router.get('/low-stock', auth.authenticate, auth.requireShopAccess, function(req,res) {
  productsService.getLowStock(req.params.shopId)
    .then(function(p){ ok(res,p); }).catch(function(e){ err(res,e.message); });
});
router.get('/barcode/:barcode', auth.authenticate, auth.requireShopAccess, function(req,res) {
  productsService.lookupBarcode(req.params.barcode, req.params.shopId)
    .then(function(p){ if(!p) return err(res,'Not found',404); ok(res,p); }).catch(function(e){ err(res,e.message); });
});
router.get('/:id', function(req,res) {
  productsService.getById(req.params.id)
    .then(function(p){ if(!p) return err(res,'Not found',404); ok(res,p); }).catch(function(e){ err(res,e.message); });
});
router.post('/', auth.authenticate, auth.requireShopAccess, validate(Joi.object({
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
})), function(req,res) {
  productsService.create(req.params.shopId, req.body)
    .then(function(p){ ok(res,p,201); }).catch(function(e){ err(res,e.message); });
});
router.patch('/:id', auth.authenticate, auth.requireShopAccess, function(req,res) {
  productsService.update(req.params.id, req.body)
    .then(function(p){ ok(res,p); }).catch(function(e){ err(res,e.message); });
});
router.post('/:id/images', auth.authenticate, auth.requireShopAccess, upload.array('images',5), function(req,res) {
  if (!req.files || !req.files.length) return err(res,'No images uploaded');
  storage.uploadProductImages(req.files)
    .then(function(urls){ return productsService.addImages(req.params.id, urls); })
    .then(function(imgs){ ok(res,imgs); }).catch(function(e){ err(res,e.message); });
});
router.delete('/:id/images/:imageId', auth.authenticate, auth.requireShopAccess, function(req,res) {
  productsService.removeImage(req.params.imageId, req.params.id)
    .then(function(){ ok(res,{deleted:true}); }).catch(function(e){ err(res,e.message); });
});
module.exports = router;
