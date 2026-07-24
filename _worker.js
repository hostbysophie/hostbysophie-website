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

    // ── Sign app: receive a signed pack and email it to Host By Sophie ────────
    // The signing pages (hosted externally) POST the signed pack here.
    // We forward it as a .json attachment via Brevo, sent from the verified
    // hostbysophie@gmail.com sender and delivered to that same inbox.
    //   Environment variable required (Cloudflare → Settings → Variables):
    //     BREVO_API_KEY  →  xkeysib-xxxxxxxx
    if (url.pathname === '/sign-pack') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      try {
        const pack = await request.json();
        if (!pack || !pack.signatory || !Array.isArray(pack.signatures)) {
          return jsonError('Invalid pack', 400);
        }

        const sigName  = String(pack.signatory.name  || 'Unknown');
        const sigEmail = String(pack.signatory.email || '');
        const signedCount = pack.signatures.filter(s => s && s.imageDataUrl).length;
        const totalCount  = pack.signatures.length;
        const receivedAt  = new Date().toISOString();

        const packJson = JSON.stringify(pack, null, 2);
        const packB64  = toBase64(packJson);
        const fileSafe = sigName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

        const htmlBody =
          '<h2>New signed pack received</h2>' +
          '<p><strong>Signatory:</strong> ' + escapeHtml(sigName) + '</p>' +
          '<p><strong>Email:</strong> ' + escapeHtml(sigEmail || '—') + '</p>' +
          '<p><strong>Zones signed:</strong> ' + signedCount + ' / ' + totalCount + '</p>' +
          '<p><strong>Received:</strong> ' + receivedAt + '</p>' +
          '<p>The signed pack is attached as a <code>.txt</code> file. Open the Sign tool on ' +
          'hostbysophie.com, upload the original PDF, then upload this pack to generate the final signed PDF.</p>';

        const payload = {
          sender:  { name: 'Host By Sophie — Sign', email: 'hostbysophie@gmail.com' },
          to:      [{ email: 'hostbysophie@gmail.com', name: 'Host By Sophie' }],
          subject: '[Sign] ' + sigName + ' signed (' + signedCount + '/' + totalCount + ')',
          htmlContent: htmlBody,
          attachment: [{ content: packB64, name: 'sigpack-' + fileSafe + '.txt' }],
        };
        if (sigEmail.includes('@')) payload.replyTo = { email: sigEmail, name: sigName };

        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key':      env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            'accept':       'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!brevoRes.ok) {
          console.error('Brevo error:', await brevoRes.text());
          return jsonError('Email service error', 502);
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });

      } catch (err) {
        console.error('sign-pack exception:', err);
        return jsonError('Server error', 500);
      }
    }

    // ── All other requests → serve static assets ──────────────────────────────
    return env.ASSETS.fetch(request);
  }
};

// UTF-8 safe base64 for the JSON attachment
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
