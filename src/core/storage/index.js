const Jimp = require('jimp');
const MAX_IMAGES = parseInt(process.env.MAX_PRODUCT_IMAGES) || 5;

const storage = {
  MAX_IMAGES,
  async compressImage(buffer, maxWidth, quality) {
    maxWidth = maxWidth || 800;
    quality = quality || 80;
    try {
      const image = await Jimp.read(buffer);
      if (image.bitmap.width > maxWidth) image.resize(maxWidth, Jimp.AUTO);
      image.quality(quality);
      const compressed = await image.getBufferAsync(Jimp.MIME_JPEG);
      return 'data:image/jpeg;base64,' + compressed.toString('base64');
    } catch (e) {
      return 'data:image/jpeg;base64,' + buffer.toString('base64');
    }
  },
  async uploadImage(buffer, folder, options) {
    options = options || {};
    return storage.compressImage(buffer, options.maxWidth, options.quality);
  },
  async uploadProductImages(files) {
    if (files.length > MAX_IMAGES) {
      throw new Error('Maximum ' + MAX_IMAGES + ' images allowed per product');
    }
    return Promise.all(files.map(function(f) {
      return storage.uploadImage(f.buffer, 'products', { maxWidth: 1200, quality: 85 });
    }));
  },
  async uploadAvatar(buffer) {
    return storage.uploadImage(buffer, 'avatars', { maxWidth: 400, quality: 90 });
  },
  async uploadShopImage(buffer, type) {
    return storage.uploadImage(buffer, 'shops', { maxWidth: 1000, quality: 85 });
  },
  async deleteImage(url) {
    return true;
  }
};

module.exports = storage;
