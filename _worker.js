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

        let stored = false, emailed = false;

        // 1) Save the pack server-side (KV) — survives even if email fails
        if (env.SIGN_PACKS) {
          try {
            const key = 'pack:' + Date.now() + ':' + fileSafe;
            await env.SIGN_PACKS.put(key, packJson, {
              metadata: { name: sigName, email: sigEmail, signed: signedCount, total: totalCount, at: receivedAt },
              expirationTtl: 60 * 60 * 24 * 365, // keep 1 year
            });
            stored = true;
          } catch (e) { console.error('KV store error:', e); }
        }

        // 2) Email it via Brevo
        try {
          const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'api-key':      env.BREVO_API_KEY,
              'Content-Type': 'application/json',
              'accept':       'application/json',
            },
            body: JSON.stringify(payload),
          });
          if (brevoRes.ok) emailed = true;
          else console.error('Brevo error:', await brevoRes.text());
        } catch (e) { console.error('Brevo exception:', e); }

        // Success if the pack is safe by at least one channel
        if (stored || emailed) {
          return new Response(JSON.stringify({ ok: true, stored, emailed }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
          });
        }
        return jsonError('Could not deliver or store the pack', 502);

      } catch (err) {
        console.error('sign-pack exception:', err);
        return jsonError('Server error', 500);
      }
    }

    // ── Sign inbox (token-protected): list / download / delete stored packs ───
    if (url.pathname === '/sign-packs' || url.pathname === '/sign-pack-file' || url.pathname === '/sign-pack-delete') {
      if (!env.INBOX_TOKEN || url.searchParams.get('token') !== env.INBOX_TOKEN) {
        return jsonError('Unauthorized', 401);
      }
      if (!env.SIGN_PACKS) return jsonError('Storage not configured', 500);

      if (url.pathname === '/sign-packs') {
        const list = await env.SIGN_PACKS.list({ prefix: 'pack:' });
        const items = list.keys
          .map(k => ({ key: k.name, ...(k.metadata || {}) }))
          .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        return new Response(JSON.stringify({ items }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }

      const key = url.searchParams.get('key');
      if (!key) return jsonError('Missing key', 400);

      if (url.pathname === '/sign-pack-file') {
        const val = await env.SIGN_PACKS.get(key);
        if (val === null) return jsonError('Not found', 404);
        return new Response(val, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="' + key.replace(/[^a-zA-Z0-9._-]+/g, '_') + '.txt"',
            ...corsHeaders(),
          },
        });
      }

      // /sign-pack-delete
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      await env.SIGN_PACKS.delete(key);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // ── Booking calendar: merged iCal feeds + manual entries (KV-backed) ──────
    //   Reads every configured iCal export (VRBO + Airbnb + Booking + tab.travel)
    //   server-side (no browser CORS limit), merges them, caches in KV, and
    //   refreshes lazily when the cache is older than 2h (or on demand).
    //   Optional: set env.CAL_KEY in Cloudflare to require a passcode.
    if (url.pathname === '/calendar-data') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: calCors() });
      }
      if (env.CAL_KEY) {
        const k = url.searchParams.get('k') || request.headers.get('x-cal-key') || '';
        if (k !== env.CAL_KEY) return calJson({ error: 'Unauthorized' }, 401);
      }
      if (!env.HBS_CAL) return calJson({ error: 'Calendar storage not configured' }, 500);

      try {
        if (request.method === 'GET') {
          return calJson(await calGetData(env, false), 200);
        }
        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const action = body.action || '';
          if (action === 'refresh') {
            return calJson(await calGetData(env, true), 200);
          }
          if (action === 'booking') {
            const b = calCleanBooking(body);
            if (!b) return calJson({ error: 'Invalid booking' }, 400);
            const manual = (await env.HBS_CAL.get('manual', 'json')) || { bookings: [], apartments: [] };
            manual.bookings.push(b);
            await env.HBS_CAL.put('manual', JSON.stringify(manual));
            return calJson(await calGetData(env, false), 200);
          }
          if (action === 'cancel') {
            const id = String(body.id || '').trim();
            const manual = (await env.HBS_CAL.get('manual', 'json')) || { bookings: [], apartments: [] };
            const before = manual.bookings.length;
            if (id) {
              manual.bookings = manual.bookings.filter(x => x.id !== id);
            } else {
              // Fallback for legacy entries saved before ids existed: match by prop+s+e+n
              const prop = String(body.prop || '').trim();
              const s = calIso(String(body.s || '')), e = calIso(String(body.e || ''));
              const n = String(body.n || '').trim();
              if (!prop || !s || !e) return calJson({ error: 'Missing id or prop/s/e' }, 400);
              manual.bookings = manual.bookings.filter(x => !(x.prop === prop && x.s === s && x.e === e && (!n || x.n === n)));
            }
            if (manual.bookings.length === before) return calJson({ error: 'Booking not found' }, 404);
            await env.HBS_CAL.put('manual', JSON.stringify(manual));
            return calJson(await calGetData(env, false), 200);
          }
          if (action === 'note') {
            const prop = String(body.prop || '').trim();
            const s = calIso(String(body.s || '')), e = calIso(String(body.e || ''));
            const note = String(body.note || '').trim().slice(0, 300);
            if (!prop || !s || !e) return calJson({ error: 'Missing prop/dates' }, 400);
            const manual = (await env.HBS_CAL.get('manual', 'json')) || { bookings: [], apartments: [] };
            let hit = manual.bookings.find(x => x.prop === prop && x.s === s && x.e === e);
            if (hit) {
              hit.note = note;
            } else {
              manual.bookings.push({ id: crypto.randomUUID(), prop, s, e, n: '', t: 'note-only', pf: 'Direct', note, manual: true });
            }
            await env.HBS_CAL.put('manual', JSON.stringify(manual));
            return calJson(await calGetData(env, false), 200);
          }
          if (action === 'apartment') {
            const name = String(body.name || '').trim();
            if (!name) return calJson({ error: 'Name required' }, 400);
            const bg = /^#[0-9a-fA-F]{6}$/.test(body.bg || '') ? body.bg : '#9DB4C7';
            const manual = (await env.HBS_CAL.get('manual', 'json')) || { bookings: [], apartments: [] };
            const exists = manual.apartments.some(a => a.name === name) || CAL_PROPS.some(p => p.name === name);
            if (!exists) {
              manual.apartments.push({ name, bg, fg: calFg(bg) });
              await env.HBS_CAL.put('manual', JSON.stringify(manual));
            }
            return calJson(await calGetData(env, false), 200);
          }
          return calJson({ error: 'Unknown action' }, 400);
        }
        return new Response('Method not allowed', { status: 405 });
      } catch (err) {
        return calJson({ error: 'Calendar error' }, 500);
      }
    }

    // ── All other requests → serve static assets ──────────────────────────────
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },

  // ── Cron (every 2h): refresh the merged iCal feeds in the background ────────
  async scheduled(event, env, ctx) {
    if (env.HBS_CAL) ctx.waitUntil(calRefresh(env));
  },
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

// ══════════════════════════════════════════════════════════════════════════
// Booking calendar engine
// ══════════════════════════════════════════════════════════════════════════
// Each property has its brand colour and the pilot data as a `seed` fallback.
// The iCal export URLs are NOT stored here (they carry access tokens). They live
// in the Cloudflare secret CAL_FEEDS — a JSON map of { "<PROPERTY>": [ {pf,url} ] }.
// A property with no configured feed falls back to its `seed` events so the page
// is never blank; the moment its feed is present, live data replaces the seed.
const CAL_TTL_MS = 2 * 60 * 60 * 1000; // refresh feeds when cache older than 2h

const CAL_PROPS = [
  { name:'SWEET CHALET', bg:'#5DCAA5', fg:'#04342C',
    seed:[
      {s:'2025-10-25',e:'2025-11-01',n:'Scot',t:'res',pf:'VRBO'},
      {s:'2025-11-12',e:'2025-11-18',n:'Marcel',t:'res',pf:'VRBO'},
      {s:'2025-12-27',e:'2026-01-02',t:'block'},
      {s:'2026-02-01',e:'2026-02-06',n:'jay',t:'res',pf:'VRBO'},
      {s:'2026-02-08',e:'2026-02-17',n:'Travis',t:'res',pf:'VRBO'},
      {s:'2026-02-20',e:'2026-02-27',n:'Jay',t:'res',pf:'VRBO'},
      {s:'2026-04-14',e:'2026-04-18',n:'Nishauna',t:'res',pf:'VRBO'},
      {s:'2026-04-28',e:'2026-05-05',n:'Vickie',t:'res',pf:'VRBO'},
      {s:'2026-05-09',e:'2026-06-03',n:'Stas',t:'res',pf:'VRBO'},
      {s:'2026-06-06',e:'2026-06-10',n:'Brady',t:'res',pf:'VRBO'},
      {s:'2026-06-14',e:'2026-06-19',n:'Sara',t:'res',pf:'VRBO'},
      {s:'2026-06-24',e:'2026-06-28',n:'Hector Bayardo',t:'res',pf:'VRBO'},
      {s:'2026-08-19',e:'2026-08-26',n:'Edlira Hysenukaj',t:'res',pf:'Booking'},
      {s:'2026-09-04',e:'2026-09-09',n:'Jeremiah',t:'res',pf:'VRBO'} ] },
  { name:'BUBALI 13 L', bg:'#D8C6A6', fg:'#4A3A22',
    seed:[
      {s:'2026-03-24',e:'2026-04-06',t:'block'},
      {s:'2026-05-26',e:'2026-05-31',t:'block'},
      {s:'2026-06-03',e:'2026-06-16',t:'block'} ] },
  { name:'SOLARA SUITE', bg:'#7FD9E0', fg:'#04343B',
    seed:[] },
  { name:'TROPICAL HOUSE', bg:'#F0997B', fg:'#4A1B0C',
    seed:[
      {s:'2026-02-18',e:'2026-03-11',t:'block'},
      {s:'2026-08-17',e:'2026-08-20',n:'Telly',t:'res',pf:'VRBO'},
      {s:'2026-12-24',e:'2026-12-31',n:'Anatoly Plaks',t:'res',pf:'VRBO'} ] },
  { name:'LODGE #1 POOL SIDE', bg:'#9DB4C7', fg:'#1E2E3A',
    seed:[
      {s:'2025-12-05',e:'2025-12-19',n:'Tracey',t:'res',pf:'VRBO'},
      {s:'2026-03-06',e:'2026-03-10',n:'Amanda',t:'res',pf:'VRBO'},
      {s:'2026-03-24',e:'2026-04-02',n:'Len',t:'res',pf:'VRBO'},
      {s:'2027-01-31',e:'2027-02-08',n:'Carolyn',t:'res',pf:'VRBO'} ] },
  { name:'LODGE #2 EUCALYPTUS', bg:'#A4C2F4', fg:'#0C2E5A',
    seed:[
      {s:'2025-03-25',e:'2025-04-10',n:'Jean-Pierre',t:'res',pf:'VRBO'},
      {s:'2026-01-22',e:'2026-01-28',n:'Nicole',t:'res',pf:'VRBO'} ] },
  { name:'LODGE #3 FLAMINGO', bg:'#ED9DB4', fg:'#6B243E',
    seed:[
      {s:'2025-10-25',e:'2025-11-01',n:'Claudia',t:'res',pf:'VRBO'},
      {s:'2026-03-24',e:'2026-03-26',n:'Benjamin',t:'res',pf:'VRBO'},
      {s:'2026-04-02',e:'2026-04-09',n:'Carlos',t:'res',pf:'VRBO'} ] },
  { name:'LODGE #4 BANANAQUIT', bg:'#C0DD97', fg:'#27500A',
    seed:[] },
  { name:'LODGE #5 HOOIBERG', bg:'#9CCB8C', fg:'#173404',
    seed:[
      {s:'2025-08-12',e:'2025-08-27',n:'Miranda',t:'res',pf:'VRBO'},
      {s:'2025-12-15',e:'2025-12-25',n:'santiago',t:'res',pf:'VRBO'},
      {s:'2025-12-28',e:'2025-12-31',n:'wei',t:'res',pf:'VRBO'},
      {s:'2026-01-19',e:'2026-01-24',n:'Erin',t:'res',pf:'VRBO'},
      {s:'2026-04-04',e:'2026-04-11',n:'Tori',t:'res',pf:'VRBO'},
      {s:'2026-07-14',e:'2026-07-20',n:'Timothy',t:'res',pf:'VRBO'} ] },
];

// Feed URLs come from the encrypted CAL_FEEDS secret (never committed to git).
function calFeeds(env) {
  try { return env.CAL_FEEDS ? JSON.parse(env.CAL_FEEDS) : {}; }
  catch (e) { return {}; }
}

async function calGetData(env, force) {
  let cache = await env.HBS_CAL.get('feeds', 'json');
  const stale = !cache || (Date.now() - (cache.updated || 0) > CAL_TTL_MS);
  if (force || stale) {
    try { cache = await calRefresh(env); }
    catch (e) { if (!cache) cache = { byProp: {}, updated: Date.now() }; }
  }
  const manual = (await env.HBS_CAL.get('manual', 'json')) || { bookings: [], apartments: [] };
  const feeds = calFeeds(env);
  const properties = CAL_PROPS.map(p => {
    const hasFeeds = (feeds[p.name] || []).some(f => f && f.url);
    const events = (hasFeeds ? ((cache.byProp && cache.byProp[p.name]) || []) : (p.seed || [])).slice();
    manual.bookings.filter(b => b.prop === p.name)
      .forEach(b => calMergeManual(events, b));
    return { name: p.name, bg: p.bg, fg: p.fg, events };
  });
  (manual.apartments || []).forEach(a => {
    const events = manual.bookings.filter(b => b.prop === a.name)
      .map(b => ({ id: b.id, s: b.s, e: b.e, n: b.n, t: b.t, pf: b.pf, note: b.note }));
    properties.push({ name: a.name, bg: a.bg, fg: a.fg, events });
  });
  return { properties, updated: cache.updated || Date.now() };
}

async function calRefresh(env) {
  const feeds = calFeeds(env);
  const byProp = {};
  for (const p of CAL_PROPS) {
    const list = feeds[p.name] || [];
    const evs = [];
    for (const f of list) {
      if (!f || !f.url) continue;
      const url = String(f.url).replace(/^http:\/\//i, 'https://'); // force HTTPS
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'HBS-Calendar/1.0' } });
        if (r.ok) evs.push(...calParseICS(await r.text(), f.pf || 'Direct'));
      } catch (e) { /* skip unreachable feed, keep the rest */ }
    }
    byProp[p.name] = calDedupe(evs);
  }
  const data = { byProp, updated: Date.now() };
  await env.HBS_CAL.put('feeds', JSON.stringify(data));
  return data;
}

function calParseICS(text, pf) {
  const out = [];
  if (!text) return out;
  text = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); // unfold folded lines
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const body = b.split('END:VEVENT')[0];
    const get = (k) => {
      const m = body.match(new RegExp('\\n' + k + '[^:\\n]*:([^\\n]*)'));
      return m ? m[1].trim() : '';
    };
    const s = calIso(get('DTSTART')), e = calIso(get('DTEND'));
    if (!s || !e) continue;
    const description = calUnescapeICS(get('DESCRIPTION'));
    const { t, n } = calClassify(get('SUMMARY'), description);
    const ev = { s, e, n, t, pf };
    // Owner/Tab blocks often carry the actual guest name only in the iCal
    // notes (DESCRIPTION), not the summary — keep a trimmed copy so the
    // calendar can surface it instead of a bare "Blocked".
    if (description) ev.note = description.slice(0, 160);
    out.push(ev);
  }
  return out;
}

// Unescape iCal TEXT value escaping (RFC 5545): \n \, \; \\
function calUnescapeICS(v) {
  return (v || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function calIso(v) {
  const m = (v || '').match(/(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';
}

function calClassify(summary, description) {
  const s = (summary || '').toLowerCase();
  if (/not available|unavailable|blocked|closed|owner|maintenance/.test(s)) {
    // A block usually carries no guest info — but owner blocks and blocks
    // synced from Tab sometimes tuck the guest's name after the standard
    // boilerplate in the summary, or in the DESCRIPTION notes. Recover it
    // when we can, so the calendar shows a name instead of a bare "Blocked".
    let n = '';
    const m1 = (summary || '').match(/(?:not available|unavailable|blocked|closed|owner)\s*[-–—:]\s*(.+)/i);
    if (m1 && m1[1].trim()) n = m1[1].trim();
    if (!n && description) {
      const m2 = description.match(/(?:guest|name|reserved by|booked by)\s*[:\-]\s*([^,;\n]+)/i);
      if (m2 && m2[1].trim()) n = m2[1].trim();
    }
    return { t: 'block', n };
  }
  let n = '';
  const m = summary.match(/reserved\s*[-–—:]\s*(.+)/i);
  if (m) n = m[1].trim();
  else if (summary && !/^reserved$/i.test(summary) && !/^airbnb/i.test(summary) && !/^booking/i.test(summary)) n = summary.trim();
  return { t: 'res', n };
}

function calDedupe(evs) {
  const map = {};
  for (const e of evs) {
    const k = e.s + '|' + e.e;
    if (!map[k]) map[k] = e;
    else if (!map[k].n && e.n) map[k] = e; // prefer the copy that carries a guest name
  }
  return Object.values(map).sort((a, b) => (a.s < b.s ? -1 : 1));
}

// Merge a manual booking into a property's event list: if a feed/seed event
// already covers the exact same date range, enrich it in place (name/platform/note)
// instead of stacking a duplicate bar on the calendar. Otherwise append as new.
function calMergeManual(events, b) {
  const noteOnly = b.t === 'note-only';
  const match = events.find(e => e.s === b.s && e.e === b.e && (noteOnly || e.t === b.t));
  if (match) {
    if (b.n) match.n = b.n;
    if (b.pf && !noteOnly) match.pf = b.pf;
    if (b.note) match.note = b.note;
    match.manualId = b.id;
  } else if (!noteOnly) {
    events.push({ id: b.id, s: b.s, e: b.e, n: b.n, t: b.t, pf: b.pf, note: b.note });
  }
  // if noteOnly and nothing matched, the note is silently dropped (no event to attach it to)
}

function calCleanBooking(b) {
  const prop = String(b.prop || '').trim();
  const s = calIso(String(b.s || '')), e = calIso(String(b.e || ''));
  if (!prop || !s || !e || e <= s) return null;
  const t = b.t === 'block' ? 'block' : 'res';
  const n = String(b.n || '').trim();
  if (t === 'res' && !n) return null;
  const pf = ['Airbnb', 'Booking', 'VRBO', 'Direct'].includes(b.pf) ? b.pf : 'Direct';
  const note = String(b.note || '').trim().slice(0, 300);
  const id = (b.id && typeof b.id === 'string') ? b.id : crypto.randomUUID();
  return { id, prop, s, e, n, t, pf, note, manual: true };
}

function calFg(hex) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16) / 255,
        g = parseInt(hex.substr(2, 2), 16) / 255,
        b = parseInt(hex.substr(4, 2), 16) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 0.55 ? '#1C2B36' : '#FFFFFF';
}

function calCors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-cal-key',
  };
}

function calJson(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...calCors() },
  });
}
