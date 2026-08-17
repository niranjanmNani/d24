// Pings the server every 14 minutes to prevent Render free tier from sleeping
// Only runs in production
if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
  const https = require('https');
  const url = process.env.RENDER_EXTERNAL_URL + '/health';
  setInterval(() => {
    https.get(url, (res) => {
      console.log(`[keepalive] ${res.statusCode}`);
    }).on('error', () => {});
  }, 14 * 60 * 1000); // every 14 minutes
  console.log('[keepalive] Active — pinging', url);
}
