// Following a route: the simulated walk and live GPS tracking share these pieces.
// Pure functions plus a small GPS watcher, so `npm test` covers them without a browser.
import { metersBetween } from '../router.js';

export const WALK_SPEED = 75 / 60;            // metres a second: the same 75 m a minute as the route times
export const AIRPORT_CENTER = [41.9786, -87.9048];

// Distance along the route at every point.
export function measureRoute(route) {
  const along = [0];
  for (let i = 1; i < route.points.length; i++) along.push(along[i - 1] + metersBetween(route.points[i - 1], route.points[i]));
  return { along, total: along.at(-1) || 0 };
}

// Where someone is after walking `d` metres: the point, the segment and the floor.
export function positionAt(route, m, d) {
  const dist = Math.max(0, Math.min(m.total, d));
  let i = 0;
  while (i < m.along.length - 2 && m.along[i + 1] < dist) i++;
  const span = m.along[i + 1] - m.along[i];
  const f = span > 0 ? (dist - m.along[i]) / span : 0;
  const a = route.points[i], b = route.points[i + 1] || a;
  // A level change belongs to the floor you are heading to once you are past halfway.
  const level = f > 0.5 ? route.levels[i + 1] ?? route.levels[i] : route.levels[i];
  return { point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], index: i, level, along: dist, remaining: m.total - dist };
}

// The written step someone is on: the first whose end is still ahead.
export function stepAt(route, m, d) {
  const steps = route.steps;
  for (let i = 0; i < steps.length; i++) {
    const end = m.along[Math.min(steps[i].range[1], m.along.length - 1)];
    if (steps[i].kind === 'arrive') return i;
    if (d < end - 2) return i;
  }
  return steps.length - 1;
}
export const metersLeftInStep = (route, m, d, i) => Math.max(0, m.along[Math.min(route.steps[i].range[1], m.along.length - 1)] - d);

// Put a GPS fix on the route. GPS cannot tell the Upper Level from the tunnel below it, so the
// fix is matched along the route, preferring places just ahead of where the walker was.
export function snapToRoute(route, m, point, lastAlong = 0) {
  const scale = Math.cos(point[0] * Math.PI / 180);
  let best = null;
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i], b = route.points[i + 1], dx = (b[1] - a[1]) * scale, dy = b[0] - a[0];
    const den = dx * dx + dy * dy;
    const f = den ? Math.max(0, Math.min(1, ((point[1] - a[1]) * scale * dx + (point[0] - a[0]) * dy) / den)) : 0;
    const snapped = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const off = metersBetween(point, snapped), along = m.along[i] + (m.along[i + 1] - m.along[i]) * f;
    const backwards = Math.max(0, lastAlong - along - 25), leap = Math.max(0, along - lastAlong - 200);
    const score = off + backwards * 0.6 + leap * 0.3;
    if (!best || score < best.score) best = { score, off, along, point: snapped, index: i };
  }
  return best;
}

// Ray casting: is the point inside the airport boundary polygon?
export function insideAirport(boundary, [lat, lng]) {
  if (!boundary?.length) return false;
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [yi, xi] = boundary[i], [yj, xj] = boundary[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function nearestGate(ctx, point) {
  let best = null, distance = Infinity;
  for (const p of ctx.places) { if (p.kind !== 'gate') continue; const d = metersBetween(point, p.point); if (d < distance) { distance = d; best = p; } }
  return best ? { place: best, distance } : null;
}

// Watch GPS until stopped. Weak fixes are still reported (with their accuracy) so the map can
// show how unsure the position is; the caller decides whether to trust them.
export const GOOD_ACCURACY = 60, USABLE_ACCURACY = 120;
export class LocationWatch {
  constructor(geolocation, onFix, onState, now = () => Date.now()) {
    Object.assign(this, { geo: geolocation, onFix, onState, now, id: null, generation: 0, active: false, last: 0 });
  }
  start() {
    this.stop();
    if (!this.geo) { this.onState('unsupported'); return; }
    this.active = true; this.last = 0;
    const generation = this.generation;
    this.onState('locating');
    try {
      const id = this.geo.watchPosition(position => {
        if (!this.active || generation !== this.generation) return;
        const { latitude, longitude, accuracy } = position.coords;
        if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0) return;
        if (this.now() - position.timestamp > 30000 || position.timestamp <= this.last) return;
        this.last = position.timestamp;
        this.onFix({ point: [latitude, longitude], accuracy, timestamp: position.timestamp });
      }, error => {
        if (!this.active || generation !== this.generation) return;
        if (error.code === 1) { this.stop(); this.onState('denied'); }
        else this.onState(error.code === 3 ? 'timeout' : 'unavailable');
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 });
      if (this.active && generation === this.generation) this.id = id; else this.geo.clearWatch(id);
    } catch { this.stop(); this.onState('unavailable'); }
  }
  stop() {
    this.active = false; this.generation++;
    if (this.id !== null) this.geo?.clearWatch(this.id);
    this.id = null;
  }
}
