/* Golden Hour: the interface. The rules live in core.js (GH); this file fetches, stores and draws.
   Release 1 of docs/SPEC.md: places, the star rating, "How was it?", times, the week, compare, a plan for one
   pinned spot, what to bring, offline, the share link and the calendar file. */
(function () {
  'use strict';
  const G = window.GH;
  const VERSION = '0.9.1';
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();

  // ---------- Settings (localStorage) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('gh.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('gh.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const region = (() => { try { return new Intl.Locale(navigator.language).maximize().region; } catch { return ''; } })();
  const settings = { imperialFirst: store.get('imperialFirst', G.prefersImperial(region)), compare: store.get('compare', false) };

  // ---------- IndexedDB (docs/SPEC.md 11.2), with an in-memory stand-in when the browser blocks it ----------
  const STORES = { places: 'id', evenings: ['placeId', 'date'], plans: 'id', ratings: ['placeId', 'date'], snapshots: ['placeId', 'date'], cache: 'url', spots: 'id' };
  const db = (() => {
    let handle = null, blocked = false;
    const mem = {};
    for (const s of Object.keys(STORES)) mem[s] = new Map();
    const keyOf = (s, v) => { const k = STORES[s]; return Array.isArray(k) ? k.map((f) => v[f]).join('|') : v[k]; };
    const open = () => new Promise((res) => {
      try {
        const rq = indexedDB.open('golden-hour', 2);
        rq.onupgradeneeded = () => { for (const [s, k] of Object.entries(STORES)) if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s, { keyPath: k }); };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = rq.onblocked = () => res(null);
      } catch { res(null); }
    });
    const ready = open().then((h) => { handle = h; blocked = !h; });
    const run = (s, mode, fn) => ready.then(() => {
      if (!handle) return fn(null);
      return new Promise((res) => {
        try {
          const tx = handle.transaction(s, mode), rq = fn(tx.objectStore(s));
          rq.onsuccess = () => res(rq.result); rq.onerror = () => res(undefined);
        } catch { res(undefined); }
      });
    });
    return {
      ready, isBlocked: () => blocked,
      get: (s, key) => run(s, 'readonly', (o) => (o ? o.get(key) : mem[s].get(Array.isArray(key) ? key.join('|') : key))),
      all: (s) => run(s, 'readonly', (o) => (o ? o.getAll() : Array.from(mem[s].values()))),
      put: (s, v) => run(s, 'readwrite', (o) => (o ? o.put(v) : void mem[s].set(keyOf(s, v), v))),
      del: (s, key) => run(s, 'readwrite', (o) => (o ? o.delete(key) : void mem[s].delete(Array.isArray(key) ? key.join('|') : key))),
    };
  })();

  // ---------- Time zones and dates ----------
  const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return !!tz; } catch { return false; } };
  const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
  const tzOr = (tz) => (validTz(tz) ? tz : deviceTz());
  const localDate = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tzOr(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const localHour = (ms, tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tzOr(tz), hour: '2-digit', hourCycle: 'h23' }).format(ms));
  const addDays = (date, n) => new Date(Date.UTC(...ymd(date)) + n * DAY).toISOString().slice(0, 10);
  function ymd(date) { const [y, m, d] = date.split('-').map(Number); return [y, m - 1, d]; }
  const timeText = (ms, tz) => new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZone: tzOr(tz), hour: 'numeric', minute: '2-digit' }).format(ms).replace(/ /g, ' ').toLowerCase();
  const dayName = (date, long) => new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZone: 'UTC', weekday: long ? 'long' : 'short' }).format(Date.UTC(...ymd(date)));
  const dateText = (date) => new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(Date.UTC(...ymd(date)));
  const weekdayOf = (date) => new Date(Date.UTC(...ymd(date))).getUTCDay();
  /** The first instant of a local date in a time zone. */
  function startOfDay(date, tz) {
    const guess = Date.UTC(...ymd(date));
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tzOr(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
    const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
    return guess - offset;
  }
  const ago = (ms) => { const m = Math.max(0, Math.round((now() - ms) / MIN)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  // ---------- Units ----------
  const two = (text) => { const [a, b] = text.split(' · '); return `${esc(a)} <span class="u2">· ${esc(b)}</span>`; };
  const temp = (c) => two(G.tempText(c, settings.imperialFirst));
  const wind = (mps) => two(G.windText(mps, settings.imperialFirst));
  const dist = (km) => two(G.distanceText(km, settings.imperialFirst));

  // ---------- State ----------
  const S = { places: [], current: null, dayBy: {}, view: null, plans: [], ratings: [], spots: [], results: null, notice: null, editing: false };
  const DATA = {};   // placeId → {fc, source: 'live' | 'cache' | 'sample', fetchedAt, error, ceiling, prev: {date → {score, at}}, snaps: {date → snap}}
  const SAMPLE = { id: 'sample', name: 'Denver', region: 'Colorado', lat: 39.7392, lon: -104.9903, tz: 'America/Denver', sample: true };
  const place = (id) => S.places.find((p) => p.id === (id || S.current)) || S.places[0];

  // ---------- The request budget (11.3): about 6 call-weights a place a refresh, 300 a day ----------
  const CEILING = 300;
  function budget(weight) {
    const today = new Date().toISOString().slice(0, 10), b = store.get('budget', { day: today, used: 0 });
    if (b.day !== today) { b.day = today; b.used = 0; }
    if (weight) { b.used += weight; store.set('budget', b); }
    return b.used;
  }

  /** A JSON response, from the app's cache when it's fresh enough, otherwise from the network; if the
      network fails, the cached copy whatever its age. → {body, fetchedAt, stale?, ceiling?} */
  async function getJSON(url, ttl, weight, counts) {
    const hit = await db.get('cache', url);
    if (hit && now() - hit.fetchedAt < ttl) return { body: hit.body, fetchedAt: hit.fetchedAt };
    if (counts !== false && budget(0) + weight > CEILING) {
      if (hit) return { body: hit.body, fetchedAt: hit.fetchedAt, stale: true, ceiling: true };
      const e = new Error('ceiling'); e.ceiling = true; throw e;
    }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const body = await r.json();
      if (counts !== false) budget(weight);
      const rec = { url, body, fetchedAt: now() };
      db.put('cache', rec);
      return rec;
    } catch (e) {
      if (hit) return { body: hit.body, fetchedAt: hit.fetchedAt, stale: true };
      throw e;
    }
  }

  const r2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const HOURLY_P0 = 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation,precipitation_probability,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,wind_direction_10m';
  const COMMON = '&forecast_days=8&past_days=1&timeformat=unixtime&timezone=GMT&wind_speed_unit=ms';
  const hourly = (h) => { const o = { time: h.time.map((t) => t * 1000) }; for (const k of Object.keys(h)) if (k !== 'time') o[k] = h[k]; return o; };

  /** The forecast for a point: the place itself, four points toward tonight's sunset, and air quality. */
  async function fetchForecast(lat, lon) {
    const today = new Date(now() - lon / 15 * HOUR);
    const t = G.eveningTimes(G.solarNoonGuess(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate(), lon), lat, lon);
    const az = t.azimuth == null ? 270 : t.azimuth;
    const pts = [50, 100, 200, 300].map((km) => G.destination(lat, lon, az, km));
    const f = 'https://api.open-meteo.com/v1/forecast';
    const p0Url = `${f}?latitude=${r2(lat)}&longitude=${r2(lon)}&hourly=${HOURLY_P0}${COMMON}`;
    const upUrl = `${f}?latitude=${pts.map((p) => r2(p.lat)).join(',')}&longitude=${pts.map((p) => r2(p.lon)).join(',')}&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high${COMMON}`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${r2(lat)}&longitude=${r2(lon)}&hourly=aerosol_optical_depth,pm2_5,us_aqi&forecast_days=7&timeformat=unixtime&timezone=GMT`;
    const [a, b] = await Promise.all([getJSON(p0Url, 30 * MIN, 1), getJSON(upUrl, 30 * MIN, 4)]);
    const c = await getJSON(aqUrl, HOUR, 1).catch(() => null);
    const upList = Array.isArray(b.body) ? b.body : [b.body];
    return { elevation: a.body.elevation, fc: { p0: hourly(a.body.hourly), up: upList.map((u) => hourly(u.hourly)), aq: c && c.body && c.body.hourly ? hourly(c.body.hourly) : null },
      fetchedAt: Math.min(a.fetchedAt, b.fetchedAt), stale: !!(a.stale || b.stale), ceiling: !!(a.ceiling || b.ceiling) };
  }

  /** The usual evening temperature here, from 1991 to 2020: fetched once per place, one place a minute. */
  let normalsAt = 0;
  async function fetchNormals(p) {
    if (p.sample || p.normals || now() - normalsAt < MIN) return;
    normalsAt = now();
    try {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${r2(p.lat)}&longitude=${r2(p.lon)}&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=GMT`;
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return;
      const d = (await r.json()).daily;
      p.normals = G.normals(d.time, d.temperature_2m_max, d.temperature_2m_min);
      await db.put('places', p);
      if (p.id === S.current) render();
    } catch { /* comfort uses fixed bounds until this works */ }
  }

  // ---------- Evenings ----------
  /** Ten evenings from today, in the place's own calendar; the first six rated when the forecast covers them. */
  function evenings(p, opts) {
    const d = DATA[p.id], fc = d && d.fc, today = localDate(now(), p.tz), out = [];
    for (let i = 0; i < 10; i++) {
      const date = addDays(today, i), [y, m, dd] = ymd(date);
      const times = G.eveningTimes(G.solarNoonGuess(y, m + 1, dd, p.lon), p.lat, p.lon);
      let rating = null, x = null;
      if (i <= 5 && fc && times.state !== 'none') {
        x = G.inputsAt(fc.p0, fc.up, fc.aq, times.sunset);
        if (x) rating = G.rate(x, { day: i, normal: G.eveningNormal(p.normals, date), imperialFirst: settings.imperialFirst, spotType: opts && opts.spotType });
      }
      out.push({ date, day: i, times, rating, x });
    }
    return out;
  }
  /** When an evening is over: last light, or local midnight when twilight lasts all night. */
  const endOf = (ev, p) => (ev.times.state === 'ok' ? ev.times.lastLight : startOfDay(addDays(ev.date, 1), p.tz));
  /** Which evening "Tonight" shows: today's until it is over, then tomorrow's. */
  function focusDay(p, evs) { return now() > endOf(evs[0], p) ? 1 : 0; }
  /** The best evening: the highest-scoring Go among tonight and the next two; an outlook evening only when
      it is still a Go at the bottom of its range. */
  function bestOf(evs) {
    let best = null;
    for (const e of evs) if (e.rating && e.rating.tier !== 'outlook' && e.rating.verdict === 'go' && now() < e.times.sunset && (!best || e.rating.score > best.rating.score)) best = e;
    if (best) return { ev: best, label: 'Best evening' };
    for (const e of evs) if (e.rating && e.rating.tier === 'outlook' && e.rating.lo >= 3.5 && (!best || e.rating.score > best.rating.score)) best = e;
    return best ? { ev: best, label: 'Likely best' } : null;
  }

  async function load(p, force) {
    const d = DATA[p.id] || (DATA[p.id] = { prev: {}, snaps: {} });
    if (p.sample) {
      const start = startOfDay(addDays(localDate(now(), p.tz), -1), p.tz);
      Object.assign(d, { fc: G.sampleForecast(start, 9 * 24), source: 'sample', fetchedAt: now(), error: null, spots: finishSample(p) });
      return;
    }
    if (d.loading) return d.loading;
    if (!force && d.fc && now() - d.fetchedAt < 30 * MIN) return;
    d.loading = (async () => {
      try {
        const r = await fetchForecast(p.lat, p.lon);
        const first = d.fetchedAt !== r.fetchedAt;
        Object.assign(d, { fc: r.fc, source: r.stale ? 'cache' : 'live', fetchedAt: r.fetchedAt, error: null, ceiling: r.ceiling, elevation: r.elevation });
        if (first) await remember(p);
      } catch (e) {
        d.error = e && e.ceiling ? 'ceiling' : 'network';
      } finally { d.loading = null; }
    })();
    await d.loading;
    fetchNormals(p);
    if (d.fc && !d.spots && !d.spotsLoading) loadSpots(p).then(() => update(p));
  }

  /** Keeps what each evening scored: the forecast log "How was it?" compares against, the first reading of
      the day ("since this morning") and the reading before this one ("since you last looked"). */
  async function remember(p) {
    const d = DATA[p.id], today = localDate(now(), p.tz);
    for (const ev of evenings(p)) {
      if (!ev.rating) continue;
      const key = [p.id, ev.date];
      const old = await db.get('evenings', key);
      if (old && old.fetchedAt !== d.fetchedAt) d.prev[ev.date] = { score: old.score, at: old.fetchedAt };
      const rec = { placeId: p.id, date: ev.date, sunsetUtc: ev.times.sunset, azimuth: ev.times.azimuth, inputs: ev.x, parts: ev.rating.parts, gate: ev.rating.gate,
        score: ev.rating.score, range: ev.rating.range, tier: ev.rating.tier, verdict: ev.rating.verdict, reason: ev.rating.reason,
        warnings: ev.rating.warnings.map((w) => w.id), fetchedAt: d.fetchedAt };
      if (!(old && now() > ev.times.sunset)) {
        db.put('evenings', rec);
        if (d.logged && ev.day === 0) d.logged[ev.date] = rec;
      }
      let snap = await db.get('snapshots', key);
      if ((!snap || snap.takenOn !== today) && localHour(d.fetchedAt, p.tz) >= 4) {
        snap = { placeId: p.id, date: ev.date, takenOn: today, fetchedAt: d.fetchedAt, score: ev.rating.score, parts: ev.rating.parts };
        db.put('snapshots', snap);
      }
      if (snap) d.snaps[ev.date] = snap;
    }
  }

  // ---------- Drawing: small pieces ----------
  const use = (name) => `<svg viewBox="0 0 32 32" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const ICON = { go: use('sunset'), maybe: use('cloud-sun'), skip: use('cloud'), rain: use('cloud-rain'), clear: use('sun-pale'),
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 17.500v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' };
  /** The picture for an evening: a sunset for Go, sun through cloud for Maybe, and for Skip the reason it's a skip. */
  function icon(r) {
    if (r.verdict === 'go') return ICON.go;
    if (r.cap === 'rain' || r.cap === 'snow' || r.cap === 'thunder') return ICON.rain;
    if (r.verdict === 'maybe') return ICON.maybe;
    return !r.cap && r.detail.canvas < 5 ? ICON.clear : ICON.skip;
  }
  const STAR = 'M15 2.500l3.700 7.900 8.600 1.100-6.300 6 1.600 8.500L15 21.800 7.400 26l1.600-8.500-6.300-6 8.600-1.100z';
  const starRow = () => `<svg viewBox="0 0 150 30" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<path transform="translate(${i * 30} 0)" d="${STAR}"/>`).join('')}</svg>`;
  /** Five stars filled to `value`. Hidden from screen readers: the sentence beside them says it. */
  const stars = (value, outlook, small) => `<span class="stars${outlook ? ' outlook' : ''}${small ? ' sm' : ''}" aria-hidden="true"><span class="base">${starRow()}</span><span class="fill" data-w="${Math.max(0, Math.min(100, value / 5 * 100)).toFixed(1)}">${starRow()}</span></span>`;
  const verdictHtml = (r, withQ) => `<span class="verdict ${r.verdict}">${icon(r)}<span>${r.verdictWord}${withQ && r.qualifier ? `<span class="q">, ${esc(r.qualifier)}</span>` : ''}</span></span>`;
  const scoreText = (r) => (r.tier === 'outlook' ? r.shown.toFixed(1) : r.score.toFixed(1));
  const rangeText = (r) => `likely ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}`;
  const spoken = (label, r) => `${label}. ${scoreText(r)} out of 5 stars, ${rangeText(r)}. ${r.colourClass} colour, ${r.colour} out of 100. ${r.verdictWord}${r.qualifier ? ', ' + r.qualifier : ''}. ${r.reason}`;
  /** The colour class: the name for how rich the colour in the clouds should be, with its score out of 100. */
  const colourHtml = (r, small) => `<span class="colour${small ? ' sm' : ''} c-${r.colourClass.toLowerCase()}"><span class="k">Colour</span><b>${r.colourClass}</b><span class="n num">${r.colour}</span></span>`;
  function evLabel(ev, p, evs) {
    const f = focusDay(p, evs);
    if (ev.day === 0) return 'Tonight';
    if (ev.day === 1) return f === 1 ? 'Tomorrow evening' : 'Tomorrow';
    return dayName(ev.date, true);
  }

  // ---------- The sky behind each place: the sunset as it might look, more vivid the better the evening ----------
  function mix(a, b, k) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const x = p(a), y = p(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, k))).toString(16).padStart(2, '0')).join('');
  }
  /** Relative luminance of a colour, 0 to 1. */
  function lum(hex) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  /** A colour no brighter than `max`, so white text over it stays readable. */
  function dim(hex, max) { let h = hex; for (let i = 0; i < 12 && lum(h) > max; i++) h = mix(h, '#120E18', 0.12); return h; }
  function rng(seed) {
    let h = 1779033703;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  const SKY_DULL = ['#242834', '#30343F', '#444450', '#58545C', '#6C6560'];     // a flat, grey evening
  const SKY_VIVID = ['#12164A', '#34206E', '#8A2877', '#D8472E', '#FFB13C'];    // deep blue through magenta to gold
  const SKY_CLEAR = ['#0E1B48', '#1A2B62', '#34447F', '#A85F4F', '#F0B46C'];    // cloudless: a clean band of colour, low
  const SKY_STOPS = [0, 0.46, 0.72, 0.9, 1];
  /** The five colours of an evening's sky, top to horizon. The colour score sets how vivid they are. */
  function skyStops(r) {
    if (!r) return SKY_DULL.map((c, i) => mix(c, SKY_VIVID[i], 0.3));
    const grey = !!r.cap, v = grey ? 0 : Math.min(1, r.parts.c * 1.15);
    let stops = !grey && r.detail.canvas < 5 ? SKY_CLEAR.slice() : SKY_DULL.map((c, i) => mix(c, SKY_VIVID[i], v));
    if (r.parts.a < 0.9) stops = stops.map((c) => mix(c, '#7A726C', (1 - r.parts.a) * 0.45));   // haze washes it toward grey
    return stops;
  }
  /** [top, middle, horizon]: for swatches and the small scene in the Colour tile. */
  function skyFor(r) { const s = skyStops(r); return [s[0], s[2], s[4]]; }

  /** The scene, as two pictures: the sky with its glow and sun, and the clouds that drift across it.
      Everything above the lowest fifth is kept dark enough for white text; the brightest colour sits at the horizon. */
  function skyScene(r, x, seed) {
    const stops = skyStops(r), rand = rng(seed || 'sky'), id = uid();
    const grey = !!(r && r.cap), v = !r ? 0.3 : grey ? 0 : Math.min(1, r.parts.c * 1.15);
    const s = r ? r.parts.s : 0.6, a = r ? r.parts.a : 1, lit = r ? r.detail.lit : 0.6, canvas = r ? r.detail.canvas : 0, low = x ? (x.low || 0) : 0;
    const glow = grey ? 0 : (0.25 + 0.6 * v) * (0.35 + 0.65 * s);
    const sun = !grey && s > 0.15 ? `<div class="sun" data-o="${(s * (0.55 + 0.45 * v)).toFixed(2)}"></div>` : '';
    const base = `<svg viewBox="0 0 400 800" preserveAspectRatio="none" aria-hidden="true"><defs>
      <linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1">${stops.map((c, i) => `<stop offset="${SKY_STOPS[i]}" stop-color="${c}"/>`).join('')}</linearGradient>
      <radialGradient id="${id}b" cx="0.5" cy="0.935" r="0.6"><stop offset="0" stop-color="${mix(stops[4], '#FFE9B8', 0.5)}" stop-opacity="${glow.toFixed(2)}"/><stop offset="0.45" stop-color="${stops[4]}" stop-opacity="${(glow * 0.45).toFixed(2)}"/><stop offset="1" stop-color="${stops[3]}" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05040C" stop-opacity=".34"/><stop offset=".7" stop-color="#05040C" stop-opacity="0"/></linearGradient></defs>
      <rect width="400" height="800" fill="url(#${id}a)"/><rect width="400" height="800" fill="url(#${id}b)"/><rect width="400" height="800" fill="url(#${id}c)"/></svg>${sun}`;

    // Clouds: long, soft bands, dusky on top and lit from below. Higher ones are deeper in colour; the lowest glow.
    const n = canvas < 5 ? 0 : canvas < 30 ? 5 : canvas <= 70 ? 9 : 13;
    let bands = '';
    for (let i = 0; i < n; i++) {
      const y = 60 + (i + rand() * 0.8) * (620 / n), f = y / 800, cx = rand() * 400, rx = 70 + rand() * 120, ry = 7 + rand() * 12;
      const body = dim(mix(mix('#3A3B50', '#4E2A6A', v), mix('#6A6066', '#A8345E', v), f), f < 0.82 ? 0.075 : 0.3);
      const under = dim(mix(body, mix(mix('#6A6878', '#D04E86', v), mix('#A0907F', '#FF9A42', v), f), 0.35 + 0.65 * lit), f < 0.82 ? 0.115 : 0.6);
      // A band is a few overlapping wisps, each lit along its underside.
      for (let k = 0; k < 3; k++) {
        const ox = (k - 1) * rx * (0.5 + rand() * 0.3), oy = (rand() - 0.5) * ry * 1.4, w = rx * (0.55 + rand() * 0.4), h = ry * (0.6 + rand() * 0.6);
        bands += `<ellipse cx="${(cx + ox).toFixed(0)}" cy="${(y + oy).toFixed(0)}" rx="${w.toFixed(0)}" ry="${h.toFixed(0)}" fill="${body}" opacity=".72"/><ellipse cx="${(cx + ox + 6).toFixed(0)}" cy="${(y + oy + h * 0.6).toFixed(0)}" rx="${(w * 0.88).toFixed(0)}" ry="${(h * 0.5).toFixed(0)}" fill="${under}" opacity=".9"/>`;
      }
    }
    const bank = low >= 30 ? `<ellipse cx="200" cy="812" rx="340" ry="${(36 + low * 0.9).toFixed(0)}" fill="${mix('#2A2A33', '#3D2A45', v)}" opacity="${Math.min(0.95, 0.5 + low / 150).toFixed(2)}"/>` : '';
    const haze = a < 0.9 ? `<rect width="400" height="800" fill="#A69A90" opacity="${((1 - a) * 0.3).toFixed(2)}"/>` : '';
    let rain = '';
    if (r && (r.cap === 'rain' || r.cap === 'snow' || r.cap === 'thunder')) {
      for (let i = 0; i < 46; i++) { const rx = rand() * 420, ry = rand() * 800, len = r.cap === 'snow' ? 2 : 16 + rand() * 12; rain += `<path d="M${rx.toFixed(0)} ${ry.toFixed(0)}l${r.cap === 'snow' ? 0 : -5} ${len.toFixed(0)}" stroke="#DCE6F5" stroke-width="${r.cap === 'snow' ? 3 : 1.2}" stroke-linecap="round" opacity="${(0.1 + rand() * 0.16).toFixed(2)}"/>`; }
    }
    const fog = r && r.cap === 'fog' ? '<rect width="400" height="800" fill="#8E8E96" opacity=".3"/>' : '';
    const clouds = `<svg class="clouds" viewBox="0 0 400 800" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter><filter id="${id}g" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="22"/></filter></defs>
      <g filter="url(#${id}f)">${bands}</g><g filter="url(#${id}g)">${bank}</g>${haze}${fog}${rain}</svg>`;
    return base + clouds;
  }
  /** Shows an evening's sky behind the screen, fading from the last one. */
  let skyKey = null;
  function setSky(r, x, seed) {
    const [t, m, b] = skyFor(r), st = document.documentElement.style;
    st.setProperty('--sky-top', t); st.setProperty('--sky-mid', m); st.setProperty('--sky-bottom', b);
    const key = (r ? [r.colour, r.cap, Math.round(r.parts.s * 10), Math.round(r.parts.a * 10), Math.round(r.detail.canvas / 5), Math.round(r.detail.lit * 10), x ? Math.round((x.low || 0) / 10) : ''].join('|') : 'none') + '|' + (seed || '');
    if (key === skyKey) return;
    skyKey = key;
    const sky = $('.sky'), layer = document.createElement('div');
    layer.className = 'layer';
    layer.innerHTML = skyScene(r, x, seed);
    for (const el of $$('[data-o]', layer)) el.style.opacity = el.dataset.o;
    sky.appendChild(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
    setTimeout(() => { while (sky.children.length > 1 && sky.firstChild !== layer) sky.removeChild(sky.firstChild); }, 900);
  }
  /** The evening a place's page is showing, and its sky. */
  function shownEvening(p) { const evs = evenings(p), f = focusDay(p, evs); return evs[S.dayBy[p.id] == null ? f : S.dayBy[p.id]] || evs[f]; }
  function skyOf(p) { const ev = shownEvening(p); setSky(ev.rating, ev.x, p.id + ev.date); if (ev.rating) prepareCard(p); }

  function toast(text, action, onAction) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    t.hidden = false;
    clearTimeout(toast.timer);
    if (action) $('button', t).onclick = () => { t.hidden = true; onAction(); };
    else toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- Drawing: the frame ----------
  // After Two Degrees on the iPhone (and Apple's Weather): one full page per place, swiped between, each on
  // its own evening's sky, with a bottom bar of plans, page dots and the list of places.
  const scrolls = {};   // placeId → how far down its page is scrolled
  const screen = (html) => `<div class="screen"><div class="inner">${html}</div></div>`;
  function dyn(root) {
    for (const el of $$('[data-w]', root)) el.style.width = el.dataset.w + '%';
    for (const el of $$('[data-l]', root)) el.style.left = el.dataset.l + '%';
    for (const el of $$('[data-h]', root)) el.style.height = el.dataset.h + '%';
    for (const el of $$('[data-sky]', root)) { const [t, m, b] = el.dataset.sky.split(','); el.style.background = `linear-gradient(${t}, ${m} 60%, ${b})`; }
  }
  /** The rating of the evening a place's page is showing. */
  function shownRating(p) {
    const evs = evenings(p), f = focusDay(p, evs), ev = evs[S.dayBy[p.id] == null ? f : S.dayBy[p.id]] || evs[f];
    return ev.rating;
  }
  /** Draws the screen. Replacing a focused field can fire its change event mid-draw; that redraw waits its turn. */
  let drawing = false, drawAgain = false;
  function render() {
    if (drawing) { drawAgain = true; return; }
    drawing = true;
    try { draw(); } finally { drawing = false; }
    if (drawAgain) { drawAgain = false; render(); }
  }
  function draw() {
    const v = $('#view'), view = S.view;
    for (const pg of $$('.page', v)) scrolls[pg.dataset.id] = pg.scrollTop;
    if (view && view.type === 'shared') v.innerHTML = screen(sharedView());
    else if (view && view.type === 'plan') v.innerHTML = screen(planView());
    else if (view && view.type === 'log') v.innerHTML = screen(logView());
    else if (view && view.type === 'plans') v.innerHTML = screen(plansView());
    else if (view && view.type === 'list') v.innerHTML = screen(listView());
    else if (view && view.type === 'spots') v.innerHTML = screen(spotsView());
    else if (view && view.type === 'spot') v.innerHTML = screen(spotView());
    else if (view && view.type === 'addspot') v.innerHTML = screen(addSpotView());
    else {
      v.innerHTML = `<div class="pager" id="pager">${S.places.map((p) => `<section class="page" data-id="${esc(p.id)}" aria-label="${esc(p.name)}"><div class="inner">${pageHtml(p)}</div></section>`).join('')}</div>`;
      const pager = $('#pager');
      for (const pg of $$('.page', pager)) pg.scrollTop = scrolls[pg.dataset.id] || 0;
      pager.scrollLeft = Math.max(0, S.places.findIndex((p) => p.id === S.current)) * pager.clientWidth;
      pager.addEventListener('scroll', onSwipe, { passive: true });
      const p = place();
      if (p) skyOf(p);
    }
    drawBar(); drawBanner(); dyn(v);
    if (view && view.type === 'list') bindSearch();
    if (view && (view.type === 'plan' || view.type === 'shared' || view.type === 'spot' || view.type === 'addspot')) mountMap();
  }
  /** Redraws one place where it stands, so a forecast arriving never disturbs a swipe or what is being typed. */
  function update(p) {
    if (S.view && S.view.type === 'list') {
      const rows = $('#listRows');
      if (rows) { rows.innerHTML = listRows(); const c = $('#compare'); if (c) c.innerHTML = compareHtml(); dyn($('#view')); }
      return;
    }
    if (S.view && S.view.type === 'spots' && S.view.placeId === p.id) return render();
    if (S.view) return;
    const pg = $$('.page').find((x) => x.dataset.id === p.id);
    if (!pg) return render();
    const top = pg.scrollTop;
    $('.inner', pg).innerHTML = pageHtml(p);
    dyn(pg); pg.scrollTop = top;
    if (p.id === S.current) { skyOf(p); drawBanner(); }
  }
  /** A swipe has settled on (or is passing) another place: it becomes the current one. */
  let swipeFrame = 0;
  function onSwipe(e) {
    const pager = e.currentTarget;
    if (swipeFrame) return;
    swipeFrame = requestAnimationFrame(() => {
      swipeFrame = 0;
      const p = S.places[Math.round(pager.scrollLeft / (pager.clientWidth || 1))];
      if (!p || p.id === S.current || S.view) return;
      S.current = p.id; store.set('current', p.id);
      skyOf(p); drawBar(); drawBanner();
      loadLogged(p).then(() => load(p)).then(() => update(p));
    });
  }
  /** Opens a place's page. From the pager it slides there; from another screen it opens on it. */
  function goTo(id, smooth) {
    const pager = !S.view && $('#pager'), i = S.places.findIndex((p) => p.id === id);
    if (i < 0) return;
    if (pager && smooth) return pager.scrollTo({ left: i * pager.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    S.view = null; S.current = id; store.set('current', id);
    render();
    const p = place();
    loadLogged(p).then(() => load(p)).then(() => update(p));
  }

  const BAR = {
    plans: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.500-5.400-6.500-10.500a6.500 6.500 0 0 1 13 0C18.500 15.600 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10.500" r="2.300" fill="currentColor"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h12M8 12h12M8 17h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4" cy="7" r="1.200" fill="currentColor"/><circle cx="4" cy="12" r="1.200" fill="currentColor"/><circle cx="4" cy="17" r="1.200" fill="currentColor"/></svg>',
    here: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M11 1 1 5.200l4.300 1.500L6.800 11z" fill="currentColor"/></svg>',
  };
  /** Plans · page dots · the list of places, on a thin frosted bar. */
  function drawBar() {
    // Only the page showing can be reached by keyboard or read aloud.
    for (const pg of $$('.page')) { const on = pg.dataset.id === S.current; pg.toggleAttribute('inert', !on); if (on) pg.setAttribute('aria-current', 'true'); else pg.removeAttribute('aria-current'); }
    const bar = $('#bar');
    bar.hidden = !!S.view;
    if (bar.hidden) return;
    const i = S.places.findIndex((p) => p.id === S.current);
    const dots = S.places.length > 7 ? `<span class="count num">${i + 1} of ${S.places.length}</span>`
      : S.places.map((p) => `<button type="button" class="dot" data-act="goto" data-id="${esc(p.id)}" aria-label="${esc(p.name)}"${p.id === S.current ? ' aria-current="true"' : ''}>${p.here ? BAR.here : '<i></i>'}</button>`).join('');
    bar.innerHTML = `<button type="button" class="barbtn" data-act="open-plans">${BAR.plans}<span>Plans</span></button>
      <div class="dots">${dots}</div>
      <button type="button" class="barbtn" data-act="open-list">${BAR.list}<span>Locations</span></button>`;
  }

  function drawBanner() {
    const el = $('#banner'), p = place(), d = p && DATA[p.id];
    let html = '';
    if (S.notice) html = `<span>${esc(S.notice)}</span>`;
    else if (db.isBlocked()) html = '<span>Plans can’t be saved in this browser mode.</span>';
    else if (d && d.ceiling) html = '<span>Showing saved forecasts. Refreshing again tomorrow.</span>';
    else if (d && d.source === 'cache' && !navigator.onLine) html = `<span>Offline. Forecast updated ${esc(ago(d.fetchedAt))}.</span>`;
    el.hidden = !html || (S.view && S.view.type === 'shared');
    el.innerHTML = html;
  }

  const unitsSeg = () => `<div class="seg" role="group" aria-label="Which units are listed first"><button type="button" data-act="units" data-v="imperial" aria-pressed="${settings.imperialFirst}">°F · mi</button><button type="button" data-act="units" data-v="metric" aria-pressed="${!settings.imperialFirst}">°C · km</button></div>`;
  function footHtml() {
    return `<footer class="foot card"><p>Golden Hour has no accounts and collects nothing. To get forecasts and places, your device sends coordinates to Open-Meteo and the map tile host. Ratings are a forecast, not a promise: the first two days are the most reliable.</p>
      <p>Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0), air quality from CAMS. Maps: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Places from <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0). Sun and moon after SunCalc.</p>
      <p><button type="button" class="btn quiet" data-act="log">My sunset log</button> · <a href="https://github.com/bradleycowdrey/golden-hour" target="_blank" rel="noopener">Source</a> · <a href="https://bradcowdrey.com/legal" target="_blank" rel="noopener">Terms and privacy</a> · Free and open source, by <a href="https://bradcowdrey.com" target="_blank" rel="noopener">Bradley Cowdrey</a> · ${esc(VERSION)}</p></footer>`;
  }

  // ---------- The list of places: each with tonight's score, search to add, and compare ----------
  function listRows() {
    return S.places.map((p) => {
      const evs = evenings(p), f = focusDay(p, evs), ev = evs[f], r = ev.rating, d = DATA[p.id] || {};
      const when = ev.times.sunset == null ? 'No sunset on this date' : `${f === 1 ? 'Tomorrow' : 'Tonight'} · sunset ${timeText(ev.times.sunset, p.tz)}`;
      const right = r ? `<span class="rt" aria-hidden="true"><span class="big num">${scoreText(r)}</span>${colourHtml(r, true)}<span class="v ${r.verdict}">${icon(r)}${r.verdictWord}</span></span>`
        : `<span class="rt muted small">${d.error ? 'No forecast' : ev.times.state === 'none' ? '' : '…'}</span>`;
      return `<div class="lrow-wrap"><button type="button" class="lrow card" data-act="goto" data-id="${esc(p.id)}"${r ? ` aria-label="${esc(p.name)}. ${esc(spoken(f === 1 ? 'Tomorrow' : 'Tonight', r))}"` : ''}>
        <span class="swatch" data-sky="${skyFor(r).join(',')}" aria-hidden="true"></span>
        <span class="l"><span class="n">${esc(p.name)}${p.sample ? ' <span class="tag">Sample</span>' : ''}${p.here ? ' <span class="tag">Here</span>' : ''}</span><span class="r">${esc(when)}</span>${r ? `<span class="why">${esc(r.reason)}</span>` : ''}</span>${right}</button>
        ${S.editing && S.places.length > 1 ? `<button type="button" class="chip-x" data-act="remove" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}</div>`;
    }).join('');
  }
  function compareHtml() {
    const real = S.places.filter((x) => !x.sample).slice(0, 5);
    if (!settings.compare || real.length < 2) return '';
    const cols = evenings(real[0]).slice(0, 6);
    const head = `<tr><th class="p">Place</th>${cols.map((e) => `<th>${esc(e.day === 0 ? 'Today' : dayName(e.date))}</th>`).join('')}</tr>`;
    const rows = real.map((q) => `<tr><th class="p" scope="row">${esc(q.name)}</th>${evenings(q).slice(0, 6).map((e) => (e.rating
      ? `<td><button type="button" data-act="cell" data-id="${esc(q.id)}" data-day="${e.day}" aria-label="${esc(q.name)}, ${esc(spoken(e.day === 0 ? 'Today' : dayName(e.date, true), e.rating))}"><span>${scoreText(e.rating)}</span><span class="v ${e.rating.verdict}">${icon(e.rating)}</span></button></td>`
      : `<td><span class="muted small">${DATA[q.id] && DATA[q.id].error ? '!' : '–'}</span></td>`)).join('')}</tr>`).join('');
    return `<div class="grid-scroll"><table class="cmp">${head}${rows}</table></div><p class="small muted" data-gap>Stars out of 5 for each evening. Tap a cell to open that place and evening.</p>`;
  }
  function listView() {
    const real = S.places.filter((x) => !x.sample);
    return `<div class="row top"><h1>Locations</h1><span class="sp"></span>${unitsSeg()}<button type="button" class="btn white" data-act="close-view">Done</button></div>
      <section class="search card"><div class="box"><input id="q" type="search" placeholder="Search for a place to add" autocomplete="off" aria-label="Search for a place to add"></div>
        <div class="results" id="results" aria-live="polite"></div>
        <div class="row" data-gap><button type="button" class="btn" data-act="locate">Use my location</button><span class="sp"></span>${S.places.length > 1 ? `<button type="button" class="btn quiet" data-act="edit">${S.editing ? 'Done editing' : 'Edit'}</button>` : ''}</div></section>
      <div id="listRows" class="lrows">${listRows()}</div>
      ${real.length > 1 ? `<section class="card"><p class="eyebrow">Side by side<span class="sp"></span><button type="button" class="tog" data-act="compare" aria-pressed="${settings.compare}"><i></i>Compare places</button></p><div id="compare">${compareHtml()}</div></section>` : ''}
      <section class="card sharecard"><div class="row"><span><b>Share Golden Hour</b><br><span class="small muted">Free, no account. Send it to someone who loves a sunset.</span></span><span class="sp"></span><button type="button" class="btn white" data-act="share-app">${SP.share}Share</button></div></section>
      ${footHtml()}`;
  }
  function bindSearch() { const q = $('#q'); if (q) { q.addEventListener('input', onSearchInput); if (S.focusSearch) { S.focusSearch = false; q.focus(); } } drawResults(); }
  function drawResults() {
    const list = $('#results');
    if (!list) return;
    if (S.results === null) list.innerHTML = '';
    else if (typeof S.results === 'string') list.innerHTML = `<p class="small muted">${esc(S.results)}</p>`;
    else list.innerHTML = S.results.map((r, i) => `<button type="button" class="result" data-act="add" data-i="${i}"><span><span class="n">${esc(r.name)}</span><br><span class="r">${esc(r.region)}</span></span><span class="sp"></span><span aria-hidden="true">+</span></button>`).join('');
  }

  // ---------- Tonight ----------
  let uidSeq = 0;
  const uid = () => 'g' + (++uidSeq);
  /** The sun against the horizon at one moment of the evening: `y` is its centre, 12 on the horizon. */
  const sunGlyph = (name) => use(name);
  /** The evening, as Two Degrees shows the next 24 hours: one line about it, then a column for each moment. */
  function eveningCard(ev, p) {
    const t = ev.times, r = ev.rating, f = (ms) => (ms == null ? '–' : esc(timeText(ms, p.tz))), all = t.state === 'twilight';
    const col = (label, time, glyph, cls) => `<div class="hour${cls || ''}"><span class="h">${label}</span><span class="ic">${glyph}</span><span class="f num">${time}</span></div>`;
    const line = r ? esc(r.reason) : all ? 'Twilight lasts all night at this time of year.' : 'The best colour often comes after the sun is down.';
    return `<section class="card"><p class="eyebrow">${TI.clock}<span>The evening</span><span class="sp"></span><span class="aside">Sets to the ${esc(compass(t.azimuth))}</span></p>
      <p class="summary">${line}</p>${r ? deltaLine(p, ev) : ''}<hr class="rule">
      <div class="times">${col('Golden', f(t.goldenStart), sunGlyph('sun'))}${col('Best light', f(t.bestStart), sunGlyph('sun-low'))}${col('Sunset', f(t.sunset), sunGlyph('sunset-down'), ' sun')}${col('Afterglow', all ? 'All night' : f(t.afterglowEnd), sunGlyph('afterglow'))}${col('Last light', all ? '–' : f(t.lastLight), sunGlyph('moon-stars'))}</div>
      <p class="small muted" data-gap>${all ? 'It never gets fully dark.' : 'Stay through the afterglow: the best colour often comes after the sun is down.'}</p></section>`;
  }

  // ---------- The tiles: every input to the score, each with its own graphic, as in Two Degrees ----------
  const TI = {
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.500V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.500" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    colour: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17h18M6 17a6 6 0 0 1 12 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 4v3M4.500 9.500l2 2M19.500 9.500l-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19a5 5 0 0 1-.600-9.960A6 6 0 0 1 18 10.500 4.300 4.300 0 0 1 17.500 19z" fill="currentColor"/></svg>',
    west: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5M10 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    air: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.500-6.500 10-6.500S22 12 22 12s-3.500 6.500-10 6.500S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    haze: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M2.500 12h19M5 16h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h10a3 3 0 1 0-3-3M3 15h14a3 3 0 1 1-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    temp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a2 2 0 0 1 4 0v9.500a4.500 4.500 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17.500" r="2" fill="currentColor"/></svg>',
    rain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.500 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z" fill="currentColor"/></svg>',
    damp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.500 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18M6.500 18a5.500 5.500 0 0 1 11 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 6v3.500M9.500 7.500 12 10l2.500-2.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z" fill="currentColor"/></svg>',
    moonrise: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.500 15.500A5 5 0 0 1 10 9a5 5 0 1 0 6.500 6.500z" fill="currentColor"/><path d="M18.500 4v5M16.300 6.200 18.500 4l2.200 2.200" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    moonset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.500 15.500A5 5 0 0 1 10 9a5 5 0 1 0 6.500 6.500z" fill="currentColor"/><path d="M18.500 4v5M16.300 6.800 18.500 9l2.200-2.200" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const pointOf = (deg) => POINTS[Math.round(G.normalize(deg) / 22.5) % 16];
  /** The sky as forecast, in miniature: the evening's sky, the sun at the horizon, and cloud bands coloured
      as richly as the colour score says. */
  function sceneSvg(r, x) {
    const [top, mid, bottom] = skyFor(r), id = uid(), d = r.detail, c = r.parts.c;
    const n = d.canvas < 5 ? 0 : d.canvas < 30 ? 2 : d.canvas <= 70 ? 4 : 6;
    const tint = ['#FF9A5A', '#FF6F7D', '#FFC56B', '#FF8A6A', '#F9A8A0', '#FFB35A'];
    const spots = [[34, 18, 96], [176, 12, 112], [92, 34, 124], [212, 36, 88], [10, 46, 82], [138, 52, 104]];
    const bands = spots.slice(0, n).map(([bx, by, bw], i) => `<rect x="${bx}" y="${by}" width="${bw}" height="7" rx="3.500" fill="${mix('#8E8A8C', tint[i], Math.min(1, c * 1.1))}" opacity="${(0.5 + 0.45 * c).toFixed(2)}"/>`).join('');
    const low = (x.low || 0) >= 25 ? `<rect x="0" y="${(72 - (x.low / 100) * 26).toFixed(0)}" width="320" height="30" fill="#4A4648" opacity=".88"/>` : '';
    return `<svg class="scene" viewBox="0 0 320 72" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".6" stop-color="${mid}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
      <rect width="320" height="72" fill="url(#${id})"/><circle cx="160" cy="70" r="20" fill="#FFE1AE" opacity="${(0.25 + 0.75 * r.parts.s).toFixed(2)}"/>${bands}${low}</svg>`;
  }
  /** Wind: a compass, the arrow pointing where the wind is blowing. */
  function windSvg(from) {
    const to = G.normalize(from + 180);
    const ticks = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line x1="36" y1="4" x2="36" y2="${a % 90 ? 7 : 8}" transform="rotate(${a} 36 36)" stroke="rgba(255,255,255,.5)" stroke-width="1.200" stroke-linecap="round"/>`).join('');
    return `<svg class="compass" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="33" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.200"/>${ticks}
      <g transform="rotate(${to.toFixed(0)} 36 36)"><path d="M36 13l5 9h-3.800v24a2.700 2.700 0 1 1-2.400 0V22H31z" fill="var(--acc)"/></g></svg>`;
  }
  /** The sun's path over the day, the horizon, and the moment it sets. */
  const sunPathSvg = () => `<div class="sunpath" aria-hidden="true"><svg viewBox="0 0 100 34" preserveAspectRatio="none"><path d="M0 22H100" stroke="rgba(255,255,255,.3)" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/><path d="M0 31C22 31 30 5 50 5S78 31 100 31" stroke="var(--acc)" stroke-width="1.600" vector-effect="non-scaling-stroke" fill="none" opacity=".85"/></svg><u></u></div>`;
  /** The moon as it is lit: phase 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  function moonSvg(phase, size) {
    const r = 15, k = Math.cos(phase * 2 * Math.PI), waxing = phase < 0.5, rx = Math.abs(k) * r, id = uid();
    // The lit part: half a disc on the sunward side, plus or minus half an ellipse at the terminator.
    const lit = phase < 0.02 || phase > 0.98 ? '' : `M18 3 A${r} ${r} 0 0 ${waxing ? 1 : 0} 18 33 A${rx.toFixed(2)} ${r} 0 0 ${(k > 0) === waxing ? 0 : 1} 18 3z`;
    return `<svg class="moon${size ? ' ' + size : ''}" viewBox="0 0 36 36" aria-hidden="true"><defs><radialGradient id="${id}" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#FFFBEE"/><stop offset=".7" stop-color="#EFE3C4"/><stop offset="1" stop-color="#D9CBA6"/></radialGradient></defs>
      <circle cx="18" cy="18" r="${r}" fill="#3A3A46"/><circle cx="18" cy="18" r="${r}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width=".8"/>${lit ? `<path d="${lit}" fill="url(#${id})"/>` : ''}
      ${lit ? '<g fill="#000" opacity=".07"><circle cx="13" cy="13" r="3"/><circle cx="21" cy="21" r="2.2"/><circle cx="23.500" cy="12" r="1.600"/><circle cx="14" cy="23.500" r="1.400"/></g>' : ''}</svg>`;
  }
  // ---------- The moon this evening: its own tiles ----------
  /** The lunar month as eight moons, new to new, with this evening's ringed. */
  function phaseStrip(phase) {
    const at = Math.round(phase * 8) % 8;
    return `<div class="phases">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<span class="${i === at ? 'on' : ''}">${moonSvg(i / 8, 'sm')}</span>`).join('')}</div>
      <div class="scale four"><span>New</span><span>First quarter</span><span>Full</span><span>Last quarter</span></div>`;
  }
  /** The moon's arc over the sky, and where it meets the horizon: rising on the left, setting on the right. */
  const moonPathSvg = (setting) => `<div class="sunpath moonpath${setting ? ' setting' : ''}" aria-hidden="true"><svg viewBox="0 0 100 34" preserveAspectRatio="none"><path d="M0 22H100" stroke="rgba(255,255,255,.3)" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/><path d="M0 31C22 31 30 5 50 5S78 31 100 31" stroke="var(--acc)" stroke-width="1.600" vector-effect="non-scaling-stroke" fill="none" opacity=".85" stroke-dasharray="${setting ? '0' : '3 3'}"/></svg><u></u></div>`;
  /** The whole horizon, north round to north: the sun where it goes down, the moon where it is
      (above the line when it is up, a dashed outline below when it is not), and the compass points. */
  function horizonSvg(m) {
    const xOf = (az) => (G.normalize(az) / 360) * 340 + 10;   // the whole horizon, north to north
    const H = 66, alt = Math.max(-18, Math.min(60, m.altitude)), my = H - alt * (52 / 60);
    const marks = [['N', 0], ['E', 90], ['S', 180], ['W', 270], ['N', 359.99]].map(([l, a]) => `<text x="${xOf(a).toFixed(1)}" y="${H + 18}" text-anchor="middle">${l}</text><line x1="${xOf(a).toFixed(1)}" y1="${H - 3}" x2="${xOf(a).toFixed(1)}" y2="${H + 3}" stroke="rgba(255,255,255,.5)" stroke-width="1.200"/>`).join('');
    const moon = m.altitude >= 0 ? `<circle cx="${xOf(m.azimuth).toFixed(1)}" cy="${my.toFixed(1)}" r="8" fill="#F1E6C8"/><circle cx="${xOf(m.azimuth).toFixed(1)}" cy="${my.toFixed(1)}" r="14" fill="#F1E6C8" opacity=".14"/>`
      : `<circle cx="${xOf(m.azimuth).toFixed(1)}" cy="${Math.min(H + 12, my).toFixed(1)}" r="7" fill="none" stroke="#F1E6C8" stroke-width="1.300" stroke-dasharray="2.500 2.500" opacity=".8"/>`;
    return `<svg class="horizon" viewBox="0 0 360 ${H + 26}" aria-hidden="true"><defs><linearGradient id="hz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB45A" stop-opacity="0"/><stop offset="1" stop-color="#FFB45A" stop-opacity=".35"/></linearGradient></defs>
      <rect x="${(xOf(m.sunAzimuth) - 60).toFixed(1)}" y="${H - 30}" width="120" height="30" fill="url(#hz)"/><path d="M${(xOf(m.sunAzimuth) - 11).toFixed(1)} ${H}a11 11 0 0 1 22 0z" fill="#FFB347"/>
      <line x1="10" y1="${H}" x2="350" y2="${H}" stroke="rgba(255,255,255,.55)" stroke-width="1.400"/>${marks}${moon}</svg>`;
  }
  /** The moon tiles for an evening. */
  function moonTiles(t, p, headBack) {
    const m = G.moonEvening(t.sunset, p.lat, p.lon, headBack), imp = settings.imperialFirst, out = [];
    const tm = (ms) => esc(timeText(ms, p.tz)), day = (ms) => esc(new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZone: tzOr(p.tz), weekday: 'short', month: 'short', day: 'numeric' }).format(ms));
    const both = (text) => { const [a, b] = text.split(' · '); return `${esc(a)}<span class="u2">${esc(b)}</span>`; };
    const opposite = Math.abs(G.normalize(m.azimuth - m.sunAzimuth + 180) - 180) > 120;
    const nextFullFirst = m.nextFull != null && (m.nextNew == null || m.nextFull < m.nextNew);
    // The phase, and where this evening sits in the month.
    out.push(tile('moonph', TI.moon, 'Moon', esc(m.name), `${Math.round(m.fraction * 100)}% lit · day ${Math.round(m.age)} of ${Math.round(G.SYNODIC)}`, `<div class="moonbig">${moonSvg(m.phase, 'lg')}</div>${phaseStrip(m.phase)}`,
      `${m.waxing ? 'Growing' : 'Shrinking'} each night. ${nextFullFirst ? `Full on ${day(m.nextFull)}` : `New on ${day(m.nextNew)}`}, then ${nextFullFirst ? `new on ${day(m.nextNew)}` : `full on ${day(m.nextFull)}`}.`,
      { wide: true, words: true, aside: m.supermoon ? 'Supermoon' : '' }));
    // In the sky at sunset: the horizon you are facing, with the sun and the moon on it.
    const where = m.upAtSunset ? `${Math.round(m.altitude)}° up in the ${compass(m.azimuth)}` : `Below the horizon, ${compass(m.azimuth)}`;
    out.push(tile('moonsky', TI.moon, 'At sunset', esc(m.upAtSunset ? 'In the sky' : 'Not up yet'), esc(where), horizonSvg(m),
      m.upAtSunset && opposite && m.fraction > 0.8 ? 'Opposite the sun: turn around as it sets to watch the moon glow.' : m.upAtSunset ? 'Look for it as the colour fades.' : m.rise && m.rise.time > t.sunset ? `It rises at ${tm(m.rise.time)}.` : 'Not in the sky this evening.',
      { wide: true, words: true }));
    // Moonrise and moonset nearest the evening.
    if (m.rise) {
      const gap = Math.round((m.rise.time - t.sunset) / MIN), rel = Math.abs(gap) < 2 ? 'with the sunset' : `${Math.abs(gap) >= 90 ? `${Math.round(Math.abs(gap) / 6) / 10} h` : `${Math.abs(gap)} min`} ${gap < 0 ? 'before' : 'after'} sunset`;
      out.push(tile('moonrise', TI.moonrise, 'Moonrise', tm(m.rise.time), `${pointOf(m.rise.azimuth)} · ${Math.round(m.rise.azimuth)}°`, moonPathSvg(false),
        Math.abs(gap) <= 60 && m.fraction > 0.8 ? `${rel[0].toUpperCase() + rel.slice(1)}, low and golden in the ${compass(m.rise.azimuth)}.` : `${rel[0].toUpperCase() + rel.slice(1)}.`));
    } else out.push(tile('moonrise', TI.moonrise, 'Moonrise', 'None', 'within a day and a half', moonPathSvg(false), 'It stays up, or stays down, all evening.', { words: true }));
    if (m.set) {
      const gap = Math.round((m.set.time - t.sunset) / MIN);
      out.push(tile('moonset', TI.moonset, 'Moonset', tm(m.set.time), `${pointOf(m.set.azimuth)} · ${Math.round(m.set.azimuth)}°`, moonPathSvg(true),
        gap < 4 * 60 ? 'Goes down during the evening.' : gap < 12 * 60 ? 'Up for most of the night.' : 'Sets the next day.'));
    } else out.push(tile('moonset', TI.moonset, 'Moonset', 'None', 'within a day and a half', moonPathSvg(true), 'It stays up, or stays down, all evening.', { words: true }));
    // Moonlight for the walk back.
    const lightWord = m.light >= 0.6 ? 'Bright' : m.light >= 0.3 ? 'Some' : m.light > 0.05 ? 'Faint' : 'None';
    const lightNote = m.light >= 0.6 ? 'Enough to see the path by. A light still helps.' : m.light >= 0.3 ? 'Some light from the moon. Bring a torch.' : m.light > 0.05 ? 'The moon is low or slim. Bring a torch.' : 'A dark walk back. Bring a torch.';
    out.push(tile('moonlight', TI.moon, 'Moonlight', lightWord, `at ${tm(headBack == null ? t.sunset + 90 * MIN : headBack)}, heading back`, sbar('moonlightbar', m.light * 100),
      lightNote, { words: true }));
    // How far away it is: closer looks bigger and brighter.
    const pos = (m.distance - 356400) / (406700 - 356400) * 100;
    const km = Math.round(m.distance / 100) * 100, mi = Math.round(m.distance / 1.609344 / 100) * 100, n = (v) => v.toLocaleString('en-US');
    out.push(tile('moondist', TI.moon, 'Distance', both(imp ? `${n(mi)} mi · ${n(km)} km` : `${n(km)} km · ${n(mi)} mi`), '', `${sbar('distbar', pos)}<div class="scale two"><span>Closest</span><span>Farthest</span></div>`,
      m.supermoon ? 'A supermoon: near and full, so it looks a little bigger and brighter.' : pos < 30 ? 'Near this month: it looks a little bigger.' : pos > 70 ? 'Far this month: it looks a little smaller.' : 'About its usual distance.', { words: true }));
    return out;
  }

  const tile = (cls, icon, title, value, sub, gfx, note, o) => `<section class="card dt a-${cls}${o && o.wide ? ' wide' : ''}" aria-label="${esc(title)}"><p class="eyebrow">${icon}<span>${esc(title)}</span>${o && o.aside ? `<span class="sp"></span><span class="aside">${o.aside}</span>` : ''}</p>
    <p class="dv${o && o.words ? ' words' : ''}">${value}</p>${sub ? `<p class="ds">${sub}</p>` : ''}${gfx ? `<div class="gfx">${gfx}</div>` : ''}${note ? `<p class="dn">${note}</p>` : ''}</section>`;
  const sbar = (cls, pct, tick) => `<div class="sbar ${cls}">${tick ? '<s></s>' : ''}<u data-l="${Math.max(0, Math.min(100, pct)).toFixed(0)}"></u></div>`;

  function tilesHtml(ev, p) {
    const r = ev.rating, x = ev.x, t = ev.times, out = [], imp = settings.imperialFirst;
    // A reading in both units, the second beneath the first, as Two Degrees sets them.
    const both = (text) => { const [a, b] = text.split(' · '); return `${esc(a)}<span class="u2">${esc(b)}</span>`; };
    if (r && x) {
      const d = r.detail, pc = (v) => Math.round(v || 0);
      // Colour: the sky as forecast, and where it sits from Muted to Brilliant.
      out.push(tile('colour', TI.colour, 'Colour', esc(r.colourClass), `${r.colour} of 100`,
        `${sceneSvg(r, x)}${sbar('colourbar', r.colour)}<div class="scale"><span>Muted</span><span>Soft</span><span>Warm</span><span>Rich</span><span>Brilliant</span></div>`,
        'Colour in the clouds is most of the score.', { wide: true, aside: '70% of the score' }));
      // Cloud cover: the canvas. High, mid and low, each filled to its share.
      const canvasWord = d.canvas < 5 ? 'None to catch the colour' : d.canvas < 30 ? 'A little' : d.canvas <= 70 ? 'Just right' : 'Heavy';
      const layer = (name, where, v, cls) => `<span><b>${name}</b><small>${where}</small></span><div><i class="${cls}" data-w="${pc(v)}"></i></div><b class="num">${pc(v)}%</b>`;
      out.push(tile('cloud', TI.cloud, 'Cloud cover', canvasWord, `${pc(d.canvas)}% mid and high cloud to catch the light`,
        `<div class="clbars">${layer('High', imp ? 'above 5 mi' : 'above 8 km', x.high, 'good')}${layer('Mid', imp ? '2 to 5 mi' : '3 to 8 km', x.mid, 'good')}${layer('Low', imp ? 'under 2 mi' : 'under 3 km', x.low, 'bad')}</div>`,
        (x.low || 0) >= 40 ? 'Low cloud overhead hides the colour.' : 'High and mid cloud catch the light; low cloud blocks it.', { wide: true, words: true }));
      // Toward the sunset: cloud in the light's path, from here out to the sun.
      const path = [0, 1, 2, 3].map((i) => Math.max(x.up[i] ? x.up[i].low : 0, i >= 2 && x.up[i] ? 0.5 * x.up[i].mid : 0, i >= 2 && x.up[i] ? 0.3 * x.up[i].high : 0));
      const km = [50, 100, 200, 300];
      out.push(tile('west', TI.west, 'Toward the sunset', r.parts.s >= 0.8 && d.lit >= 0.8 ? 'Open' : r.parts.s >= 0.4 ? 'Partly blocked' : 'Blocked', `Sun in view: ${pc(r.parts.s * 100)}%`,
        `<div class="pathg"><span class="end you"><i></i>You</span><div class="pbars">${path.map((v, i) => `<div class="b"><div class="col"><i data-h="${Math.max(4, pc(v))}"></i></div><span class="num">${imp ? Math.round(km[i] / 1.609) : km[i]} ${imp ? 'mi' : 'km'}</span></div>`).join('')}</div><span class="end sunend">${TI.sun}Sun</span></div>`,
        `Cloud in the light’s path. The sun sets to the ${esc(compass(t.azimuth))}.`, { wide: true, words: true, aside: '10% of the score' }));
      // Air clarity.
      const airWord = r.smoke ? 'Smoky' : r.parts.a >= 0.8 ? 'Clear' : r.parts.a >= 0.5 ? 'Light haze' : r.parts.a >= 0.2 ? 'Hazy' : 'Thick haze';
      out.push(tile('air', TI.haze, 'Air clarity', airWord, x.aod != null ? `Haze ${x.aod.toFixed(2)}` : '', sbar('airbar', r.parts.a * 100),
        'Clean air keeps the colour vivid. 10% of the score.', { words: true }));
      // Visibility.
      if (x.visibility != null) {
        const vkm = x.visibility / 1000;
        out.push(tile('vis', TI.air, 'Visibility', both(G.distanceText(vkm, imp)), '', sbar('visbar', Math.min(100, vkm / 40 * 100)),
          vkm >= 20 ? 'A clear view to the horizon.' : vkm >= 8 ? 'Some haze in the distance.' : 'The horizon will be lost in haze.'));
      }
      // Wind.
      const windWord = d.w <= 3.5 ? 'Calm' : d.w < 6.5 ? 'A breeze' : d.w < 9 ? 'Windy' : 'Very windy';
      out.push(tile('wind', TI.wind, 'Wind', both(G.windText(x.wind || 0, imp)), '', x.windFrom != null ? windSvg(x.windFrom) : sbar('windbar', (d.w / 12) * 100),
        `${windWord}${x.windFrom != null ? ` from the ${esc(compass(x.windFrom))}` : ''}. Gusts to ${esc(G.windText(x.gusts || 0, imp, true))}.`));
      // Feels like, against what is usual here.
      if (x.apparent != null) {
        const n = d.normal, diff = n == null ? null : x.apparent - n;
        const word = diff == null ? 'Half an hour after sunset.' : diff < -3 ? 'Cooler than usual for the time of year.' : diff > 4 ? 'Warmer than usual for the time of year.' : 'About usual for the time of year.';
        const pos = diff == null ? x.apparent / 35 * 100 : 50 + Math.max(-12, Math.min(12, diff)) / 12 * 50;
        out.push(tile('temp', TI.temp, 'Feels like', both(G.tempText(x.apparent, imp)), n == null ? '' : `Usual: ${temp(n)}`, sbar('tempbar', pos, n != null), word));
      }
      // Rain.
      const showers = (x.codes || []).some((c) => c >= 80 && c <= 82);
      out.push(tile('rain', TI.rain, 'Rain', `${pc(x.rainChance)}%`, 'chance at sunset', sbar('rainbar', x.rainChance || 0),
        r.cap === 'rain' || r.cap === 'snow' ? 'Steady rain or snow caps the evening at 1.5 stars.' : showers ? 'Passing showers can leave the best skies.' : (x.rain12 || 0) >= 1 ? 'It rained earlier: the ground will be wet.' : 'None expected.'));
      // Humidity.
      out.push(tile('damp', TI.damp, 'Humidity', `${pc(x.humidity)}%`, '', sbar('dampbar', x.humidity || 0), (x.humidity || 0) > 85 ? 'Damp air mutes the reds and oranges.' : 'Dry enough for clean colour.'));
    }
    if (t.sunset != null) {
      // Where and when the sun goes down.
      out.push(tile('sun', TI.sun, 'Sunset', esc(timeText(t.sunset, p.tz)), `${pointOf(t.azimuth)} · ${Math.round(t.azimuth)}°`, sunPathSvg(),
        t.state === 'twilight' ? 'Twilight lasts all night.' : `Best light ${esc(timeText(t.bestStart, p.tz))} to ${esc(timeText(t.bestEnd, p.tz))}.`));
      // The moon: its own tiles.
      out.push(...moonTiles(t, p, t.state === 'ok' ? t.lastLight : t.sunset + 90 * MIN));
    }
    return out.length ? `<section class="details" aria-label="What’s behind the score"><div class="dgrid">${out.join('')}</div>
      ${r ? `<p class="small tilenote card">Clean air and comfort only count when there is a sky worth watching${r.gate < 0.995 ? ` (counted at ${Math.round(r.gate * 100)}% this evening)` : ''}.${r.cap ? ' This evening is capped at 1.5 stars.' : ''}</p>` : ''}</section>` : '';
  }

  function deltaLine(p, ev) {
    const d = DATA[p.id], r = ev.rating;
    if (!d || !r) return '';
    const snap = d.snaps[ev.date], prev = d.prev[ev.date];
    const say = (from, since) => { const diff = Math.round((r.score - from) * 10) / 10; return Math.abs(diff) >= 0.1 ? `<p class="delta">${diff > 0 ? 'Up' : 'Down'} ${Math.abs(diff).toFixed(1)} ${since}</p>` : ''; };
    if (snap && snap.takenOn === localDate(now(), p.tz) && snap.fetchedAt < d.fetchedAt) return say(snap.score, 'since this morning');
    if (prev) return say(prev.score, `since you last looked at ${esc(timeText(prev.at, p.tz))}`);
    return '';
  }

  /** One place's page, laid out as Two Degrees lays out a city: the reading on the sky, the evening, the ten
      evenings ahead, then a tile for every input. */
  function pageHtml(p) {
    const d = DATA[p.id] || {}, evs = evenings(p), f = focusDay(p, evs);
    const ev = evs[S.dayBy[p.id] == null ? f : S.dayBy[p.id]] || evs[f], r = ev.rating;
    const label = evLabel(ev, p, evs);
    const head = `<button type="button" class="circle heroshare" data-act="share-today" aria-label="Share ${esc(label.toLowerCase())}’s sunset">${SP.share}</button><h2>${esc(p.name)}${p.sample ? ' <span class="tag">Sample</span>' : ''}</h2><p class="when">${esc(label)} · ${esc(dayName(ev.date, true))}, ${esc(dateText(ev.date))}${p.region ? ` · ${esc(p.region)}` : ''}</p>`;
    let hero;
    if (ev.times.state === 'none') hero = `<section class="hero">${head}<p class="none">No sunset here on this date</p><p class="cond">${ev.times.polar === 'day' ? 'The sun stays up all night.' : 'The sun stays below the horizon.'}</p></section>`;
    else if (r) {
      const stale = d.source !== 'sample' && now() - d.fetchedAt > 3 * HOUR;
      hero = `<section class="hero" aria-label="${esc(spoken(label, r))}">${head}
        <div class="score${stale ? ' stale' : ''}" aria-hidden="true"><span class="n">${scoreText(r)}</span><span class="of">/ 5</span></div>
        <div aria-hidden="true">${stars(r.tier === 'outlook' ? r.shown : r.score, r.tier === 'outlook')}</div>
        <p class="cond colour c-${r.colourClass.toLowerCase()}" aria-hidden="true"><b>${r.colourClass}</b> colour <span class="n num">· ${r.colour}</span></p>
        <p class="hilo verdict ${r.verdict}" aria-hidden="true">${icon(r)}<span>${r.verdictWord}${r.qualifier ? `<span class="q">, ${esc(r.qualifier)}</span>` : ''}</span></p>
        <p class="hilo other range" aria-hidden="true">${r.tier === 'outlook' ? 'Outlook' : r.tier === 'forecast' ? 'Forecast' : 'Tonight'} · ${rangeText(r)} (typical)</p>
        ${stale ? '<p class="hilo other">Out of date. Reconnect to refresh.</p>' : ''}
      </section>`;
    } else if (ev.day > 5) hero = `<section class="hero">${head}<p class="none">Too early to call</p><p class="cond">Sunset is at ${esc(timeText(ev.times.sunset, p.tz))}. A rating appears five days ahead.</p></section>`;
    else if (d.error) hero = `<section class="hero">${head}<p class="none">${d.error === 'ceiling' ? 'Refreshing again tomorrow' : 'Couldn’t reach the forecast'}</p><div class="cta"><button type="button" class="btn white" data-act="retry">Try again</button></div></section>`;
    else if (d.fc) hero = `<section class="hero">${head}<p class="none">No forecast for this evening yet</p></section>`;
    else hero = `<section class="hero skeleton" aria-busy="true">${head}<div class="bone" data-w="40"></div><div class="bone" data-w="60"></div><div class="bone" data-w="50"></div></section>`;

    const warns = r ? r.warnings.map((w) => `<div class="warn" role="note">${ICON.warn}<span>${esc(w.text)}</span></div>`).join('') : '';
    const canPlan = ev.times.state !== 'none' && now() < endOf(ev, p);
    const cta = canPlan ? `<div class="cta"><button type="button" class="btn white" data-act="plan-new" data-date="${ev.date}">Plan this evening</button></div>` : '';
    const sample = p.sample ? `<section class="card ask"><h3>This is a sample forecast</h3><p>Add where you are to see the real one. You can add several locations and swipe between them.</p><div class="row" data-gap><button type="button" class="btn white" data-act="add-place">Add a location</button></div></section>` : '';
    const back = S.dayBy[p.id] != null && S.dayBy[p.id] !== f ? `<button type="button" class="btn quiet back" data-act="day" data-day="">‹ Back to ${f === 1 ? 'tomorrow' : 'tonight'}</button>` : '';
    const best = bestOf(evs);
    const week = `<section class="card daily"><p class="eyebrow">${TI.cal}<span>The evenings ahead</span><span class="sp"></span><span class="aside">Colour</span></p><div class="days">${evs.filter((e) => e.rating || e.times.state === 'none' || e.day <= 5).map((e) => dayRow(e, p, evs, best, ev)).join('')}${(() => { const later = evs.find((e) => !e.rating && e.day > 5); return later ? `<div class="day later"><span class="why">${esc(dayName(later.date, true))}, ${esc(dateText(later.date))} and beyond: too early to call</span></div>` : ''; })()}</div>
      <p class="small muted" data-gap>The bar is the colour score. Tap an evening to see it above. Days three to five are an outlook and may change.</p></section>`;
    return `${back}<div class="two"><div class="col">${hero}${warns}${cta}${sample}</div><div class="col">${howWasIt(p, evs)}${ev.times.state === 'none' ? '' : eveningCard(ev, p)}${week}</div></div>${tilesHtml(ev, p)}${placesSection(p)}${footHtml()}`;
  }
  const compass = (deg) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(G.normalize(deg) / 45) % 8];

  // ---------- How was it? ----------
  /** The evening just gone, if it was rated and hasn't been answered: today's once it is over, else yesterday's. */
  function pendingRating(p, evs) {
    const d = DATA[p.id];
    if (!d || p.sample) return null;
    const over = now() > endOf(evs[0], p);
    const date = over ? evs[0].date : addDays(evs[0].date, -1);
    if (!d.logged || !d.logged[date]) return null;
    if (S.ratings.some((r) => r.placeId === p.id && r.date === date)) return null;
    return { date, predicted: d.logged[date] };
  }
  function howWasIt(p, evs) {
    const q = pendingRating(p, evs);
    if (!q) return '';
    const words = ['Nothing', 'Dull', 'Pleasant', 'Lovely', 'Stunning'];
    return `<section class="card" id="howWasIt"><p class="eyebrow">How was it?</p>
      <p>How was the sunset in ${esc(p.name)} ${q.date === evs[0].date ? 'tonight' : 'last night'}? We forecast ${q.predicted.score.toFixed(1)}. Your answer stays on this device and helps tune the rating.</p>
      <div class="rate" data-gap>${words.map((w, i) => `<button type="button" data-act="rate" data-date="${q.date}" data-v="${i + 1}" aria-label="${i + 1} out of 5: ${w}">${i + 1}<small>${w}</small></button>`).join('')}</div>
      <div class="row" data-gap><span class="sp"></span><button type="button" class="btn quiet" data-act="rate" data-date="${q.date}" data-v="0">Didn’t see it</button></div></section>`;
  }
  async function loadLogged(p) {
    const d = DATA[p.id] || (DATA[p.id] = { prev: {}, snaps: {} });
    d.logged = {};
    const today = localDate(now(), p.tz);
    for (const date of [today, addDays(today, -1)]) {
      const rec = await db.get('evenings', [p.id, date]);
      if (rec && rec.score != null) d.logged[date] = rec;
    }
  }
  function logView() {
    const rows = S.ratings.filter((r) => r.observed).sort((a, b) => (a.date < b.date ? 1 : -1));
    const name = (id) => { const p = S.places.find((x) => x.id === id); return p ? p.name : 'A removed place'; };
    const within = rows.filter((r) => Math.abs(r.observed - r.predicted) <= 1).length;
    return `<button type="button" class="btn quiet back" data-act="close-view">‹ Back</button>
      <section class="card"><p class="eyebrow">My sunset log</p>
      ${rows.length ? `<p>${rows.length} evening${rows.length === 1 ? '' : 's'} rated. The forecast was within one star on ${within} of them.</p>
        <div data-gap>${rows.map((r) => `<div class="plan-row"><span><span class="n">${esc(dayName(r.date))} ${esc(dateText(r.date))} · ${esc(name(r.placeId))}</span><br><span class="r">Forecast ${r.predicted.toFixed(1)} · You said ${r.observed} of 5</span></span></div>`).join('')}</div>
        <div class="row" data-gap><button type="button" class="btn" data-act="copy-log">Copy my log</button><a class="btn" target="_blank" rel="noopener" href="${esc(feedbackUrl(rows))}">Send feedback</a></div>
        <p class="small muted" data-gap>Nothing is sent unless you choose Send feedback, which opens a pre-filled report on GitHub for you to review.</p>`
    : '<p class="empty">No evenings rated yet. After last light, Golden Hour asks how the sunset was.</p>'}</section>`;
  }
  function feedbackUrl(rows) {
    const body = 'My Golden Hour sunset log (forecast → what I saw):\n\n' + rows.slice(0, 40).map((r) => `${r.date}  forecast ${r.predicted.toFixed(1)}  saw ${r.observed}/5  parts c${r.parts.c.toFixed(2)} s${r.parts.s.toFixed(2)} a${r.parts.a.toFixed(2)} k${r.parts.k.toFixed(2)}`).join('\n');
    return 'https://github.com/bradleycowdrey/golden-hour/issues/new?title=' + encodeURIComponent('Sunset log') + '&body=' + encodeURIComponent(body);
  }

  // ---------- Week and Compare ----------
  /** One evening in the list of ten, as Two Degrees shows a day: the day, the verdict, the score, a bar for
      the colour, and the colour class over the sunset time. */
  function dayRow(ev, p, evs, best, shown) {
    const label = ev.day === 0 ? 'Today' : ev.day === 1 ? 'Tomorrow' : dayName(ev.date, true), short = ev.day === 0 ? 'Today' : dayName(ev.date);
    const isBest = best && best.ev.date === ev.date;
    const d = `<span class="d">${esc(short)}${isBest ? `<small class="best">${best.label === 'Best evening' ? 'Best' : 'Likely best'}</small>` : ''}</span>`;
    const sunset = ev.times.sunset == null ? '' : esc(timeText(ev.times.sunset, p.tz));
    if (ev.times.state === 'none') return `<div class="day none">${d}<span class="why">No sunset here on this date</span><span class="hi"></span></div>`;
    if (!ev.rating) return `<div class="day none">${d}<span class="why">${ev.day > 5 ? 'Too early to call' : 'No forecast yet'}</span><span class="hi"><span>Sunset ${sunset}</span></span></div>`;
    const r = ev.rating, out = r.tier === 'outlook', cls = r.colourClass.toLowerCase();
    return `<button type="button" class="day${out ? ' outlook' : ''}${shown && shown.date === ev.date ? ' on' : ''}" data-act="day" data-day="${ev.day}" aria-label="${esc(spoken(label, r))}">${d}
      <span class="ic v ${r.verdict}" aria-hidden="true">${icon(r)}<small>${r.verdictWord}</small></span>
      <span class="sc num" aria-hidden="true">${scoreText(r)}</span>
      <span class="cbar" aria-hidden="true"><i class="f-${cls}" data-w="${Math.max(3, r.colour)}"></i></span>
      <span class="hi" aria-hidden="true"><b class="c-${cls}">${r.colourClass}</b><span>${sunset}</span></span></button>`;
  }

  // ---------- Plans ----------
  function plansView() {
    const today = localDate(now(), deviceTz());
    const upcoming = S.plans.filter((p) => p.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
    const earlier = S.plans.filter((p) => p.date < today).sort((a, b) => (a.date < b.date ? 1 : -1));
    const row = (p) => `<button type="button" class="plan-row" data-act="plan-open" data-id="${esc(p.id)}"><span><span class="n">${esc(p.spot.name)}</span><br><span class="r">${esc(dayName(p.date, true))} ${esc(dateText(p.date))} · meet at ${esc(timeText(p.times.meetAt, p.tz))} · sunset ${esc(timeText(p.times.sunset, p.tz))}</span></span><span class="sp"></span><span aria-hidden="true">›</span></button>`;
    return `<div class="row top"><button type="button" class="btn quiet back" data-act="close-view">‹ Back</button></div><section class="card"><p class="eyebrow">Plans</p>${upcoming.length ? upcoming.map(row).join('') : '<p class="empty">No plans yet. Pick an evening to start one.</p>'}</section>
      ${earlier.length ? `<section class="card"><p class="eyebrow">Earlier</p>${earlier.map(row).join('')}</section>` : ''}`;
  }

  const TYPES = { outdoor: 'Park, field or open ground', water: 'Beach, pier or waterside', peak: 'Summit or viewpoint', venue: 'Restaurant or bar' };

  /** Everything the Plan screen shows, worked out from the draft and the forecast. */
  function planModel(dr) {
    const p = S.places.find((x) => x.id === dr.placeId) || (dr.saved ? null : place());
    const evs = p ? evenings(p, { spotType: dr.spot.type }) : [];
    const ev = evs.find((e) => e.date === dr.date) || null;
    const hasPin = dr.spot.lat != null;
    const at = hasPin ? dr.spot : p;
    const [y, m, d] = ymd(dr.date);
    const times = G.eveningTimes(G.solarNoonGuess(y, m + 1, d, at.lon), at.lat, at.lon);
    const km = hasPin && dr.start ? G.distance(dr.start.lat, dr.start.lon, dr.spot.lat, dr.spot.lon) / 1000 : 0;
    const travel = G.travelMinutes(km);
    const r = ev && ev.rating;
    const buffer = G.bufferMinutes(r ? r.score : 0, weekdayOf(dr.date));
    const pt = G.planTimes(times, { walkIn: dr.walkIn, travel, buffer });
    const items = r && pt ? G.mergeItems(dr.items, G.bringList(ev.x, r.detail, { spotType: dr.spot.type, walkIn: dr.walkIn, times: pt, imperialFirst: settings.imperialFirst })) : (dr.items || []);
    return { p, ev, r, times, km, travel, buffer, pt, items, hasPin, tz: p ? p.tz : dr.tz };
  }

  function timeline(pt, tz, opts) {
    const o = opts || {};
    const row = (cls, ms, title, sub) => `<div class="tl ${cls}"><span class="t num">${esc(timeText(ms, tz))}</span><span class="dot"></span><span class="what"><b>${title}</b><span>${sub}</span></span></div>`;
    return `<div class="timeline">
      ${o.leave ? row('', pt.leaveBy, 'Leave by', o.leave) : ''}
      ${row('', pt.meetAt, 'Meet at the spot', 'Settled 20 minutes before the best light')}
      ${row('sun', pt.sunset, 'Sunset', 'Stay: the best colour often comes after the sun is down')}
      ${row('', pt.stayUntil, 'Afterglow ends', o.twilight ? 'Twilight lasts all night here' : 'The last of the colour')}
      ${row('', pt.headBackBy, 'Head back by', o.twilight ? 'It stays light' : 'Last light')}
    </div>`;
  }

  function afterDark(model, walkIn, lat, lon, pt, tz) {
    const moon = G.moonAt(pt.headBackBy, lat, lon), pct = Math.round(moon.fraction * 100);
    const facts = [];
    facts.push(walkIn > 0 ? `The walk back is about ${walkIn} minute${walkIn === 1 ? '' : 's'}.` : 'No walk back to speak of.');
    facts.push(model && model.times.state === 'twilight' ? 'Twilight lasts all night at this time of year.' : `Last light is at ${esc(timeText(pt.headBackBy, tz))}. After that it is dark.`);
    facts.push(moon.up ? `The moon will be up when you leave (${esc(moon.name.toLowerCase())}, ${pct}% lit).` : `No moon in the sky when you leave (${esc(moon.name.toLowerCase())}).`);
    return `<ul class="facts">${facts.map((f) => `<li><span>${f}</span></li>`).join('')}</ul>`;
  }

  function planView() {
    const dr = S.view.draft, mo = planModel(dr), tz = mo.tz;
    setSky(mo.r, mo.ev && mo.ev.x, (mo.p ? mo.p.id : 'plan') + dr.date);
    const saved = !!dr.saved, past = mo.pt && now() > mo.pt.headBackBy + 6 * HOUR;
    const dayLabel = `${dayName(dr.date, true)} ${dateText(dr.date)}`;
    const score = mo.r ? `<span class="row">${stars(mo.r.tier === 'outlook' ? mo.r.shown : mo.r.score, mo.r.tier === 'outlook', true)}<b class="num">${scoreText(mo.r)}</b>${colourHtml(mo.r, true)}<span class="v ${mo.r.verdict}">${mo.r.verdictWord}</span><span class="small muted">${esc(mo.r.reason)}</span></span>` : '<span class="small muted">No rating for this evening yet.</span>';
    const far = mo.hasPin && mo.p && G.distance(mo.p.lat, mo.p.lon, dr.spot.lat, dr.spot.lon) > 15000;
    const head = `<button type="button" class="btn quiet back" data-act="close-view">‹ ${saved ? 'Plans' : 'Back'}</button>
      <section class="hero"><p class="when">${esc(dayLabel)}</p><h2>${esc(dr.spot.name || 'A new plan')}</h2>
      <p class="tagline">${mo.p ? `Forecast for ${esc(mo.p.name)}${far ? ', some distance from this spot' : ''}` : ''}</p></section>`;
    const coords = mo.hasPin ? `${dr.spot.lat.toFixed(5)}, ${dr.spot.lon.toFixed(5)}` : '';
    const mapCard = `<section class="card"><p class="eyebrow">The spot</p>
      <div class="map" id="map"><div class="msg" id="mapMsg">Loading the map…</div></div>
      ${past ? '' : `<div class="row" data-gap><button type="button" class="btn" data-act="pin-here">Pin my location</button>${mo.p ? `<button type="button" class="btn" data-act="pin-place">Pin ${esc(mo.p.name)}</button>` : ''}</div>
      <div class="form" data-gap>
        <label class="wide">Name<input id="spotName" maxlength="60" value="${esc(dr.spot.name)}" placeholder="West ridge car park" autocomplete="off"></label>
        <label>Kind of place<select id="spotType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${dr.spot.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Walk in, minutes<input id="walkIn" type="number" inputmode="numeric" min="0" max="240" value="${dr.walkIn}"></label>
        <label class="wide">Coordinates<input id="coords" value="${esc(coords)}" placeholder="Tap the map, or type 39.7392, -104.9903" autocomplete="off"></label>
      </div>`}</section>`;
    if (!mo.hasPin || !mo.pt) {
      return `${head}<div class="two"><div class="col">${mapCard}</div><div class="col"><section class="card"><p class="eyebrow">The evening</p>${score}
        <p data-gap>${mo.pt ? 'Drop a pin where you’ll watch from. The times, what to bring and the walk back fill in from there.' : 'No sunset here on this date.'}</p></section></div></div>`;
    }
    const leaveSub = `From ${esc(dr.start.label)}: about ${mo.travel} min${mo.km >= 0.2 ? ` (${dist(mo.km * 1.4)} by road, roughly)` : ''}, ${dr.walkIn} min walk in, ${mo.buffer} min to spare`;
    const timesCard = `<section class="card"><p class="eyebrow">The evening</p>${score}<div data-gap>${timeline(mo.pt, tz, { leave: leaveSub, twilight: mo.times.state === 'twilight' })}</div>
      <div class="row"><span class="small muted">Leaving from <b>${esc(dr.start.label)}</b>. Never shared.</span><span class="sp"></span>
      <button type="button" class="btn quiet" data-act="start-here">Use my location</button>${mo.p && dr.start.kind !== 'place' ? `<button type="button" class="btn quiet" data-act="start-place">Use ${esc(mo.p.name)}</button>` : ''}</div>
      <p class="small muted">Travel time is an estimate. Directions gives the real figure.</p></section>`;
    const items = mo.items;
    const bring = `<section class="card"><p class="eyebrow">What to bring</p><div class="items">${items.length ? items.map((it, i) => `<div class="item${it.done ? ' done' : ''}">
        <input type="checkbox" id="it${i}" data-act="tick" data-i="${i}"${it.done ? ' checked' : ''} aria-label="${esc(it.name)}">
        <label for="it${i}"><span class="n">${esc(it.name)}${it.isNew ? '<span class="new">New</span>' : ''}</span>${it.why ? `<br><span class="w">${esc(it.why)}</span>` : ''}</label>
        <span class="row"><input class="who" data-act-input="who" data-i="${i}" maxlength="24" value="${esc(it.who || '')}" placeholder="Who?" aria-label="Who brings ${esc(it.name)}">${it.custom ? `<button type="button" class="x" data-act="item-del" data-i="${i}" aria-label="Remove ${esc(it.name)}">×</button>` : ''}</span></div>`).join('') : '<p class="small muted">Nothing special needed.</p>'}</div>
      <div class="additem"><input id="newItem" maxlength="40" placeholder="Add your own" aria-label="Add your own item"><button type="button" class="btn" data-act="item-add">Add</button></div></section>`;
    const dark = `<section class="card"><p class="eyebrow">After dark</p>${afterDark(mo, dr.walkIn, dr.spot.lat, dr.spot.lon, mo.pt, tz)}</section>`;
    let actions;
    if (S.view.sharing) actions = `<section class="notice" id="shareNotice"><p><b>Anyone with this link can see the place, time and names.</b> It never includes where you’re leaving from.</p><div class="row"><button type="button" class="btn primary" data-act="share-go">Share link</button><button type="button" class="btn" data-act="share-cancel">Cancel</button></div></section>`;
    else if (saved) actions = `<section class="card"><div class="row"><button type="button" class="btn primary" data-act="share">Share</button><button type="button" class="btn" data-act="calendar">Add to calendar</button><a class="btn" target="_blank" rel="noopener" href="${esc(directionsUrl(dr.spot))}">Directions</a><span class="sp"></span><button type="button" class="btn quiet danger" data-act="plan-del">Delete</button></div></section>`;
    else actions = `<div class="cta"><button type="button" class="btn primary" data-act="plan-save"${db.isBlocked() ? ' disabled' : ''}>Save plan</button></div>`;
    return `${head}<div class="two"><div class="col">${mapCard}${actions}</div><div class="col">${timesCard}${bring}${dark}</div></div>`;
  }

  function directionsUrl(spot) {
    const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
    return apple ? `https://maps.apple.com/?daddr=${spot.lat},${spot.lon}&q=${encodeURIComponent(spot.name || 'Sunset spot')}`
      : `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lon}`;
  }

  // ---------- The shared plan (read-only) ----------
  function sharedView() {
    const v = S.view;
    setSky(v.live || null, null, 'shared');
    if (!v.plan) return `<section class="card"><p class="eyebrow">Golden Hour</p><p>This plan link is incomplete. Ask for it again.</p><div class="row" data-gap><a class="btn" href="./">Open Golden Hour</a></div></section>`;
    const pl = v.plan, tz = tzOr(pl.tz), [y, m, d] = ymd(pl.date);
    const times = G.eveningTimes(G.solarNoonGuess(y, m + 1, d, pl.spot.lon), pl.spot.lat, pl.spot.lon);
    const groups = new Map();
    for (const it of pl.items) { const k = it.who || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it.name); }
    const names = Array.from(groups.keys()).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const live = v.live;
    const dropped = live && pl.scoreAtSave != null && pl.scoreAtSave >= 3.5 && live.verdict !== 'go';
    const scoreLine = live ? `<span class="row">${stars(live.tier === 'outlook' ? live.shown : live.score, live.tier === 'outlook', true)}<b class="num">${scoreText(live)}</b>${colourHtml(live, true)}<span class="v ${live.verdict}">${live.verdictWord}</span><span class="small muted">${esc(live.reason)}</span></span>`
      : pl.scoreAtSave != null ? `<span class="small muted">Rated ${pl.scoreAtSave.toFixed(1)} of 5 when this plan was made.</span>` : '';
    return `<section class="hero"><p class="when">${esc(dayName(pl.date, true))} ${esc(dateText(pl.date))}</p><h2>${esc(pl.spot.name || 'Sunset')}</h2><p class="tagline">A sunset plan, shared with you</p></section>
      ${dropped ? `<div class="warn" role="note">${ICON.warn}<span>The forecast has dropped since this plan was made. Check with whoever sent you this.</span></div>` : ''}
      <div class="two"><div class="col">
        <section class="card"><p class="eyebrow">The spot</p><div class="map" id="map"><div class="msg" id="mapMsg">Loading the map…</div></div>
          <div class="row" data-gap><a class="btn primary" target="_blank" rel="noopener" href="${esc(directionsUrl(pl.spot))}">Directions</a><button type="button" class="btn" data-act="calendar">Add to calendar</button></div></section>
        <section class="card"><p class="eyebrow">After dark</p>${afterDark({ times }, pl.walkIn, pl.spot.lat, pl.spot.lon, pl.times, tz)}<p class="small muted" data-gap>Based on the sun and moon for this spot.</p></section>
      </div><div class="col">
        <section class="card"><p class="eyebrow">The evening</p>${scoreLine}<div data-gap>${timeline(pl.times, tz, { twilight: times.state === 'twilight' })}</div></section>
        <section class="card"><p class="eyebrow">What to bring</p>${pl.items.length ? `<div class="group">${names.map((n) => `<h3>${n ? esc(n) : names.length > 1 ? 'Anyone' : 'Bring'}</h3><ul>${groups.get(n).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}</div>` : '<p class="small muted">Nothing listed.</p>'}</section>
        <section class="card"><p class="small muted">Plan as of ${pl.sharedAt ? `${esc(timeText(pl.sharedAt, tz))} on ${esc(new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(pl.sharedAt))}` : 'when it was shared'}. Times are local to the spot.</p>
          <div class="row" data-gap><a class="btn" href="./">Make my own plan</a></div></section>
      </div></div>`;
  }

  // ---------- The map (MapLibre and OpenFreeMap, loaded only when a plan is opened) ----------
  let map = null, marker = null, mapLib = null;
  function loadMapLib() {
    if (mapLib) return mapLib;
    mapLib = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/maplibre-gl.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'vendor/maplibre-gl-csp.js';
      s.onload = () => { if (!window.maplibregl) return rej(new Error('no map library')); window.maplibregl.setWorkerUrl('vendor/maplibre-gl-csp-worker.js'); res(window.maplibregl); };
      s.onerror = () => rej(new Error('no map library'));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('timeout')), 15000);
    });
    mapLib.catch(() => { mapLib = null; });
    return mapLib;
  }
  function mapFallback(text) {
    const box = mapEl && mapEl.isConnected ? mapEl : $('#map');
    if (!box) return;
    const img = S.view && S.view.draft && S.view.draft.mapImage;
    box.innerHTML = img ? `<img src="${esc(img)}" alt="Map of the spot, saved with the plan">` : `<div class="msg">${esc(text)}</div>`;
  }
  let mapEl = null, mapKey = null, viewSeq = 0;
  function syncMarker(spot, shared) {
    if (!map || !window.maplibregl) return;
    if (spot && spot.lat != null) {
      if (!marker) { const el = document.createElement('div'); el.className = 'pin'; marker = new window.maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat([spot.lon, spot.lat]).addTo(map); }
      else marker.setLngLat([spot.lon, spot.lat]);
      const h = $('.hint', mapEl); if (h) h.remove();
    } else if (!shared && !$('.hint', mapEl)) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = 'Tap the map to drop a pin'; mapEl.appendChild(h); }
  }
  /** Puts the map in the page. The same map is kept while one plan stays open, so typing never redraws it. */
  function mountMap() {
    const slot = $('#map');
    if (!slot) return;
    const v = S.view, shared = v.type === 'shared' || v.type === 'spot';
    const spot = v.type === 'shared' ? (v.plan && v.plan.spot) : v.type === 'spot' ? v.spot : v.draft.spot;
    if (shared && !spot) return;
    if (!v.key) v.key = ++viewSeq;
    if (mapEl && mapKey === v.key) { slot.replaceWith(mapEl); if (map) { map.resize(); syncMarker(spot, shared); } return; }
    if (map) { try { map.remove(); } catch { /* already gone */ } }
    map = null; marker = null; mapEl = slot; mapKey = v.key;
    const p = place(), centre = spot && spot.lat != null ? [spot.lon, spot.lat] : [p.lon, p.lat];
    const failed = shared ? 'The map couldn’t load. Directions still works.' : 'The map couldn’t load. Type coordinates or pin your location.';
    if (!navigator.onLine) return mapFallback('The map needs a connection. The plan itself is saved.');
    const key = v.key;
    loadMapLib().then((ml) => {
      if (mapKey !== key || !mapEl.isConnected) return;
      mapEl.innerHTML = '';
      try {
        map = new ml.Map({ container: mapEl, style: 'https://tiles.openfreemap.org/styles/liberty', center: centre, zoom: spot && spot.lat != null ? 13 : 10,
          attributionControl: { compact: true }, preserveDrawingBuffer: true, dragRotate: false, pitchWithRotate: false });
      } catch { map = null; return mapFallback('The map couldn’t start in this browser. Type coordinates or pin your location.'); }
      const mine = map;
      mine.on('error', () => { if (map === mine && !mine.isStyleLoaded()) { try { mine.remove(); } catch { /* gone */ } map = null; marker = null; mapFallback(failed); } });
      syncMarker(spot, shared);
      if (!shared) mine.on('click', (e) => setPin(e.lngLat.lat, e.lngLat.lng));
    }).catch(() => { if (mapKey === key) mapFallback(failed); });
  }
  /** The map as an image, with its credit, to keep with the plan for offline. */
  function mapSnapshot() {
    try {
      if (!map || !map.isStyleLoaded()) return null;
      const src = map.getCanvas(), c = document.createElement('canvas'), w = 640, h = Math.round(640 * src.height / src.width);
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0, w, h);
      const text = '© OpenStreetMap contributors · OpenFreeMap';
      g.font = '600 13px sans-serif';
      const tw = g.measureText(text).width;
      g.fillStyle = 'rgba(18,15,13,.78)'; g.fillRect(w - tw - 16, h - 24, tw + 16, 24);
      g.fillStyle = '#fff'; g.fillText(text, w - tw - 8, h - 8);
      const url = c.toDataURL('image/jpeg', 0.72);
      return url.length > 400000 ? null : url;
    } catch { return null; }
  }

  // ---------- Golden Hour Places: where to go, near each location ----------
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const SPOT_TTL = 14 * DAY;
  const CATS = [
    { key: 'easy', title: 'Landmarks', sub: 'Well-known spots, easy to reach', icon: 'landmark' },
    { key: 'adventurous', title: 'Adventurous', sub: 'Worth the effort: a drive up, a hike or a climb', icon: 'peak' },
    { key: 'dining', title: 'Dining with a view', sub: 'Terraces and rooftops. You may need to book', icon: 'dining' },
  ];
  const EFFORT = { easy: 'Easy to reach', medium: 'Medium effort', high: 'High effort', low: 'Easy to reach' };
  const SP = {
    landmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 20V10l6-5 6 5v10M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    peak: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.500 20 9 8l3.500 6 2.500-3.500L21.500 20z" fill="currentColor"/><path d="M9 8 7.300 11.200 9 10.500l1.600.9z" fill="#fff" opacity=".7"/></svg>',
    dining: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M16.500 21V3c-2 0-3.500 2.500-3.500 6v4h3.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.500-4.600-7.500-10.200A4.300 4.300 0 0 1 12 7.300a4.300 4.300 0 0 1 7.500 2.500C19.500 15.400 12 20 12 20z" fill="currentColor"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.500M7.500 8 12 3.500 16.500 8M5 12v7.500A1.500 1.500 0 0 0 6.500 21h11a1.500 1.500 0 0 0 1.500-1.500V12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V11l2-5h10l2 5v5M3.500 11h17M5 16h14v2.500H5zM7.500 13.500h.01M16.500 13.500h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  /** The picture for a kind of place; a pin for anything else. */
  const KIND_ICON = { Viewpoint: 'viewpoint', Pier: 'pier', Beach: 'beach', Park: 'park', Garden: 'garden', Lake: 'lake', Lighthouse: 'lighthouse', 'Lookout tower': 'tower',
    Cliff: 'cliff', Harbour: 'harbour', Landmark: 'landmark', Summit: 'summit', Restaurant: 'restaurant', Bar: 'bar', Pub: 'pub', 'Café': 'cafe', 'Beer garden': 'beergarden',
    'Open ground': 'park', Waterside: 'lake', 'Summit or viewpoint': 'summit', 'Restaurant or bar': 'restaurant' };
  /** A viewpoint is drawn as what you'd look out on there, read from its name: the coast, a peak, the city. */
  const VIEW_OF = [[/light ?house|\bphare\b|\bfaro\b/, 'lighthouse'], [/\b(pier|jetty|wharf|boardwalk|mole)\b/, 'pier'], [/\b(bridge|viaduct|pont|puente|brücke)\b/, 'bridge'],
    [/\b(harbou?r|marina|port|docks?|quay)\b/, 'harbour'], [/\b(beach|shore|sands?|strand|playa|plage|praia|cove)\b/, 'beach'],
    [/\b(cliffs?|bluffs?|head|headland|cape|point|ocean|sea|coast|bay|gulf)\b/, 'cliff'], [/\b(lake|loch|lago|lac|reservoir|pond|river|creek|falls|lagoon)\b/, 'lake'],
    [/\b(mount|mt\.?|mountain|peak|summit|ridge|butte|mesa|pass|canyon|monte|pico|berg|crest|knob|rock|rocks)\b/, 'summit'],
    [/\b(tower|torre|tour|turm)\b/, 'tower'], [/\b(roof|rooftop|terrace|sky ?deck|observatory|observation|skyline|city|downtown|plaza)\b/, 'skyline'],
    [/\b(garden|gardens|jardin|jardim)\b/, 'garden'], [/\b(park|meadows?|green|commons?)\b/, 'park']];
  function viewpointIcon(s) {
    const n = String(s.name || '').toLowerCase();
    for (const [re, k] of VIEW_OF) if (re.test(n)) return k === 'cliff' && /\bpoint\b/.test(n) && !/\b(ocean|sea|coast|bay|cape|cliffs?|head)\b/.test(n) ? 'viewpoint' : k;
    return s.gain >= 300 ? 'summit' : 'viewpoint';
  }
  function kindIconName(s) {
    if (s.cat === 'dining' && s.rooftop && s.kind !== 'Café') return 'rooftop';
    if (s.kind === 'Viewpoint') return viewpointIcon(s);
    return KIND_ICON[s.kind] || (s.type && { outdoor: 'park', water: 'lake', peak: 'summit', venue: 'restaurant' }[s.type]) || 'pin';
  }
  const kindIcon = (s) => `<svg viewBox="0 0 40 40" aria-hidden="true"><use href="#k-${kindIconName(s)}"/></svg>`;
  const catIcon = (cat) => SP[{ easy: 'landmark', adventurous: 'peak', dining: 'dining', own: 'heart' }[cat] || 'landmark'];
  /** Places a sample location shows without asking the network, so the first look has something in it. */
  const SAMPLE_SPOTS = (() => {
    const mk = (cat, name, kind, lat, lon, extra) => ({ id: 'sample/' + name, name, cat, kind, lat, lon, famous: true, sunsetNamed: /sunset/i.test(name), faces: null, sample: true, rooftop: /rooftop/i.test(name), ...extra });
    return {
      easy: [mk('easy', 'Inspiration Point Park', 'Viewpoint', 39.7826, -105.0566), mk('easy', 'Sloan’s Lake Park', 'Park', 39.7499, -105.0453), mk('easy', 'Cheesman Park Pavilion', 'Park', 39.7329, -104.9668),
        mk('easy', 'Riverside Cemetery Overlook', 'Viewpoint', 39.7856, -104.9671), mk('easy', 'Ruby Hill Park', 'Park', 39.6865, -105.0007), mk('easy', 'Sunset Park', 'Park', 39.6981, -104.8767)],
      adventurous: [mk('adventurous', 'Lookout Mountain', 'Viewpoint', 39.7322, -105.2392, { ele: 2190, gain: 581, effort: 'medium' }), mk('adventurous', 'Green Mountain', 'Summit', 39.6935, -105.1488, { ele: 2005, gain: 396, effort: 'medium' }),
        mk('adventurous', 'Mount Galbraith', 'Summit', 39.7707, -105.2531, { ele: 2265, gain: 656, effort: 'high' }), mk('adventurous', 'Mount Falcon', 'Summit', 39.6375, -105.2392, { ele: 2370, gain: 761, effort: 'high' }),
        mk('adventurous', 'Mount Evans', 'Summit', 39.5883, -105.6438, { ele: 4348, gain: 2739, effort: 'high' })],
      dining: [mk('dining', 'Linger', 'Restaurant', 39.7597, -105.0113, { effort: 'low' }), mk('dining', 'Avanti F&B', 'Bar', 39.7637, -105.0102, { effort: 'low' }),
        mk('dining', 'Mile High Rooftop', 'Bar', 39.7473, -104.9947, { effort: 'low' }), mk('dining', 'Will Call', 'Bar', 39.7589, -104.9998, { effort: 'low' }),
        mk('dining', 'Departure Rooftop', 'Restaurant', 39.7186, -104.9532, { effort: 'low' })],
    };
  })();

  /** Finds the Golden Hour Places around a location, once a fortnight. */
  async function loadSpots(p) {
    const d = DATA[p.id] || (DATA[p.id] = { prev: {}, snaps: {} });
    if (p.sample) { d.spots = finishSample(p); return; }
    if (d.spots && d.spots !== 'error') return;
    if (d.spotsLoading) return d.spotsLoading;
    d.spotsLoading = (async () => {
      const q = G.spotsQuery(Math.round(p.lat * 100) / 100, Math.round(p.lon * 100) / 100);
      let body = null;
      for (const base of OVERPASS) {
        try { body = (await getJSON(`${base}?data=${encodeURIComponent(q)}`, SPOT_TTL, 0, false)).body; break; } catch { /* try the next */ }
      }
      if (!body) { d.spots = 'error'; return; }
      const evs = evenings(p), az = evs[0].times.azimuth;
      d.spots = G.rankSpots(body.elements, { lat: p.lat, lon: p.lon, elevation: d.elevation == null ? null : d.elevation, facing: az });
    })();
    try { await d.spotsLoading; } finally { d.spotsLoading = null; }
  }
  function finishSample(p) {
    const out = {};
    for (const [k, list] of Object.entries(SAMPLE_SPOTS)) out[k] = list.map((s) => { const km = G.distance(p.lat, p.lon, s.lat, s.lon) / 1000; return { effort: k === 'easy' ? 'easy' : s.effort, ...s, km, travel: G.travelMinutes(km) }; });
    return out;
  }
  /** Your own spots near a location (within 100 km). */
  const ownSpots = (p) => S.spots.filter((s) => G.distance(p.lat, p.lon, s.lat, s.lon) < 100000)
    .map((s) => { const km = G.distance(p.lat, p.lon, s.lat, s.lon) / 1000; return { ...s, km, travel: G.travelMinutes(km) }; }).sort((a, b) => a.km - b.km);
  const allSpots = (p) => { const d = DATA[p.id] || {}; return d.spots && typeof d.spots === 'object' ? d.spots : null; };
  function findSpot(p, id) {
    const s = allSpots(p);
    for (const list of s ? Object.values(s) : []) { const hit = list.find((x) => x.id === id); if (hit) return hit; }
    return ownSpots(p).find((x) => x.id === id) || null;
  }

  const away = (s) => `${s.km < 0.2 ? 'Here' : `${esc(G.distanceText(s.km, settings.imperialFirst, true))} · about ${s.travel} min`}`;
  /** One row for a place: its picture, name, what it is, how far and how hard. */
  function spotRow(s, p, i) {
    const effort = s.cat === 'own' ? 'Your spot' : s.cat === 'dining' ? 'May need a booking' : EFFORT[s.effort] || '';
    return `<button type="button" class="srow" data-act="spot-open" data-id="${esc(s.id)}" data-place="${esc(p.id)}">
      <span class="sbadge c-${s.cat} k-${kindIconName(s)}" aria-hidden="true">${kindIcon(s)}${i != null ? `<b class="rank">${i + 1}</b>` : s.cat === 'own' ? '<b class="rank own"><svg viewBox="0 0 40 40"><use href="#k-heart"/></svg></b>' : ''}</span>
      <span class="sl"><span class="n">${esc(s.name)}</span><span class="r">${esc(s.kind || G.SPOT_CAT[s.cat] || '')} · ${away(s)}</span><span class="e e-${esc(s.cat === 'own' ? 'own' : s.effort || 'own')}">${esc(effort)}</span></span>
      <span class="chev">${SP.chev}</span></button>`;
  }
  /** At the foot of each location's page: the top three of each kind, and the way in to all of them. */
  function placesSection(p) {
    const s = allSpots(p), d = DATA[p.id] || {}, mine = ownSpots(p);
    const head = `<div class="sechead"><h3>Golden Hour Places</h3><p>Where to watch from near ${esc(p.name)}</p></div>`;
    let body;
    if (!s && d.spots === 'error') body = `<section class="card"><p>Couldn’t load places near ${esc(p.name)}.</p><div class="row" data-gap><button type="button" class="btn" data-act="spots-retry">Try again</button></div></section>`;
    else if (!s) body = `<section class="card skeleton" aria-busy="true"><p class="muted">Finding sunset places near ${esc(p.name)}…</p><div class="bone" data-w="70"></div><div class="bone" data-w="55"></div></section>`;
    else body = '<div class="spotgrid">' + CATS.map((c) => {
      const list = s[c.key].slice(0, 3);
      return `<section class="card spotcard a-${c.key}"><p class="eyebrow">${SP[c.icon]}<span>${c.title}</span><span class="sp"></span><span class="aside">${s[c.key].length ? `Top ${list.length}` : ''}</span></p>
        ${list.length ? list.map((x, i) => spotRow(x, p, i)).join('') : `<p class="small muted">None found nearby in open map data.</p>`}</section>`;
    }).join('') + (mine.length ? `<section class="card spotcard a-own"><p class="eyebrow">${SP.heart}<span>Your spots</span></p>${mine.slice(0, 3).map((x) => spotRow(x, p)).join('')}</section>` : '') + '</div>';
    return `<section class="ghplaces" aria-label="Golden Hour Places">${head}${body}
      <div class="cta"><button type="button" class="btn white" data-act="spots-all" data-place="${esc(p.id)}">See all Golden Hour Places</button></div></section>`;
  }

  /** The full list, in four parts: landmarks, adventurous places, dining with a view, and your own. */
  function spotsView() {
    const v = S.view, p = place(v.placeId), s = allSpots(p), mine = ownSpots(p), d = DATA[p.id] || {};
    skyOf(p);
    const part = (c, list) => {
      const open = v.expanded[c.key], shown = open ? list : list.slice(0, 5);
      return `<section class="card spotcard a-${c.key}"><p class="eyebrow">${SP[c.icon]}<span>${c.title}</span></p><p class="catsub">${c.sub}</p>
        ${shown.length ? shown.map((x, i) => spotRow(x, p, i)).join('') : '<p class="small muted">None found nearby in open map data.</p>'}
        ${list.length > 5 ? `<button type="button" class="more" data-act="spots-more" data-k="${c.key}">${open ? 'Show fewer' : `Show ${list.length - 5} more`}</button>` : ''}</section>`;
    };
    const lists = !s ? `<section class="card">${d.spots === 'error' ? `<p>Couldn’t load places near ${esc(p.name)}.</p><div class="row" data-gap><button type="button" class="btn" data-act="spots-retry">Try again</button></div>` : `<p class="muted">Finding sunset places near ${esc(p.name)}…</p>`}</section>`
      : `<div class="spotgrid wide">${CATS.map((c) => part(c, s[c.key])).join('')}</div>`;
    return `<div class="row top"><button type="button" class="btn quiet back" data-act="close-view">‹ ${esc(p.name)}</button><span class="sp"></span>
        <button type="button" class="circle" data-act="share-app" aria-label="Share Golden Hour">${SP.share}</button></div>
      <header class="screenhead"><h1>Golden Hour Places</h1><p>Where to watch the sunset near ${esc(p.name)}${p.sample ? ' (sample)' : ''}</p></header>
      ${lists}
      <section class="card spotcard a-own"><p class="eyebrow">${SP.heart}<span>Your spots</span></p><p class="catsub">Places you love to watch from. Only on this device.</p>
        ${mine.length ? mine.map((x) => spotRow(x, p)).join('') : '<p class="small muted">None yet.</p>'}
        <div class="row" data-gap><button type="button" class="btn white" data-act="spot-add" data-place="${esc(p.id)}">Add your own spot</button></div></section>
      <p class="small credit">${p.sample ? 'Sample places. ' : ''}From OpenStreetMap: well-known places, and places named for the sunset, come first. Effort is estimated from how high a place is above ${esc(p.name)}.</p>`;
  }

  /** One place, the whole screen: what it is, how to get there, tonight's sunset, and what to do next. */
  function spotView() {
    const v = S.view, p = place(v.placeId) || place(), sp = v.spot, own = sp.cat === 'own', saved = S.spots.some((x) => x.id === sp.id || (Math.abs(x.lat - sp.lat) < 1e-4 && Math.abs(x.lon - sp.lon) < 1e-4));
    const km = G.distance(p.lat, p.lon, sp.lat, sp.lon) / 1000, travel = G.travelMinutes(km), ev = shownEvening(p), r = ev.rating;
    setSky(r, ev.x, p.id + ev.date);
    const effort = own ? 'Your spot' : sp.cat === 'dining' ? 'May need a booking' : EFFORT[sp.effort] || '';
    const facts = [];
    facts.push(`${km < 0.2 ? 'Right here' : `${esc(G.distanceText(km, settings.imperialFirst))} from ${esc(p.name)}, about ${travel} min by car`}.`);
    if (sp.ele != null) facts.push(`Elevation ${Math.round(sp.ele * 3.28084).toLocaleString('en-US')} ft · ${Math.round(sp.ele).toLocaleString('en-US')} m${sp.gain != null ? `, ${Math.round(sp.gain * 3.28084).toLocaleString('en-US')} ft · ${Math.round(sp.gain).toLocaleString('en-US')} m above ${esc(p.name)}` : ''}.`);
    if (sp.faces === true) facts.push('Faces the sunset.');
    if (sp.faces === false) facts.push('Faces away from the sunset: look for a clear view west.');
    if (sp.hours) facts.push(`Hours: ${esc(sp.hours)}. Check before you go.`);
    else if (sp.cat === 'dining') facts.push('Opening hours unknown. Check before you go, and book for an hour before sunset.');
    if (sp.fee === 'yes') facts.push('There may be a fee.');
    if (sp.dog === 'yes') facts.push('Dogs allowed.'); else if (sp.dog === 'no') facts.push('No dogs.');
    if (sp.wheelchair === 'yes') facts.push('Step-free access.');
    const tonight = r ? `<section class="card"><p class="eyebrow">${TI.colour}<span>${esc(evLabel(ev, p, evenings(p)))} here</span></p>
        <div class="tonight"><span class="big num">${scoreText(r)}</span><span class="tl2">${stars(r.tier === 'outlook' ? r.shown : r.score, r.tier === 'outlook', true)}<b class="c-${r.colourClass.toLowerCase()}">${r.colourClass} colour</b><span class="v ${r.verdict}">${icon(r)}${r.verdictWord}</span></span></div>
        <p class="small muted">Sunset ${esc(timeText(ev.times.sunset, p.tz))}. ${esc(r.reason)}${km > 15 ? ` Forecast for ${esc(p.name)}.` : ''}</p></section>` : '';
    const links = [sp.website ? `<a class="btn" href="${esc(sp.website)}" target="_blank" rel="noopener">Website</a>` : '', sp.phone ? `<a class="btn" href="tel:${esc(sp.phone.replace(/[^\d+]/g, ''))}">Call to book</a>` : ''].join('');
    return `<div class="row top"><button type="button" class="btn quiet back" data-act="close-view">‹ ${v.from === 'all' ? 'Golden Hour Places' : esc(p.name)}</button><span class="sp"></span>
        <button type="button" class="circle" data-act="share-spot" aria-label="Share ${esc(sp.name)}">${SP.share}</button></div>
      <section class="hero spothero"><span class="sbadge big c-${sp.cat} k-${kindIconName(sp)}" aria-hidden="true">${kindIcon(sp)}</span><h2>${esc(sp.name)}</h2><p class="when">${esc(sp.kind || G.SPOT_CAT[sp.cat] || 'Your spot')} · ${esc(effort)}</p>${v.shared ? '<p class="when">Shared with you</p>' : ''}</section>
      <div class="cta row center"><button type="button" class="btn primary" data-act="spot-plan">Plan this evening here</button><a class="btn white" target="_blank" rel="noopener" href="${esc(directionsUrl(sp))}">${SP.car}Directions</a></div>
      <div class="two"><div class="col">
        <section class="card"><p class="eyebrow">${SP.landmark}<span>Where</span></p><div class="map" id="map"><div class="msg">Loading the map…</div></div></section>
        ${tonight}
      </div><div class="col">
        <section class="card"><p class="eyebrow">${catIcon(sp.cat)}<span>About this place</span></p><ul class="facts">${facts.filter(Boolean).map((f) => `<li><span>${f}</span></li>`).join('')}</ul>
          ${!own && !sp.sample ? `<p class="small muted" data-gap>${esc(G.spotReason(sp))}. From OpenStreetMap.</p>` : ''}${links ? `<div class="row" data-gap>${links}</div>` : ''}</section>
        <section class="card"><div class="row"><button type="button" class="btn" data-act="share-spot">${SP.share}Share this place</button><span class="sp"></span>
          ${own ? `<button type="button" class="btn quiet danger" data-act="spot-del">Remove</button>` : saved ? '<span class="small muted">In your spots</span>' : `<button type="button" class="btn" data-act="spot-save">${SP.heart}Save to your spots</button>`}</div></section>
      </div></div>`;
  }

  /** Add your own spot: a name, a kind, and a pin. */
  function addSpotView() {
    const v = S.view, dr = v.draft, p = place(v.placeId);
    skyOf(p);
    const coords = dr.spot.lat != null ? `${dr.spot.lat.toFixed(5)}, ${dr.spot.lon.toFixed(5)}` : '';
    return `<div class="row top"><button type="button" class="btn quiet back" data-act="close-view">‹ Golden Hour Places</button></div>
      <header class="screenhead"><h1>Your own spot</h1><p>Somewhere you love to watch the sunset</p></header>
      <section class="card"><div class="map" id="map"><div class="msg">Loading the map…</div></div>
        <div class="row" data-gap><button type="button" class="btn" data-act="pin-here">Pin my location</button></div>
        <div class="form" data-gap>
          <label class="wide">Name<input id="spotName" maxlength="60" value="${esc(dr.spot.name)}" placeholder="The bench above the lake" autocomplete="off"></label>
          <label>Kind of place<select id="spotType">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${dr.spot.type === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Coordinates<input id="coords" value="${esc(coords)}" placeholder="Tap the map, or type 39.7392, -104.9903" autocomplete="off"></label>
        </div>
        <div class="cta"><button type="button" class="btn primary" data-act="spot-create"${dr.spot.lat == null ? ' disabled' : ''}>Save spot</button></div></section>`;
  }
  const KIND_OF_TYPE = { outdoor: 'Open ground', water: 'Waterside', peak: 'Summit or viewpoint', venue: 'Restaurant or bar' };
  const TYPE_OF_SPOT = (s) => (s.cat === 'dining' ? 'venue' : s.kind === 'Beach' || s.kind === 'Pier' ? 'water' : s.cat === 'adventurous' || s.kind === 'Viewpoint' ? 'peak' : s.type || 'outdoor');
  const WALK_OF_SPOT = (s) => (s.cat === 'dining' ? 0 : s.effort === 'high' ? 45 : s.effort === 'medium' ? 20 : 5);

  // ---------- Sharing: today's sunset, a place, the app ----------
  const appUrl = () => location.origin + location.pathname;
  async function shareOut(o) {
    try {
      if (o.file && navigator.canShare && navigator.canShare({ files: [o.file] })) { await navigator.share({ files: [o.file], title: o.title, text: `${o.text}\n${o.url}` }); return; }
      if (navigator.share) { await navigator.share({ title: o.title, text: o.text, url: o.url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${o.text}\n${o.url}`); toast('Copied to share'); } catch { window.prompt('Copy and share', `${o.text}\n${o.url}`); }
  }
  /** Today's sunset as a picture: the evening's sky, the score, and the times, ready for a message. */
  async function sunsetCard(p, ev) {
    const r = ev.rating, W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), stops = skyStops(r), grad = g.createLinearGradient(0, 0, 0, H);
    [0, 0.46, 0.72, 0.9, 1].forEach((o, i) => grad.addColorStop(o, stops[i]));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    if (r && !r.cap) { const rg = g.createRadialGradient(W / 2, H * 0.96, 0, W / 2, H * 0.96, 420); rg.addColorStop(0, 'rgba(255,240,200,.9)'); rg.addColorStop(0.25, 'rgba(255,214,150,.5)'); rg.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
    try { await document.fonts.load('200 100px Inter'); await document.fonts.load('600 40px Inter'); } catch { /* system font */ }
    const font = (w, s) => `${w} ${s}px Inter, -apple-system, system-ui, sans-serif`;
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 16;
    g.font = font(500, 40); g.globalAlpha = 0.9; g.fillText(`${evLabel(ev, p, evenings(p)).toUpperCase()} · ${dayName(ev.date, true).toUpperCase()}, ${dateText(ev.date).toUpperCase()}`, W / 2, 170);
    g.globalAlpha = 1; g.font = font(400, 92); g.fillText(p.name, W / 2, 290);
    if (r) {
      g.font = font(200, 330); g.fillText(scoreText(r), W / 2 - 50, 640);
      g.font = font(300, 96); g.globalAlpha = 0.75; g.textAlign = 'left'; g.fillText('/ 5', W / 2 + 190, 640); g.globalAlpha = 1; g.textAlign = 'center';
      // Five stars, filled to the score.
      const star = (cx, cy, rad) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? rad * 0.45 : rad; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); };
      const val = r.tier === 'outlook' ? r.shown : r.score;
      for (let i = 0; i < 5; i++) {
        const cx = W / 2 + (i - 2) * 92, cy = 730;
        g.shadowBlur = 0; star(cx, cy, 36); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();
        const f = Math.max(0, Math.min(1, val - i));
        if (f > 0) { g.save(); g.beginPath(); g.rect(cx - 36, cy - 40, 72 * f, 80); g.clip(); star(cx, cy, 36); g.fillStyle = '#F4B860'; g.fill(); g.restore(); }
      }
      g.shadowBlur = 16; g.fillStyle = '#FFE3B5'; g.font = font(600, 64); g.fillText(`${r.colourClass} colour · ${r.colour}`, W / 2, 870);
      g.fillStyle = '#fff'; g.font = font(500, 54); g.fillText(r.verdict === 'go' ? 'Go' : r.verdict === 'maybe' ? 'Maybe' : 'Skip', W / 2, 950);
    }
    if (ev.times.sunset != null) { g.font = font(500, 46); g.globalAlpha = 0.95; g.fillText(`Sunset ${timeText(ev.times.sunset, p.tz)} · best light ${timeText(ev.times.bestStart, p.tz)}`, W / 2, 1060); }
    g.globalAlpha = 0.9; g.font = font(600, 40); g.fillText('Golden Hour', W / 2, H - 120); g.font = font(400, 32); g.fillText(appUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, H - 70);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return blob ? new File([blob], `golden-hour-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, { type: 'image/png' }) : null;
  }
  const locationLink = (p) => `${appUrl()}#l=${encodeURIComponent([p.name, p.lat.toFixed(4), p.lon.toFixed(4), p.tz || ''].join('~'))}`;
  async function shareToday(p) {
    const ev = shownEvening(p), r = ev.rating, label = evLabel(ev, p, evenings(p));
    const line = r ? `${label}'s sunset in ${p.name}: ${scoreText(r)}/5, ${r.colourClass.toLowerCase()} colour. ${r.verdict === 'go' ? 'Worth going out for.' : r.verdict === 'maybe' ? 'Could be good.' : 'One to skip.'}` : `${label}'s sunset in ${p.name}.`;
    const times = ev.times.sunset != null ? ` Sunset ${timeText(ev.times.sunset, p.tz)}, best light from ${timeText(ev.times.bestStart, p.tz)}.` : '';
    // The picture is made ahead of time (see prepareCard): a phone only lets the share sheet open straight from
    // the tap, so there is no time to draw it then.
    const file = cardCache.key === cardKey(p, ev) ? cardCache.file : null;
    await shareOut({ title: 'Golden Hour', text: `${line}${times} From Golden Hour.`, url: locationLink(p), file });
    if (!file) prepareCard(p);
  }
  const cardCache = { key: null, file: null };
  const cardKey = (p, ev) => `${p.id}|${ev.date}|${ev.rating ? ev.rating.score : ''}|${settings.imperialFirst}`;
  let cardTimer = 0;
  /** Draws the share picture for the place on screen, a moment after it settles. */
  function prepareCard(p) {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(async () => {
      const ev = shownEvening(p), key = cardKey(p, ev);
      if (cardCache.key === key) return;
      try { const file = await sunsetCard(p, ev); cardCache.key = key; cardCache.file = file; } catch { /* text only */ }
    }, 600);
  }
  async function shareSpot(sp, p) {
    const url = `${appUrl()}#s=${G.encodeSpot(sp)}`, ev = shownEvening(p), r = ev.rating;
    const tonight = r && G.distance(p.lat, p.lon, sp.lat, sp.lon) < 30000 ? ` Tonight's sunset there: ${scoreText(r)}/5, at ${timeText(ev.times.sunset, p.tz)}.` : '';
    await shareOut({ title: sp.name, text: `${sp.name}: a great place to watch the sunset${p ? ` near ${p.name}` : ''}.${tonight} Found with Golden Hour.`, url });
  }
  const shareApp = () => shareOut({ title: 'Golden Hour', text: 'Golden Hour: which evenings are worth it for the sunset, where to watch from, and a plan to share. Free, no account.', url: appUrl() });

  // ---------- Plan actions ----------
  function newDraft(date) {
    const p = place();
    return { id: null, saved: false, placeId: p.id, tz: p.tz, date, spot: { name: '', type: 'outdoor', lat: null, lon: null }, walkIn: 5,
      start: { lat: p.lat, lon: p.lon, label: p.name, kind: 'place' }, items: [], mapImage: null };
  }
  function setPin(lat, lon) {
    const dr = S.view.draft;
    dr.spot.lat = Math.round(lat * 1e5) / 1e5; dr.spot.lon = Math.round(lon * 1e5) / 1e5;
    keepFields(); autosave(); render();
  }
  /** Reads the form back into the draft, so a redraw never loses typing. */
  function keepFields() {
    const dr = S.view && S.view.draft;
    if (!dr || !$('#spotName')) return;
    dr.spot.name = $('#spotName').value.trim().slice(0, 60);
    dr.spot.type = $('#spotType').value;
    if ($('#walkIn')) dr.walkIn = Math.max(0, Math.min(240, Math.round(Number($('#walkIn').value) || 0)));
  }
  function toPlan(dr) {
    const mo = planModel(dr);
    return { id: dr.id, v: 1, placeId: dr.placeId, tz: mo.tz, spot: { ...dr.spot, name: dr.spot.name || 'Sunset spot' }, date: dr.date, who: null, walkIn: dr.walkIn, travel: mo.travel,
      buffer: mo.buffer, start: dr.start, times: mo.pt, items: mo.items.map((i) => ({ ...i, isNew: false })), scoreAtSave: mo.r ? mo.r.score : null, mapImage: dr.mapImage, createdAt: dr.createdAt || now() };
  }
  async function savePlan() {
    keepFields();
    const dr = S.view.draft, mo = planModel(dr);
    if (!mo.hasPin || !mo.pt) return toast('Drop a pin first');
    if (db.isBlocked()) return toast('Plans can’t be saved in this browser mode');
    if (!dr.id) dr.id = 'p' + now().toString(36) + Math.random().toString(36).slice(2, 6);
    dr.mapImage = mapSnapshot() || dr.mapImage;
    dr.items = mo.items;
    dr.saved = true;
    const plan = toPlan(dr);
    await db.put('plans', plan);
    S.plans = S.plans.filter((x) => x.id !== plan.id).concat(plan);
    render();
    toast('Plan saved. It works offline.');
  }
  function autosave() {
    const dr = S.view && S.view.draft;
    if (!dr || !dr.saved) return;
    const mo = planModel(dr);
    if (!mo.pt) return;
    dr.items = mo.items;
    const plan = toPlan(dr);
    db.put('plans', plan);
    S.plans = S.plans.filter((x) => x.id !== plan.id).concat(plan);
  }
  function openPlan(id) {
    const pl = S.plans.find((x) => x.id === id);
    if (!pl) return;
    if (S.places.some((p) => p.id === pl.placeId)) S.current = pl.placeId;
    S.view = { type: 'plan', draft: { id: pl.id, saved: true, placeId: pl.placeId, tz: pl.tz, date: pl.date, spot: { ...pl.spot }, walkIn: pl.walkIn, start: pl.start, items: pl.items, mapImage: pl.mapImage, createdAt: pl.createdAt } };
    render();
    load(place()).then(render);
  }
  function shareUrl(plan) { return location.origin + location.pathname + '#p=' + G.encodePlan({ ...plan, sharedAt: now() }); }
  async function shareGo() {
    keepFields(); autosave();
    const plan = toPlan(S.view.draft), url = shareUrl(plan);
    S.view.sharing = false;
    render();
    if (url.length > 2000 + location.origin.length + location.pathname.length) return toast('Too many items to fit in a link. Remove a few.');
    const text = `Sunset at ${plan.spot.name}, ${dayName(plan.date, true)}. Meet at ${timeText(plan.times.meetAt, plan.tz)}.`;
    try {
      if (navigator.share) await navigator.share({ title: 'Golden Hour', text, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { window.prompt('Copy this link', url); }
    }
  }
  /** The calendar event: from leave-by for the organiser, from meet-at for someone it was shared with. */
  async function addToCalendar() {
    const shared = S.view.type === 'shared';
    const plan = shared ? S.view.plan : (keepFields(), autosave(), toPlan(S.view.draft));
    const tz = tzOr(plan.tz), t = plan.times, f = (ms) => timeText(ms, tz);
    const link = shared ? location.href : shareUrl(plan);
    const lines = [];
    if (!shared) lines.push(`Leave by ${f(t.leaveBy)}`);
    lines.push(`Meet at ${f(t.meetAt)}`, `Sunset ${f(t.sunset)}`, `Stay until ${f(t.stayUntil)} for the afterglow`, `Head back by ${f(t.headBackBy)}`);
    if (plan.items.length) lines.push('', 'Bring: ' + plan.items.map((i) => (i.who ? `${i.name} (${i.who})` : i.name)).join(', '));
    lines.push('', link);
    const text = G.ics({ id: plan.id || 'shared-' + plan.date, now: now(), start: shared ? t.meetAt : t.leaveBy, end: t.headBackBy, title: `Sunset at ${plan.spot.name}`,
      location: `${plan.spot.name} (${plan.spot.lat.toFixed(5)}, ${plan.spot.lon.toFixed(5)})`, description: lines.join('\n') });
    const file = new File([text], 'golden-hour.ics', { type: 'text/calendar' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Sunset at ${plan.spot.name}` }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = 'golden-hour.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Calendar file downloaded');
  }

  // ---------- Places: search, location ----------
  let cityList = null, searchTimer = 0, searchSeq = 0;
  async function cities() {
    if (!cityList) cityList = (await (await fetch('cities.tsv')).text()).split('\n').map((l) => l.split('\t')).filter((c) => c.length >= 6);
    return cityList;
  }
  const countryName = (code) => { try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(code) || code; } catch { return code; } };
  function onSearchInput(e) {
    const q = e.target.value.trim(), seq = ++searchSeq;
    clearTimeout(searchTimer);
    if (q.length < 2) { S.results = null; return drawResults(); }
    searchTimer = setTimeout(async () => {
      let out = null;
      try {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' }), { signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error('search');
        out = ((await r.json()).results || []).map((c) => ({ name: c.name, region: [c.admin1, c.country].filter(Boolean).join(', '), lat: c.latitude, lon: c.longitude, tz: c.timezone }));
      } catch {
        try {
          const ql = q.toLowerCase();
          out = (await cities()).filter((c) => c[0].toLowerCase().startsWith(ql) || c[1].toLowerCase().startsWith(ql)).slice(0, 6)
            .map((c) => ({ name: c[0], region: [c[2], countryName(c[3])].filter(Boolean).join(', '), lat: Number(c[4]), lon: Number(c[5]), tz: null }));
        } catch { out = 'Search needs a connection.'; }
      }
      if (seq !== searchSeq) return;
      S.results = Array.isArray(out) && !out.length ? 'No places found.' : out;
      drawResults();
    }, 250);
  }
  /** A fixed-offset zone from the longitude, for a place found offline (no zone in the bundled list). */
  const roughTz = (lon) => { const h = Math.round(lon / 15); return h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`; };
  async function addPlace(r, here) {
    if (S.places.filter((p) => !p.sample).length >= 20) return toast('Twenty places at most. Remove one first.');
    const id = here ? 'here' : `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`;
    const p = { id, name: r.name, region: r.region || '', lat: r.lat, lon: r.lon, tz: validTz(r.tz) ? r.tz : here ? deviceTz() : roughTz(r.lon), here: !!here };
    for (const s of S.places.filter((x) => x.sample)) db.del('places', s.id);
    S.places = S.places.filter((x) => x.id !== id && !x.sample).concat(p);
    await db.put('places', p);
    S.results = null; S.editing = false;
    goTo(id);
  }
  function locate(then) {
    if (!navigator.geolocation) return toast('Search for a place instead.');
    navigator.geolocation.getCurrentPosition((pos) => then(pos.coords.latitude, pos.coords.longitude),
      () => toast('Search for a place instead.'), { timeout: 12000, maximumAge: 5 * MIN });
  }
  async function nameNear(lat, lon) {
    try {
      const k = Math.cos(lat * Math.PI / 180);
      let best = null, bestD = Infinity;
      for (const c of await cities()) { const dy = c[4] - lat; let dx = Math.abs(c[5] - lon); if (dx > 180) dx = 360 - dx; const d = dy * dy + (dx * k) ** 2; if (d < bestD) { bestD = d; best = c; } }
      if (best && Math.sqrt(bestD) * 111 <= 60) return { name: best[0], region: [best[2], countryName(best[3])].filter(Boolean).join(', ') };
    } catch { /* no list */ }
    return { name: 'My location', region: '' };
  }

  // ---------- Events ----------
  const ACT = {
    units(el) { settings.imperialFirst = el.dataset.v === 'imperial'; store.set('imperialFirst', settings.imperialFirst); keepFields(); render(); },
    search() {},
    goto(el) { goTo(el.dataset.id, !S.view); },
    'share-today'() { shareToday(place()); },
    'share-app'() { shareApp(); },
    'share-spot'() { shareSpot(S.view.spot, place(S.view.placeId) || place()); },
    'spots-all'(el) { S.view = { type: 'spots', placeId: el.dataset.place || S.current, expanded: {} }; render(); },
    'spots-more'(el) { S.view.expanded[el.dataset.k] = !S.view.expanded[el.dataset.k]; render(); },
    async 'spots-retry'() { const p = place(S.view && S.view.placeId); DATA[p.id].spots = null; update(p); await loadSpots(p); update(p); if (S.view) render(); },
    'spot-open'(el) {
      const p = place(el.dataset.place), sp = findSpot(p, el.dataset.id);
      if (!sp) return;
      S.view = { type: 'spot', spot: sp, placeId: p.id, from: S.view && S.view.type === 'spots' ? 'all' : 'page', back: S.view };
      render();
    },
    'spot-plan'() {
      const v = S.view, sp = v.spot, p = place(v.placeId) || place(), ev = shownEvening(p);
      S.current = p.id;
      const dr = newDraft(ev.date);
      dr.spot = { name: sp.name, type: TYPE_OF_SPOT(sp), lat: sp.lat, lon: sp.lon };
      dr.walkIn = WALK_OF_SPOT(sp);
      S.view = { type: 'plan', draft: dr };
      render();
    },
    async 'spot-save'() {
      const sp = S.view.spot, own = { id: 'own-' + now().toString(36), name: sp.name, cat: 'own', kind: sp.kind || 'Your spot', rooftop: !!sp.rooftop, type: TYPE_OF_SPOT(sp), lat: sp.lat, lon: sp.lon, ele: sp.ele == null ? null : sp.ele, createdAt: now() };
      if (db.isBlocked()) return toast('Spots can’t be saved in this browser mode');
      S.spots.push(own); await db.put('spots', own); render(); toast('Saved to your spots');
    },
    async 'spot-del'() {
      if (!window.confirm('Remove this spot?')) return;
      const id = S.view.spot.id; S.spots = S.spots.filter((x) => x.id !== id); await db.del('spots', id);
      S.view = { type: 'spots', placeId: S.view.placeId, expanded: {} }; render();
    },
    'spot-add'(el) { S.view = { type: 'addspot', placeId: el.dataset.place || S.current, draft: { spot: { name: '', type: 'outdoor', lat: null, lon: null } } }; render(); },
    async 'spot-create'() {
      keepFields();
      const v = S.view, sp = v.draft.spot;
      if (sp.lat == null) return toast('Drop a pin first');
      if (db.isBlocked()) return toast('Spots can’t be saved in this browser mode');
      const own = { id: 'own-' + now().toString(36), name: sp.name || 'My sunset spot', cat: 'own', kind: KIND_OF_TYPE[sp.type] || 'Your spot', type: sp.type, lat: sp.lat, lon: sp.lon, createdAt: now() };
      S.spots.push(own); await db.put('spots', own);
      S.view = { type: 'spots', placeId: v.placeId, expanded: {} }; render(); toast('Spot saved');
    },
    'open-list'() { S.view = { type: 'list' }; S.results = null; render(); loadAll(); },
    'open-plans'() { S.view = { type: 'plans' }; render(); },
    'add-place'() { S.view = { type: 'list' }; S.results = null; S.focusSearch = true; render(); },
    edit() { S.editing = !S.editing; render(); },
    async remove(el) {
      const id = el.dataset.id;
      S.places = S.places.filter((p) => p.id !== id); await db.del('places', id);
      delete DATA[id];
      if (S.current === id) { S.current = S.places[0].id; store.set('current', S.current); }
      if (S.places.length < 2) S.editing = false;
      render();
    },
    add(el) { const r = S.results[Number(el.dataset.i)]; if (r) addPlace(r); },
    locate() { locate(async (lat, lon) => { const n = await nameNear(lat, lon); addPlace({ ...n, lat, lon, tz: deviceTz() }, true); }); },
    async retry() { const p = place(); DATA[p.id].error = null; update(p); await load(p, true); update(p); },
    day(el) { const p = place(); S.dayBy[p.id] = el.dataset.day === '' ? null : Number(el.dataset.day); update(p); const pg = $$('.page').find((x) => x.dataset.id === p.id); if (pg) pg.scrollTo({ top: 0 }); },
    cell(el) { S.dayBy[el.dataset.id] = Number(el.dataset.day); scrolls[el.dataset.id] = 0; goTo(el.dataset.id); },
    compare() { settings.compare = !settings.compare; store.set('compare', settings.compare); render(); if (settings.compare) loadAll(); },
    async rate(el) {
      const p = place(), date = el.dataset.date, v = Number(el.dataset.v), rec = DATA[p.id].logged[date];
      const r = { placeId: p.id, date, predicted: rec.score, parts: rec.parts, observed: v || null, at: now() };
      S.ratings.push(r); await db.put('ratings', r);
      update(p); toast(v ? 'Thanks. Saved to your sunset log.' : 'Noted.');
    },
    log() { S.view = { type: 'log' }; render(); },
    async 'copy-log'() { try { await navigator.clipboard.writeText(JSON.stringify(S.ratings, null, 1)); toast('Log copied'); } catch { toast('Couldn’t copy'); } },
    'close-view'() { keepFields(); autosave(); const v = S.view; S.view = v && v.type === 'plan' && v.draft.saved ? { type: 'plans' } : v && v.type === 'spot' && v.back ? v.back : v && v.type === 'addspot' ? { type: 'spots', placeId: v.placeId, expanded: {} } : null; S.editing = false; render(); },
    'plan-new'(el) { S.view = { type: 'plan', draft: newDraft(el.dataset.date) }; render(); },
    'plan-open'(el) { openPlan(el.dataset.id); },
    'plan-save'() { savePlan(); },
    async 'plan-del'() {
      if (!window.confirm('Delete this plan?')) return;
      const id = S.view.draft.id;
      S.plans = S.plans.filter((p) => p.id !== id); await db.del('plans', id);
      S.view = { type: 'plans' }; render();
    },
    'pin-here'() { locate((lat, lon) => setPin(lat, lon)); },
    'pin-place'() { const p = place(S.view.draft.placeId); setPin(p.lat, p.lon); },
    'start-here'() { locate((lat, lon) => { keepFields(); S.view.draft.start = { lat, lon, label: 'my location', kind: 'here' }; autosave(); render(); }); },
    'start-place'() { const p = place(S.view.draft.placeId); keepFields(); S.view.draft.start = { lat: p.lat, lon: p.lon, label: p.name, kind: 'place' }; autosave(); render(); },
    tick(el) { keepFields(); const dr = S.view.draft, items = planModel(dr).items; items[Number(el.dataset.i)].done = el.checked; items[Number(el.dataset.i)].isNew = false; dr.items = items; autosave(); render(); },
    'item-add'() {
      const name = $('#newItem').value.trim().slice(0, 40);
      if (!name) return;
      keepFields();
      const dr = S.view.draft, items = planModel(dr).items;
      if (items.filter((i) => i.custom).length >= 10) return toast('Ten of your own items at most.');
      items.push({ id: 'c' + now().toString(36), name, custom: true, done: false });
      dr.items = items; autosave(); render();
    },
    'item-del'(el) { keepFields(); const dr = S.view.draft, items = planModel(dr).items; items.splice(Number(el.dataset.i), 1); dr.items = items; autosave(); render(); },
    share() { keepFields(); S.view.sharing = true; render(); const n = $('#shareNotice'); if (n) n.scrollIntoView({ block: 'center' }); },
    'share-cancel'() { S.view.sharing = false; render(); },
    'share-go'() { shareGo(); },
    calendar() { addToCalendar(); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = ACT[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.act === 'tick') return ACT.tick(t);
    if (t.id === 'spotType' || t.id === 'walkIn' || t.id === 'spotName') { keepFields(); autosave(); render(); }
    if (t.id === 'coords') {
      const m = t.value.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
      if (m && Math.abs(m[1]) <= 90 && Math.abs(m[2]) <= 180) setPin(Number(m[1]), Number(m[2]));
      else if (t.value.trim()) toast('Type a latitude and longitude, like 39.7392, -104.9903');
    }
    if (t.dataset && t.dataset.actInput === 'who') {
      keepFields();
      const dr = S.view.draft, items = planModel(dr).items;
      items[Number(t.dataset.i)].who = t.value.trim().slice(0, 24);
      dr.items = items; autosave();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'newItem') return ACT['item-add']();
    if (S.view || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const next = S.places[S.places.findIndex((p) => p.id === S.current) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) goTo(next.id, true);
  });
  window.addEventListener('resize', () => { const pager = $('#pager'); if (pager) pager.scrollLeft = Math.max(0, S.places.findIndex((p) => p.id === S.current)) * pager.clientWidth; });

  async function loadAll() {
    for (const p of S.places.slice()) { const d = DATA[p.id]; if (!d || !d.fc || now() - d.fetchedAt > 3 * HOUR) { await load(p); update(p); } }
  }

  // ---------- Keeping current: every 30 minutes while open, and on coming back to the tab ----------
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    if (S.view && S.view.type !== 'list') return;
    const p = place();
    if (!p) return;
    const d = DATA[p.id];
    if (!d || !d.fc || now() - d.fetchedAt >= 30 * MIN || p.sample) { await load(p, true); update(p); }
  }
  setInterval(refresh, MIN);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', () => { refresh(); });
  window.addEventListener('offline', drawBanner);

  // ---------- The service worker: the app shell offline; a new version waits until asked ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
    navigator.serviceWorker && navigator.serviceWorker.register('sw.js').then((reg) => {
      const offer = (w) => toast('Update ready.', 'Reload', () => w.postMessage('skip'));
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    }).catch(() => { /* the app works without it */ });
  }

  // ---------- Start ----------
  async function openShared(hash) {
    const plan = G.decodePlan(hash.slice(3));
    S.view = { type: 'shared', plan, live: null };
    render();
    if (!plan) return;
    try {
      const r = await fetchForecast(plan.spot.lat, plan.spot.lon);
      const x = G.inputsAt(r.fc.p0, r.fc.up, r.fc.aq, plan.times.sunset);
      if (x) {
        const day = Math.round((Date.UTC(...ymd(plan.date)) - Date.UTC(...ymd(localDate(now(), plan.tz)))) / DAY);
        if (day >= 0 && day <= 5) { S.view.live = G.rate(x, { day, normal: null, imperialFirst: settings.imperialFirst, spotType: plan.spot.type }); render(); }
      }
    } catch { /* the plan still shows without a live score */ }
  }
  async function start() {
    await db.ready;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (location.hash.startsWith('#p=')) return openShared(location.hash);
    const incoming = location.hash;
    if (/^#[ls]=/.test(incoming)) history.replaceState(null, '', location.pathname + location.search);
    const [places, plans, ratings, cached, spots] = await Promise.all([db.all('places'), db.all('plans'), db.all('ratings'), db.all('cache'), db.all('spots')]);
    S.spots = spots || [];
    for (const c of cached || []) if (now() - c.fetchedAt > (/overpass/.test(c.url) ? 15 : 3) * DAY) db.del('cache', c.url);
    S.places = (places || []).filter((p) => !p.sample);
    if (!S.places.length) S.places = [SAMPLE];
    S.plans = plans || []; S.ratings = ratings || [];
    S.current = store.get('current', null);
    if (!S.places.some((p) => p.id === S.current)) S.current = S.places[0].id;
    if (incoming.startsWith('#l=')) {
      const [name, lat, lon, tz] = decodeURIComponent(incoming.slice(3)).split('~');
      if (name && Number.isFinite(+lat) && Number.isFinite(+lon) && Math.abs(+lat) <= 90 && Math.abs(+lon) <= 180) { await addPlace({ name: name.slice(0, 60), region: '', lat: +lat, lon: +lon, tz }); toast(`${name.slice(0, 60)} added. Swipe for your other locations.`); return; }
    }
    if (incoming.startsWith('#s=')) {
      const sp = G.decodeSpot(incoming.slice(3));
      if (sp) { const near = S.places.slice().sort((a, b) => G.distance(a.lat, a.lon, sp.lat, sp.lon) - G.distance(b.lat, b.lon, sp.lat, sp.lon))[0];
        if (near) S.current = near.id;
        S.view = { type: 'spot', spot: { ...sp, id: 'shared/' + sp.lat + ',' + sp.lon }, placeId: S.current, shared: true }; }
    }
    const p = place();
    if (p.sample) await load(p);
    render();
    await loadLogged(p); await load(p);
    update(p);
    for (const q of S.places) if (q !== p && Math.abs(S.places.indexOf(q) - S.places.indexOf(p)) === 1) load(q).then(() => update(q));   // the pages either side, ready to swipe to
  }
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#p=')) openShared(location.hash); });
  window.__gh = { S, DATA, settings, render, db, card: () => sunsetCard(place(), shownEvening(place())) };   // read by tests/web.test.js
  start();
})();
