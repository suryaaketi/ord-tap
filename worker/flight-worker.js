// ORD Tap flight data: a Cloudflare Worker that keeps the Aviationstack key off the public site.
//
//   GET /flight?number=UA1234  →  { data: [...records for that flight leaving ORD...] }
//   GET /board                 →  { data: [...O'Hare departures...], fetchedAt, refreshMinutes }
//
// Setup is in worker/README.md. The key is stored as the secret AVIATIONSTACK_KEY, never in code.
// Every answer is reused so many visitors cost one Aviationstack request:
//   - one flight number: FLIGHT_MINUTES (10)
//   - the departures board: BOARD_MINUTES, a variable you set in Cloudflare. The default, 480
//     (8 hours), keeps the free plan's 100 requests a month enough for the board plus a few
//     lookups. On the paid Basic plan (10,000 a month), 10 is a sensible value.
// Bind a KV namespace called FLIGHTS to share the cache across Cloudflare's servers; without it
// each server keeps its own memory, and the board may be fetched more often than planned.

const ALLOWED_ORIGINS = ['https://suryaaketi.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];
const FLIGHT_MINUTES = 10;
const FLIGHT = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4})([A-Z]?)$/;
const memory = new Map();

// Pass on only what the site shows; nothing here identifies the key or the account.
const keep = r => ({
  flight_date: r.flight_date, flight_status: r.flight_status,
  departure: r.departure && { airport: r.departure.airport, iata: r.departure.iata, terminal: r.departure.terminal, gate: r.departure.gate, delay: r.departure.delay, scheduled: r.departure.scheduled, estimated: r.departure.estimated, actual: r.departure.actual },
  arrival: r.arrival && { airport: r.arrival.airport, iata: r.arrival.iata },
  airline: r.airline && { name: r.airline.name, iata: r.airline.iata },
  flight: r.flight && { number: r.flight.number, iata: r.flight.iata, codeshared: r.flight.codeshared ? { airline_name: r.flight.codeshared.airline_name, flight_iata: r.flight.codeshared.flight_iata } : null }
});

async function cached(env, key, minutes, load) {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return { body: hit.body, source: 'memory' };
  if (env.FLIGHTS) {
    const stored = await env.FLIGHTS.get(key, 'json');
    if (stored) { memory.set(key, { body: stored, expires: Date.now() + Math.min(minutes, 2) * 60_000 }); return { body: stored, source: 'kv' }; }
  }
  const body = await load();
  if (body.error) return { body, source: 'upstream' };
  memory.set(key, { body, expires: Date.now() + minutes * 60_000 });
  if (env.FLIGHTS) await env.FLIGHTS.put(key, JSON.stringify(body), { expirationTtl: Math.max(60, minutes * 60) });
  return { body, source: 'upstream' };
}

async function aviationstack(env, params) {
  const api = new URL('https://api.aviationstack.com/v1/flights');
  api.searchParams.set('access_key', env.AVIATIONSTACK_KEY);
  for (const [k, v] of Object.entries(params)) api.searchParams.set(k, v);
  let upstream, json;
  try { upstream = await fetch(api.href, { headers: { Accept: 'application/json' } }); json = await upstream.json(); }
  catch { return { error: 'upstream-unreachable', status: 502 }; }
  // Aviationstack reports problems (spent quota, bad key) as { error: { code, message } }.
  if (json?.error) return { error: { code: json.error.code || 'upstream-error', message: json.error.message || '' }, status: upstream.status >= 400 ? upstream.status : 502 };
  return { data: (json?.data || []).map(keep) };
}

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
    // Origin header; the caches limit what that costs.)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: 'forbidden-origin' }, 403);
    const url = new URL(request.url);
    if (!['/flight', '/board'].includes(url.pathname)) return reply({ error: 'not-found', usage: ['/flight?number=UA1234', '/board'] }, 404);
    if (!env.AVIATIONSTACK_KEY) return reply({ error: 'missing_access_key' }, 500);

    if (url.pathname === '/board') {
      const minutes = Math.max(5, Number(env.BOARD_MINUTES) || 480);
      const { body, source } = await cached(env, 'board:ORD', minutes, async () => {
        const r = await aviationstack(env, { dep_iata: 'ORD', limit: '100' });
        return r.error ? r : { data: r.data, fetchedAt: new Date().toISOString(), refreshMinutes: minutes };
      });
      if (body.error) return reply({ error: body.error }, body.status || 502);
      return reply(body, 200, { 'X-Cache': source });
    }

    const m = (url.searchParams.get('number') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(FLIGHT);
    if (!m) return reply({ error: 'bad-number' }, 400);
    const number = `${m[1]}${Number(m[2])}${m[3]}`;
    const { body, source } = await cached(env, `flight:${number}`, FLIGHT_MINUTES, async () => {
      const r = await aviationstack(env, { flight_iata: number, dep_iata: 'ORD', limit: '10' });
      return r.error ? r : { data: r.data, cachedFor: FLIGHT_MINUTES, fetchedAt: new Date().toISOString() };
    });
    if (body.error) return reply({ error: body.error }, body.status || 502);
    return reply(body, 200, { 'X-Cache': source });
  }
};
