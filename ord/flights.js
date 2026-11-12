// Flight lookup: turn the flight number a passenger types into a gate on the map.
// Pure functions, so `npm test` checks them without a browser or an API key.
//
// Live data comes from Aviationstack's /v1/flights endpoint through a small Cloudflare Worker
// (worker/flight-worker.js) that keeps the API key off this public site. With no Worker link set
// in ord/config.js the searchable board displays clearly labeled sample data.

// Airline code (two letters, or a letter and a digit) + 1 to 4 digits + an optional letter.
const FLIGHT = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4})([A-Z]?)$/;

export function normalizeFlight(text) {
  const compact = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = compact.match(FLIGHT);
  if (!m) return null;
  const number = `${Number(m[2])}${m[3]}`;            // "UA0088" and "UA 88" both become UA88
  return { iata: `${m[1]}${number}`, airline: m[1], number, label: `${m[1]} ${number}` };
}

// Aviationstack writes departure times as the airport's local clock time. Only the wall-clock part
// of the string is used, so a "+00:00" suffix cannot shift the time by the Chicago offset.
const wall = iso => {
  const m = String(iso || '').match(/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)/);
  return m ? { date: m[1], hour: Number(m[2]), minute: Number(m[3]), key: `${m[1]}T${m[2]}:${m[3]}` } : null;
};
const keyMinutes = key => Date.parse(`${key}:00Z`) / 60000;

export function chicagoNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function clockText(time) {
  if (!time) return '';
  return `${(time.hour % 12) || 12}:${String(time.minute).padStart(2, '0')} ${time.hour < 12 ? 'a.m.' : 'p.m.'}`;
}

const STATUS = {
  scheduled: { text: 'Scheduled', tone: 'ok' },
  active: { text: 'Departed', tone: 'warn' },
  landed: { text: 'Landed', tone: 'warn' },
  cancelled: { text: 'Cancelled', tone: 'bad' },
  incident: { text: 'Incident reported', tone: 'bad' },
  diverted: { text: 'Diverted', tone: 'bad' }
};

// One Aviationstack record → the fields this site shows. Missing fields stay empty rather than guessed.
export function normalizeRecord(item, direction = 'departures') {
  const dep = item?.departure || {}, arr = item?.arrival || {}, code = item?.flight?.codeshared;
  const isArrival = direction === 'arrivals';
  const local = isArrival ? arr : dep, remote = isArrival ? dep : arr;
  const scheduled = wall(local.scheduled), estimated = wall(local.estimated);
  const delay = Number.isFinite(local.delay) ? local.delay : null;
  const status = STATUS[item?.flight_status] || { text: item?.flight_status ? String(item.flight_status) : 'Status unknown', tone: 'info' };
  return {
    iata: String(item?.flight?.iata || '').toUpperCase(),
    airline: item?.airline?.name || '',
    from: String(dep.iata || '').toUpperCase(),
    to: { name: arr.airport || '', iata: String(arr.iata || '').toUpperCase() },
    airport: { name: remote.airport || '', iata: String(remote.iata || '').toUpperCase() },
    status: item?.flight_status || '', statusText: status.text, tone: delay >= 15 && status.tone === 'ok' ? 'warn' : status.tone,
    scheduled, estimated: estimated && estimated.key !== scheduled?.key ? estimated : null, delay,
    terminal: local.terminal ? String(local.terminal).replace(/^T(?:erminal)?\s*/i, '') : '',
    gate: local.gate ? String(local.gate).toUpperCase().replace(/^GATE\s*/, '') : '',
    operatedBy: code ? { airline: code.airline_name || '', iata: String(code.flight_iata || '').toUpperCase() } : null
  };
}

// The API can return several records for one number (yesterday's flight, codeshares, other
// airports). Keep O'Hare departures and choose the next one to leave, allowing for a three-hour
// delay; if every one is in the past, show the latest.
export function pickFlight(items, now = chicagoNow()) {
  const flights = (items || []).map(normalizeRecord).filter(f => f.from === 'ORD' && f.scheduled);
  if (!flights.length) return null;
  const nowMin = keyMinutes(now);
  const at = f => keyMinutes((f.estimated || f.scheduled).key);
  const upcoming = flights.filter(f => at(f) >= nowMin - 180).sort((a, b) => at(a) - at(b));
  if (upcoming.length) return upcoming[0];
  return flights.sort((a, b) => at(b) - at(a))[0];
}

// "C17", "Gate C17", "c-17" in terminal "1" → the Gate C17 place. A bare number is only accepted
// in a terminal with one concourse (Terminal 5's M gates).
export function findGate(ctx, gate, terminal = '') {
  const code = String(gate || '').toUpperCase().replace(/^GATE\s*/, '').replace(/[^A-Z0-9]/g, '');
  if (!code) return null;
  const t = String(terminal || '').replace(/\D/g, '');
  const candidates = [code];
  if (/^\d+[A-Z]?$/.test(code) && ctx.network.terminals[t]?.concourses.length === 1) candidates.unshift(ctx.network.terminals[t].concourses[0] + code);
  if (/^[A-Z]\d+[A-Z]$/.test(code)) candidates.push(code.slice(0, -1));     // C17A falls back to C17
  for (const c of candidates) {
    if (!/^[A-Z]/.test(c)) continue;
    const gates = ctx.places.filter(p => p.kind === 'gate' && p.near.toUpperCase() === c);
    const pick = gates.find(p => p.terminal === t) || (gates.length === 1 ? gates[0] : null);
    if (pick) return pick;
  }
  return null;
}

// People sometimes type their gate instead of their flight ("C17" is also a valid flight number
// shape). A letter and one or two digits that match a gate on the map is treated as that gate.
export function looksLikeGate(ctx, text) {
  const t = String(text || '').toUpperCase().replace(/^\s*GATE\s*/, '').trim();
  if (!/^[A-Z]\s*-?\s*\d{1,2}[A-Z]?$/.test(t)) return null;
  return findGate(ctx, t);
}

// The concourses a terminal number points to, for when the gate is not posted yet.
export function terminalHint(ctx, terminal) {
  const t = ctx.network.terminals[String(terminal || '').replace(/\D/g, '')];
  return t ? `${t.name} (Concourse${t.concourses.length > 1 ? 's' : ''} ${t.concourses.join(', ')})` : '';
}

export class FlightError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

async function fetchSnapshot(url, { fetchImpl = fetch, signal } = {}) {
  let response;
  try { response = await fetchImpl(url.href, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' }); }
  catch (e) { if (e?.name === 'AbortError') throw e; throw new FlightError('offline'); }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    const code = typeof body?.error === 'string' ? body.error : body?.error?.code || `http-${response.status}`;
    throw new FlightError(code);
  }
  if (!Array.isArray(body?.data)) throw new FlightError('invalid-response');
  return {
    data: body.data,
    fetchedAt: Number.isFinite(Date.parse(body.fetchedAt)) ? body.fetchedAt : null,
    refreshMinutes: body.refreshMinutes ?? body.cachedFor ?? null
  };
}

// Ask the Worker for the last checked departure details and the snapshot time.
export function fetchFlights(apiBase, iata, options) {
  const url = new URL(apiBase);
  url.pathname = url.pathname.replace(/\/?$/, '/flight');
  url.searchParams.set('number', iata);
  return fetchSnapshot(url, options);
}

// Sample flights keep their clock times but move to today's date, so "next departure" logic still works.
export function sampleFlights(samples, now = chicagoNow()) {
  const today = now.slice(0, 10);
  const move = iso => typeof iso === 'string' ? today + iso.slice(10) : iso;
  return (samples.flights || []).map(f => ({ ...f, flight_date: today, departure: { ...f.departure, scheduled: move(f.departure?.scheduled), estimated: move(f.departure?.estimated) } }));
}

// ---------- Flight board ----------
const dayAfter = date => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
// Sample times use today's date or the next day once more than 30 minutes past.
export function sampleBoard(samples, now = chicagoNow(), { direction = 'departures' } = {}) {
  const today = now.slice(0, 10), tomorrow = dayAfter(today), nowMin = keyMinutes(now);
  const side = direction === 'arrivals' ? 'arrival' : 'departure';
  const move = (iso, date) => typeof iso === 'string' ? date + iso.slice(10) : iso;
  return (samples.flights || []).map(f => {
    const local = f[side];
    const date = keyMinutes(`${today}T${local.scheduled.slice(11, 16)}`) < nowMin - 30 ? tomorrow : today;
    return { ...f, flight_date: date, [side]: { ...local, scheduled: move(local.scheduled, date), estimated: move(local.estimated, date) } };
  });
}
const searchKey = value => String(value || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

// O'Hare flights in time order. Keep codeshares available for flight-number searches.
export function boardRows(items, now = chicagoNow(), { direction = 'departures', terminal = 'all', query = '', limit = 80 } = {}) {
  const nowMin = keyMinutes(now), q = searchKey(query);
  const at = f => keyMinutes((f.estimated || f.scheduled).key);
  const seen = new Set();
  return (items || []).map(item => normalizeRecord(item, direction))
    .filter(f => (direction === 'arrivals' ? f.to.iata : f.from) === 'ORD' && f.scheduled && f.iata)
    .filter(f => !f.operatedBy || (q && searchKey(f.iata).includes(q)))
    .filter(f => { if (seen.has(f.iata + f.scheduled.key)) return false; seen.add(f.iata + f.scheduled.key); return true; })
    .map(f => ({ ...f, label: normalizeFlight(f.iata)?.label || f.iata }))
    .filter(f => at(f) >= nowMin - 15 && at(f) <= nowMin + 1440)
    .filter(f => terminal === 'all' || f.terminal === terminal)
    .filter(f => !q || [f.iata, f.airline, f.airport.name, f.airport.iata, f.gate].some(value => searchKey(value).includes(q)))
    .sort((a, b) => at(a) - at(b) || a.iata.localeCompare(b.iata))
    .slice(0, limit);
}
export function fetchBoard(apiBase, { direction = 'departures', ...options } = {}) {
  const url = new URL(apiBase);
  url.pathname = url.pathname.replace(/\/?$/, '/board');
  if (direction === 'arrivals') url.searchParams.set('direction', 'arrivals');
  return fetchSnapshot(url, options);
}

// Plain-language reasons for each failure the Worker or Aviationstack can return.
export function errorText(code) {
  const c = String(code || '');
  if (c === 'bad-number' || c === 'invalid-number') return 'That does not look like a flight number. Use the airline code and number from your boarding pass, like UA 1234.';
  if (c === 'offline') return 'The flight service could not be reached. Check your connection, or search for your gate below.';
  if (/usage_limit|rate_limit|too_many/.test(c) || c === 'http-429') return 'This prototype has used up its free flight lookups for now. Search for your gate number below instead.';
  if (/access_key|invalid_access|missing_access|http-401|function_access/.test(c)) return 'The flight service is not set up correctly. Search for your gate number below instead.';
  return 'Flight information is not available right now. Search for your gate number below instead.';
}
