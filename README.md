# Host By Sophie — Website

Boutique vacation rental & property management agency, Santa Cruz, Aruba.

## Structure

```
site internet HBS/
├── index.html         Public-facing site (Hero, Services, About, Portfolio, Contact)
├── portal.html        Private Owner Portal (login + dashboard mockup)
├── payment.html       Secure payment page (booking, concierge, owner invoice)
├── assets/
│   └── styles.css     Shared stylesheet (brand palette, components)
└── README.md          This file
```

## Brand palette

| Role       | Hex       | Usage                           |
|------------|-----------|---------------------------------|
| Ocean      | `#0F4C5C` | Primary — headings, nav, footer |
| Sea        | `#1E7A8C` | Hover / secondary               |
| Sand       | `#F5EBD7` | Alt section background          |
| Gold       | `#C9A961` | Accent, eyebrows, gold CTA      |
| Coral      | `#E07856` | Primary CTA (Aruba sunset)      |
| Ink        | `#1A2A33` | Body text                       |
| Paper      | `#FAF7F2` | Page background                 |

Typography: **Cormorant Garamond** (serif headings) + **Inter** (sans body) — loaded from Google Fonts.

## How to preview locally

No build step — just open `index.html` in any browser.

Or run a tiny local server (optional, recommended for clean hosting paths):

```bash
# Python
python3 -m http.server 8000
# then open http://localhost:8000
```

## How to deploy (free options)

1. **Netlify Drop** (easiest) — drag the whole `site internet HBS/` folder onto https://app.netlify.com/drop. You get a public URL in seconds. You can then connect your own domain (e.g. `hostbysophie.com`).
2. **Vercel** — `vercel --prod` from the folder, or connect a GitHub repo.
3. **GitHub Pages** — push the folder to a repo, enable Pages in settings.
4. **Traditional hosting** — upload all files via FTP to your provider.

## What's placeholder vs. real

- **Text, structure, brand palette** — production-ready, English, reflects the positioning in `CLAUDE.md`.
- **Images** — royalty-free Unsplash URLs as placeholders. Replace with your own property photos (put them in `assets/` and update the URLs in `index.html`).
- **Contact form** — currently shows a "Thank you" alert. To go live, connect one of:
  - [Formspree](https://formspree.io/) — no backend needed, swap the `onsubmit` for a `<form action="https://formspree.io/f/YOUR_ID" method="POST">`.
  - [Netlify Forms](https://docs.netlify.com/forms/setup/) — add `netlify` attribute to the form tag.
- **Payment page** — UI is complete; the card-handling is a demo. For real transactions:
  - Create a [Stripe](https://stripe.com/) account.
  - Use Stripe **Payment Links** (easiest — no code, just paste your link) OR
  - Replace the form's submit handler with a call to Stripe's [Checkout Session API](https://stripe.com/docs/payments/checkout) via a small serverless function (Netlify Function / Vercel Function).
  - **Never** accept raw card numbers on your own page — always use Stripe Elements or Checkout.
- **Owner Portal** — the login is a mockup. For production, use one of:
  - [Auth0](https://auth0.com/) or [Clerk](https://clerk.com/) — drop-in authentication.
  - [Firebase Authentication](https://firebase.google.com/products/auth) — free tier is generous.
  - The dashboard data is hardcoded; connect to your real data source (Google Sheets, Airtable, Supabase) with a few API calls.

## AI model recommendation (per project instructions)

For the work in this project:

- **Drafting copy, SEO, light design tweaks** → Claude Haiku 4.5 (fast, cheap).
- **Rebuilding layouts, writing code, debugging, owner-portal logic** → Claude Sonnet 4.6 (best balance).
- **Long/creative writing (e.g. property descriptions, brochures)** → Claude Opus 4.6 only when you need the extra depth.

## Next steps (suggested)

- [ ] Replace stock images with real property photos.
- [ ] Set up custom domain (e.g. `hostbysophie.com`) and point DNS.
- [ ] Connect Formspree or Netlify Forms to the contact form.
- [ ] Create Stripe account and swap the payment form for a Stripe Payment Link or Checkout session.
- [ ] Add Google Analytics 4 / Plausible for traffic tracking.
- [ ] Add a cookie banner if operating under EU/NL privacy rules (likely, given Aruba's ties to NL).

## Contact

Host By Sophie
Santa Cruz, Aruba
hostbysophie@gmail.com · +297 593 18 74 · @hostbysophie
In partnership with Aruba Sol Energy
