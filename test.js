// Smoke test of the guardrails: node test.js
const assert = require('assert'), api = require('./api/index.js');
const call = (method, url, b) => new Promise((ok) => { const req = require('stream').Readable.from(b ? [JSON.stringify(b)] : []); Object.assign(req, { method, url, headers: { host: 'x' } });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(d) { ok({ code: this.statusCode, json: d && this.headers['content-type'] ? JSON.parse(d) : null, headers: this.headers }); } }; api(req, res); });
(async () => {
  let r = await call('POST', '/api/invoices/INV-101/negotiate', { message: 'Can I get 20% off?' });
  assert.equal(r.json.offer.pct, 8); assert(r.json.offer.countered); // capped by mandate
  r = await call('POST', '/api/invoices/INV-101/negotiate', { message: 'split into 6 payments please' });
  assert.equal(r.json.offer.n, 3); assert.equal(+r.json.offer.parts.reduce((a, b) => a + b, 0).toFixed(2), 1200); assert(r.json.offer.parts[0] >= 408);
  r = await call('POST', '/api/invoices/INV-102/accept', { intent: { type: 'discount', discountAsk: 50 } });
  assert.equal(r.json.offer.parts[0], 588.8); // 8% max, re-validated server-side
  const cap = await call('GET', r.json.orders[0].url.replace('http://x', ''));
  assert.equal(cap.code, 302); r = await call('GET', '/api/invoices/INV-102'); assert.equal(r.json.outstanding, 0);
  console.log('all checks passed');
})();
