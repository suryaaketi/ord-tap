import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createContext, planTrip } from '../ord/core.js';
import { measureRoute, positionAt, stepAt, snapToRoute, insideAirport, nearestGate, LocationWatch, WALK_SPEED } from '../ord/walk.js';

const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ctx = createContext(read('../data/network.json'), read('../data/places.json'));
const boundary = read('../data/outline.json').boundary;
const route = planTrip(ctx, 't1-b6', 't1-c17').route;
const m = measureRoute(route);

test('the simulated walk covers the route at the same pace as the route time', () => {
  assert.ok(Math.abs(m.total - route.distance) < 1, `${m.total} vs ${route.distance}`);
  assert.equal(WALK_SPEED * 60, 75);
  assert.deepEqual(positionAt(route, m, 0).point, route.points[0]);
  assert.deepEqual(positionAt(route, m, m.total).point, route.points.at(-1));
  assert.equal(positionAt(route, m, m.total + 50).remaining, 0);
  // Walking the whole route passes through the tunnel and back up.
  const levels = [];
  for (let d = 0; d <= m.total; d += 2) { const l = positionAt(route, m, d).level; if (levels.at(-1) !== l) levels.push(l); }
  assert.deepEqual(levels, ['t1-upper', 't1-tunnel', 't1-upper']);
});

test('the current written step moves forward and ends on arrival', () => {
  const seen = [];
  for (let d = 0; d <= m.total; d += 1) { const i = stepAt(route, m, d); if (seen.at(-1) !== i) seen.push(i); }
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'never goes backwards');
  assert.equal(seen[0], 0);
  assert.equal(route.steps[seen.at(-1)].kind, 'arrive');
  assert.ok(seen.length >= route.steps.length - 1);
});

test('GPS fixes snap to the route and prefer moving forward', () => {
  const mid = positionAt(route, m, 250);
  const fix = [mid.point[0] + 0.00012, mid.point[1]];         // about 13 m off the line
  const s = snapToRoute(route, m, fix, 200);
  assert.ok(s.off < 20); assert.ok(Math.abs(s.along - 250) < 20);
  // Concourse B runs north to the tunnel and Concourse C comes back south: a fix near the start of
  // the tunnel should not jump to the end of the route.
  const early = positionAt(route, m, 120);
  assert.ok(snapToRoute(route, m, early.point, 100).along < 200);
});

test('the airport boundary tells O\'Hare from the rest of Chicago', () => {
  assert.equal(insideAirport(boundary, ctx.byId.get('t1-b6').point), true);
  assert.equal(insideAirport(boundary, ctx.byId.get('t5-m13').point), true);
  assert.equal(insideAirport(boundary, [41.8789, -87.6359]), false);      // the Loop
  assert.equal(insideAirport(boundary, [41.9620, -87.9500]), false);      // just west of the field
  assert.equal(insideAirport([], [41.97, -87.9]), false);
  const near = nearestGate(ctx, [41.97789, -87.90698]);
  assert.equal(near.place.terminal, '1'); assert.ok(near.distance < 60);
});

test('the GPS watcher reports fixes, refusals and stops cleanly', () => {
  let ok, err, cleared = 0;
  const geo = { watchPosition: (s, e) => { ok = s; err = e; return 7; }, clearWatch: id => { if (id === 7) cleared++; } };
  const fixes = [], states = [];
  const w = new LocationWatch(geo, f => fixes.push(f), s => states.push(s), () => 1000);
  w.start();
  ok({ coords: { latitude: 41.979, longitude: -87.907, accuracy: 30 }, timestamp: 990 });
  ok({ coords: { latitude: 41.979, longitude: -87.907, accuracy: 30 }, timestamp: 990 });   // duplicate ignored
  ok({ coords: { latitude: NaN, longitude: -87.907, accuracy: 30 }, timestamp: 995 });       // bad fix ignored
  assert.equal(fixes.length, 1); assert.equal(fixes[0].accuracy, 30);
  err({ code: 1 });
  assert.deepEqual(states, ['locating', 'denied']); assert.equal(cleared, 1);
  ok({ coords: { latitude: 41.979, longitude: -87.907, accuracy: 10 }, timestamp: 999 });    // after stop: ignored
  assert.equal(fixes.length, 1);
  const none = []; new LocationWatch(undefined, () => {}, s => none.push(s)).start();
  assert.deepEqual(none, ['unsupported']);
});
