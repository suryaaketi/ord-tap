import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createContext, planTrip } from '../ord/core.js';
import { normalizeFlight, normalizeRecord, pickFlight, findGate, looksLikeGate, fetchFlights, fetchBoard, boardRows, sampleBoard, sampleFlights, errorText, clockText, chicagoNow } from '../ord/flights.js';
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
  const fetchedAt = '2026-11-04T18:00:00.000Z';
  const ok = async url => {
    asked = url;
    return new Response(JSON.stringify({ data: [record()], fetchedAt, cachedFor: 10 }));
  };
  const snapshot = await fetchFlights('https://ord-tap-flights.example.workers.dev', 'UA1234', { fetchImpl: ok });
  assert.equal(asked, 'https://ord-tap-flights.example.workers.dev/flight?number=UA1234');
  assert.equal(snapshot.data.length, 1);
  assert.equal(snapshot.fetchedAt, fetchedAt);
  assert.equal(snapshot.refreshMinutes, 10);
  const board = await fetchBoard('https://ord-tap-flights.example.workers.dev', { fetchImpl: ok });
  assert.equal(asked, 'https://ord-tap-flights.example.workers.dev/board');
  assert.equal(board.fetchedAt, fetchedAt);
  await fetchBoard('https://ord-tap-flights.example.workers.dev', { direction: 'arrivals', fetchImpl: ok });
  assert.equal(asked, 'https://ord-tap-flights.example.workers.dev/board?direction=arrivals');
  await assert.rejects(fetchBoard('https://x.example', { fetchImpl: async () => new Response('{}') }), e => e.code === 'invalid-response');
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
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.ok(body.fetchedAt);
    await ask('UA1234'); assert.equal(calls, 1, 'second ask comes from the cache');
    assert.equal((await ask('hello')).status, 400);
    assert.equal((await ask('UA1234', 'https://evil.example')).status, 403);
    assert.equal((await worker.fetch(new Request('https://w.example/flight?number=UA9'), {})).status, 500);
  } finally { globalThis.fetch = realFetch; }
});

test('the departures board lists upcoming O\'Hare departures in order, without codeshare copies', async () => {
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
  assert.deepEqual(boardRows(items, '2026-11-04T18:00', { query: 'LH-9000' }).map(r => r.iata), ['LH9000']);
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

test('arrivals search uses the incoming flight, origin and O’Hare arrival gate', () => {
  const now = '2026-11-04T12:00';
  const data = sampleBoard(read('../data/sample-arrivals.json'), now, { direction: 'arrivals' });
  const matches = query => boardRows(data, now, { direction: 'arrivals', query });
  const [flight] = matches('UA-1762');
  assert.equal(flight.iata, 'UA1762');
  assert.deepEqual(flight.airport, { name: 'New York LaGuardia', iata: 'LGA' });
  assert.equal(flight.gate, 'C19');
  assert.equal(clockText(flight.scheduled), '1:20 p.m.');
  assert.equal(clockText(flight.estimated), '1:42 p.m.');
  assert.deepEqual(matches('New York'), matches('LGA'));
  assert.equal(matches('no match').length, 0);
  assert.equal(boardRows(data, now, { direction: 'arrivals', terminal: '3', query: 'LGA' }).length, 0);
  assert.equal(boardRows(data, now).length, 0);
});

test('the Worker serves the board from its cache for the time set in BOARD_MINUTES', async () => {
  let calls = 0, upstream = '';
  const realFetch = globalThis.fetch;
  const arrival = read('../data/sample-arrivals.json').flights[0];
  globalThis.fetch = async url => { calls++; upstream = String(url); return new Response(JSON.stringify({ data: [record(), arrival] })); };
  try {
    const env = { AVIATIONSTACK_KEY: 'secret-key', BOARD_MINUTES: '15' };
    const ask = () => worker.fetch(new Request('https://w.example/board', { headers: { Origin: 'https://suryaaketi.github.io' } }), env);
    const body = await (await ask()).json();
    assert.match(upstream, /dep_iata=ORD/); assert.doesNotMatch(upstream, /flight_iata/);
    assert.equal(body.refreshMinutes, 15); assert.ok(body.fetchedAt); assert.equal(body.data.length, 1);
    assert.ok(!JSON.stringify(body).includes('secret-key'));
    await ask(); await ask(); assert.equal(calls, 1);
    const askArrivals = () => worker.fetch(new Request('https://w.example/board?direction=arrivals'), env);
    const incoming = await (await askArrivals()).json();
    assert.match(upstream, /arr_iata=ORD/);
    assert.doesNotMatch(upstream, /dep_iata/);
    assert.equal(incoming.data.length, 1);
    assert.equal(incoming.data[0].arrival.gate, arrival.arrival.gate);
    assert.equal(incoming.data[0].arrival.scheduled, arrival.arrival.scheduled);
    await askArrivals(); await ask(); assert.equal(calls, 2);
    assert.equal((await worker.fetch(new Request('https://w.example/board?direction=unknown'), env)).status, 400);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'usage_limit_reached', message: 'Do not return secret-key' } }), { status: 429 });
    const fresh = await worker.fetch(new Request('https://w.example/flight?number=AA1'), env);
    assert.equal(fresh.status, 429);
    assert.deepEqual(await fresh.json(), { error: { code: 'usage_limit_reached' } });
    globalThis.fetch = async () => new Response(JSON.stringify({ pagination: {} }));
    const malformed = await worker.fetch(new Request('https://w.example/flight?number=AA2'), env);
    assert.equal(malformed.status, 502);
    assert.deepEqual(await malformed.json(), { error: 'invalid-upstream-response' });
  } finally { globalThis.fetch = realFetch; }
});

function aeroDeparture(number, time, overrides = {}) {
  return {
    number, status: 'Expected', isCargo: false, codeshareStatus: 'IsOperator',
    departure: { terminal: '1', gate: 'C17', scheduledTime: { local: time } },
    arrival: { airport: { name: 'Denver International', iata: 'DEN' } },
    airline: { name: 'United Airlines' },
    ...overrides
  };
}

test('the same searchable board shows the complete Chicago day from both live windows', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-13T02:00:00Z') });
  const day = '2026-11-12', now = chicagoNow();
  const morning = Array.from({ length: 130 }, (_, i) => aeroDeparture(`UA ${200 + i}`, `${day} 09:00-06:00`));
  const evening = aeroDeparture('UA 0730', `${day} 22:15-06:00`, {
    status: 'Boarding',
    departure: {
      terminal: '1', gate: 'C17',
      scheduledTime: { local: `${day} 22:15-06:00`, utc: '2026-11-13 04:15Z' },
      revisedTime: { local: `${day} 22:30-06:00`, utc: '2026-11-13 04:30Z' }
    }
  });
  const boundary = aeroDeparture('UA 88', `${day} 12:00-06:00`);
  const codeshare = aeroDeparture('LH 9500', `${day} 22:15-06:00`, { codeshareStatus: 'IsCodeshared' });
  const arrivals = [{
    number: 'AA 20', status: 'Arrived',
    departure: { airport: { name: 'New York LaGuardia', iata: 'LGA' } },
    arrival: { terminal: '3', gate: 'K10', scheduledTime: { local: `${day} 10:00-06:00` } }
  }];
  const requests = [];
  const env = { AERODATABOX_KEY: 'test-secret', BOARD_MINUTES: '15' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const asked = new URL(url);
    requests.push(asked.pathname);
    assert.equal(asked.hostname, 'aerodatabox.p.rapidapi.com');
    assert.equal(asked.searchParams.get('direction'), 'Both');
    assert.equal(asked.searchParams.get('withLeg'), 'true');
    assert.equal(options.headers['X-RapidAPI-Key'], env.AERODATABOX_KEY);
    assert.ok(!asked.href.includes(env.AERODATABOX_KEY));
    return Response.json(asked.pathname.endsWith(`${day}T12:00`)
      ? { departures: [...morning, boundary], arrivals }
      : { departures: [boundary, evening, codeshare, aeroDeparture('UA 999', '2026-11-13 00:00-06:00')], arrivals: null });
  });

  const fetchImpl = url => worker.fetch(new Request(url), env);
  const base = 'https://ord-worker.example';
  const board = await fetchBoard(base, { fetchImpl });
  assert.equal(board.date, day);
  assert.equal(board.source, 'aerodatabox');
  assert.equal(board.refreshMinutes, 15);
  assert.equal(board.fetchedAt, '2026-11-13T02:00:00.000Z');
  assert.equal(board.data.length, 133);
  assert.ok(!JSON.stringify(board).includes(env.AERODATABOX_KEY));
  const departures = boardRows(board.data, now, { date: board.date });
  assert.equal(departures.length, 132);
  assert.equal(departures[0].iata, 'UA730');
  assert.equal(departures[0].statusText, 'Boarding');
  assert.equal(departures[0].delay, 15);
  assert.equal(clockText(departures[0].estimated), '10:30 p.m.');
  assert.equal(findGate(ctx, departures[0].gate, departures[0].terminal).id, 't1-c17');
  assert.equal(boardRows(board.data, now, { date: day, query: 'denver' }).length, departures.length);
  assert.equal(boardRows(board.data, now, { date: day, query: 'UA-0730' })[0].iata, 'UA730');
  assert.equal(boardRows(board.data, now, { date: day, query: 'LH 9500' })[0].iata, 'LH9500');

  const incoming = await fetchBoard(base, { direction: 'arrivals', fetchImpl });
  const [arrival] = boardRows(incoming.data, now, { direction: 'arrivals', date: incoming.date, query: 'New York' });
  assert.equal(arrival.iata, 'AA20');
  assert.equal(arrival.gate, 'K10');
  const lookup = await fetchFlights(base, 'UA 0730', { fetchImpl });
  assert.deepEqual(lookup.data, board.data.filter(f => f.flight.iata === 'UA730'));
  assert.deepEqual(requests, [
    '/flights/airports/iata/ORD/2026-11-12T00:00/2026-11-12T12:00',
    '/flights/airports/iata/ORD/2026-11-12T12:00/2026-11-13T00:00'
  ]);
});

test('the daily board keeps an overnight delay and excludes tomorrow’s schedule', () => {
  const date = '2026-11-12', now = `${date}T23:55`;
  const shifted = record({ departure: { scheduled: `${date}T23:50:00-06:00`, estimated: '2026-11-13T00:15:00-06:00' } });
  const tomorrow = record({ departure: { scheduled: '2026-11-13T01:00:00-06:00', estimated: null } });
  const [flight, ...rest] = boardRows([shifted, tomorrow], now, { date });
  assert.equal(flight.scheduled.date, date);
  assert.equal(flight.estimated.date, '2026-11-13');
  assert.deepEqual(rest, []);
});

test('a failed window returns an error and a retry can load the full board', async t => {
  const date = '2026-11-01';
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T19:00:00Z`) });
  const requests = [];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (fail && path.endsWith('2026-11-02T00:00')) {
      return Response.json({ message: 'upstream diagnostic' }, { status: 429 });
    }
    return new Response(null, { status: 204 });
  });
  const env = { AERODATABOX_KEY: 'test-secret' };
  const req = new Request('https://ord-worker.example/board');
  const first = await worker.fetch(req, env);
  assert.equal(first.status, 429);
  assert.deepEqual(await first.json(), { error: 'http-429' });
  assert.deepEqual(requests, [
    '/flights/airports/iata/ORD/2026-11-01T00:00/2026-11-01T06:00',
    '/flights/airports/iata/ORD/2026-11-01T06:00/2026-11-01T12:00',
    '/flights/airports/iata/ORD/2026-11-01T12:00/2026-11-02T00:00'
  ]);
  fail = false;
  const retry = await worker.fetch(req, env);
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).data, []);
  assert.equal(requests.length, 6);
});
