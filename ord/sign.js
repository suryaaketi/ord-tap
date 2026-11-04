// Printable "You are here" sign. The NFC tag and the QR code carry the same link.
import { locationLink } from '../prototype.js';
import { qrSVG } from '../signs.js';
import { createContext, placeFacts } from './core.js';

const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
const NFC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7a8 8 0 0 0 0 10m3-8a5 5 0 0 0 0 6m9-8a8 8 0 0 1 0 10m-3-8a5 5 0 0 1 0 6"/><rect x="11" y="10" width="2" height="4" rx="1"/></svg>';

const [network, places] = await Promise.all(['data/network.json', 'data/places.json'].map(p => fetch(p).then(r => r.json())));
const ctx = createContext(network, places);
const requested = new URLSearchParams(location.search).get('start');
for (const s of ctx.signs) { const o = el('option', '', `${s.label}, Concourse ${s.place.concourse}${s.demo ? ' (demo)' : ''}`); o.value = s.id; $('sign-start').append(o); }
$('sign-start').value = ctx.signs.some(s => s.id === requested) ? requested : ctx.signs.find(s => s.demo)?.id;

function render() {
  const sign = ctx.signs.find(s => s.id === $('sign-start').value), f = placeFacts(ctx, sign.place);
  const url = locationLink(location.href, sign.id, places);
  $('tag-url').textContent = url; $('open').href = url;
  history.replaceState(null, '', `?start=${sign.id}`);
  const card = $('sign'); card.replaceChildren();
  const here = el('div', 'here'); here.append(el('span', 'dot'), el('h1', '', 'You are here'));
  const tap = el('div', 'tap');
  const nfc = el('div', 'nfc'); nfc.innerHTML = NFC; nfc.append(el('b', '', 'Tap your phone here'), el('span', '', 'NFC tag inside this sign'));
  const qr = el('div', 'qr'); const svg = new DOMParser().parseFromString(qrSVG(url), 'image/svg+xml').documentElement;
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `QR code for ${url}`); qr.append(document.importNode(svg, true), el('p', '', 'Or scan with your camera'));
  tap.append(nfc, qr);
  const foot = el('div', 'foot'); const left = el('span'); left.append(el('b', '', 'ORD Tap'), document.createTextNode(' · ENGR 408 student prototype · not an official O\'Hare sign'));
  foot.append(left, el('span', '', `Sign ID ${sign.id}`));
  card.append(here, el('p', 'where', `${f.terminal} · ${f.concourse} · ${sign.label}`), el('p', 'level', `${f.level}, after security`), tap, el('p', 'find', 'Find your gate, restrooms and food.'), el('p', 'no', 'Opens a map in your browser with a walking route. No app, no GPS, no location permission.'), foot);
}
$('sign-start').addEventListener('change', render);
$('print').addEventListener('click', () => window.print());
render();
