// ORD Tap flight data. The Worker keeps provider keys out of the public site.
//
// GET /board[?direction=arrivals] returns today's O'Hare departures or arrivals.
// GET /flight?number=UA1234 searches the same O'Hare departures.
// See worker/README.md for deployment, secrets and cache settings.

const ALLOWED_ORIGINS = ['https://suryaaketi.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];
const FLIGHT_MINUTES = 10;
const FLIGHT = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4})([A-Z]?)$/;
const memory = new Map();
const DIRECTIONS = ['departures', 'arrivals'];
const AERO_HOST = 'aerodatabox.p.rapidapi.com';
const CHICAGO = 'America/Chicago';
const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CHICAGO, year: 'numeric', month: '2-digit', day: '2-digit'
});
const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CHICAGO, hour: 'numeric', timeZoneName: 'shortOffset'
});

function flightNumber(value) {
  const match = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(FLIGHT);
  return match ? `${match[1]}${Number(match[2])}${match[3]}` : null;
}

function chicagoDate() {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayBoundaries(date) {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const next = new Date(midnight + 86_400_000).toISOString().slice(0, 10);
  const offset = hour => offsetFormat.formatToParts(midnight + hour * 3_600_000)
    .find(p => p.type === 'timeZoneName').value;
  const times = [`${date}T00:00`];
  // Keep the first window below 12 elapsed hours when Chicago moves the clocks back.
  if (offset(6) !== offset(18)) times.push(`${date}T06:00`);
  times.push(`${date}T12:00`, `${next}T00:00`);
  return times;
}

const AERO_STATUS = new Map([
  ['Expected', 'scheduled'], ['CheckIn', 'checkin'], ['Boarding', 'boarding'],
  ['GateClosed', 'gate-closed'], ['Delayed', 'delayed'], ['EnRoute', 'active'],
  ['Departed', 'active'], ['Approaching', 'active'], ['Arrived', 'landed'],
  ['Canceled', 'cancelled'], ['CanceledUncertain', 'cancelled-uncertain'], ['Diverted', 'diverted']
]);
const isoTime = value => typeof value === 'string' ? value.replace(' ', 'T') : undefined;

function aeroMovement(movement, airportCode) {
  const airport = movement?.airport;
  const scheduled = movement?.scheduledTime, revised = movement?.revisedTime;
  const before = Date.parse(isoTime(scheduled?.utc)), after = Date.parse(isoTime(revised?.utc));
  return {
    airport: airport?.name || airport?.municipalityName,
    iata: airport?.iata || airportCode,
    terminal: movement?.terminal, gate: movement?.gate,
    scheduled: isoTime(scheduled?.local), estimated: isoTime(revised?.local),
    delay: Number.isFinite(after - before) ? Math.max(0, Math.round((after - before) / 60_000)) : null
  };
}

function aeroRecords(flights, direction, date) {
  const side = direction === 'departures' ? 'departure' : 'arrival';
  const seen = new Set();
  const data = [];
  for (const item of flights) {
    const iata = flightNumber(item?.number);
    if (!iata || item.isCargo) continue;
    const departure = aeroMovement(item.departure, side === 'departure' ? 'ORD' : undefined);
    const arrival = aeroMovement(item.arrival, side === 'arrival' ? 'ORD' : undefined);
    const local = side === 'departure' ? departure : arrival;
    const scheduledDate = local.scheduled?.slice(0, 10);
    if (local.iata !== 'ORD' || !scheduledDate ||
        (scheduledDate !== date && local.estimated?.slice(0, 10) !== date)) continue;
    const key = `${iata}:${local.scheduled}`;
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({
      flight_date: scheduledDate, flight_status: AERO_STATUS.get(item.status),
      departure, arrival, airline: { name: item.airline?.name },
      flight: { iata, codeshared: item.codeshareStatus === 'IsCodeshared' ? {} : null }
    });
  }
  return data;
}

async function aeroWindow(env, from, to) {
  const url = new URL(`https://${AERO_HOST}/flights/airports/iata/ORD/${from}/${to}`);
  url.search = new URLSearchParams({
    direction: 'Both', withLeg: 'true', withCancelled: 'true', withCodeshared: 'true',
    withCargo: 'false', withPrivate: 'false', withLocation: 'false'
  });
  try {
    const upstream = await fetch(url.href, {
      headers: { Accept: 'application/json', 'X-RapidAPI-Key': env.AERODATABOX_KEY, 'X-RapidAPI-Host': AERO_HOST },
      redirect: 'error', signal: AbortSignal.timeout(15_000)
    });
    if (upstream.status === 204) return { departures: [], arrivals: [] };
    if (!upstream.ok) return { error: `http-${upstream.status}`, status: upstream.status };
    const body = await upstream.json();
    if (!body || !DIRECTIONS.some(direction => Object.hasOwn(body, direction)) ||
        DIRECTIONS.some(direction => body[direction] != null && !Array.isArray(body[direction]))) {
      return { error: 'invalid-upstream-response', status: 502 };
    }
    return body;
  } catch {
    return { error: 'upstream-unreachable', status: 502 };
  }
}

async function aeroDay(env, date) {
  const times = dayBoundaries(date);
  const windows = await Promise.all(times.slice(0, -1).map((from, i) => aeroWindow(env, from, times[i + 1])));
  const failure = windows.find(window => window.error);
  if (failure) return failure;
  return {
    departures: aeroRecords(windows.flatMap(window => window.departures || []), 'departures', date),
    arrivals: aeroRecords(windows.flatMap(window => window.arrivals || []), 'arrivals', date),
    fetchedAt: new Date().toISOString()
  };
}

// Pass on only what the site shows; nothing here identifies the key or the account.
const keepAirport = airport => airport && {
  airport: airport.airport, iata: airport.iata, terminal: airport.terminal, gate: airport.gate,
  delay: airport.delay, scheduled: airport.scheduled, estimated: airport.estimated, actual: airport.actual
};
const keep = r => ({
  flight_date: r.flight_date, flight_status: r.flight_status,
  departure: keepAirport(r.departure), arrival: keepAirport(r.arrival),
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

async function aviationstack(env, params, airportSide = 'departure') {
  const api = new URL('https://api.aviationstack.com/v1/flights');
  api.searchParams.set('access_key', env.AVIATIONSTACK_KEY);
  for (const [k, v] of Object.entries(params)) api.searchParams.set(k, v);
  let upstream, json;
  try { upstream = await fetch(api.href, { headers: { Accept: 'application/json' } }); json = await upstream.json(); }
  catch { return { error: 'upstream-unreachable', status: 502 }; }
  // Upstream diagnostic messages may include request details. Pass back only the error code.
  if (!upstream.ok || json?.error) return { error: { code: json?.error?.code || `http-${upstream.status}` }, status: upstream.ok ? 502 : upstream.status };
  if (!Array.isArray(json?.data)) return { error: 'invalid-upstream-response', status: 502 };
  return { data: json.data.filter(r => r?.[airportSide]?.iata === 'ORD').map(keep) };
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
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors, ...extra } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405);
    // Browsers on other websites cannot use this Worker. (A script outside a browser can fake the
    // Origin header; the caches limit what that costs.)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: 'forbidden-origin' }, 403);
    const url = new URL(request.url);
    if (!['/flight', '/board'].includes(url.pathname)) return reply({ error: 'not-found', usage: ['/flight?number=UA1234', '/board'] }, 404);
    const direction = url.pathname === '/board' ? url.searchParams.get('direction') || 'departures' : null;
    if (direction && !DIRECTIONS.includes(direction)) return reply({ error: 'bad-direction' }, 400);
    const number = direction ? null : flightNumber(url.searchParams.get('number'));
    if (!direction && !number) return reply({ error: 'bad-number' }, 400);

    if (env.AERODATABOX_KEY) {
      const date = chicagoDate();
      const minutes = Math.min(1440, Math.max(5, Math.round(Number(env.BOARD_MINUTES)) || 30));
      const { body, source } = await cached(env, `aerodatabox:ORD:${date}`, minutes, () => aeroDay(env, date));
      if (body.error) return reply({ error: body.error }, body.status || 502);
      const data = direction ? body[direction] : body.departures.filter(f => f.flight.iata === number);
      return reply({ data, date, source: 'aerodatabox', fetchedAt: body.fetchedAt, refreshMinutes: minutes },
        200, { 'X-Cache': source });
    }

    if (!env.AVIATIONSTACK_KEY) return reply({ error: 'missing_access_key' }, 500);

    if (direction) {
      const minutes = Math.max(5, Number(env.BOARD_MINUTES) || 480);
      const isArrival = direction === 'arrivals';
      const filter = isArrival ? 'arr_iata' : 'dep_iata';
      const { body, source } = await cached(env, `board:ORD:${direction}`, minutes, async () => {
        const r = await aviationstack(env, { [filter]: 'ORD', limit: '100' }, isArrival ? 'arrival' : 'departure');
        return r.error ? r : { data: r.data, fetchedAt: new Date().toISOString(), refreshMinutes: minutes };
      });
      if (body.error) return reply({ error: body.error }, body.status || 502);
      return reply(body, 200, { 'X-Cache': source });
    }

    const { body, source } = await cached(env, `flight:${number}`, FLIGHT_MINUTES, async () => {
      const r = await aviationstack(env, { flight_iata: number, dep_iata: 'ORD', limit: '10' });
      return r.error ? r : { data: r.data, cachedFor: FLIGHT_MINUTES, fetchedAt: new Date().toISOString() };
    });
    if (body.error) return reply({ error: body.error }, body.status || 502);
    return reply(body, 200, { 'X-Cache': source });
  }
};
