// Zero-dependency smoke/invariant tests: node test.js
const assert = require('assert');
const api = require('./api/index.js');

const call = (method, url, body) => new Promise((resolve) => {
  const stream = require('stream').Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(stream, { method, url, headers: { host: 'localhost' } });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(data) { resolve({ code: this.statusCode, json: data && this.headers['content-type'] ? JSON.parse(data) : null, headers: this.headers }); } };
  Promise.resolve(api(stream, res)).catch((err) => resolve({ code: 500, json: { error: err.message } }));
});

(async () => {
  let r = await call('GET', '/api/health');
  assert.equal(r.code, 200); assert.equal(r.json.ok, true);

  r = await call('POST', '/api/invoices/INV-101/negotiate', { message: 'Can I get 20% off?' });
  assert.equal(r.code, 200); assert.equal(r.json.offer.pct, 8); assert(r.json.offer.countered);

  r = await call('POST', '/api/invoices/INV-101/negotiate', { message: 'split into 6 payments please' });
  assert.equal(r.code, 200); assert.equal(r.json.offer.n, 3);
  assert.equal(+r.json.offer.parts.reduce((a, b) => a + b, 0).toFixed(2), 1200);
  assert(r.json.offer.parts[0] >= 408);

  // Client-supplied money is ignored; the server recomputes from the mandate.
  r = await call('POST', '/api/invoices/INV-102/accept', { intent: { type: 'discount', discountAsk: 50 }, offer: { total: 1, parts: [1] } });
  assert.equal(r.code, 200); assert.equal(r.json.offer.parts[0], 588.8);
  assert.equal(r.json.offer.pct, 8); assert.equal(r.json.provider, 'mock');

  r = await call('GET', r.json.orders[0].url);
  assert.equal(r.code, 302);
  r = await call('GET', '/api/invoices/INV-102');
  assert.equal(r.code, 200); assert.equal(r.json.invoice.outstanding, 0);

  r = await call('POST', '/api/invoices/INV-102/accept', { intent: { type: 'discount', discountAsk: 1 } });
  assert.equal(r.code, 409);

  r = await call('POST', '/api/invoices/INV-101/negotiate', { message: '' });
  assert.equal(r.code, 400);

  console.log('all ChaseBot checks passed');
})();
