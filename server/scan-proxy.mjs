// Minimal Anthropic proxy for the "Цифры со скриншота" module.
// Reads ANTHROPIC_API_KEY from env, forwards /api/scan to api.anthropic.com.
// Key lives ONLY on the server — never exposed to the browser.
import http from 'node:http';

const PORT = process.env.SCAN_PROXY_PORT || 8787;
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.SCAN_PROXY_MODEL || 'claude-sonnet-4-6';

const server = http.createServer(async (req, res) => {
  // CORS (allow site origin; adjust if needed)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url !== '/api/scan' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'not found' } }));
  }
  if (!KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'server missing ANTHROPIC_API_KEY' } }));
  }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 12e6) req.destroy(); });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); } catch { res.writeHead(400); return res.end(JSON.stringify({ error: { message: 'bad json' } })); }
    // force server model unless caller overrode
    if (!payload.model) payload.model = MODEL;
    payload.max_tokens = payload.max_tokens || 1500;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload),
      });
      const buf = await r.text();
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'upstream error: ' + e.message } }));
    }
  });
});
server.listen(PORT, () => console.log('scan-proxy listening on ' + PORT));
