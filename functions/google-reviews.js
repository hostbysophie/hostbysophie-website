/**
 * Cloudflare Pages Function — Live Google Reviews
 * Endpoint: GET /google-reviews
 *
 * Environment variable required (set in Cloudflare Pages → Settings → Variables):
 *   GOOGLE_PLACES_API_KEY  →  restricted to "Places API" only
 *
 * Place ID for HOST BY SOPHIE (Santa Cruz, Aruba): ChIJ_1VVvyZEb2cRhuMYu1waxgQ
 *
 * Response is cached at Cloudflare's edge for 1 hour (Cache-Control header),
 * so this only calls the Google Places API a handful of times per hour at
 * most, well inside the free monthly quota.
 */

const PLACE_ID = 'ChIJ_1VVvyZEb2cRhuMYu1waxgQ';

export async function onRequestGet({ env }) {
  try {
    const apiKey = env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: 'Missing GOOGLE_PLACES_API_KEY' }, 500);
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=name,rating,user_ratings_total,reviews&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK') {
      return jsonResponse({ error: data.status || 'Google API error' }, 502);
    }

    const result = data.result || {};
    const reviews = (result.reviews || [])
      .sort((a, b) => b.time - a.time) // most recent first
      .map((r) => ({
        author: r.author_name,
        authorPhoto: r.profile_photo_url,
        rating: r.rating,
        text: r.text,
        relativeTime: r.relative_time_description,
        time: r.time,
      }));

    return jsonResponse({
      rating: result.rating,
      totalReviews: result.user_ratings_total,
      reviews,
    });
  } catch (err) {
    console.error('google-reviews error:', err);
    return jsonResponse({ error: 'Server error' }, 500);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Edge-cache for 1 hour to keep Places API usage minimal (free tier).
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
