import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createContext,planTrip,search,normalizeQuery,busRunning,placeFacts,routeBetween} from '../ord/core.js';
import {locationLink,inspectTagLink} from '../prototype.js';
import {makeQR} from '../signs.js';

const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const network=read('../data/network.json'),places=read('../data/places.json');
const ctx=createContext(network,places);
const site='https://suryaaketi.github.io/ord-tap/';

// Walking distances from Gate B6 on the official O'Hare interactive map, checked 2026-11-04.
const OFFICIAL={'t1-c17':491,'t1-restrooms-c19':466,'t1-c1':692,'t1-c31':667,'t1-c10':589,'t1-b1':125,'t1-b12':310,'t1-b14':376,'t1-b21':562,'t1-transfer-bus':450};

test('every place carries terminal, concourse, level, security and source',()=>{
  const ids=new Set();
  for(const p of places){
    assert.ok(!ids.has(p.id),`duplicate ${p.id}`);ids.add(p.id);
    for(const key of ['name','kind','terminal','level','security','source']) assert.ok(p[key],`${p.id} ${key}`);
    assert.ok(network.levels[p.level],`${p.id} level`);
    assert.ok(p.point[0]>41.97&&p.point[0]<41.985&&p.point[1]>-87.915&&p.point[1]<-87.88,`${p.id} outside O'Hare`);
  }
  for(const t of ['1','2','3','5']) for(const c of network.terminals[t].concourses) assert.ok(places.some(p=>p.kind==='gate'&&p.terminal===t&&p.concourse===c),`no gates in ${c}`);
});

test('Terminal 1 airside places are routable; other terminals are a map preview',()=>{
  const t1=places.filter(p=>p.terminal==='1'&&p.security==='airside');
  for(const p of t1) assert.ok(ctx.routable(p.id),`${p.id} has no route`);
  assert.ok(places.filter(p=>p.terminal!=='1').every(p=>!ctx.routable(p.id)));
  assert.equal(placeFacts(ctx,ctx.byId.get('t3-k20')).preview,true);
  assert.equal(placeFacts(ctx,ctx.byId.get('t1-c17')).preview,false);
});

test('B6 to C17 goes down to the tunnel, west under the apron, and up into Concourse C',()=>{
  const trip=planTrip(ctx,'t1-b6','t1-c17');
  assert.equal(trip.type,'route');
  const levels=trip.route.levels.filter((l,i,a)=>i===0||l!==a[i-1]);
  assert.deepEqual(levels,['t1-upper','t1-tunnel','t1-upper']);
  const text=trip.route.steps.map(s=>s.text);
  assert.match(text[0],/north along Concourse B/);
  assert.match(text[1],/escalator down to the Pedestrian Tunnel Level/);
  assert.match(text[2],/pedestrian tunnel west/);
  assert.match(text[3],/escalator up to the Upper Level of Concourse C/);
  assert.match(text.at(-1),/Arrive at Gate C17, on your left/);
  assert.equal(trip.route.minutes,7);
});

test('routes match the official map distances within 5%',()=>{
  for(const [id,meters] of Object.entries(OFFICIAL)){
    const r=routeBetween(ctx,'t1-b6',id);
    assert.ok(r,id); assert.ok(Math.abs(r.distance/meters-1)<0.05,`${id}: ${Math.round(r.distance)} m vs official ${meters} m`);
  }
});

test('restrooms near C19 are a second verified destination',()=>{
  const trip=planTrip(ctx,'t1-b6','t1-restrooms-c19');
  assert.equal(trip.type,'route');
  assert.ok(trip.route.levels.includes('t1-tunnel'));
  assert.match(ctx.byId.get('t1-restrooms-c19').detail,/all-gender/);
});

test('avoiding escalators uses the elevators at both ends',()=>{
  const trip=planTrip(ctx,'t1-b6','t1-c17',{avoidSteps:true});
  const kinds=trip.route.edgeIndices.map(i=>ctx.edgeMeta[i].kind);
  assert.ok(!kinds.includes('escalator')); assert.equal(kinds.filter(k=>k==='elevator').length,2);
  assert.match(trip.route.steps[1].text,/elevator down/);
});

test('Terminal 5 trips end at the Terminal Transfer Bus at C18B; core terminals show a preview message',()=>{
  const t5=planTrip(ctx,'t1-b6','t5-m13');
  assert.equal(t5.type,'transfer'); assert.equal(t5.busStop.id,'t1-transfer-bus'); assert.match(t5.busStop.name,/C18B/);
  assert.match(t5.route.steps.at(-1).text,/Terminal Transfer Bus/);
  assert.equal(planTrip(ctx,'t1-b6','t3-k20').type,'preview');
  assert.equal(planTrip(ctx,'t1-b6','t2-e5').type,'preview');
  assert.equal(planTrip(ctx,'','t1-c17').type,'no-start');
  assert.equal(planTrip(ctx,'t1-b6','t1-b6').type,'here');
  assert.equal(planTrip(ctx,'t1-b6','nowhere').type,'unknown');
});

test('the transfer bus runs 11:30 a.m. to 9:30 p.m. Chicago time',()=>{
  assert.equal(busRunning(ctx,new Date('2026-11-04T17:31:00Z')),true);   // 11:31 a.m. CST
  assert.equal(busRunning(ctx,new Date('2026-11-04T17:29:00Z')),false);  // 11:29 a.m.
  assert.equal(busRunning(ctx,new Date('2026-11-05T03:29:00Z')),true);   // 9:29 p.m.
  assert.equal(busRunning(ctx,new Date('2026-11-05T03:30:00Z')),false);  // 9:30 p.m.
});

test('gate search accepts C17 in the ways people type it',()=>{
  for(const q of ['C17','c17','c 17','Gate C17','gate c-17','  C17 ']) assert.equal(search(ctx,q)[0].id,'t1-c17',q);
  assert.equal(search(ctx,'B22')[0].id,'t1-b22');
  assert.equal(search(ctx,'h1b')[0].id,'t3-h1b');
  assert.equal(normalizeQuery('Gate C17!'),'c17');
  assert.ok(search(ctx,'restroom','restroom').every(p=>p.kind==='restroom'));
  assert.ok(search(ctx,'starbucks').some(p=>p.id==='t1-starbucks-c17'));
});

test('NFC and QR links open the site at the sign, and shared routes keep both ends',()=>{
  const link=locationLink(site+'sign.html',`t1-b6`,places);
  assert.equal(link,`${site}?start=t1-b6`);
  assert.equal(inspectTagLink(link,site,places).place.id,'t1-b6');
  assert.equal(inspectTagLink(`${site}?start=t1-b6&to=t1-c17`,site,places).ok,true);
  assert.ok(makeQR(link).getModuleCount()>=21);
  const demo=ctx.signs.find(s=>s.demo); assert.equal(demo.id,'t1-b6');
  assert.ok(ctx.signs.every(s=>ctx.routable(s.id)));
});
