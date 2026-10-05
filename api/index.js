const crypto = require('crypto');

const invoices = {
  'INV-101': { id: 'INV-101', client: 'Acme Studio', amount: 1200, outstanding: 1200, due: '2026-09-15', mandate: { maxDiscountPct: 8, maxInstallments: 3, minFirstPaymentPct: 34 } },
  'INV-102': { id: 'INV-102', client: 'Northstar Labs', amount: 640, outstanding: 640, due: '2026-09-20', mandate: { maxDiscountPct: 8, maxInstallments: 3, minFirstPaymentPct: 34 } }
};

// Demo-only state. A production system should persist invoices/audit/order state in a database.
const audit = [];
const mockOrders = new Map();
const consumedOrders = new Set();

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function getInvoice(id) { return invoices[id] || null; }
function money(n) { return Math.round(Number(n) * 100) / 100; }

function parseIntent(message = '') {
  const text = String(message).toLowerCase();
  const discount = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const installments = text.match(/(?:in|into|over|across)\s*(\d+)\s*(?:payments?|installments?|parts?)/) || text.match(/(\d+)\s*(?:payments?|installments?|parts?)/);
  const wantsPlan = /payment|installment|split|parts?/.test(text);
  return {
    type: discount ? 'discount' : wantsPlan ? 'installments' : 'general',
    discountAsk: discount ? Number(discount[1]) : 0,
    installmentsAsk: installments ? Number(installments[1]) : 1,
    message: String(message).slice(0, 1000)
  };
}

async function llmIntent(message) {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  if (!base || !key) return null;
  const endpoint = base.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: process.env.LLM_MODEL || 'llama-3.1-8b-instant',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Extract negotiation intent as JSON only: {"type":"discount|installments|general","discountAsk":number,"installmentsAsk":number}. Never decide an offer, never invent financial terms.' },
      { role: 'user', content: String(message).slice(0, 1000) }
    ]
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: controller.signal });
    if (!r.ok) return null;
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const type = ['discount', 'installments', 'general'].includes(parsed.type) ? parsed.type : 'general';
    const discountAsk = Number(parsed.discountAsk || 0);
    const installmentsAsk = Number(parsed.installmentsAsk || 1);
    if (!Number.isFinite(discountAsk) || !Number.isFinite(installmentsAsk)) return null;
    return { type, discountAsk: Math.max(0, discountAsk), installmentsAsk: Math.max(1, installmentsAsk) };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function decide(invoice, intent) {
  const m = invoice.mandate;
  const askedDiscount = Math.min(100, Math.max(0, Number(intent.discountAsk || 0)));
  const askedN = Math.min(100, Math.max(1, Math.floor(Number(intent.installmentsAsk || 1))));
  const pct = Math.min(askedDiscount, m.maxDiscountPct);
  const n = Math.min(askedN, m.maxInstallments);
  const discounted = money(invoice.outstanding * (1 - pct / 100));
  const minimumFirst = money(invoice.outstanding * (m.minFirstPaymentPct / 100));
  const parts = Array.from({ length: n }, () => 0);
  if (n === 1) parts[0] = discounted;
  else {
    const first = Math.max(minimumFirst, money(discounted / n));
    if (first > discounted) return { pct: 0, n: 1, total: invoice.outstanding, parts: [invoice.outstanding], countered: true, limits: m, reason: 'Minimum first payment exceeds the discounted settlement.' };
    parts[0] = money(first);
    const remaining = money(discounted - first);
    for (let i = 1; i < n; i++) parts[i] = money(remaining / (n - 1));
    const delta = money(discounted - parts.reduce((a, b) => a + b, 0));
    parts[n - 1] = money(parts[n - 1] + delta);
  }
  return { pct, n, total: discounted, parts, countered: pct < askedDiscount || n < askedN, limits: m };
}

function answer(offer, intent) {
  if (intent.type === 'discount' && offer.countered) return `I can help with that. The account mandate allows up to ${offer.pct}% off, so I applied the maximum permitted discount.`;
  if (intent.type === 'installments' && offer.countered) return `I can split this into up to ${offer.n} payments under the account mandate. The first payment is ${offer.parts[0].toFixed(2)}.`;
  return `The approved plan is ${offer.n} payment${offer.n === 1 ? '' : 's'}, with ${offer.pct}% discount. The first payment is ${offer.parts[0].toFixed(2)}.`;
}

function addAudit(event, data) { audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), event, ...data }); }

function signingSecret() {
  return process.env.PAYPAL_CLIENT_SECRET || process.env.APP_SIGNING_SECRET || 'chasebot-local-demo-secret';
}

function signState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyState(value) {
  if (!value || !value.includes('.')) return null;
  const [encoded, sig] = value.split('.');
  const expected = crypto.createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

async function paypalToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) return null;
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!r.ok) throw new Error(`PayPal OAuth failed (${r.status})`);
  return (await r.json()).access_token;
}

async function createPayPalOrder(invoice, offer) {
  const token = await paypalToken();
  if (!token) return null;
  const appUrl = process.env.APP_URL;
  if (!appUrl || !/^https:\/\//i.test(appUrl)) throw new Error('APP_URL must be an HTTPS public URL for PayPal Sandbox checkout');
  const baseUrl = appUrl.replace(/\/$/, '');
  const state = signState({ invoice: invoice.id, amount: offer.parts[0], complete: offer.n === 1, exp: Date.now() + 15 * 60 * 1000 });
  const r = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: invoice.id, description: `ChaseBot settlement ${invoice.id}`, amount: { currency_code: 'USD', value: offer.parts[0].toFixed(2) } }],
      application_context: { brand_name: 'ChaseBot', user_action: 'PAY_NOW', return_url: `${baseUrl}/api/orders/return?state=${encodeURIComponent(state)}`, cancel_url: `${baseUrl}/api/orders/cancel` }
    })
  });
  if (!r.ok) throw new Error(`PayPal order creation failed (${r.status})`);
  return await r.json();
}

async function capturePayPalOrder(orderId, expectedAmount) {
  const token = await paypalToken();
  if (!token) return null;
  const r = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal capture failed (${r.status})`);
  const captured = Number(data?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value);
  if (!Number.isFinite(captured) || Math.abs(captured - Number(expectedAmount)) > 0.01) throw new Error('Captured amount does not match the server-approved amount');
  return data;
}

function mockOrder(invoice, offer) {
  const id = `MOCK-${crypto.randomUUID()}`;
  mockOrders.set(id, { id, invoiceId: invoice.id, amount: offer.parts[0], status: 'CREATED', complete: offer.n === 1, createdAt: Date.now() });
  return { id, status: 'CREATED', links: [{ rel: 'approve', href: `/api/orders/${id}` }] };
}

function applyPayment(invoice, orderId, amount, complete, provider) {
  if (consumedOrders.has(orderId)) return false;
  const safeAmount = money(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0 || safeAmount > invoice.outstanding + 0.01) throw new Error('Invalid payment amount');
  invoice.outstanding = complete ? 0 : money(invoice.outstanding - safeAmount);
  consumedOrders.add(orderId);
  addAudit('PAYMENT_CAPTURED', { invoiceId: invoice.id, orderId, amount: safeAmount, complete, provider });
  return true;
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'health') return json(res, 200, { ok: true, service: 'ChaseBot', mode: process.env.PAYPAL_CLIENT_ID ? 'paypal-sandbox' : 'mock', ai: Boolean(process.env.LLM_API_KEY) });
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'invoices' && parts[2]) {
      const invoice = getInvoice(parts[2]);
      if (!invoice) return json(res, 404, { error: 'Invoice not found' });
      return json(res, 200, { invoice, audit: audit.filter(x => x.invoiceId === invoice.id) });
    }
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'audit') return json(res, 200, { audit });

    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'invoices' && parts[3] === 'negotiate') {
      const invoice = getInvoice(parts[2]);
      if (!invoice) return json(res, 404, { error: 'Invoice not found' });
      const body = await readBody(req);
      const message = String(body.message || '').slice(0, 1000);
      if (!message.trim()) return json(res, 400, { error: 'Message is required' });
      const aiIntent = await llmIntent(message);
      const intent = aiIntent || parseIntent(message);
      const offer = decide(invoice, intent);
      const reply = answer(offer, intent);
      addAudit('NEGOTIATION', { invoiceId: invoice.id, intent, offer, source: aiIntent ? 'llm' : 'deterministic-fallback' });
      return json(res, 200, { invoice, intent, offer, reply, ai: Boolean(aiIntent) });
    }

    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'invoices' && parts[3] === 'accept') {
      const invoice = getInvoice(parts[2]);
      if (!invoice) return json(res, 404, { error: 'Invoice not found' });
      if (invoice.outstanding <= 0) return json(res, 409, { error: 'Invoice is already settled' });
      const body = await readBody(req);
      const intent = body.intent || parseIntent(body.message || '');
      const offer = decide(invoice, intent); // Never trust client-calculated money.
      if (!Number.isFinite(offer.total) || offer.total <= 0 || offer.total > invoice.outstanding) return json(res, 400, { error: 'Invalid settlement' });
      let order;
      if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) order = await createPayPalOrder(invoice, offer);
      if (!order) order = mockOrder(invoice, offer);
      const approval = order.links?.find(x => x.rel === 'approve')?.href || `/api/orders/${order.id}`;
      addAudit('ORDER_CREATED', { invoiceId: invoice.id, orderId: order.id, amount: offer.parts[0], provider: order.id.startsWith('MOCK-') ? 'mock' : 'paypal-sandbox' });
      return json(res, 200, { invoiceId: invoice.id, offer, orders: [{ id: order.id, url: approval }], provider: order.id.startsWith('MOCK-') ? 'mock' : 'paypal-sandbox' });
    }

    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'orders' && parts[2] === 'return') {
      const state = verifyState(url.searchParams.get('state'));
      const token = url.searchParams.get('token');
      if (!state || !token || !state.invoice) return json(res, 400, { error: 'Invalid or expired payment state' });
      const invoice = getInvoice(state.invoice);
      if (!invoice) return json(res, 404, { error: 'Invoice not found' });
      if (!consumedOrders.has(token)) await capturePayPalOrder(token, state.amount);
      applyPayment(invoice, token, state.amount, Boolean(state.complete), 'paypal-sandbox');
      return redirect(res, `/pay.html?success=1&invoice=${encodeURIComponent(invoice.id)}&order=${encodeURIComponent(token)}&complete=${state.complete ? '1' : '0'}`);
    }

    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'orders' && parts[2] === 'cancel') return redirect(res, `/pay.html?cancelled=1`);

    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'orders' && parts[2]) {
      const id = parts[2];
      const mock = mockOrders.get(id);
      if (!mock) return json(res, 404, { error: 'Order not found' });
      if (Date.now() - mock.createdAt > 15 * 60 * 1000) return json(res, 410, { error: 'Mock order expired' });
      const invoice = getInvoice(mock.invoiceId);
      if (!invoice) return json(res, 404, { error: 'Invoice not found' });
      if (!consumedOrders.has(id)) applyPayment(invoice, id, mock.amount, mock.complete, 'mock');
      return redirect(res, `/pay.html?success=1&invoice=${encodeURIComponent(mock.invoiceId)}&order=${encodeURIComponent(id)}&complete=${mock.complete ? '1' : '0'}`);
    }

    return json(res, 404, { error: 'Route not found' });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: 'Internal server error', detail: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
}

module.exports = handler;
