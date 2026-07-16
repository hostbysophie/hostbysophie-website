/**
 * Cloudflare Worker — Host By Sophie
 * Handles /create-checkout (Stripe) and serves all static assets.
 *
 * Environment variable (set in Cloudflare dashboard after adding this file):
 *   STRIPE_SECRET_KEY  →  sk_live_xxxxxxxxxxxxxxxxxxxx
 */

const ALLOWED_TYPES = ['booking', 'concierge', 'deposit', 'invoice'];

const PRODUCT_NAMES = {
  booking:   'Vacation Rental Payment — Host By Sophie',
  concierge: 'Concierge Service — Host By Sophie',
  deposit:   'Security Deposit — Host By Sophie',
  invoice:   'Owner Management Fee — Host By Sophie',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Proxy for HBS Meeting app: relay summary requests to AssemblyAI ──────
    // (their LLM Gateway blocks direct browser calls; same-origin proxy fixes it)
    if (url.pathname === '/meeting-summary') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      try {
        const auth = request.headers.get('authorization') || '';
        const upstream = await fetch('https://llm-gateway.assemblyai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'authorization': auth, 'content-type': 'application/json' },
          body: await request.text(),
        });
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      } catch (err) {
        return jsonError('Summary proxy error', 502);
      }
    }

    // ── Handle Stripe Checkout session creation ───────────────────────────────
    if (url.pathname === '/create-checkout') {

      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const { amount, email, name, ref, type } = await request.json();

        // Validate
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) < 1)
          return jsonError('Invalid amount', 400);
        if (!email || !email.includes('@'))
          return jsonError('Invalid email', 400);
        if (!ALLOWED_TYPES.includes(type))
          return jsonError('Invalid payment type', 400);

        const amountCents = Math.round(parseFloat(amount) * 100);
        const origin = new URL(request.url).origin;

        const params = new URLSearchParams({
          'payment_method_types[]':                          'card',
          'customer_email':                                  email,
          'line_items[0][price_data][currency]':             'usd',
          'line_items[0][price_data][unit_amount]':          amountCents,
          'line_items[0][price_data][product_data][name]':   PRODUCT_NAMES[type],
          ...(ref ? { 'line_items[0][price_data][product_data][description]': ref } : {}),
          'line_items[0][quantity]':                         '1',
          'mode':                                            'payment',
          'success_url':                                     `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
          'cancel_url':                                      `${origin}/payment.html?cancelled=1`,
          'metadata[guest_name]':                            name || '',
          'metadata[reference]':                             ref  || '',
          'metadata[type]':                                  type,
          'payment_intent_data[description]':                `${PRODUCT_NAMES[type]} — ref: ${ref || 'n/a'}`,
          'payment_intent_data[receipt_email]':              email,
        });

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization':  `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type':   'application/x-www-form-urlencoded',
            'Stripe-Version': '2024-04-10',
          },
          body: params.toString(),
        });

        const session = await stripeRes.json();

        if (!stripeRes.ok) {
          return jsonError(session?.error?.message || 'Stripe error', 502);
        }

        return new Response(JSON.stringify({ url: session.url }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });

      } catch (err) {
        return jsonError('Server error', 500);
      }
    }

    // ── All other requests → serve static assets ──────────────────────────────
    return env.ASSETS.fetch(request);
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
