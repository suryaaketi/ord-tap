// ORD Tap flight lookup: a Cloudflare Worker that keeps the Aviationstack key off the public site.
//
//   GET /flight?number=UA1234  →  { data: [...Aviationstack records for that flight leaving ORD...] }
//
// Setup is in worker/README.md. The key is stored as the secret AVIATIONSTACK_KEY, never in code.
// The free Aviationstack plan allows about 100 requests a month, so answers are reused for
// CACHE_MINUTES. Bind a KV namespace called FLIGHTS to share that cache across Cloudflare's
// servers; without it each server keeps its own short memory.

const ALLOWED_ORIGINS = ['https://suryaaketi.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];
const CACHE_MINUTES = 10;
const FLIGHT = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4})([A-Z]?)$/;
const memory = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept',
      'Vary': 'Origin'
    };
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405);
    // Browsers on other websites cannot use this Worker. (A script outside a browser can fake the
    // Origin header; the cache below limits what that costs.)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: 'forbidden-origin' }, 403);

    const url = new URL(request.url);
    if (url.pathname !== '/flight') return reply({ error: 'not-found', usage: '/flight?number=UA1234' }, 404);
    const m = (url.searchParams.get('number') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(FLIGHT);
    if (!m) return reply({ error: 'bad-number' }, 400);
    const number = `${m[1]}${Number(m[2])}${m[3]}`;
    if (!env.AVIATIONSTACK_KEY) return reply({ error: 'missing_access_key' }, 500);

    const cacheKey = `flight:${number}`;
    const cached = memory.get(cacheKey);
    if (cached && cached.expires > Date.now()) return reply(cached.body, 200, { 'X-Cache': 'memory' });
    if (env.FLIGHTS) {
      const stored = await env.FLIGHTS.get(cacheKey, 'json');
      if (stored) { memory.set(cacheKey, { body: stored, expires: Date.now() + 60_000 }); return reply(stored, 200, { 'X-Cache': 'kv' }); }
    }

    const api = new URL('https://api.aviationstack.com/v1/flights');
    api.searchParams.set('access_key', env.AVIATIONSTACK_KEY);
    api.searchParams.set('flight_iata', number);
    api.searchParams.set('dep_iata', 'ORD');
    api.searchParams.set('limit', '10');
    let upstream, json;
    try {
      upstream = await fetch(api.href, { headers: { Accept: 'application/json' } });
      json = await upstream.json();
    } catch {
      return reply({ error: 'upstream-unreachable' }, 502);
    }
    // Aviationstack reports problems (spent quota, bad key) as { error: { code, message } }.
    if (json?.error) return reply({ error: { code: json.error.code || 'upstream-error', message: json.error.message || '' } }, upstream.status >= 400 ? upstream.status : 502);

    // Pass on only what the site shows; nothing here identifies the key or the account.
    const keep = r => ({
      flight_date: r.flight_date, flight_status: r.flight_status,
      departure: r.departure && { airport: r.departure.airport, iata: r.departure.iata, terminal: r.departure.terminal, gate: r.departure.gate, delay: r.departure.delay, scheduled: r.departure.scheduled, estimated: r.departure.estimated, actual: r.departure.actual },
      arrival: r.arrival && { airport: r.arrival.airport, iata: r.arrival.iata },
      airline: r.airline && { name: r.airline.name, iata: r.airline.iata },
      flight: r.flight && { number: r.flight.number, iata: r.flight.iata, codeshared: r.flight.codeshared ? { airline_name: r.flight.codeshared.airline_name, flight_iata: r.flight.codeshared.flight_iata } : null }
    });
    const body = { data: (json?.data || []).map(keep), cachedFor: CACHE_MINUTES, fetchedAt: new Date().toISOString() };
    memory.set(cacheKey, { body, expires: Date.now() + CACHE_MINUTES * 60_000 });
    if (env.FLIGHTS) await env.FLIGHTS.put(cacheKey, JSON.stringify(body), { expirationTtl: CACHE_MINUTES * 60 });
    return reply(body);
  }
};
