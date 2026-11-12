'use strict';
// Simulated demo: `npm run demo` (or `node demo.js`).
// Runs the normal app with an in-process fake PayPal Sandbox and a canned AI answer.
// Nothing here touches the network, reads PayPal keys, or needs a local model.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || 8787);
const origin = 'http://127.0.0.1:' + port;
const SB = 'https://www.sandbox.paypal.com/checkoutnow?token=';
const BRIEF = 'We are the Saltmarsh Maritime Museum. We want to print The Tidal Archive on the cover of our spring exhibition guide. We are printing 600 copies, and it will run for six months from March. We will credit the artist on the inside cover. We do not need exclusive rights, and it will not be used to train any model.';

// Replace the whole environment the app reads: fake credentials, fake model URL, throwaway data.
for (const key of Object.keys(process.env)) if (/^(PAYPAL_|OLLAMA_|LICENSELANE_|BRIEF_|CREATOR_)/.test(key)) Reflect.deleteProperty(process.env, key);
Object.assign(process.env, {
  HOST: '127.0.0.1', PORT: String(port), PAYPAL_CLIENT_ID: 'SIMULATED', PAYPAL_CLIENT_SECRET: 'SIMULATED',
  OLLAMA_URL: 'http://127.0.0.1:1', OLLAMA_MODEL: 'simulated-canned-answer',
  LICENSELANE_DATA: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'licenselane-demo-')), 'licenses.json')
});

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- fake PayPal: token, create order, get order, capture ----
const orders = new Map();
const payPal = async (method, pathname, body) => {
  if (pathname === '/v1/oauth2/token')
    return json({ scope: 'https://uri.paypal.com/services/payments/payment', access_token: 'SIMULATED-ACCESS-TOKEN', token_type: 'Bearer', app_id: 'APP-SIMULATED', expires_in: 32400, nonce: 'simulated' });
  if (method === 'POST' && pathname === '/v2/checkout/orders') {
    const unit = body.purchase_units[0], id = 'SIM' + crypto.randomBytes(7).toString('hex').toUpperCase();
    orders.set(id, { id, status: 'CREATED', unit, captures: [] });
    return json({ id, status: 'PAYER_ACTION_REQUIRED', links: [
      { href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/' + id, rel: 'self', method: 'GET' },
      { href: SB + id, rel: 'payer-action', method: 'GET' }] }, 201);
  }
  const m = pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/), o = m && orders.get(m[1]);
  if (!o) return json({ name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' }, 404);
  const view = () => ({ id: o.id, intent: 'CAPTURE', status: o.status,
    purchase_units: [{ reference_id: o.unit.reference_id, custom_id: o.unit.custom_id, description: o.unit.description, amount: o.unit.amount, ...(o.captures.length ? { payments: { captures: o.captures } } : {}) }] });
  if (method === 'GET' && !m[2]) return json(view());
  if (method === 'POST' && m[2]) {
    if (o.status !== 'APPROVED') return json({ name: 'UNPROCESSABLE_ENTITY', message: 'Order not approved', details: [{ issue: 'ORDER_NOT_APPROVED' }] }, 422);
    o.captures = [{ id: 'SIMCAP' + crypto.randomBytes(5).toString('hex').toUpperCase(), status: 'COMPLETED', amount: o.unit.amount, final_capture: true }];
    o.status = 'COMPLETED';
    return json(view(), 201);
  }
  return json({ name: 'NOT_FOUND' }, 404);
};

// ---- canned AI answer: an Ollama /api/chat reply in the same shape the real call returns ----
// The fixed rule reads the numbered source passages the app sends and answers only where a passage says it.
const model = async body => {
  if (body.messages?.[0]?.images) return json({ error: 'Simulated demo: no vision model is running' }, 503);
  await wait(1200);
  const passages = JSON.parse(body.messages[1].content.split('BUYER SOURCE PASSAGES:\n')[1]);
  const allowed = field => body.format.properties[field].anyOf?.find(x => x.type === 'object')?.properties.s.enum || [];
  const find = (field, test) => { for (const [i, text] of passages) if (allowed(field).includes(i) && test(text)) return i; return null; };
  const pick = (field, test, value) => { const s = find(field, test); return s === null ? null : { v: value(passages[s][1]), s }; };
  const content = {
    medium: pick('medium', t => /\bprint/i.test(t), () => 'print'),
    copies: pick('copies', t => /\d[\d,]*\s+copies/i.test(t), t => Number(t.match(/(\d[\d,]*)\s+copies/i)[1].replace(/,/g, ''))),
    training: pick('training', t => /train/i.test(t), t => !/not be used to train|no model training/i.test(t)),
    exclusive: pick('exclusive', t => /exclusiv/i.test(t), t => !/not need exclusive|non-exclusive|no exclusiv/i.test(t)),
    attribution: pick('attribution', t => /credit|attribut/i.test(t), () => true)
  };
  return json({ model: 'simulated', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify(content) }, done: true, done_reason: 'stop', total_duration: 1200000000, eval_count: 60, prompt_eval_count: 300 });
};

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : undefined;
  if (u.hostname === 'api-m.sandbox.paypal.com') return payPal(init.method || 'GET', u.pathname, body);
  if (u.hostname === '127.0.0.1' && u.port === '1' && u.pathname === '/api/chat') return model(body);
  throw new TypeError('Simulated demo: network access is disabled (' + u.hostname + ')');
};

// ---- demo-only routes: approval page, badge assets, and the index with the badge ----
const { createApp } = require('./server.js');
const server = createApp();
const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'"; // same as server.js
const send = (res, status, type, text) => { res.writeHead(status, { 'Content-Type': type, 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(text); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const badgeJs = `(function(){
  var SB=${JSON.stringify(SB)};
  // The fake PayPal returns a realistic sandbox link (the page only accepts those); point it at the local approval page instead.
  function fix(){document.querySelectorAll('a[href^="'+SB+'"]').forEach(function(a){a.href="/demo/paypal/approve?order="+a.getAttribute("href").slice(SB.length);});}
  new MutationObserver(fix).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["href"]});fix();
  var b=document.createElement("div");b.className="sim-badge";b.setAttribute("role","note");b.textContent="Simulated demo: no real PayPal call";document.body.prepend(b);
  var t=document.getElementById("project-brief");
  if(t&&!t.value){t.value=${JSON.stringify(BRIEF)};t.dispatchEvent(new Event("input",{bubbles:true}));}
})();`;
const original = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', async (req, res) => {
  const url = new URL(req.url || '/', origin);
  if (req.method === 'GET' && url.pathname === '/demo-badge.css') return send(res, 200, 'text/css; charset=utf-8', fs.readFileSync(path.join(__dirname, 'demo-badge.css')));
  if (req.method === 'GET' && url.pathname === '/demo-badge.js') return send(res, 200, 'text/javascript; charset=utf-8', badgeJs);
  if (req.method === 'GET' && url.pathname === '/found.html') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'found.html'), 'utf8').replace('</body>', '<script src="/demo-badge.js" defer></script></body>').replace('</head>', '<link rel="stylesheet" href="/demo-badge.css"></head>');
    return send(res, 200, 'text/html; charset=utf-8', html);
  }
  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace('</body>', '<script src="/demo-badge.js" defer></script></body>').replace('</head>', '<link rel="stylesheet" href="/demo-badge.css"></head>');
    return send(res, 200, 'text/html; charset=utf-8', html);
  }
  if (url.pathname === '/demo/paypal/approve') {
    if (req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      const form = new URLSearchParams(raw), o = orders.get(form.get('order'));
      if (!o) return send(res, 404, 'text/plain', 'Unknown simulated order.');
      if (form.get('action') === 'approve' && o.status === 'CREATED') o.status = 'APPROVED';
      res.writeHead(303, { Location: '/#vault' }); return res.end();
    }
    const o = orders.get(url.searchParams.get('order'));
    if (!o) return send(res, 404, 'text/plain', 'Unknown simulated order.');
    return send(res, 200, 'text/html; charset=utf-8', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulated PayPal approval</title><link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head><body class="sim-page"><main class="sim-card"><h1>Simulated PayPal approval</h1><p>This page stands in for PayPal's hosted approval page. No real PayPal account or card is involved.</p><p><b>${esc(o.unit.description)}</b><br>$${esc(o.unit.amount.value)} ${esc(o.unit.amount.currency_code)}<br>Order ${esc(o.id)}</p><form method="post" action="/demo/paypal/approve"><input type="hidden" name="order" value="${esc(o.id)}"><button type="submit" name="action" value="approve" id="sim-approve">Approve</button> <button type="submit" name="action" value="cancel" class="sim-secondary">Cancel</button></form></main></body></html>`);
  }
  return original(req, res);
});
server.listen(port, '127.0.0.1', () => console.log('LicenseLane SIMULATED demo: ' + origin + '\nFake PayPal Sandbox and a canned AI answer; no keys, no model, no network.'));
