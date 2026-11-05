import { createSheet } from '../sheet.js?v=20261105';
import { createContext, planTrip, search, placeFacts, formatMeters } from './core.js?v=20261105';
import { normalizeFlight, pickFlight, findGate, looksLikeGate, terminalHint, fetchFlights, sampleFlights, errorText, clockText, chicagoNow } from './flights.js?v=20261105';
import { FLIGHT_API } from './config.js?v=20261105';
import { WALK_SPEED, AIRPORT_CENTER, measureRoute, positionAt, stepAt, metersLeftInStep, snapToRoute, insideAirport, nearestGate, LocationWatch, GOOD_ACCURACY, USABLE_ACCURACY } from './walk.js?v=20261105';
import { metersBetween } from '../router.js?v=20261105';

// Files carry ?v=… so a phone that opened an older version never mixes old and new code.
// Change the date in index.html and these imports whenever you push a change.
// ---------- Icons ----------
const paths = {
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  here:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  nfc:'<path d="M6 7a8 8 0 0 0 0 10m3-8a5 5 0 0 0 0 6m9-8a8 8 0 0 1 0 10m-3-8a5 5 0 0 1 0 6"/><rect x="11" y="10" width="2" height="4" rx="1"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  gate:'<path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6"/>',
  restroom:'<circle cx="8" cy="5" r="2"/><circle cx="16" cy="5" r="2"/><path d="M6 21v-6H5l1.5-6h3L11 15h-1v6M14 9h4v6h-1v6h-2v-6h-1z"/>',
  food:'<path d="M5 3v6m3-6v6M2 3v6c0 2 6 2 6 0m-3 2v10M18 3c-3 2-4 6-4 9h5V3Zm1 9v9"/>',
  lounge:'<path d="M4 18v-6a3 3 0 0 1 6 0v2h4v-2a3 3 0 0 1 6 0v6M4 18h16M6 18v2m12-2v2"/>',
  nursing:'<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z"/>',
  animal:'<circle cx="7" cy="9" r="1.8"/><circle cx="17" cy="9" r="1.8"/><circle cx="10" cy="5" r="1.8"/><circle cx="14" cy="5" r="1.8"/><path d="M12 12c-3 0-5 3-5 5.5S9 20 12 19s5 1 5-1.5S15 12 12 12Z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>',
  bus:'<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 18v2m8-2v2M8 15h.1m7.9 0h.1"/>',
  train:'<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 16l-2 4m8-4 2 4M9 13h.1m5.9 0h.1"/>',
  walk:'<circle cx="14" cy="4" r="2"/><path d="m7 21 3-7 4 2 2 5m-6-7 2-6 3 4h4M6 12l3-4h3"/>',
  tunnel:'<path d="M3 20V12a9 9 0 0 1 18 0v8M7 20v-7a5 5 0 0 1 10 0v7"/>',
  down:'<path d="M12 4v14m-6-6 6 6 6-6"/>',
  up:'<path d="M12 20V6m-6 6 6-6 6 6"/>',
  back:'<path d="m15 5-7 7 7 7"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  share:'<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  external:'<path d="M14 3h7v7m0-7L11 13M10 4H4v16h16v-6"/>',
  info2:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>',
  plane:'<path d="M10.5 21 13 13.5l6.5 3V14L13 10V4.5a1.5 1.5 0 0 0-3 0V10l-6.5 4v2.5l6.5-3L10.5 21Zm-2 0h5"/>',
  connect:'<path d="M4 7h11l-3-3m3 3-3 3M20 17H9l3-3m-3 3 3 3"/>',
  play:'<path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor"/>',
  pause:'<path d="M8 5v14m8-14v14"/>',
  locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  pin2:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.pin}</svg>`;
const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
const symbol = (name, className = '') => { const e = el('span', className); e.innerHTML = icon(name); return e; };
document.querySelectorAll('[data-icon]').forEach(e => { e.innerHTML = icon(e.dataset.icon); });
const iconFor = p => p.kind === 'gate' ? 'gate' : p.kind === 'restroom' ? 'restroom' : p.kind === 'food' ? 'food' : p.sub === 'ttb' ? 'bus' : p.sub === 'ats' ? 'train' : paths[p.sub] ? p.sub : 'info';

const sheet = createSheet($('sheet'), $('sheet-grab'));
const params = new URLSearchParams(location.search);
let ctx, map, routeLayer = null, markerLayer = null, gateLayer = null, gateDots = null, amenityLayer = null, labelLayer = null, concourseLabels = null, pierLayers = [], toastTimer;
let startId = (params.get('start') || '').toLowerCase(), destId = (params.get('to') || '').toLowerCase();
let avoidSteps = params.get('steps') === 'avoid', filter = 'all', trip = null, distances = null, distancesFor = '';
let flightIata = normalizeFlight(params.get('flight'))?.iata || '', tripKind = flightIata ? 'depart' : '', flightInfo = null, lookupController = null;
const SAMPLE_MODE = !FLIGHT_API;
let airport = null, walk = null, gpsLayer = null, locateWatch = null;
const LIST_LIMIT = 50;

function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200); }
function message(text) { $('message').textContent = text; $('message').hidden = !text; }
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function shareURL() {
  const url = new URL('./', location.href);
  if (startId) url.searchParams.set('start', startId);
  if (destId) url.searchParams.set('to', destId);
  if (avoidSteps) url.searchParams.set('steps', 'avoid');
  if (flightIata) url.searchParams.set('flight', flightIata);
  return url.href;
}
function updateAddress() { const url = new URL(shareURL()); history.replaceState(null, '', url.pathname + url.search); }

// ---------- Map: an original schematic, not a copy of the airport's drawings ----------
const metersPerPixel = () => 40075016.686 * Math.cos(41.977 * Math.PI / 180) / 2 ** (map.getZoom() + 8);
function drawSchematic(outline) {
  const s = ctx.network.schematic;
  // The airport boundary, runways and real building outlines (OpenStreetMap), under everything else.
  if (outline?.boundary) L.polygon(outline.boundary, { color: css('--airfield-edge'), weight: 1.5, dashArray: '6 6', fillColor: css('--airfield'), fillOpacity: 1, interactive: false }).addTo(map);
  for (const r of outline?.runways || []) pierLayers.push({ fill: L.polyline(r.line, { color: css('--runway'), lineCap: 'butt', interactive: false }).addTo(map), width: r.width });
  if (outline?.buildings?.length) {
    for (const b of outline.buildings) L.polygon(b.rings, { color: css('--pier-edge'), weight: 1.2, fillColor: css('--pier'), fillOpacity: 1, interactive: false }).addTo(map);
  } else {
    // Fallback if the outline file is missing: the original schematic shapes.
    for (const h of s.halls) L.polygon(h.points, { color: css('--separator'), weight: 1, fillColor: css('--hall'), fillOpacity: 1, interactive: false }).addTo(map);
    for (const p of s.piers) pierLayers.push({ edge: L.polyline(p.points, { color: css('--pier-edge'), lineCap: 'round', interactive: false }).addTo(map), fill: L.polyline(p.points, { color: css('--pier'), lineCap: 'round', interactive: false }).addTo(map), width: p.width });
  }
  for (const w of s.secureWalkways) L.polyline(w.points, { color: css('--pier-edge'), weight: 3, dashArray: '2 6', lineCap: 'round', interactive: false }).addTo(map);
  const tunnel = ctx.network.corridors.find(c => c.id === 't1-tunnel');
  L.polyline(tunnel.points, { color: css('--tunnel'), weight: 9, opacity: .35, lineCap: 'round', interactive: false }).addTo(map);
  L.polyline(tunnel.points, { color: css('--tunnel'), weight: 2, dashArray: '6 6', interactive: false }).addTo(map);
  L.polyline(s.ats.stations.map(st => [st[1], st[2]]), { color: css('--ats'), weight: 3, dashArray: '8 6', opacity: .9, interactive: false }).addTo(map);
  for (const r of s.ttb.routes) L.polyline(r, { color: css('--ttb'), weight: 3, dashArray: '1 7', lineCap: 'round', opacity: .9, interactive: false }).addTo(map);
  resizePiers();
  // Labels for terminals (tap to zoom in) and concourses.
  labelLayer = L.layerGroup().addTo(map);
  for (const [id, t] of Object.entries(ctx.network.terminals)) {
    const html = `<span class="t-label" aria-label="${t.name}: ${t.status === 'routes' ? 'routes' : 'map preview'}"><b>T${id}</b>${t.status === 'routes' ? '<i class="ok">Routes</i>' : '<i>Preview</i>'}</span>`;
    L.marker(t.label, { icon: L.divIcon({ className: 'ord-label', html, iconSize: null }), keyboard: true, title: t.name, zIndexOffset: 900 }).on('click', () => showTerminal(id)).addTo(labelLayer);
  }
  concourseLabels = L.layerGroup();
  for (const p of s.piers) {
    if (p.concourse === 'L' && p.width === 40) continue;
    const mid = p.points[Math.floor(p.points.length / 2)];
    L.marker(mid, { icon: L.divIcon({ className: 'ord-label', html: `<span class="c-label">${p.concourse}</span>`, iconSize: null }), interactive: false, keyboard: false }).addTo(concourseLabels);
  }
  map.on('zoomend', () => { resizePiers(); toggleDetail(); });
}
function resizePiers() { const mpp = metersPerPixel(); for (const p of pierLayers) { p.edge?.setStyle({ weight: p.width / mpp + 2 }); p.fill.setStyle({ weight: Math.max(1.5, p.width / mpp) }); } }
function toggleDetail() {
  const z = map.getZoom();
  const show = (layer, on) => { if (on && !map.hasLayer(layer)) layer.addTo(map); if (!on && map.hasLayer(layer)) layer.remove(); };
  if (concourseLabels) show(concourseLabels, z >= 15.5 && z < 18);
  show(gateLayer, z >= 17);
  show(gateDots, z < 17);
  show(amenityLayer, z >= 17.5);
  document.body.classList.toggle('map-detail', z >= 17);
}
function drawPlaces() {
  gateLayer = L.layerGroup(); amenityLayer = L.layerGroup(); gateDots = L.layerGroup();
  for (const p of ctx.places) {
    if (p.kind === 'gate') {
      L.marker(p.point, { icon: L.divIcon({ className: 'ord-label', html: `<span class="g-label${ctx.routable(p.id) ? '' : ' preview'}">${p.near}</span>`, iconSize: null }), title: p.name, keyboard: false }).on('click', () => selectDestination(p.id)).addTo(gateLayer);
      // Every gate in the airport, as a dot, when zoomed out too far for labels.
      L.circleMarker(p.point, { radius: 3.5, weight: 1.5, color: css('--gate-dot-edge'), fillColor: css('--gate-dot'), fillOpacity: 1 }).bindTooltip(p.name, { direction: 'top', offset: [0, -4] }).on('click', () => selectDestination(p.id)).addTo(gateDots);
    } else if (filter === 'all' || filter === p.kind || (filter === 'amenity' && p.kind === 'transfer')) {
      L.marker(p.point, { icon: L.divIcon({ className: 'ord-label', html: `<span class="a-pin ${p.kind}">${icon(iconFor(p))}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: p.name, keyboard: false }).on('click', () => selectDestination(p.id)).addTo(amenityLayer);
    }
  }
}
function redrawAmenities() { amenityLayer.remove(); gateLayer.remove(); gateDots.remove(); drawPlaces(); toggleDetail(); }
function boundsFor(view) {
  if (view === 'all') return L.latLngBounds(ctx.network.schematic.piers.flatMap(p => p.points));
  return L.latLngBounds([...ctx.network.schematic.piers.filter(p => p.terminal === view).flatMap(p => p.points), ...ctx.network.schematic.halls.filter(h => h.terminal === view).flatMap(h => h.points)]);
}
function framing() {
  if (sheet.active()) return { paddingTopLeft: [24, 80], paddingBottomRight: [24, Math.min(sheet.visible() + 24, $('map').clientHeight - 200)] };
  const m = $('map').getBoundingClientRect(), s = $('sheet').getBoundingClientRect();
  return { paddingTopLeft: [Math.max(40, s.right - m.left + 32), 76], paddingBottomRight: [72, 40] };
}
// Put a point in the middle of the part of the map the panel does not cover.
function centerOn(point, zoom = map.getZoom(), animate = true) {
  let dx = 0, dy = 0;
  if (sheet.active()) dy = sheet.visible() / 2;
  else { const m = $('map').getBoundingClientRect(), s = $('sheet').getBoundingClientRect(); dx = -Math.max(0, s.right - m.left) / 2; }
  map.setView(map.unproject(map.project(point, zoom).add([dx, dy]), zoom), zoom, { animate });
}
function showTerminal(view) { map.fitBounds(boundsFor(view), { ...framing(), animate: true, duration: .6 }); }

// ---------- Markers for start, destination and the route ----------
function drawTrip() {
  if (routeLayer) routeLayer.remove();
  if (markerLayer) markerLayer.remove();
  routeLayer = L.layerGroup().addTo(map); markerLayer = L.layerGroup().addTo(map);
  const start = ctx.byId.get(startId), dest = ctx.byId.get(destId);
  if (start && ctx.routable(startId)) {
    L.marker(start.point, { icon: L.divIcon({ className: 'ord-label', html: `<span class="here-pin"><span class="here-dot"></span><span class="here-text">You are here</span></span>`, iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 2000, keyboard: false, title: `You are here: ${start.name}` }).addTo(markerLayer);
  }
  if (dest) L.marker(dest.point, { icon: L.divIcon({ className: 'ord-label', html: `<span class="dest-pin">${icon(iconFor(dest))}</span>`, iconSize: [34, 34], iconAnchor: [17, 34] }), zIndexOffset: 2100, keyboard: false, title: dest.name }).addTo(markerLayer);
  const route = trip?.route;
  if (!route) return;
  // Split the line by level so the tunnel reads as a different floor.
  let run = [route.points[0]], level = route.levels[0];
  const flush = () => {
    if (run.length < 2) return;
    const tunnel = ctx.network.levels[level]?.order === 1;
    L.polyline(run, { color: tunnel ? css('--tunnel-casing') : '#fff', weight: 11, opacity: .95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
    L.polyline(run, { color: css('--route'), weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', dashArray: tunnel ? '10 8' : null, interactive: false }).addTo(routeLayer);
  };
  for (let i = 1; i < route.points.length; i++) {
    if (route.levels[i] !== level) {
      flush();
      const way = ctx.network.levels[route.levels[i]].order < ctx.network.levels[level].order ? 'down' : 'up';
      L.marker(route.points[i], { icon: L.divIcon({ className: 'ord-label', html: `<span class="level-pin">${icon(way)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1500, keyboard: false, interactive: false }).addTo(routeLayer);
      run = [route.points[i]]; level = route.levels[i];
    } else run.push(route.points[i]);
  }
  flush();
}
function fitTrip() {
  const pts = trip?.route?.points || [ctx.byId.get(startId)?.point, ctx.byId.get(destId)?.point].filter(Boolean);
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { ...framing(), maxZoom: 19, animate: true, duration: .6 });
  else if (pts.length === 1) centerOn(pts[0], 18);
}

// ---------- Starting point ----------
function buildStartPicker() {
  const select = $('start-select'); select.replaceChildren();
  const blank = el('option', '', 'Choose the sign near you'); blank.value = ''; select.append(blank);
  const group = el('optgroup'); group.label = 'Terminal 1 · Upper Level';
  for (const s of ctx.signs) { const o = el('option', '', `${s.label}, Concourse ${s.place.concourse}`); o.value = s.id; group.append(o); }
  select.append(group);
  // A link may start at any Terminal 1 place, not only a printed sign.
  if (ctx.routable(startId) && !ctx.signs.some(s => s.id === startId)) { const o = el('option', '', `Near ${ctx.byId.get(startId).name}`); o.value = startId; group.append(o); }
  select.value = ctx.routable(startId) ? startId : '';
}
function renderHere() {
  const start = ctx.byId.get(startId), ok = start && ctx.routable(startId);
  $('here-card').classList.toggle('needs-start', !ok);
  document.body.classList.toggle('needs-start', !ok);
  if (ok) {
    const f = placeFacts(ctx, start);
    $('origin-context').textContent = `${f.terminal} · ${f.concourse} · ${f.level}. Set by your sign; no GPS used.`;
  } else $('origin-context').textContent = 'Choose the sign you are standing near. No location access needed.';
}

// ---------- List ----------
function distanceTo(p) {
  if (!ctx.routable(startId) || !ctx.routable(p.id)) return null;
  const key = `${startId}:${avoidSteps}`;
  if (distancesFor !== key) { distances = ctx.router.distancesFromNode(ctx.placeNode.get(startId), { avoidStairs: avoidSteps }); distancesFor = key; }
  const m = distances?.meters[ctx.placeNode.get(p.id)];
  return Number.isFinite(m) ? m : null;
}
function renderList() {
  const query = $('search').value;
  const kind = filter;
  let matches = search(ctx, query, kind === 'amenity' ? 'all' : kind);
  if (kind === 'amenity') matches = matches.filter(p => p.kind === 'amenity' || p.kind === 'transfer');
  const startTerminal = ctx.byId.get(startId)?.terminal || '1';
  if (!query.trim()) matches.sort((a, b) => {
    const da = distanceTo(a), db = distanceTo(b);
    return (da === null) - (db === null) || (da ?? 0) - (db ?? 0) || (a.terminal !== startTerminal) - (b.terminal !== startTerminal) || a.terminal.localeCompare(b.terminal);
  });
  const shown = matches.slice(0, LIST_LIMIT), list = $('place-list'); list.replaceChildren();
  $('list-label').textContent = query.trim() ? 'Results' : { all: 'Nearby', gate: 'Gates', restroom: 'Restrooms', food: 'Food & drink', amenity: 'More places' }[kind];
  $('place-count').textContent = matches.length > shown.length ? `${shown.length} of ${matches.length}` : `${matches.length}`;
  if (!shown.length) { list.append(el('p', 'empty-state', 'Nothing matches. Try a gate number like C17, or “coffee”, “restroom”, “lounge”.')); return; }
  for (const p of shown) {
    const row = el('button', 'place-card'); row.type = 'button';
    row.append(symbol(iconFor(p), `place-symbol ${p.kind}`));
    const info = el('span', 'place-info'), f = placeFacts(ctx, p);
    info.append(el('span', 'place-name', p.name), el('span', 'place-description', [f.terminal, f.concourse, p.kind === 'gate' ? f.level : p.detail || f.level].filter(Boolean).join(' · ')));
    const m = distanceTo(p);
    const meta = el('span', 'place-time');
    if (p.id === startId) { meta.append(el('span', 'here', 'You are here')); }
    else if (m !== null) { meta.append(symbol('walk'), document.createTextNode(`${Math.max(1, Math.ceil(m / 75))} min · ${formatMeters(m)}`)); }
    else if (f.preview) meta.append(el('span', 'badge', 'Map preview'));
    else if (p.security === 'landside') meta.append(el('span', 'badge', 'Before security'));
    else if (!ctx.routable(p.id)) meta.append(el('span', 'badge', 'Not routed yet'));
    else meta.append(el('span', 'hint', 'Choose your sign for walking time'));
    info.append(meta); row.append(info, symbol('arrow', 'place-arrow'));
    row.addEventListener('click', () => selectDestination(p.id));
    list.append(row);
  }
  if (matches.length > shown.length) list.append(el('p', 'list-more', 'Type more of a name or gate to narrow the list.'));
}

// ---------- Destination card ----------
const clock = hm => { const [h, m] = hm.split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`; };
function chip(text, cls = '') { return el('span', `fact ${cls}`, text); }
function notice(kind, title, body, links = []) {
  const n = $('notice'); n.className = `notice ${kind}`; n.replaceChildren(el('strong', '', title));
  for (const line of [].concat(body)) n.append(el('p', '', line));
  for (const [text, href] of links) { const a = el('a', '', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.append(symbol('external')); n.append(a); }
  n.hidden = false;
}
function renderRoute() {
  const dest = ctx.byId.get(destId); if (!dest) return;
  const start = ctx.byId.get(startId);
  trip = planTrip(ctx, startId, destId, { avoidSteps });
  const f = placeFacts(ctx, dest);
  $('route-category').textContent = start && ctx.routable(startId) ? `From near ${start.name}, ${placeFacts(ctx, start).terminal}` : 'Destination';
  $('route-title').textContent = dest.name;
  $('facts').replaceChildren(chip(f.terminal), ...(f.concourse ? [chip(f.concourse)] : []), chip(f.level), chip(f.security), ...(f.preview ? [chip('Map preview', 'preview')] : []));
  $('notice').hidden = true;
  const route = trip.route;
  $('route-summary').hidden = !route;
  $('steps-toggle').hidden = !route;
  $('walk-actions').hidden = !route;
  $('avoid-steps').checked = avoidSteps;
  if (route) {
    $('route-minutes').textContent = `${route.minutes} min`;
    $('route-distance').textContent = formatMeters(route.distance);
    const levels = [...new Set(route.levels)].map(l => ctx.network.levels[l].name);
    $('route-levels').textContent = levels.length > 1 ? `${levels.length} levels` : 'one level';
  }
  if (trip.type === 'no-start') notice('info', 'Where are you?', 'Choose the sign you are standing near, above, to see the route. Signs set your starting point without GPS.');
  if (trip.type === 'no-start') sheet.refresh();
  if (trip.type === 'here') notice('ok', 'You are already here', 'This sign is at your destination.');
  if (trip.type === 'preview') {
    const sameCore = ['1', '2', '3'].includes(dest.terminal) && ['1', '2', '3'].includes(start?.terminal);
    notice('preview', `${f.terminal} is a map preview`, [
      `${dest.name} is placed from the official O'Hare map, but this prototype has not verified a walking route to it yet.`,
      sameCore ? 'Terminals 1, 2 and 3 are connected after security. Follow overhead signs to the terminal, or use the official map.' : dest.security === 'landside' ? 'This place is before security.' : 'Use the official map for turn-by-turn directions.'
    ], [['Open the official O\'Hare map', 'https://maps.ord.flychicago.com/']]);
  }
  if (trip.type === 'transfer') {
    const t = ctx.network.transfers, running = trip.running;
    notice('transfer', running ? 'Terminal 5: take the Terminal Transfer Bus' : 'Terminal 5: the transfer bus is not running now', [
      'Terminal 5 has no secure walkway to Terminals 1–3. This route ends at the transfer point.',
      `Terminal Transfer Bus: ${clock(t.ttb.hours.start)} to ${clock(t.ttb.hours.end)} Chicago time, every ${t.ttb.every}, from ${t.ttb.stops['1']} to ${t.ttb.stops['5']}. ${t.ttb.eligibility}`,
      `Outside those hours: ${t.ats.rule.replace(/^Between 9:30 p.m. and 11:30 a.m., /, '')}`
    ], [['Transfer rules (flychicago.com)', 'https://www.flychicago.com/ohare/servicesamenities/services/pages/tbt.aspx']]);
  }
  // Directions.
  const list = $('route-steps'); list.replaceChildren();
  $('steps-heading').hidden = !route;
  if (route) {
    $('step-count').textContent = `${route.steps.length} steps`;
    route.steps.forEach((s, i) => {
      const li = el('li', `step ${s.kind}`); li.tabIndex = 0;
      li.append(symbol(s.maneuver === 'walk' ? 'walk' : s.maneuver, 'step-icon'));
      const body = el('div'); body.append(el('span', 'step-text', s.text));
      const small = [s.detail, s.meters ? formatMeters(s.meters) : ''].filter(Boolean).join(' · ');
      if (small) body.append(el('small', '', small));
      li.append(body);
      const focus = () => { const pts = route.points.slice(s.range[0], s.range[1] + 1); if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { ...framing(), maxZoom: 19.5, animate: true }); else map.setView(pts[0] || dest.point, 19, { animate: true }); highlight(i); };
      li.addEventListener('click', focus); li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(); } });
      list.append(li);
    });
  }
  $('route-footnote').textContent = trip.type === 'transfer' ? 'Walking route to the Terminal Transfer Bus stop, along mapped passenger corridors. Transfer rules checked on flychicago.com on November 4, 2026.' : 'Schematic route along mapped passenger corridors. Times assume 75 m a minute. Follow airport signs; gates, closures and construction change.';
  renderFlightBanner();
  drawTrip();
}
function highlight(i) { document.querySelectorAll('.directions .step').forEach((li, j) => li.classList.toggle('active-step', j === i)); }

// ---------- Flight questions: why you are here → flight number → gate ----------
const SAMPLE_NUMBERS = ['UA 1234', 'UA 2210', 'UA 4567', 'AA 2345', 'DL 3456', 'UA 5678'];
let samples = null;
function showStep(name) {
  for (const id of ['ff-trip', 'ff-number', 'ff-result']) $(id).hidden = id !== `ff-${name}`;
  $('ff-reopen').hidden = name !== 'reopen';
  $('flight-finder').dataset.step = name;
}
function chooseTrip(kind) {
  tripKind = kind;
  if (kind === 'browse') { showStep('reopen'); return; }
  $('ff-number-label').textContent = kind === 'connect' ? "What's your next flight number?" : "What's your flight number?";
  $('ff-help').classList.remove('error');
  $('ff-help').textContent = SAMPLE_MODE
    ? `Demo mode with sample flights. Try ${SAMPLE_NUMBERS.slice(0, 5).join(', ')}.`
    : 'On your boarding pass or airline app: two characters for the airline, then the number.';
  showStep('number');
  $('flight-input').focus({ preventScroll: true });
}
const flightLine = f => [f.to.name ? `to ${f.to.name}${f.to.iata ? ` (${f.to.iata})` : ''}` : '', f.airline].filter(Boolean).join(' · ');
const departureText = f => f.estimated ? `Departs ${clockText(f.estimated)} (was ${clockText(f.scheduled)})` : `Departs ${clockText(f.scheduled)}`;
function flightSummary(f, gate, { compact = false } = {}) {
  const box = el('div', 'flight-summary');
  const top = el('div', 'flight-top');
  const name = el('div', 'flight-name'); name.append(el('strong', '', f.label || f.iata), el('span', '', flightLine(f)));
  top.append(symbol('plane', 'flight-icon'), name, el('span', `status ${f.tone}`, f.statusText));
  box.append(top);
  const chips = el('div', 'facts');
  chips.append(chip(`${departureText(f)}, Chicago time`));
  if (f.terminal) chips.append(chip(`Terminal ${f.terminal}`));
  chips.append(chip(gate ? gate.name : f.gate ? `Gate ${f.gate}` : 'Gate not posted', gate || f.gate ? 'gate' : 'preview'));
  if (flightInfo?.sample) chips.append(chip('Sample flight, not live data', 'preview'));
  box.append(chips);
  if (f.operatedBy?.iata && !compact) box.append(el('p', 'ff-text', `Operated as ${f.operatedBy.iata}${f.operatedBy.airline ? ` by ${f.operatedBy.airline}` : ''}.`));
  return box;
}
function resultCard(nodes) { $('ff-result').replaceChildren(...nodes); showStep('result'); sheet.refresh(); }
function changeFlightButton() {
  const b = el('button', 'ff-skip', 'Change flight'); b.type = 'button';
  b.addEventListener('click', () => { flightIata = ''; flightInfo = null; updateAddress(); $('flight-input').value = ''; chooseTrip(tripKind === 'connect' ? 'connect' : 'depart'); });
  return b;
}
async function records(iata) {
  if (SAMPLE_MODE) {
    samples ??= await fetch('data/sample-flights.json', { cache: 'no-cache' }).then(r => r.json());
    return sampleFlights(samples).filter(r => r.flight?.iata === iata);
  }
  lookupController?.abort(); lookupController = new AbortController();
  return fetchFlights(FLIGHT_API, iata, { signal: lookupController.signal });
}
async function lookupFlight(text, { fromLink = false } = {}) {
  const typedGate = !fromLink && looksLikeGate(ctx, text);
  if (typedGate) { toast(`That looks like a gate. Showing ${typedGate.name}.`); showStep('reopen'); selectDestination(typedGate.id); return; }
  const parsed = normalizeFlight(text);
  if (!parsed) { $('ff-help').textContent = errorText('bad-number'); $('ff-help').classList.add('error'); $('flight-input').focus(); return; }
  flightIata = parsed.iata; updateAddress();
  $('flight-input').value = parsed.label;
  resultCard([el('p', 'ff-loading', `Looking up ${parsed.label}…`)]);
  let flight = null;
  try { flight = pickFlight(await records(parsed.iata), chicagoNow()); }
  catch (e) {
    if (e?.name === 'AbortError') return;
    flightInfo = null;
    resultCard([el('h2', 'ff-question', `Couldn't look up ${parsed.label}`), el('p', 'ff-text', errorText(e.code)), changeFlightButton()]);
    return;
  }
  if (!flight) {
    flightInfo = null;
    const tip = SAMPLE_MODE ? `This demo only knows the sample flights: ${SAMPLE_NUMBERS.join(', ')}.` : 'Check the number on your boarding pass. Flights from other airports, or more than a day away, do not show here.';
    resultCard([el('h2', 'ff-question', `No O'Hare departure found for ${parsed.label}`), el('p', 'ff-text', tip), changeFlightButton()]);
    return;
  }
  flight.label = parsed.label;
  const gate = findGate(ctx, flight.gate, flight.terminal);
  flightInfo = { flight, gate, sample: SAMPLE_MODE };
  const actions = el('div', 'ff-actions'), notes = [];
  if (gate) {
    const go = el('button', 'primary-button', `Walk to ${gate.name}`); go.type = 'button';
    go.prepend(symbol('walk')); go.addEventListener('click', () => selectDestination(gate.id));
    actions.append(go);
  } else {
    const hint = terminalHint(ctx, flight.terminal);
    notes.push(el('p', 'ff-text', flight.gate
      ? `Gate ${flight.gate} is not on this map. Follow the airport signs${hint ? ` to ${hint}` : ''} and check the departure screens.`
      : `The airline has not posted a gate yet.${hint ? ` Your flight leaves from ${hint}.` : ''} Check the departure screens, or look again here closer to boarding.`));
    if (hint) { const t = el('button', 'secondary-button', `Show Terminal ${flight.terminal}`); t.type = 'button'; t.addEventListener('click', () => { sheet.snap('peek'); showTerminal(flight.terminal.replace(/\D/g, '')); }); actions.append(t); }
  }
  actions.append(changeFlightButton());
  if (['cancelled', 'diverted', 'incident'].includes(flight.status)) notes.push(el('p', 'ff-text warn', 'Talk to your airline before walking to the gate: this flight may not leave as planned.'));
  if (flight.status === 'active') notes.push(el('p', 'ff-text warn', 'This flight has already left. If you are booked on it, talk to your airline.'));
  resultCard([el('span', 'ff-count', tripKind === 'connect' ? 'Your next flight' : 'Your flight'), flightSummary(flight, gate), ...notes, actions]);
  // On-schedule flight with a mapped gate: go straight to the route.
  if (gate && ['scheduled', ''].includes(flight.status)) {
    const changed = fromLink && destId && destId !== gate.id;
    selectDestination(gate.id);
    if (changed) toast(`Gate changed: ${flight.label} now leaves from ${gate.name}.`);
  }
}
function renderFlightBanner() {
  const banner = $('flight-banner'), show = flightInfo?.gate && flightInfo.gate.id === destId;
  banner.hidden = !show;
  if (show) banner.replaceChildren(flightSummary(flightInfo.flight, flightInfo.gate, { compact: true }));
}

// ---------- Walking the route: a simulation for demos, or live GPS at the airport ----------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (walk && document.visibilityState === 'visible') keepAwake(true); });
const levelLabel = level => ctx.network.levels[level]?.name || '';
const kmFrom = point => metersBetween(point, AIRPORT_CENTER) / 1000;
function walkerIcon(kind) { return L.divIcon({ className: 'ord-label', html: `<span class="walker ${kind}"><span></span></span>`, iconSize: [26, 26], iconAnchor: [13, 13] }); }
function drawWalker(point, { raw = null, accuracy = 0, kind = 'sim' } = {}) {
  if (!walk) return;
  if (!walk.marker) walk.marker = L.marker(point, { icon: walkerIcon(kind), zIndexOffset: 3000, keyboard: false, interactive: false }).addTo(map);
  else { walk.marker.setLatLng(point); walk.marker.setIcon(walkerIcon(kind)); }
  if (raw) {
    if (!walk.circle) walk.circle = L.circle(raw, { radius: accuracy, color: css('--route'), weight: 1, fillColor: css('--route'), fillOpacity: .12, interactive: false }).addTo(map);
    else { walk.circle.setLatLng(raw); walk.circle.setRadius(accuracy); }
  }
}
function followWalker(force = false) {
  if (!walk?.follow || !walk.position) return;
  const now = performance.now();
  if (!force && now - (walk.lastPan || 0) < 300) return;
  walk.lastPan = now;
  centerOn(walk.position, Math.max(map.getZoom(), 18.25), false);
}
// One place renders progress for both modes.
function showProgress(pos) {
  const route = walk.route, m = walk.m, i = stepAt(route, m, pos.along), step = route.steps[i];
  walk.position = pos.point;
  const arrived = pos.remaining < (walk.mode === 'live' ? 12 : 0.5);
  highlight(arrived ? route.steps.length - 1 : i);
  const left = metersLeftInStep(route, m, pos.along, i);
  $('walk-hud-icon').innerHTML = icon(arrived ? 'pin2' : step.maneuver);
  $('walk-hud-meta').textContent = arrived ? 'Arrived' : `${step.kind === 'walk' ? `${formatMeters(left)} · ` : ''}${levelLabel(pos.level)}`;
  $('walk-hud-text').textContent = arrived ? (trip.type === 'transfer' ? 'You are at the Terminal Transfer Bus' : `You have arrived at ${trip.dest.name}`) : step.text;
  const next = route.steps[i + 1];
  $('walk-hud-detail').textContent = arrived ? (trip.type === 'transfer' ? `Board here for Terminal 5, ${trip.dest.name}.` : 'Check the screens at the gate for boarding times.') : next ? `Then: ${next.text}` : step.detail || '';
  $('route-minutes').textContent = arrived ? 'Here' : `${Math.max(1, Math.ceil(pos.remaining / 75))} min`;
  $('route-distance').textContent = arrived ? '0 m' : formatMeters(pos.remaining);
  $('route-levels').textContent = arrived ? 'arrived' : 'left';
  $('walk-progress-bar').style.width = `${Math.min(100, pos.along / (m.total || 1) * 100)}%`;
  if (arrived && !walk.arrived) {
    walk.arrived = true; walk.paused = true;
    $('walk-pause').hidden = true; $('walk-speed').hidden = true; $('walk-stop').textContent = 'Done';
    try { navigator.vibrate?.([60, 40, 60]); } catch {}
    if (walk.mode === 'live') walk.watch?.stop();
  }
}
function beginWalk(mode) {
  if (!trip?.route) return;
  stopWalk(false);
  const m = measureRoute(trip.route);
  walk = { mode, route: trip.route, m, along: 0, speed: Number(document.querySelector('#walk-speed .active')?.dataset.speed || 5), paused: false, follow: true, arrived: false, off: 0 };
  document.body.classList.add('walking');
  $('walk-hud').hidden = false; $('walk-controls').hidden = false; $('walk-status').hidden = false;
  $('walk-pause').hidden = mode !== 'sim'; setPauseButton(false); $('walk-stop').textContent = 'End';
  $('walk-speed').hidden = mode !== 'sim';
  keepAwake(true);
  sheet.snap('peek');
  if (mode === 'sim') {
    $('walk-status').textContent = 'Simulation: the dot walks this route at a normal pace, sped up. No location is used.';
    const pos = positionAt(walk.route, m, 0);
    drawWalker(pos.point); showProgress(pos); followWalker(true);
    let last = performance.now();
    const tick = now => {
      if (!walk || walk.mode !== 'sim') return;
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (!walk.paused) {
        walk.along = Math.min(m.total, walk.along + dt * WALK_SPEED * walk.speed);
        const p = positionAt(walk.route, m, walk.along);
        drawWalker(p.point, { kind: ctx.network.levels[p.level]?.order === 1 ? 'sim tunnel' : 'sim' }); showProgress(p); followWalker();
      }
      walk.raf = requestAnimationFrame(tick);
    };
    walk.raf = requestAnimationFrame(tick);
  } else {
    $('walk-status').textContent = 'Finding your location…';
    $('walk-hud-meta').textContent = 'Live GPS'; $('walk-hud-text').textContent = 'Finding your location…'; $('walk-hud-detail').textContent = 'Allow location access if your phone asks.';
    $('walk-hud-icon').innerHTML = icon('locate');
    walk.watch = new LocationWatch(navigator.geolocation, onLiveFix, onLiveState);
    walk.watch.start();
  }
}
function onLiveState(state) {
  if (!walk || walk.mode !== 'live') return;
  const text = {
    locating: 'Finding your location…',
    denied: 'Location access is off. Turn it on for this site, or use Simulate walk.',
    unsupported: 'This browser cannot share its location. Use Simulate walk instead.',
    timeout: 'No GPS signal yet. Indoors this is common: tap the nearest ORD Tap sign for an exact position.',
    unavailable: 'Your location is not available right now. Tap the nearest ORD Tap sign instead.'
  }[state];
  if (text) { $('walk-status').textContent = text; if (state !== 'locating') { $('walk-hud-text').textContent = 'No GPS position'; $('walk-hud-detail').textContent = text; } }
}
function onLiveFix({ point, accuracy }) {
  if (!walk || walk.mode !== 'live' || walk.arrived) return;
  if (!insideAirport(airport?.boundary, point)) {
    const km = kmFrom(point);
    walk.watch.stop();
    $('walk-hud-meta').textContent = 'Live GPS';
    $('walk-hud-text').textContent = 'You are not at O\'Hare';
    $('walk-hud-detail').textContent = `GPS puts you about ${km < 10 ? km.toFixed(1) : Math.round(km)} km away. Live mode works inside the airport; try Simulate walk.`;
    $('walk-status').textContent = 'Live GPS stopped: you are outside the airport.';
    return;
  }
  const accText = `±${Math.round(accuracy)} m`;
  if (accuracy > USABLE_ACCURACY) {
    drawWalker(point, { raw: point, accuracy, kind: 'live weak' });
    $('walk-hud-meta').textContent = `Live GPS · ${accText}`;
    $('walk-hud-text').textContent = 'GPS is too vague here';
    $('walk-hud-detail').textContent = 'Tap the nearest ORD Tap sign for an exact position.';
    $('walk-status').textContent = `GPS accuracy is ${accText}, too vague to follow the route indoors.`;
    walk.position = point; followWalker();
    return;
  }
  const snap = snapToRoute(walk.route, walk.m, point, walk.along);
  if (snap.off > Math.max(45, accuracy)) {
    walk.off++;
    drawWalker(point, { raw: point, accuracy, kind: 'live weak' });
    if (walk.off >= 3) {
      $('walk-hud-text').textContent = 'You may be off the route';
      $('walk-hud-detail').textContent = 'Tap the nearest ORD Tap sign to start again from there.';
      $('walk-status').textContent = `About ${Math.round(snap.off)} m from the route (${accText}).`;
    }
    walk.position = point; followWalker();
    return;
  }
  walk.off = 0;
  walk.along = Math.max(walk.along - 25, snap.along);   // small steps back are allowed; GPS jitters
  const pos = positionAt(walk.route, walk.m, walk.along);
  drawWalker(pos.point, { raw: point, accuracy, kind: accuracy > GOOD_ACCURACY ? 'live weak' : 'live' });
  showProgress(pos);
  $('walk-status').textContent = `Live GPS ${accText}. GPS cannot tell the Upper Level from the tunnel; the dot assumes you are following the route.`;
  if (!walk.arrived) $('walk-hud-meta').textContent = `Live GPS · ${accText} · ${levelLabel(pos.level)}`;
  followWalker();
}
function stopWalk(refit = true) {
  if (!walk) return;
  cancelAnimationFrame(walk.raf); walk.watch?.stop();
  walk.marker?.remove(); walk.circle?.remove();
  walk = null;
  keepAwake(false);
  document.body.classList.remove('walking');
  $('walk-hud').hidden = true; $('walk-controls').hidden = true; $('walk-status').hidden = true;
  if (refit && destId) { renderRoute(); sheet.snap('medium'); fitTrip(); }
}

// "Use my location" without a route: pick the nearest Terminal 1 gate as the starting point.
function locateStart() {
  if (locateWatch) { locateWatch.stop(); locateWatch = null; }
  $('locate-text').textContent = 'Finding your location…';
  const done = text => { locateWatch?.stop(); locateWatch = null; $('locate-text').textContent = 'Use my location (GPS)'; if (text) message(text); };
  let best = null;
  const timer = setTimeout(() => best ? use(best) : done('No GPS position came through. Indoors this is common: choose or tap the nearest sign.'), 15000);
  const use = fix => {
    clearTimeout(timer); done();
    gpsLayer?.remove(); gpsLayer = L.layerGroup().addTo(map);
    L.circle(fix.point, { radius: fix.accuracy, color: css('--route'), weight: 1, fillOpacity: .1, interactive: false }).addTo(gpsLayer);
    L.marker(fix.point, { icon: walkerIcon('live weak'), keyboard: false, interactive: false }).addTo(gpsLayer);
    if (!insideAirport(airport?.boundary, fix.point)) { const km = kmFrom(fix.point); message(`GPS puts you about ${km < 10 ? km.toFixed(1) : Math.round(km)} km from O'Hare. At the airport, this picks your starting gate. For now, choose a sign or use Simulate walk on any route.`); return; }
    const near = nearestGate(ctx, fix.point);
    if (near && near.distance <= 120 && ctx.routable(near.place.id)) {
      setStart(near.place.id);
      message(`Starting near ${near.place.name} from GPS (±${Math.round(fix.accuracy)} m). GPS can be off indoors: tap a sign for an exact start.`);
    } else if (near) {
      centerOn(fix.point, 17.5);
      message(`GPS puts you near ${near.place.name}, Terminal ${near.place.terminal} (±${Math.round(fix.accuracy)} m). Walking routes cover Terminal 1 only so far.`);
    }
  };
  locateWatch = new LocationWatch(navigator.geolocation, fix => {
    if (!best || fix.accuracy < best.accuracy) best = fix;
    if (fix.accuracy <= GOOD_ACCURACY) use(fix);
  }, state => {
    if (state === 'denied') { clearTimeout(timer); done('Location access is off for this site. Choose the sign near you instead.'); }
    if (state === 'unsupported') { clearTimeout(timer); done('This browser cannot share its location. Choose the sign near you instead.'); }
  });
  locateWatch.start();
}

// ---------- Navigation between list and route ----------
function selectDestination(id) {
  if (!ctx.byId.has(id)) return;
  stopWalk(false);
  destId = id;
  $('places').hidden = true; $('route-view').hidden = false; document.body.classList.add('has-route');
  $('sheet').scrollTo({ top: 0, behavior: 'smooth' }); sheet.snap('medium');
  renderRoute(); updateAddress(); sheet.refresh(); fitTrip();
}
function showPlaces() {
  stopWalk(false);
  destId = ''; trip = null;
  $('places').hidden = false; $('route-view').hidden = true; document.body.classList.remove('has-route');
  sheet.snap('medium'); drawTrip(); renderList(); updateAddress();
  const start = ctx.byId.get(startId);
  if (start && ctx.routable(startId)) centerOn(start.point, 17.5); else showTerminal('all');
}
function setStart(id) {
  stopWalk(false);
  startId = id; distancesFor = '';
  buildStartPicker(); renderHere(); updateAddress();
  if (destId) renderRoute(); else { renderList(); drawTrip(); }
  if (destId) fitTrip(); else if (ctx.routable(id)) centerOn(ctx.byId.get(id).point, 17.5);
}

// ---------- Events ----------
$('search').addEventListener('input', renderList);
$('search').addEventListener('focus', () => sheet.snap('large'));
$('search').addEventListener('keydown', e => { if (e.key === 'Enter') { const first = search(ctx, $('search').value, filter === 'amenity' ? 'all' : filter)[0]; if (first) { $('search').blur(); selectDestination(first.id); } } });
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.category;
  const buttons = [...document.querySelectorAll('[data-category]')];
  button.parentElement.style.setProperty('--segment', buttons.indexOf(button));
  buttons.forEach(b => { const on = b === button; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  renderList(); redrawAmenities();
}));
$('start-select').addEventListener('change', e => { if (e.target.value) setStart(e.target.value); });
document.querySelectorAll('[data-trip]').forEach(b => b.addEventListener('click', () => chooseTrip(b.dataset.trip)));
$('ff-back').addEventListener('click', () => showStep('trip'));
$('ff-reopen').addEventListener('click', () => chooseTrip('depart'));
$('simulate').addEventListener('click', () => beginWalk('sim'));
$('live').addEventListener('click', () => beginWalk('live'));
$('walk-stop').addEventListener('click', () => stopWalk(true));
function setPauseButton(paused) { $('walk-pause').innerHTML = icon(paused ? 'play' : 'pause'); $('walk-pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause'); }
$('walk-pause').addEventListener('click', () => { if (!walk) return; walk.paused = !walk.paused; setPauseButton(walk.paused); });
document.querySelectorAll('#walk-speed button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#walk-speed button').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); });
  if (walk) walk.speed = Number(b.dataset.speed);
}));
$('locate').addEventListener('click', locateStart);
$('ff-number').addEventListener('submit', e => { e.preventDefault(); $('flight-input').blur(); lookupFlight($('flight-input').value); });
$('back').addEventListener('click', showPlaces);
$('avoid-steps').addEventListener('change', e => { stopWalk(false); avoidSteps = e.target.checked; distancesFor = ''; renderRoute(); updateAddress(); fitTrip(); });
$('fit-map').addEventListener('click', () => { if (walk) { walk.follow = true; followWalker(true); } else if (destId) fitTrip(); else showTerminal('all'); });
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showTerminal(b.dataset.view)));
$('share').addEventListener('click', async () => {
  const url = shareURL(), dest = ctx.byId.get(destId);
  try { if (navigator.share) { await navigator.share({ title: `Route to ${dest?.name || 'O\'Hare'}`, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Route link copied.'); } catch { prompt('Copy this route link:', url); }
});
document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); $('search').focus(); } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());

// ---------- Start ----------
async function init() {
  try {
    const [network, places] = await Promise.all(['data/network.json', 'data/places.json'].map(p => fetch(p, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(p); return r.json(); })));
    const outline = await fetch('data/outline.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    airport = outline;
    ctx = createContext(network, places);
    buildStartPicker(); renderHere(); sheet.snap('medium', false);
    map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 13.5, maxZoom: 20, zoomSnap: 0.25, attributionControl: true, maxBounds: [[41.945, -87.945], [42.013, -87.865]], maxBoundsViscosity: 0.8 }).setView([41.9768, -87.8990], 15);
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution(`${outline ? 'Outlines © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · ' : ''}<a href="sources.html">Sources</a>`);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    drawSchematic(outline); drawPlaces(); map.fire('zoomend');
    map.on('dragstart', () => { if (walk) walk.follow = false; });
    if (startId && !ctx.byId.has(startId)) message('That sign link is not recognized. Choose the sign near you.');
    else if (startId && !ctx.routable(startId)) message(`${ctx.byId.get(startId).name} is in a map preview area. Choose a Terminal 1 sign to get routes.`);
    renderList();
    showStep(destId ? 'reopen' : 'trip');
    if (destId && ctx.byId.has(destId)) selectDestination(destId);
    else {
      if (destId) message('That destination link is not recognized. Search for a gate or amenity.');
      destId = ''; drawTrip();
      if (ctx.routable(startId)) centerOn(ctx.byId.get(startId).point, 17.5, false); else map.fitBounds(boundsFor('all'), { ...framing(), animate: false });
      updateAddress();
    }
    document.body.classList.add('ready');
    // The map's size settles only after the first layout; frame the route again once it has.
    requestAnimationFrame(() => { map.invalidateSize(false); if (destId) fitTrip(); });
    if (flightIata) { tripKind = 'depart'; await lookupFlight(flightIata, { fromLink: true }); }
  } catch (error) {
    console.error('ORD Tap could not load its data.', error);
    $('place-list').replaceChildren(el('p', 'empty-state', 'The O\'Hare map could not load. Refresh to try again.'));
  }
}
init();
