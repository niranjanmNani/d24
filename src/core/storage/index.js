const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = process.env.STORAGE_BUCKET || 'delivery24';
const MAX_IMAGES = parseInt(process.env.MAX_PRODUCT_IMAGES) || 5;

const storage = {
  MAX_IMAGES,

  async uploadImage(buffer, folder = 'general', options = {}) {
    const { maxWidth = 800, quality = 80 } = options;
    
    // Compress with sharp
    const compressed = await sharp(buffer)
      .resize(maxWidth, maxWidth, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();

    const filename = `${folder}/${uuidv4()}.jpg`;
    
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, compressed, { contentType: 'image/jpeg', upsert: false });

    if (error) throw error;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filename);
    return urlData.publicUrl;
  },

  async uploadProductImages(files) {
    if (files.length > MAX_IMAGES) {
      throw new Error(\`Maximum \${MAX_IMAGES} images allowed per product\`);
    }
    const urls = await Promise.all(
      files.map(f => storage.uploadImage(f.buffer, 'products', { maxWidth: 1200, quality: 85 }))
    );
    return urls;
  },

  async uploadAvatar(buffer) {
    return storage.uploadImage(buffer, 'avatars', { maxWidth: 400, quality: 90 });
  },

  async uploadShopImage(buffer, type = 'logo') {
    return storage.uploadImage(buffer, \`shops/\${type}\`, { maxWidth: 1000, quality: 85 });
  },

  async deleteImage(url) {
    const filename = url.split(\`/\${BUCKET}/\`)[1];
    if (!filename) return;
    await supabase.storage.from(BUCKET).remove([filename]);
  }
};

module.exports = storage;