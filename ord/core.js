// O'Hare wayfinding logic with no page code, so every rule here runs under `npm test`.
// The network is built from data/network.json (verified corridors and level changes) and
// data/places.json (gates and amenities). Routing reuses the same WalkingRouter as Campus Tap.
import { WalkingRouter, metersBetween } from '../router.js';

export const WALK_METERS_PER_MINUTE = 75;
const ATTACH_LIMIT = 70;        // farthest a place may sit from a verified corridor and still get a route
const SAME_POINT = 0.5;         // metres: points closer than this share a node
export const STEP_FLAG = 1;     // escalators and stairs: skipped when someone asks to avoid them
export const LIFT_FLAG = 2;     // elevators: small wait penalty in the router

const toXY = ([lat, lng], lat0) => [lng * 111320 * Math.cos(lat0 * Math.PI / 180), lat * 110540];

// Closest point on a polyline, with how far along the line it sits.
export function project(points, point) {
  const lat0 = point[0], p = toXY(point, lat0);
  let best = null, along = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = toXY(points[i], lat0), b = toXY(points[i + 1], lat0);
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const q = [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    const distance = metersBetween(point, q), seg = metersBetween(points[i], points[i + 1]);
    if (!best || distance < best.distance) best = { point: q, distance, along: along + seg * t };
    along += seg;
  }
  return best;
}

export function buildNetwork(network, places) {
  const nodes = [], nodeLevel = [], edges = [], edgeMeta = [], names = [];
  const nameIndex = name => { let i = names.indexOf(name); if (i < 0) { i = names.length; names.push(name); } return i; };
  const addNode = (point, level) => { nodes.push([+point[0].toFixed(7), +point[1].toFixed(7)]); nodeLevel.push(level); return nodes.length - 1; };
  const addEdge = (a, b, meters, name, flags, meta) => { edges.push([a, b, Math.max(0.1, +meters.toFixed(1)), nameIndex(name), flags]); edgeMeta.push(meta); };
  const corridors = network.corridors.map(c => ({ ...c, stops: c.points.map((point, i) => ({ point, along: i ? null : 0, vertex: true })) }));
  // Distances along each corridor for its own vertices.
  for (const c of corridors) { let run = 0; c.stops.forEach((s, i) => { if (i) run += metersBetween(c.points[i - 1], c.points[i]); s.along = run; }); }
  const nearestCorridor = (point, level, security) => {
    let best = null;
    for (const c of corridors) {
      if (c.level !== level || (security && c.security !== security)) continue;
      const hit = project(c.points, point);
      if (!best || hit.distance < best.hit.distance) best = { corridor: c, hit };
    }
    return best;
  };
  // Every place, sign and level change that sits close to a verified corridor gets a stop on it.
  const placeNode = new Map(), attachments = [], unattached = [];
  for (const place of places) {
    const near = nearestCorridor(place.point, place.level, place.security);
    if (!near || near.hit.distance > ATTACH_LIMIT) { unattached.push(place.id); continue; }
    const stop = { point: near.hit.point, along: near.hit.along };
    near.corridor.stops.push(stop);
    attachments.push({ kind: 'place', place, corridor: near.corridor, stop });
  }
  const connectorEnds = [];
  for (const connector of network.connectors) {
    for (const end of ['upper', 'lower']) {
      const { point, level } = connector[end];
      const near = nearestCorridor(point, level, 'airside');
      if (!near || near.hit.distance > ATTACH_LIMIT) throw new Error(`${connector.id} ${end} is not on a corridor`);
      const stop = { point: near.hit.point, along: near.hit.along };
      near.corridor.stops.push(stop);
      connectorEnds.push({ connector, end, point, level, corridor: near.corridor, stop });
    }
  }
  // Lay out each corridor as a chain of nodes in walking order.
  for (const c of corridors) {
    c.stops.sort((a, b) => a.along - b.along);
    let previous = null;
    for (const stop of c.stops) {
      if (previous && Math.abs(stop.along - previous.along) < SAME_POINT) { stop.node = previous.node; continue; }
      stop.node = addNode(stop.point, c.level);
      if (previous) addEdge(previous.node, stop.node, stop.along - previous.along, c.name, 0, { kind: 'walk', corridor: c.id });
      previous = stop;
    }
  }
  for (const a of attachments) {
    const node = addNode(a.place.point, a.place.level);
    placeNode.set(a.place.id, node);
    addEdge(a.stop.node, node, metersBetween(a.stop.point, a.place.point), a.corridor.name, 0, { kind: 'stub', corridor: a.corridor.id, place: a.place.id });
  }
  const endNode = new Map();
  for (const e of connectorEnds) {
    const gap = metersBetween(e.point, e.stop.point);
    let node = e.stop.node;
    if (gap >= SAME_POINT) { node = addNode(e.point, e.level); addEdge(e.stop.node, node, gap, e.corridor.name, 0, { kind: 'walk', corridor: e.corridor.id }); }
    endNode.set(`${e.connector.id}:${e.end}`, node);
  }
  for (const connector of network.connectors) {
    const flags = connector.kind === 'elevator' ? LIFT_FLAG : STEP_FLAG;
    addEdge(endNode.get(`${connector.id}:upper`), endNode.get(`${connector.id}:lower`), connector.meters, connector.name, flags, { kind: connector.kind, connector: connector.id });
  }
  const graph = { nodes, edges, names };
  return { graph, nodeLevel, edgeMeta, placeNode, unattached, router: new WalkingRouter(graph) };
}

export function createContext(network, places) {
  const built = buildNetwork(network, places);
  const byId = new Map(places.map(p => [p.id, p]));
  const signs = network.signs.map(s => ({ ...s, place: byId.get(s.id) })).filter(s => s.place && built.placeNode.has(s.id));
  return { network, places, byId, signs, ...built, routable: id => built.placeNode.has(id) };
}

// ---------- Describing places ----------
export function levelName(ctx, levelId) { return ctx.network.levels[levelId]?.name || ''; }
export function placeFacts(ctx, place) {
  const t = ctx.network.terminals[place.terminal];
  return {
    terminal: t?.name || `Terminal ${place.terminal}`,
    concourse: place.concourse && place.concourse.length === 1 ? `Concourse ${place.concourse}` : '',
    level: levelName(ctx, place.level),
    security: place.security === 'landside' ? 'Before security' : 'After security',
    preview: t?.status !== 'routes'
  };
}

// ---------- Search ----------
const GATE = /^([a-z])\s*-?\s*(\d{1,2})\s*([a-z]?)$/;
export function normalizeQuery(text) {
  return String(text ?? '').toLowerCase().replace(/\bgates?\b/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const KIND_WORDS = { gate: ['gate', 'gates'], restroom: ['restroom', 'restrooms', 'toilet', 'toilets', 'bathroom', 'washroom'], food: ['food', 'eat', 'coffee', 'restaurant', 'bar', 'drink'], amenity: ['amenity', 'lounge', 'nursing', 'lactation', 'pet', 'animal', 'information', 'info'], transfer: ['transfer', 'bus', 'ats', 'train', 'transit'] };
export function search(ctx, text, kind = 'all') {
  const raw = String(text ?? '').trim().toLowerCase();
  const query = normalizeQuery(text);
  const pool = ctx.places.filter(p => kind === 'all' || p.kind === kind);
  if (!query) return pool;
  const gate = query.replace(/\s+/g, '').match(GATE) || query.match(GATE);
  if (gate) {
    const label = `${gate[1]}${gate[2]}${gate[3]}`.toUpperCase();
    const exact = pool.filter(p => p.kind === 'gate' && p.near === label);
    const near = pool.filter(p => p.kind !== 'gate' && p.near === label);
    if (exact.length || near.length) return [...exact, ...near];
  }
  const words = query.split(' ');
  const scored = [];
  for (const p of pool) {
    const hay = `${p.name} ${p.detail || ''} ${p.near ? 'gate ' + p.near : ''} concourse ${p.concourse} terminal ${p.terminal} t${p.terminal}`.toLowerCase();
    const kindHit = words.some(w => KIND_WORDS[p.kind]?.includes(w) || (p.sub && KIND_WORDS.amenity.includes(w) && hay.includes(w)));
    const allWords = words.every(w => hay.includes(w) || KIND_WORDS[p.kind]?.includes(w));
    if (!allWords && !kindHit) continue;
    const score = (p.name.toLowerCase() === raw ? 0 : p.name.toLowerCase().startsWith(raw) ? 1 : allWords ? 2 : 3);
    scored.push([score, p]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

// ---------- Transfer rules (checked 2026-11-04 on the official Transportation Between Terminals page) ----------
export function chicagoMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type)?.value);
  return get('hour') * 60 + get('minute');
}
export function busRunning(ctx, date = new Date()) {
  const { start, end } = ctx.network.transfers.ttb.hours;
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const now = chicagoMinutes(date);
  return now >= toMin(start) && now < toMin(end);
}

// ---------- Trips ----------
export function routeBetween(ctx, fromId, toId, options = {}) {
  const a = ctx.placeNode.get(fromId), b = ctx.placeNode.get(toId);
  if (a === undefined || b === undefined) return null;
  const route = ctx.router.routeNodes(a, b, { avoidStairs: !!options.avoidSteps });
  if (!route) return null;
  route.minutes = Math.max(1, Math.ceil(route.distance / WALK_METERS_PER_MINUTE));
  route.levels = route.indices.map(i => ctx.nodeLevel[i]);
  route.steps = directions(ctx, route, ctx.byId.get(fromId), ctx.byId.get(toId));
  return route;
}

export function planTrip(ctx, startId, destId, options = {}) {
  const start = ctx.byId.get(startId), dest = ctx.byId.get(destId);
  if (!dest) return { type: 'unknown' };
  if (!start || !ctx.routable(startId)) return { type: 'no-start', dest };
  if (startId === destId) return { type: 'here', start, dest };
  if (ctx.routable(destId)) {
    const route = routeBetween(ctx, startId, destId, options);
    return route ? { type: 'route', start, dest, route } : { type: 'no-route', start, dest };
  }
  // Terminal 5 has no secure walkway to Terminals 1-3: walk to the transfer point instead.
  if (dest.terminal === '5' && start.terminal !== '5') {
    const busStop = ctx.places.find(p => p.sub === 'ttb' && p.terminal === start.terminal && ctx.routable(p.id));
    const route = busStop ? routeBetween(ctx, startId, busStop.id, options) : null;
    return { type: 'transfer', start, dest, busStop, route, running: busRunning(ctx, options.now) };
  }
  return { type: 'preview', start, dest };
}

// ---------- Written directions ----------
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export function heading(a, b) {
  const [ax, ay] = toXY(a, a[0]), [bx, by] = toXY(b, a[0]);
  const deg = (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360;
  return { deg, word: COMPASS[Math.round(deg / 45) % 8] };
}
function sideOf(walkFrom, walkTo, corridorPoint, placePoint) {
  const lat0 = walkFrom[0], [ax, ay] = toXY(walkFrom, lat0), [bx, by] = toXY(walkTo, lat0), [cx, cy] = toXY(corridorPoint, lat0), [px, py] = toXY(placePoint, lat0);
  const cross = (bx - ax) * (py - cy) - (by - ay) * (px - cx);
  if (Math.hypot(px - cx, py - cy) < 6) return 'ahead';
  return cross > 0 ? 'on your left' : 'on your right';
}
const nearestGateLabel = (ctx, point, terminal) => {
  let best = null, bd = Infinity;
  for (const p of ctx.places) { if (p.kind !== 'gate' || p.terminal !== terminal) continue; const d = metersBetween(point, p.point); if (d < bd) { bd = d; best = p; } }
  return best?.near;
};

export function directions(ctx, route, start, dest) {
  const steps = [], groups = [];
  route.edgeIndices.forEach((edgeIndex, i) => {
    const meta = ctx.edgeMeta[edgeIndex], from = route.indices[i], to = route.indices[i + 1];
    const kind = meta.kind === 'stub' || meta.kind === 'walk' ? 'walk' : meta.kind;
    const last = groups.at(-1);
    if (last && kind === 'walk' && last.kind === 'walk' && last.corridor === meta.corridor) { last.to = to; last.edges.push(edgeIndex); last.endPos = i + 1; }
    else groups.push({ kind, corridor: meta.corridor, connector: meta.connector, from, to, edges: [edgeIndex], startPos: i, endPos: i + 1 });
  });
  const corridorName = id => ctx.network.corridors.find(c => c.id === id)?.name;
  const meters = g => g.edges.reduce((sum, e) => sum + ctx.graph.edges[e][2], 0);
  groups.forEach((g, gi) => {
    const a = ctx.graph.nodes[g.from], b = ctx.graph.nodes[g.to];
    const level = ctx.nodeLevel[g.to], range = [g.startPos, g.endPos];
    if (g.kind === 'walk') {
      const m = meters(g);
      if (m < 4 && gi > 0 && gi < groups.length - 1) return;
      const dir = heading(a, b).word, name = corridorName(g.corridor);
      const tunnel = ctx.network.levels[ctx.nodeLevel[g.from]]?.order === 1;
      const next = groups[gi + 1];
      let text, detail;
      if (tunnel) {
        const end = next ? ctx.network.connectors.find(c => c.id === next.connector) : null;
        text = `Follow the ${name} ${dir}`;
        detail = `${end ? `To the ${next.kind} ${end.landmark}` : 'Through the tunnel'} · moving walkways`;
      } else {
        text = gi === 0 ? `Walk ${dir} along ${name}` : `Continue ${dir} along ${name}`;
        if (next) { const c = ctx.network.connectors.find(x => x.id === next.connector); detail = c ? `Toward the ${next.kind} ${c.landmark}` : ''; }
        else { const gate = nearestGateLabel(ctx, dest.point, dest.terminal); detail = dest.kind === 'gate' ? `Toward Gate ${dest.near}` : gate ? `Toward Gate ${gate}` : ''; }
      }
      steps.push({ kind: 'walk', text, detail, meters: Math.round(m), level, range, maneuver: tunnel ? 'tunnel' : 'walk' });
    } else {
      const c = ctx.network.connectors.find(x => x.id === g.connector);
      const fromOrder = ctx.network.levels[ctx.nodeLevel[g.from]].order, toOrder = ctx.network.levels[level].order;
      const way = toOrder < fromOrder ? 'down' : 'up';
      const target = levelName(ctx, level) + (toOrder > fromOrder && ctx.network.levels[level].terminal === '1' ? ` of ${corridorName(groups[gi + 1]?.corridor) || 'the concourse'}` : '');
      steps.push({ kind: g.kind, text: `Take the ${g.kind} ${way} to the ${target}`, detail: c ? `${c.kind === 'escalator' ? 'Escalators' : 'Elevators'} ${c.landmark}` : '', meters: 0, level, range, maneuver: way });
    }
  });
  // Arrival: which side of the corridor the destination is on.
  const lastWalk = [...groups].reverse().find(g => g.kind === 'walk');
  let side = 'ahead';
  if (lastWalk && route.indices.length > 2) {
    const n = route.indices, end = n.length - 1;
    const corridorPoint = ctx.graph.nodes[n[end - 1]];
    let back = end - 2; while (back > 0 && metersBetween(ctx.graph.nodes[n[back]], corridorPoint) < 10) back--;
    side = sideOf(ctx.graph.nodes[n[Math.max(0, back)]], corridorPoint, corridorPoint, ctx.graph.nodes[n[end]]);
  }
  const facts = placeFacts(ctx, dest);
  steps.push({ kind: 'arrive', text: `Arrive at ${dest.name}${side === 'ahead' ? '' : `, ${side}`}`, detail: [facts.concourse, facts.level].filter(Boolean).join(' · '), meters: 0, level: dest.level, range: [route.indices.length - 1, route.indices.length - 1], maneuver: 'pin' });
  return steps;
}

export const formatMeters = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(5, Math.round(m / 5) * 5)} m`;
