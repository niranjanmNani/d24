if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
  var https = require('https');
  var url = process.env.RENDER_EXTERNAL_URL + '/health';
  setInterval(function() {
    https.get(url, function(res) {
      console.log('[keepalive] ' + res.statusCode);
    }).on('error', function() {});
  }, 14 * 60 * 1000);
  console.log('[keepalive] Active — pinging ' + url);
}
