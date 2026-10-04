# ChaseBot

A guardrailed AI collections agent. A freelancer sets limits once (max discount, max installments, minimum first payment). When a client ignores an overdue invoice, they open a link and negotiate in plain language. An AI reads the request, **a rules engine** sets the actual terms (the AI never decides money), and the client pays through **PayPal Orders (sandbox)**. Every action is audited and re-validated server-side on accept.

Built for the PayPal AI Hackathon. Free to run: zero npm dependencies, PayPal sandbox, free LLM tier, Vercel Hobby.

## Run locally (30 seconds)
```
node server.js        # Node 18+, then open http://localhost:3000
node test.js          # guardrail checks
```
With no keys it runs in **mock mode** (fake PayPal checkout, rules-only parsing) so judges can try it instantly.

## Real PayPal sandbox + AI (still free)
1. developer.paypal.com > Apps & Credentials > Sandbox > create app; copy Client ID and Secret.
2. Optional AI: a free key from Groq, OpenRouter, or Gemini (OpenAI-compatible endpoint), or local Ollama.
3. `cp .env.example .env`, then export the vars (or set them in Vercel) and restart.
4. Checkout with a sandbox *personal* test buyer account from the same dashboard.

## Deploy on Vercel (Hobby, free)
Push to a public GitHub repo, import it at vercel.com/new (no build command, no framework), add the env vars above, deploy. `api/index.js` becomes the serverless function; `public/` is served statically.

## How it works
- `api/index.js`: risk scoring, intent parsing (LLM, with regex fallback), **rules engine** (`decide`), PayPal OAuth + Orders create/capture, audit log.
- `public/index.html`: dashboard (AG Grid Community), limits, activity. `public/pay.html`: client negotiation page.
- Safety: accept re-computes the offer from the mandate, so a tampered request cannot exceed limits.

## Known limitations
- Data lives in memory and resets on cold starts (fine for a demo). Swap `db` for Upstash Redis or Vercel KV for persistence.
- The client side is simulated in-browser; real email/WhatsApp sending is not wired up.
- No webhook handler yet: payments are captured on the PayPal return redirect.
- Each installment is its own PayPal order; only the first checkout opens automatically.
