// Unit tests for web/core.js: node --test tests/core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../web/core.js');
const FIX = require('./fixtures/vectors.json');

const MIN = 60000, HOUR = 3600000;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what || ''} ${a} is not within ${tol} of ${b}`);
function make(set, up) {
  const x = JSON.parse(JSON.stringify(FIX.base));
  Object.assign(x, set || {});
  for (const [i, v] of Object.entries(up || {})) Object.assign(x.up[i], v);
  return x;
}

test('golden vectors: parts, gate, stars and verdict', () => {
  for (const v of FIX.vectors) {
    const r = G.rate(make(v.set, v.up), { day: 0, normal: FIX.normal });
    near(r.parts.c, v.c, 0.006, `${v.name}: C`);
    near(r.parts.s, v.s, 0.006, `${v.name}: S`);
    near(r.parts.a, v.a, 0.006, `${v.name}: A`);
    near(r.parts.k, v.k, 0.006, `${v.name}: K`);
    near(r.gate, v.gate, 0.006, `${v.name}: gate`);
    assert.equal(r.score, v.stars, `${v.name}: stars`);
    assert.equal(r.verdict, v.verdict, `${v.name}: verdict`);
    assert.equal(r.colourClass, v.class, `${v.name}: colour class`);
  }
});

test('sun visible and colour at their thresholds', () => {
  const p = (set, up) => G.parts(make(set, up), 18);
  assert.equal(p({}, { 0: { low: 20 } }).s, 1);
  near(p({}, { 0: { low: 50 } }).s, 0.5, 1e-9);
  assert.equal(p({}, { 1: { low: 80 } }).s, 0);
  near(p({}, { 2: { mid: 100 } }).s, 0.5, 1e-9, 'half of mid cloud at 200 km');
  assert.equal(p({}, { 2: { low: 100 } }).s, 1, 'low cloud at 200 km is below the horizon: the sun still shows');
  assert.equal(p({}, { 3: { mid: 100 } }).s, 1, 'cloud at 300 km does not hide the sun');
  near(p({ high: 50 }, { 2: { low: 100 } }).c, 0.4, 1e-9, 'but it shades the cloud overhead');
  near(p({ high: 50 }, { 3: { high: 100 } }).c, 0.4 + 0.6 * (1 - 10 / 60), 1e-9, '30% of high cloud at 300 km');
  near(p({ high: 4 }).c, 0.1, 1e-9, 'a cloudless sky has nothing to catch the colour');
  near(p({ high: 17.5 }).c, 0.55, 1e-9);
  near(p({ high: 50, aod: 0.6 }).c, 0.76, 1e-9, 'haze washes the colour out');
  assert.deepEqual([1, 0.85, 0.7, 0.5, 0.3, 0.1].map(G.colourClass), ['Brilliant', 'Brilliant', 'Rich', 'Warm', 'Soft', 'Muted']);
  near(p({ mid: 30 }).c, 1, 1e-9);
  near(p({ mid: 70 }).c, 1, 1e-9);
  near(p({ high: 100 }, { 0: { low: 50 } }).c, 0.2 * (0.4 + 0.6 * 0.5), 1e-9, 'a solid deck with no strip');
  near(p({ high: 50, low: 50 }).c, 0.5, 1e-9, 'low cloud overhead halves it');
});

test('air clarity', () => {
  const a = (set) => G.parts(make(set), 18).a;
  assert.equal(a({ aod: 0.15 }), 1);
  near(a({ aod: 0.375 }), 0.6, 1e-9);
  near(a({ aod: 0.6 }), 0.2, 1e-9);
  near(a({ aod: 0.8 }), 0.1, 1e-9);
  assert.equal(a({ aod: 1.2 }), 0);
  near(a({ aod: null, visibility: 17500 }), 0.5, 1e-9, 'falls back to visibility in metres');
  assert.equal(a({ aod: null, visibility: 4000 }), 0);
  near(a({ humidity: 85 }), 1 - 0.075, 1e-9, 'humidity is a ramp, not a step');
  near(a({ humidity: 100 }), 0.85, 1e-9);
  near(a({ aod: null, visibility: 30000, humidity: 95 }), 0.85, 1e-9, 'and applies to the fallback too');
});

test('comfort: wind, gusts, temperature against the normal, rain', () => {
  const k = (set, normal) => G.parts(make(set), normal === undefined ? 18 : normal);
  assert.equal(k({ wind: 3.5 }).wind, 1);
  near(k({ wind: 6.25 }).wind, 0.5, 1e-9);
  assert.equal(k({ wind: 9 }).wind, 0);
  near(k({ wind: 2, gusts: 10 }).w, 7, 1e-9, '0.7 of the gusts when that is more');
  assert.equal(k({ apparent: 15 }).temp, 1);
  assert.equal(k({ apparent: 22 }).temp, 1);
  near(k({ apparent: 10.5 }).temp, 0.5, 1e-9, '7.5 below normal');
  near(k({ apparent: 25 }).temp, 0.5, 1e-9, '7 above normal');
  assert.equal(k({ apparent: 6 }).temp, 0);
  assert.equal(k({ apparent: -2 }, -1).temp, 0.5, 'below freezing is never better than half, whatever is normal');
  assert.equal(k({ apparent: 36 }, 36).temp, 0.5);
  assert.equal(k({ apparent: 18 }, null).temp, 1, 'without a normal: comfortable from 10 to 27');
  near(k({ apparent: 5 }, null).temp, 0.5, 1e-9);
  near(k({ apparent: 31 }, null).temp, 0.5, 1e-9);
  near(k({ rainChance: 60 }).k, 0.5, 1e-9);
  assert.equal(k({ rainChance: 50 }).k, 1);
});

test('colour dominates: comfort and clean air never lift a dead sky, and comfort costs at most half a star', () => {
  const dead = G.rate(make({ low: 100 }, { 0: { low: 80 }, 1: { low: 80 } }), { normal: 18 });
  assert.ok(dead.score <= 0.2, `dead sky scored ${dead.score}`);
  const calm = G.rate(make({ high: 50 }), { normal: 18 }).score;
  const rough = G.rate(make({ high: 50, wind: 20, apparent: -10 }), { normal: 18 }).score;
  near(calm - rough, 0.5, 1e-9);
  assert.equal(G.rate(make({}), { normal: 18 }).verdict, 'skip', 'a cloudless, clean, calm evening is not a Go');
  assert.equal(G.WEIGHTS.c, 0.7);
});

test('caps at 1.5 stars', () => {
  const r = (set, up) => G.rate(make({ high: 50, ...set }, up), { normal: 18 });
  assert.deepEqual([r({ codes: [3, 95] }).cap, r({ codes: [3, 95] }).score], ['thunder', 1.5]);
  assert.equal(r({ codes: [61, 3], precipitation: 0.4 }).cap, 'rain');
  assert.equal(r({ codes: [61, 3], precipitation: 0.1 }).cap, null, 'a trace is not rain');
  assert.equal(r({ codes: [73, 73], precipitation: 1 }).cap, 'snow');
  assert.equal(r({ codes: [3, 86], precipitation: 1 }).cap, 'snow');
  assert.equal(r({ codes: [45, 3] }).cap, 'fog');
  assert.equal(r({ codes: [80, 81], precipitation: 2 }).cap, null, 'rain showers are not capped');
  assert.equal(r({ low: 90 }, { 0: { low: 90 }, 1: { low: 90 } }).cap, 'overcast');
  assert.equal(r({ low: 90 }, { 0: { low: 90 }, 1: { low: 40 } }).cap, null);
  assert.equal(r({ codes: [61, 61], precipitation: 2 }).score, 1.5);
  assert.equal(r({ low: 90 }, { 0: { low: 90 }, 1: { low: 90 } }).score < 1.5, true, 'a cap never raises a score');
});

test('tiers, ranges and verdict qualifiers', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6].map(G.tierOf), ['tonight', 'forecast', 'forecast', 'outlook', 'outlook', 'none']);
  const x = make({ mid: 20 });                                 // 3.7
  const t = G.rate(x, { day: 0, normal: 18 });
  assert.deepEqual([t.range, t.lo, t.hi, t.qualifier], [0.5, 3.2, 4.2, 'could slip to Maybe']);
  const f = G.rate(x, { day: 2, normal: 18 });
  assert.deepEqual([f.range, f.lo, f.hi], [0.8, 2.9, 4.5]);
  const o = G.rate(x, { day: 4, normal: 18 });
  assert.deepEqual([o.range, o.shown, o.qualifier], [1.2, 3.5, 'may change']);
  assert.equal(G.rate(x, { day: 0, normal: 18, spotType: 'water' }).range, 0.8, 'coast and summits are harder to call');
  assert.equal(G.rate(make({ high: 50 }), { day: 0, normal: 18 }).qualifier, '', 'a 5.0 tonight stays a Go');
  assert.equal(G.rate(make({ high: 50 }), { day: 0, normal: 18 }).hi, 5, 'the range stops at 5');
  assert.equal(G.rate(make({ mid: 15 }), { day: 0, normal: 18 }).qualifier, 'could reach Go');   // 3.1
  assert.equal(G.rate(make({ high: 50 }, { 1: { low: 80 } }), { day: 1, normal: 18 }).qualifier, 'could reach Maybe'); // 2.3 ± 0.8
  assert.equal(G.rate(make({ codes: [95, 95] }), { day: 0, normal: 18 }).qualifier, '', 'capped evenings get no qualifier');
});

test('reason sentences and warnings', () => {
  const r = (set, up, o) => G.rate(make(set, up), { normal: 18, ...(o || {}) });
  assert.equal(r({ codes: [95, 3] }).reason, 'Thunderstorms nearby: one to skip.');
  assert.equal(r({ codes: [63, 63], precipitation: 1 }).reason, 'Rain will likely hide it.');
  assert.equal(r({ codes: [73, 73], precipitation: 1 }).reason, 'Snow will likely hide it.');
  assert.equal(r({ codes: [48, 48] }).reason, 'Fog will likely hide it.');
  assert.equal(r({ low: 95 }, { 0: { low: 95 }, 1: { low: 95 } }).reason, 'Low cloud will likely block it.');
  assert.equal(r({ pm25: 60, aod: 0.7, high: 50 }).reason, 'Smoky: a red sun, muted sky.');
  assert.equal(r({ high: 50 }, { 0: { low: 80 } }).reason, 'Cloud to the west will likely hide the sun.');
  assert.equal(r({ high: 50 }).reason, 'High cloud should catch the colour; clear to the west.');
  assert.equal(r({}).reason, 'Clear sky: no cloud to catch the colour.');
  assert.equal(r({ low: 45, mid: 20 }).reason, 'Low cloud may block some of it.');
  assert.equal(r({ high: 95 }, { 3: { low: 60 } }).reason, 'A thick cloud layer may mute it.');
  assert.equal(r({ mid: 15 }).reason, 'Some cloud to catch a little colour.');
  assert.equal(r({ mid: 15, aod: 0.5 }).reason, 'Some cloud to catch a little colour; hazy.');
  assert.equal(r({ mid: 15, wind: 8 }, null, { imperialFirst: true }).reason, 'Some cloud to catch a little colour; breezy: 18 mph · 29 km/h.');
  assert.equal(r({ mid: 15, apparent: 8 }).reason, 'Some cloud to catch a little colour; cold for the time of year.');
  assert.equal(r({ mid: 15, apparent: 27 }).reason, 'Some cloud to catch a little colour; hot for the time of year.');
  assert.equal(r({ mid: 15, rainChance: 70 }).reason, 'Some cloud to catch a little colour; showers possible.');
  for (const wind of [8, 30, 60]) for (const up of [null, { 0: { low: 45 } }]) {
    const s = r({ high: 50, wind }, up, { imperialFirst: true }).reason;
    assert.ok(s.length <= 90, `over 90 characters: ${s}`);
  }
  assert.equal(r({ high: 50 }, { 0: { low: 45 } }).reason, 'Colour likely overhead, though the sun may slip behind cloud.');
  assert.equal(r({ codes: [63, 63], precipitation: 1, wind: 9 }).reason, 'Rain will likely hide it.', 'capped rows take no modifier');
  assert.deepEqual(r({ codes: [96, 3] }).warnings.map((w) => w.id), ['thunder']);
  assert.deepEqual(r({ aqi: 160 }).warnings.map((w) => w.id), ['air']);
  assert.deepEqual(r({ aqi: 150 }).warnings, []);
});

test('reading the forecast: interpolation, sums and categories', () => {
  const t0 = Date.UTC(2026, 5, 1, 0), time = Array.from({ length: 48 }, (_, i) => t0 + i * HOUR);
  const ramp = time.map((_, i) => i * 2);
  const p0 = { time, cloud_cover_low: ramp, cloud_cover_mid: ramp, cloud_cover_high: ramp, visibility: ramp, relative_humidity_2m: ramp,
    apparent_temperature: ramp, wind_speed_10m: ramp, wind_gusts_10m: ramp,
    precipitation: time.map((_, i) => (i === 21 ? 0.5 : i === 12 ? 2 : 0)), precipitation_probability: time.map((_, i) => (i === 20 ? 30 : 80)),
    weather_code: time.map((_, i) => (i === 21 ? 95 : 2)) };
  const up = [0, 1, 2, 3].map(() => ({ time, cloud_cover_low: ramp, cloud_cover_mid: ramp, cloud_cover_high: ramp }));
  const x = G.inputsAt(p0, up, null, t0 + 20.25 * HOUR);
  near(x.low, 40.5, 1e-9);
  assert.equal(x.precipitation, 0.5, 'the larger of the two hours');
  assert.equal(x.rainChance, 80);
  assert.deepEqual(x.codes, [2, 95], 'both hours, so a rule can fire on either');
  near(x.apparent, 41.5, 1e-9, 'comfort is read 30 minutes after sunset');
  near(x.apparentLater, 42.5, 1e-9, 'and the bring list an hour after');
  assert.equal(x.rain12, 2, 'rain in the 12 hours before');
  assert.equal(x.aod, null);
  assert.equal(G.inputsAt(p0, up, null, t0 + 60 * HOUR), null, 'outside the forecast');
  const aq = { time, aerosol_optical_depth: time.map(() => 0.3), pm2_5: time.map(() => 12), us_aqi: time.map(() => 40) };
  assert.equal(G.inputsAt(p0, up, aq, t0 + 20.25 * HOUR).aod, 0.3);
});

test('evening times', () => {
  // Denver, 21 June 2026 (UTC-6): sunset about 8:31 pm.
  const d = G.eveningTimes(G.solarNoonGuess(2026, 6, 21, -104.99), 39.739, -104.99);
  assert.equal(d.state, 'ok');
  near(d.sunset, Date.UTC(2026, 5, 22, 2, 31), 2 * MIN, 'Denver sunset, 8:31 pm');
  assert.ok(d.goldenStart < d.bestStart && d.bestStart < d.sunset && d.sunset < d.bestEnd && d.bestEnd < d.afterglowEnd && d.afterglowEnd < d.lastLight);
  near(G.sunPosition(d.sunset, 39.739, -104.99).altitude, -0.833, 0.25, 'sunset altitude');
  near(G.sunPosition(d.goldenStart, 39.739, -104.99).altitude, 6, 0.25, 'golden hour altitude');
  near(G.sunPosition(d.lastLight, 39.739, -104.99).altitude, -6, 0.25, 'last light altitude');
  near(d.azimuth, 302, 1.5, 'midsummer sunset is to the north-west');
  // London, 21 December 2026: sunset about 3:53 pm.
  const l = G.eveningTimes(G.solarNoonGuess(2026, 12, 21, -0.128), 51.507, -0.128);
  near(l.sunset, Date.UTC(2026, 11, 21, 15, 53), 2 * MIN, 'London sunset, 3:53 pm');
  // Sydney, 21 December 2026 (UTC+11): sunset about 8:05 pm, on the right local day.
  const s = G.eveningTimes(G.solarNoonGuess(2026, 12, 21, 151.21), -33.87, 151.21);
  assert.equal(new Date(s.sunset + 11 * HOUR).toISOString().slice(0, 10), '2026-12-21');
  near(s.sunset, Date.UTC(2026, 11, 21, 9, 5), 4 * MIN, 'Sydney sunset');
  // Tromsø: midnight sun in June, polar night in December.
  assert.deepEqual([G.eveningTimes(G.solarNoonGuess(2026, 6, 21, 18.96), 69.65, 18.96).state, G.eveningTimes(G.solarNoonGuess(2026, 6, 21, 18.96), 69.65, 18.96).polar], ['none', 'day']);
  assert.equal(G.eveningTimes(G.solarNoonGuess(2026, 12, 21, 18.96), 69.65, 18.96).polar, 'night');
  // 64° N at midsummer: the sun sets, but twilight lasts all night.
  const r = G.eveningTimes(G.solarNoonGuess(2026, 6, 21, -21.9), 64.15, -21.9);
  assert.equal(r.state, 'twilight');
  assert.ok(r.sunset !== null && r.lastLight === null);
});

test('plan times', () => {
  const times = G.eveningTimes(G.solarNoonGuess(2026, 6, 21, -104.99), 39.739, -104.99);
  const p = G.planTimes(times, { walkIn: 10, travel: 30, buffer: 25 });
  assert.equal(p.meetAt, times.bestStart - 20 * MIN);
  assert.equal(p.leaveBy, p.meetAt - 65 * MIN);
  assert.equal(p.stayUntil, times.afterglowEnd);
  assert.equal(p.headBackBy, times.lastLight);
  assert.equal(G.planTimes(times, { closing: times.sunset + 10 * MIN }).headBackBy, times.sunset - 5 * MIN, '15 minutes before closing');
  const tw = G.eveningTimes(G.solarNoonGuess(2026, 6, 21, -21.9), 64.15, -21.9);
  const q = G.planTimes(tw, {});
  assert.deepEqual([q.stayUntil - tw.sunset, q.headBackBy - tw.sunset], [45 * MIN, 90 * MIN]);
  assert.equal(G.planTimes(G.eveningTimes(G.solarNoonGuess(2026, 6, 21, 18.96), 69.65, 18.96), {}), null);
  assert.deepEqual([0.1, 3, 9.9, 10, 25, 40, 41, 80].map(G.travelMinutes), [0, 10, 30, 20, 40, 70, 40, 80]);
  assert.deepEqual([G.bufferMinutes(3.6, 2), G.bufferMinutes(4.0, 2), G.bufferMinutes(3.0, 5), G.bufferMinutes(3.0, 0)], [10, 25, 25, 25]);
});

test('what to bring', () => {
  const times = G.planTimes(G.eveningTimes(G.solarNoonGuess(2026, 6, 21, -104.99), 39.739, -104.99), {});
  const list = (set, o) => { const x = make(set); return G.bringList(x, G.rate(x, { normal: 18 }).detail, { spotType: 'outdoor', walkIn: 5, times, ...(o || {}) }).map((i) => i.id); };
  assert.deepEqual(list({ apparentLater: 8 }), ['coat', 'light', 'blanket', 'sunglasses']);
  assert.deepEqual(list({ apparentLater: 14 }), ['layer', 'light', 'blanket', 'sunglasses']);
  assert.deepEqual(list({ apparentLater: 20, windLater: 6 }), ['windproof', 'light', 'blanket', 'sunglasses']);
  assert.deepEqual(list({ apparentLater: 20, rain12: 2 }), ['light', 'mat', 'blanket', 'sunglasses']);
  assert.deepEqual(list({ apparentLater: 20 }, { spotType: 'water' }), ['light', 'blanket', 'repellent', 'sunglasses']);
  assert.deepEqual(list({ apparentLater: 20 }, { spotType: 'venue' }), ['booking', 'light', 'sunglasses']);
  assert.deepEqual(list({ apparentLater: 20 }, { walkIn: 20 }), ['light', 'blanket', 'water', 'sunglasses']);
  assert.equal(list({ apparentLater: 5, windLater: 6, rain12: 3 }, { spotType: 'water', walkIn: 20, who: 'family' }).length, 7, 'never more than seven');
  const x = make({ apparentLater: 8 });
  assert.match(G.bringList(x, G.rate(x, { normal: 18 }).detail, { spotType: 'outdoor', walkIn: 5, times, imperialFirst: true })[0].why, /^46°F · 8°C an hour after sunset$/);
});

test('merging a new bring list into a saved one', () => {
  const saved = [{ id: 'coat', name: 'Coat', done: true }, { id: 'light', name: 'Torch', done: false }, { id: 'mat', name: 'Mat', done: false, who: 'Sam' },
    { id: 'x1', name: 'Camera', custom: true, done: false }];
  const out = G.mergeItems(saved, [{ id: 'light', name: 'Torch or phone light', why: 'dark' }, { id: 'windproof', name: 'Windproof layer', why: 'breezy' }]);
  assert.deepEqual(out.map((i) => i.id), ['light', 'windproof', 'coat', 'mat', 'x1']);
  assert.equal(out[1].isNew, true, 'a newly triggered item is marked new');
  assert.equal(out[2].done, true, 'ticked items stay');
  assert.equal(out[3].who, 'Sam', 'named items stay');
});

test('share link: round trip, privacy, size and hostile input', () => {
  const times = G.planTimes(G.eveningTimes(G.solarNoonGuess(2026, 6, 21, -104.99), 39.739, -104.99), { walkIn: 10, travel: 40, buffer: 25 });
  const plan = { spot: { name: 'Lookout Mountain — “the view”, 日没 <img src=x onerror=alert(1)>', lat: 39.7323456, lon: -105.2391234, type: 'peak' }, date: '2026-06-21',
    tz: 'America/Denver', times, walkIn: 10, travel: 40, buffer: 25, start: { lat: 39.74, lon: -104.99 }, scoreAtSave: 4.4, sharedAt: Date.UTC(2026, 5, 21, 18),
    items: [{ id: 'coat', name: 'Coat', why: 'cold', who: 'Sam' }, { id: 'blanket', name: 'Blanket or chairs', why: 'sit' },
      ...Array.from({ length: 14 }, (_, i) => ({ id: 'c' + i, custom: true, name: 'A very long custom item name that goes on and on ' + i }))] };
  const link = G.encodePlan(plan);
  assert.match(link, /^[A-Za-z0-9_-]+$/);
  assert.ok(link.length < G.MAX_LINK, `link is ${link.length} characters`);
  const json = new TextDecoder().decode(G.fromBase64Url(link));
  assert.ok(!/leaveBy|travel|buffer|start|104\.99|39\.74\b/.test(json), 'nothing that reveals where the organiser starts');
  assert.ok(!json.includes(String(Math.round(times.leaveBy / MIN))), 'no leave-by time');
  const back = G.decodePlan(link);
  assert.equal(back.spot.name, plan.spot.name.slice(0, 60), 'names come back as the same text, to be shown as text');
  assert.deepEqual([back.spot.lat, back.spot.lon, back.spot.type, back.date, back.walkIn, back.scoreAtSave], [39.73235, -105.23912, 'peak', '2026-06-21', 10, 4.4]);
  for (const k of ['meetAt', 'sunset', 'stayUntil', 'headBackBy']) near(back.times[k], times[k], 30000, k);
  assert.equal(back.times.leaveBy, undefined);
  assert.equal(back.items.length, 12, 'two rule items and at most ten custom ones');
  assert.equal(back.items[0].who, 'Sam');
  assert.ok(back.items.every((i) => i.name.length <= 40));
  assert.equal(G.decodePlan(link.slice(0, 40)), null, 'a cut-off link');
  assert.equal(G.decodePlan('!!!'), null);
  assert.equal(G.decodePlan(G.toBase64Url(new TextEncoder().encode(JSON.stringify({ v: 2 })))), null, 'a newer version');
  assert.equal(G.decodePlan(G.toBase64Url(new TextEncoder().encode('{"v":1,"n":"x","la":999,"lo":0,"d":"2026-06-21","m":1,"s":1,"u":1,"h":1}'))), null);
});

test('calendar file', () => {
  const text = G.ics({ id: 'p1', now: Date.UTC(2026, 5, 20, 12), start: Date.UTC(2026, 5, 22, 1, 5), end: Date.UTC(2026, 5, 22, 3, 10),
    title: 'Sunset at Lookout Mountain; west side, upper lot', location: 'Lookout Mountain (39.73235, -105.23912)',
    description: 'Meet at 7:59 pm\nBring: coat, blanket\\chairs\n' + 'https://bradcowdrey.com/golden-hour/#p=' + 'A'.repeat(120) });
  const lines = text.split('\r\n');
  assert.equal(lines[lines.length - 1], '', 'ends with CRLF');
  assert.ok(!text.replace(/\r\n/g, '').includes('\n'), 'only CRLF line endings');
  assert.deepEqual(lines.slice(0, 3), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bradley Cowdrey//Golden Hour//EN']);
  assert.ok(lines.includes('UID:p1@goldenhour'));
  assert.ok(lines.includes('DTSTAMP:20260620T120000Z'));
  assert.ok(lines.includes('DTSTART:20260622T010500Z'));
  assert.ok(lines.includes('DTEND:20260622T031000Z'));
  assert.ok(lines.includes('SUMMARY:Sunset at Lookout Mountain\\; west side\\, upper lot'));
  assert.ok(lines.includes('TRIGGER:-PT90M') && lines.includes('ACTION:DISPLAY'));
  assert.ok(lines.every((l) => new TextEncoder().encode(l).length <= 75), 'no line over 75 octets');
  const unfolded = text.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('DESCRIPTION:Meet at 7:59 pm\\nBring: coat\\, blanket\\\\chairs\\nhttps://'), 'backslashes first, then commas and newlines');
  assert.deepEqual(lines.slice(-4, -1), ['END:VALARM', 'END:VEVENT', 'END:VCALENDAR']);
});

test('normals and units', () => {
  const dates = [], max = [], min = [];
  for (let y = 1991; y <= 1993; y++) for (let d = 0; d < 365; d++) {
    const date = new Date(Date.UTC(y, 0, 1 + d)).toISOString().slice(0, 10);
    dates.push(date); max.push(20 + 10 * Math.sin((d - 100) / 365 * 2 * Math.PI)); min.push(10 + 10 * Math.sin((d - 100) / 365 * 2 * Math.PI));
  }
  const table = G.normals(dates, max, min);
  assert.equal(table.max.length, 366);
  near(G.eveningNormal(table, '2026-07-10'), 10 + 9.99 + 6.5, 0.2, 'evening normal in July');
  assert.equal(G.eveningNormal(null, '2026-07-10'), null);
  assert.deepEqual([G.dayOfYear('2026-01-01'), G.dayOfYear('2026-03-01'), G.dayOfYear('2026-12-31')], [0, 60, 365]);
  assert.equal(G.tempText(20, true), '68°F · 20°C');
  assert.equal(G.tempText(20, false), '20°C · 68°F');
  assert.equal(G.windText(8, true), '18 mph · 29 km/h');
  assert.equal(G.distanceText(3.9, true), '2.4 mi · 3.9 km');
  assert.equal(G.distanceText(40, false), '40 km · 25 mi');
  const p = G.destination(39.739, -104.99, 302, 100);
  near(G.distance(39.739, -104.99, p.lat, p.lon), 100000, 5, 'a point 100 km away');
  near(G.bearing(39.739, -104.99, p.lat, p.lon), 302, 0.01, 'on the bearing');
});

test('the sample forecast rates like any other', () => {
  const start = Date.UTC(2026, 5, 20, 0);
  const s = G.sampleForecast(start, 8 * 24);
  const times = G.eveningTimes(G.solarNoonGuess(2026, 6, 21, -104.99), 39.739, -104.99);
  const r = G.rate(G.inputsAt(s.p0, s.up, s.aq, times.sunset), { day: 0, normal: null });
  assert.ok(r.score >= 0 && r.score <= 5 && r.reason.length <= 90);
});
