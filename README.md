# ChaseBot

A guardrailed AI collections agent for the PayPal AI Hackathon. A freelancer sets a financial mandate (maximum discount, maximum installments, and minimum first payment). A client negotiates in plain language. AI may extract the client's intent, but a deterministic server-side rules engine decides the actual money terms. The server recomputes the offer again before creating a PayPal order.

## What is included

- `api/index.js` — serverless API, intent extraction, deterministic rules engine, PayPal Sandbox Orders create/capture, mock checkout, and audit trail.
- `public/index.html` — freelancer dashboard and audit view.
- `public/pay.html` — client negotiation and checkout view.
- `server.js` — zero-dependency local server.
- `test.js` — guardrail and checkout smoke tests.
- `vercel.json` — Vercel API routing.

## Run locally

Requires Node.js 18+.

```bash
npm test
npm start
```

Open `http://localhost:3000`.

With no environment variables, ChaseBot runs in **mock mode**, so the complete negotiation → server re-validation → checkout → capture flow can be demonstrated without credentials.

## Real PayPal Sandbox + optional AI

1. Create a PayPal Sandbox app at the PayPal Developer Dashboard and copy the Client ID and Secret.
2. Copy `.env.example` to `.env`.
3. Set:

```env
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_secret
APP_URL=https://your-deployed-app.example
```

4. Optionally set an OpenAI-compatible LLM endpoint:

```env
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=your_key
LLM_MODEL=llama-3.1-8b-instant
```

Without an LLM key, the application uses a deterministic parser fallback. Without PayPal credentials, it uses the local mock checkout.

For real sandbox checkout, `APP_URL` must be the public HTTPS URL of the deployed application so PayPal can return the buyer to the application after approval.

## Deploy on Vercel

Import the public GitHub repository into Vercel. No build command or framework preset is required. Add the environment variables above in the Vercel project settings. Vercel serves `public/` and routes `/api/*` to `api/index.js`.

## Safety design

The AI is deliberately **not** the financial decision maker:

```text
Client message
    ↓
AI / deterministic intent extraction
    ↓
Deterministic mandate rules
    ↓
Server re-validation on acceptance
    ↓
PayPal Sandbox Order
    ↓
Buyer approval + server-side capture
    ↓
Audit event
```

A client cannot submit an arbitrary discount or installment count and bypass the mandate because the server ignores client-calculated monetary values and recomputes the offer from the stored mandate.

## Demo invoices

- `INV-101` — $1,200 outstanding, max 8% discount, max 3 installments, minimum first payment 34%.
- `INV-102` — $640 outstanding, max 8% discount, max 3 installments, minimum first payment 34%.

## Demo limitations

The demo uses in-memory invoice/audit state, so serverless cold starts reset the demo data. Real production use should add durable storage and idempotency/webhook handling. For the hackathon demo, the core negotiation, guardrail, order, approval, capture, and audit path is intentionally kept dependency-light.

## License

MIT.