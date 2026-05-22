/**
 * Cloudflare Pages Function — Stripe Checkout Session
 * Endpoint: POST /create-checkout
 *
 * Environment variable required (set in Cloudflare Pages → Settings → Variables):
 *   STRIPE_SECRET_KEY  →  sk_live_xxxxxxxxxxxxxxxxxxxx
 *
 * Also add in wrangler.toml (or Pages env) the allowed origin for CORS.
 */

const ALLOWED_TYPES = ['booking', 'concierge', 'deposit', 'invoice'];

const PRODUCT_NAMES = {
  booking:   'Vacation Rental Payment — Host By Sophie',
  concierge: 'Concierge Service — Host By Sophie',
  deposit:   'Security Deposit — Host By Sophie',
  invoice:   'Owner Management Fee — Host By Sophie',
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin')) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';

  try {
    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await request.json();
    const { amount, email, name, ref, type } = body;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) < 1)
      return jsonError('Invalid amount', 400, origin);
    if (!email || !email.includes('@'))
      return jsonError('Invalid email', 400, origin);
    if (!ALLOWED_TYPES.includes(type))
      return jsonError('Invalid payment type', 400, origin);

    const amountCents = Math.round(parseFloat(amount) * 100); // Stripe uses cents

    // ── Stripe API call ───────────────────────────────────────────────────────
    const params = new URLSearchParams({
      'payment_method_types[]':                          'card',
      'customer_email':                                  email,
      'line_items[0][price_data][currency]':             'usd',
      'line_items[0][price_data][unit_amount]':          amountCents,
      'line_items[0][price_data][product_data][name]':   PRODUCT_NAMES[type],
      'line_items[0][price_data][product_data][description]': ref || '',
      'line_items[0][quantity]':                         '1',
      'mode':                                            'payment',
      'success_url':                                     'https://hostbysophie.com/payment-success.html?session_id={CHECKOUT_SESSION_ID}',
      'cancel_url':                                      'https://hostbysophie.com/payment.html?cancelled=1',
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
      console.error('Stripe error:', session);
      return jsonError(session?.error?.message || 'Stripe error', 502, origin);
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });

  } catch (err) {
    console.error('Worker exception:', err);
    return jsonError('Server error', 500, origin);
  }
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
