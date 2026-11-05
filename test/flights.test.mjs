import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createContext, planTrip } from '../ord/core.js';
import { normalizeFlight, normalizeRecord, pickFlight, findGate, looksLikeGate, fetchFlights, sampleFlights, errorText, clockText, chicagoNow } from '../ord/flights.js';
import worker from '../worker/flight-worker.js';

const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ctx = createContext(read('../data/network.json'), read('../data/places.json'));
const samples = read('../data/sample-flights.json');
const record = (over = {}) => ({ flight_status: 'scheduled', departure: { iata: 'ORD', terminal: '1', gate: 'C17', delay: null, scheduled: '2026-11-04T18:05:00+00:00', estimated: '2026-11-04T18:05:00+00:00', ...over.departure }, arrival: { airport: 'Denver International', iata: 'DEN' }, airline: { name: 'United Airlines' }, flight: { iata: 'UA1234', codeshared: null }, ...over.top });

test('flight numbers are read the way people type them', () => {
  for (const t of ['UA1234', 'ua 1234', 'UA-1234', ' Ua1234 ']) assert.equal(normalizeFlight(t).iata, 'UA1234', t);
  assert.equal(normalizeFlight('AA 0088').iata, 'AA88');
  assert.equal(normalizeFlight('B6 123').iata, 'B6123');
  assert.equal(normalizeFlight('9K 5').iata, '9K5');
  assert.equal(normalizeFlight('UA 1234').label, 'UA 1234');
  for (const t of ['', 'UA', '1234', 'UA12345', 'hello']) assert.equal(normalizeFlight(t), null, t);
});

test('departure times keep the Chicago clock time even with a +00:00 suffix', () => {
  const f = normalizeRecord(record());
  assert.equal(clockText(f.scheduled), '6:05 p.m.');
  assert.equal(f.estimated, null);                        // same as scheduled
  const late = normalizeRecord(record({ departure: { delay: 25, estimated: '2026-11-04T18:30:00+00:00' } }));
  assert.equal(clockText(late.estimated), '6:30 p.m.'); assert.equal(late.tone, 'warn');
  assert.equal(normalizeRecord(record({ top: { flight_status: 'cancelled' } })).tone, 'bad');
  assert.equal(normalizeRecord({}).statusText, 'Status unknown');
  assert.equal(normalizeRecord(record({ departure: { terminal: 'T5' } })).terminal, '5');
});

test('the next O\'Hare departure is chosen from several records', () => {
  const items = [
    record({ departure: { scheduled: '2026-11-03T18:05:00+00:00', estimated: null } }),   // yesterday
    record({ departure: { scheduled: '2026-11-04T18:05:00+00:00', estimated: null } }),   // today
    record({ departure: { iata: 'DEN', scheduled: '2026-11-04T12:00:00+00:00' } })         // other airport
  ];
  assert.equal(pickFlight(items, '2026-11-04T15:00').scheduled.date, '2026-11-04');
  assert.equal(pickFlight(items, '2026-11-04T20:00').scheduled.date, '2026-11-04');      // delayed allowance
  assert.equal(pickFlight(items, '2026-11-06T09:00').scheduled.date, '2026-11-04');      // all past: latest
  assert.equal(pickFlight([record({ departure: { iata: 'DEN' } })]), null);
  assert.equal(pickFlight([]), null);
});

test('gates from the API land on places in the map', () => {
  assert.equal(findGate(ctx, 'C17', '1').id, 't1-c17');
  assert.equal(findGate(ctx, 'Gate c-17', '').id, 't1-c17');
  assert.equal(findGate(ctx, 'C17A', '1').id, 't1-c17');      // suffix not mapped: same gate
  assert.equal(findGate(ctx, '13', '5').id, 't5-m13');       // bare number in a one-concourse terminal
  assert.equal(findGate(ctx, '13', '1'), null);               // ambiguous: B13 or C13
  assert.equal(findGate(ctx, 'H1B', '3').id, 't3-h1b');
  assert.equal(findGate(ctx, '', '1'), null);
  assert.equal(findGate(ctx, 'Z99', '1'), null);
  assert.equal(looksLikeGate(ctx, 'C17').id, 't1-c17');     // typed a gate into the flight box
  assert.equal(looksLikeGate(ctx, 'gate b6').id, 't1-b6');
  assert.equal(looksLikeGate(ctx, 'UA1234'), null);
});

test('sample flights cover a route, a delay, no gate, another terminal, Terminal 5 and a cancellation', () => {
  const now = chicagoNow(new Date('2026-11-04T18:00:00Z'));
  const flights = sampleFlights(samples, now);
  assert.ok(flights.every(f => f.departure.scheduled.startsWith('2026-11-04')));
  const pick = iata => pickFlight(flights.filter(f => f.flight.iata === iata), now);
  const ua1234 = pick('UA1234'), gate = findGate(ctx, ua1234.gate, ua1234.terminal);
  assert.equal(gate.id, 't1-c17'); assert.equal(planTrip(ctx, 't1-b6', gate.id).route.minutes, 7);
  assert.ok(pick('UA2210').estimated);
  assert.equal(pick('UA4567').gate, '');
  assert.equal(planTrip(ctx, 't1-b6', findGate(ctx, pick('AA2345').gate, '3').id).type, 'preview');
  assert.equal(planTrip(ctx, 't1-b6', findGate(ctx, pick('DL3456').gate, '5').id).type, 'transfer');
  assert.equal(pick('UA5678').status, 'cancelled');
});

test('the browser asks the Worker, never Aviationstack, and errors become plain sentences', async () => {
  let asked = '';
  const ok = async url => { asked = url; return new Response(JSON.stringify({ data: [record()] }), { status: 200 }); };
  const data = await fetchFlights('https://ord-tap-flights.example.workers.dev', 'UA1234', { fetchImpl: ok });
  assert.equal(asked, 'https://ord-tap-flights.example.workers.dev/flight?number=UA1234');
  assert.equal(data.length, 1);
  const quota = async () => new Response(JSON.stringify({ error: { code: 'usage_limit_reached' } }), { status: 429 });
  await assert.rejects(fetchFlights('https://x.example', 'UA1', { fetchImpl: quota }), e => e.code === 'usage_limit_reached');
  await assert.rejects(fetchFlights('https://x.example', 'UA1', { fetchImpl: async () => { throw new TypeError('down'); } }), e => e.code === 'offline');
  assert.match(errorText('usage_limit_reached'), /used up/);
  assert.match(errorText('bad-number'), /UA 1234/);
});

test('the Worker hides the key, checks the number and the website, and reuses answers', async () => {
  let calls = 0, upstream = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { calls++; upstream = String(url); return new Response(JSON.stringify({ pagination: {}, data: [{ ...record(), live: null, aircraft: { registration: 'N1' } }] })); };
  try {
    const env = { AVIATIONSTACK_KEY: 'secret-key' };
    const ask = (q, origin = 'https://suryaaketi.github.io') => worker.fetch(new Request(`https://w.example/flight?number=${q}`, { headers: { Origin: origin } }), env);
    const r = await ask('ua%201234'), body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://suryaaketi.github.io');
    assert.match(upstream, /flight_iata=UA1234/); assert.match(upstream, /dep_iata=ORD/);
    assert.ok(!JSON.stringify(body).includes('secret-key'));
    assert.equal(body.data[0].departure.gate, 'C17'); assert.equal(body.data[0].aircraft, undefined);
    await ask('UA1234'); assert.equal(calls, 1, 'second ask comes from the cache');
    assert.equal((await ask('hello')).status, 400);
    assert.equal((await ask('UA1234', 'https://evil.example')).status, 403);
    assert.equal((await worker.fetch(new Request('https://w.example/flight?number=UA9'), {})).status, 500);
  } finally { globalThis.fetch = realFetch; }
});

test('the departures board lists upcoming O\'Hare departures in order, without codeshare copies', async () => {
  const { boardRows, sampleBoard } = await import('../ord/flights.js');
  const at = (t, over = {}) => record({ departure: { scheduled: `2026-11-04T${t}:00+00:00`, estimated: null, ...over.departure }, top: over.top });
  const items = [
    at('19:00', { top: { flight: { iata: 'AA10', codeshared: null }, airline: { name: 'American Airlines' } }, departure: { terminal: '3', gate: 'K10' } }),
    at('18:00'),
    at('18:00', { top: { flight: { iata: 'LH9000', codeshared: { airline_name: 'united airlines', flight_iata: 'ua1234' } } } }),
    at('10:00'),                                                    // long gone
    at('17:50'),                                                    // 10 minutes ago: still shown
    record({ departure: { iata: 'DEN', scheduled: '2026-11-04T18:30:00+00:00' } })
  ];
  const rows = boardRows(items, '2026-11-04T18:00');
  assert.deepEqual(rows.map(r => r.scheduled.key.slice(11)), ['17:50', '18:00', '19:00']);
  assert.ok(rows.every(r => r.iata !== 'LH9000'));
  assert.equal(rows[0].label, 'UA 1234');
  assert.deepEqual(boardRows(items, '2026-11-04T18:00', { terminal: '3' }).map(r => r.iata), ['AA10']);
  assert.deepEqual(boardRows(items, '2026-11-04T18:00', { query: 'american' }).map(r => r.iata), ['AA10']);
  assert.equal(boardRows(items, '2026-11-04T18:00', { query: 'denver' }).length, 3);
  assert.deepEqual(boardRows(items, '2026-11-04T18:00', { query: 'k10' }).map(r => r.iata), ['AA10']);
  // Sample board: late at night, the morning flights move to tomorrow so the board is never empty.
  const board = read('../data/sample-board.json');
  const late = boardRows(sampleBoard(board, '2026-11-04T23:50'), '2026-11-04T23:50');
  assert.ok(late.length >= 20); assert.equal(late[0].scheduled.date, '2026-11-05');
  const noon = boardRows(sampleBoard(board, '2026-11-04T12:00'), '2026-11-04T12:00');
  assert.equal(noon[0].scheduled.date, '2026-11-04');
  assert.ok(noon.every((r, i) => i === 0 || (r.estimated || r.scheduled).key >= (noon[i - 1].estimated || noon[i - 1].scheduled).key));
  // Every sample gate is on the map.
  for (const f of board.flights) if (f.departure.gate) assert.ok(findGate(ctx, f.departure.gate, f.departure.terminal), f.departure.gate);
});

test('the Worker serves the board from its cache for the time set in BOARD_MINUTES', async () => {
  let calls = 0, upstream = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { calls++; upstream = String(url); return new Response(JSON.stringify({ data: [record()] })); };
  try {
    const env = { AVIATIONSTACK_KEY: 'secret-key', BOARD_MINUTES: '15' };
    const ask = () => worker.fetch(new Request('https://w.example/board', { headers: { Origin: 'https://suryaaketi.github.io' } }), env);
    const body = await (await ask()).json();
    assert.match(upstream, /dep_iata=ORD/); assert.doesNotMatch(upstream, /flight_iata/);
    assert.equal(body.refreshMinutes, 15); assert.ok(body.fetchedAt); assert.equal(body.data.length, 1);
    assert.ok(!JSON.stringify(body).includes('secret-key'));
    await ask(); await ask(); assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'usage_limit_reached', message: 'x' } }), { status: 429 });
    const fresh = await worker.fetch(new Request('https://w.example/flight?number=AA1'), env);
    assert.equal(fresh.status, 429); assert.equal((await fresh.json()).error.code, 'usage_limit_reached');
  } finally { globalThis.fetch = realFetch; }
});
