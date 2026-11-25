/* Golden Hour: the interface. The rules live in core.js (GH); this file fetches, stores and draws.
   Release 1 of docs/SPEC.md: places, the star rating, "How was it?", times, the week, compare, a plan for one
   pinned spot, what to bring, offline, the share link and the calendar file. */
(function () {
  'use strict';
  const G = window.GH;
  const VERSION = '0.10.0';
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
  // view: the screen under the bar (null = Today's pager, or plans, plan, list, spots, addspot, shared).
  // sheet: what is open over it (a day, a place, settings, the place picker for a new plan).
  const S = { places: [], current: null, sheet: null, view: null, plans: [], ratings: [], spots: [], results: null, notice: null, editing: false, filters: {} };
  const DATA = {};   // placeId → {fc, source: 'live' | 'cache' | 'sample', fetchedAt, error, ceiling, spots, near, prev: {date → {score, at}}, snaps: {date → snap}}
  const SAMPLE = { id: 'sample', name: 'Denver', region: 'Colorado', lat: 39.7392, lon: -104.9903, tz: 'America/Denver', sample: true };
  const place = (id) => S.places.find((p) => p.id === (id || S.current)) || S.places[0];

  // ---------- Status: what the app last asked for and what came back (Settings, Status) ----------
  const STATUS = store.get('status', []);
  function note(what, ok, detail, t0) {
    STATUS.unshift({ what, ok: !!ok, detail: String(detail || '').slice(0, 140), at: now(), ms: t0 ? now() - t0 : null });
    STATUS.length = Math.min(STATUS.length, 30);
    store.set('status', STATUS);
  }
  const why = (e) => (e && e.name === 'TimeoutError' ? 'timed out' : e && e.name === 'AbortError' ? 'timed out' : !navigator.onLine ? 'offline' : (e && e.message) || 'failed');

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
  async function getJSON(url, ttl, weight, counts, what) {
    const hit = await db.get('cache', url);
    if (hit && now() - hit.fetchedAt < ttl) return { body: hit.body, fetchedAt: hit.fetchedAt };
    if (counts !== false && budget(0) + weight > CEILING) {
      if (hit) return { body: hit.body, fetchedAt: hit.fetchedAt, stale: true, ceiling: true };
      const e = new Error('ceiling'); e.ceiling = true; throw e;
    }
    const t0 = now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const body = await r.json();
      if (counts !== false) budget(weight);
      const rec = { url, body, fetchedAt: now() };
      db.put('cache', rec);
      if (what) note(what, true, 'OK', t0);
      return rec;
    } catch (e) {
      if (what) note(what, false, why(e) + (hit ? ', showing the saved copy' : ''), t0);
      if (hit) return { body: hit.body, fetchedAt: hit.fetchedAt, stale: true };
      throw e;
    }
  }

  /** A question for the open map (Overpass). One 45-second budget across both sources; an answer marked as an
      error, or (unless allowed) with nothing in it, counts as a failure and is never kept. */
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const PLACES_BUDGET = 45000;
  async function overpass(q, what, ttl, allowEmpty) {
    const key = 'overpass:' + q;
    const hit = await db.get('cache', key);
    if (hit && now() - hit.fetchedAt < ttl) return hit.body;
    const t0 = now(), deadline = t0 + PLACES_BUDGET;
    let last = 'no answer';
    for (let i = 0; i < OVERPASS.length; i++) {
      const left = deadline - now();
      if (left < 2000) break;
      try {
        const r = await fetch(`${OVERPASS[i]}?data=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(i === 0 ? Math.min(left, 30000) : left) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const body = await r.json();
        if (body && body.remark) throw new Error('the map service reported a problem');
        if (!body || !Array.isArray(body.elements) || (!allowEmpty && !body.elements.length)) throw new Error('nothing in the answer');
        db.put('cache', { url: key, body, fetchedAt: now() });
        note(what, true, `${body.elements.length} found`, t0);
        return body;
      } catch (e) { last = why(e); }
    }
    note(what, false, last, t0);
    throw new Error(last);
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
    const [a, b] = await Promise.all([getJSON(p0Url, 30 * MIN, 1, true, 'Forecast'), getJSON(upUrl, 30 * MIN, 4, true, 'Forecast toward the sunset')]);
    const c = await getJSON(aqUrl, HOUR, 1, true, 'Air quality').catch(() => null);
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
  /** One evening at a place: its times (exact for any date) and, within five days when a forecast covers it, its rating.
      opts: {fc, normal, spotType, at: {lat, lon}} to rate somewhere other than the place itself. */
  function eveningOn(p, date, opts) {
    const o = opts || {}, d = DATA[p.id], fc = o.fc !== undefined ? o.fc : d && d.fc, at = o.at || p;
    const today = localDate(now(), p.tz), [y, m, dd] = ymd(date);
    const day = Math.round((Date.UTC(y, m, dd) - Date.UTC(...ymd(today))) / DAY);
    const times = G.eveningTimes(G.solarNoonGuess(y, m + 1, dd, at.lon), at.lat, at.lon);
    let rating = null, x = null;
    if (day >= 0 && day <= 5 && fc && times.state !== 'none') {
      x = G.inputsAt(fc.p0, fc.up, fc.aq, times.sunset);
      if (x) rating = G.rate(x, { day, normal: o.normal !== undefined ? o.normal : G.eveningNormal(p.normals, date), imperialFirst: settings.imperialFirst, spotType: o.spotType });
    }
    return { date, day, times, rating, x };
  }
  /** Ten evenings from today, in the place's own calendar; the first six rated when the forecast covers them. */
  function evenings(p, opts) {
    const today = localDate(now(), p.tz), out = [];
    for (let i = 0; i < 10; i++) out.push(eveningOn(p, addDays(today, i), opts));
    return out;
  }
  /** When an evening is over: last light, or local midnight when twilight lasts all night. */
  const endOf = (ev, p) => (ev.times.state === 'ok' ? ev.times.lastLight : startOfDay(addDays(ev.date, 1), p.tz));
  /** Which evening "Tonight" shows: today's until it is over, then tomorrow's. */
  function focusDay(p, evs) { return now() > endOf(evs[0], p) ? 1 : 0; }
  /** The next evening after this one worth going out for: the first Go, else the first Maybe. */
  function nextGood(evs, after) {
    const later = evs.filter((e) => e.day > after.day && e.rating);
    return later.find((e) => e.rating.verdict === 'go') || later.find((e) => e.rating.verdict === 'maybe') || null;
  }

  async function load(p, force) {
    const d = DATA[p.id] || (DATA[p.id] = { prev: {}, snaps: {} });
    if (p.sample) {
      const start = startOfDay(addDays(localDate(now(), p.tz), -1), p.tz);
      Object.assign(d, { fc: G.sampleForecast(start, 9 * 24), source: 'sample', fetchedAt: now(), error: null, spots: finishSample(p), near: sampleNear() });
      return;
    }
    // Places never wait on the forecast: they load beside it, and a failed lookup is tried again, at most every two minutes.
    if ((!d.spots || d.spots === 'error') && !d.spotsLoading && now() - (d.spotsTriedAt || 0) > 2 * MIN) loadSpots(p).then(() => update(p));
    if (d.loading) return d.loading;
    if (!force && d.fc && !d.error && now() - d.fetchedAt < 30 * MIN) return;
    d.loading = (async () => {
      try {
        const r = await fetchForecast(p.lat, p.lon);
        const first = d.fetchedAt !== r.fetchedAt;
        Object.assign(d, { fc: r.fc, source: r.stale ? 'cache' : 'live', fetchedAt: r.fetchedAt, error: r.stale && !r.ceiling ? 'stale' : null, ceiling: r.ceiling, elevation: r.elevation });
        if (first) await remember(p);
        if (d.spotsRaw) rankInto(p);   // effort needs the height of the place, which comes with the forecast
      } catch (e) {
        d.error = e && e.ceiling ? 'ceiling' : 'network';
      } finally { d.loading = null; }
    })();
    await d.loading;
    fetchNormals(p); fixZone(p);
  }

  /** A place added offline gets a rough zone from its longitude; the real one, with summer time, once online. */
  async function fixZone(p) {
    if (!p.tzRough || p.sample || p.zoneAsked) return;
    p.zoneAsked = true;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${r2(p.lat)}&longitude=${r2(p.lon)}&daily=sunset&forecast_days=1&timezone=auto`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const tz = (await r.json()).timezone;
      if (validTz(tz) && tz !== 'GMT') { p.tz = tz; delete p.tzRough; delete p.zoneAsked; await db.put('places', p); update(p); }
    } catch { /* tried again next time the app opens */ }
  }

  // ---------- The forecast at a venue: a plan is rated where it happens, the same for whoever opens it ----------
  const VENUE = {};   // "lat,lon" → {fc, fetchedAt, loading, triedAt}
  const venueKey = (s) => `${r2(s.lat)},${r2(s.lon)}`;
  function venueFc(p, spot) {
    const own = p && DATA[p.id] ? DATA[p.id].fc : null;
    if (!spot || spot.lat == null || (p && p.sample)) return own;
    const k = venueKey(spot), v = VENUE[k] || (VENUE[k] = {});
    if (!v.loading && (!v.fc || now() - v.fetchedAt > 30 * MIN) && now() - (v.triedAt || 0) > 2 * MIN) {
      v.triedAt = now();
      v.loading = fetchForecast(spot.lat, spot.lon).then((r) => { v.fc = r.fc; v.fetchedAt = r.fetchedAt; }).catch(() => { /* the location's forecast stands in */ })
        .finally(() => { v.loading = null; if (S.view && (S.view.type === 'plan' || S.view.type === 'plans')) { keepFields(); render(); } });
    }
    return v.fc || own;
  }
  /** The rating of an evening at a venue. No "usual temperature" is used, so everyone sees the same number. */
  function venueEvening(p, spot, date) {
    const at = spot && spot.lat != null ? spot : p;
    const base = p || { id: '-', lat: at.lat, lon: at.lon, tz: deviceTz() };
    return eveningOn(base, date, { fc: venueFc(p, spot), normal: null, spotType: spot && spot.type, at });
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
  function shownEvening(p) { const evs = evenings(p); return evs[focusDay(p, evs)]; }
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
  // Three places to be, always in the bar: Today (one full page per location, swiped between, each on its own
  // evening's sky), Plans and Places. A day, a place and Settings open as sheets over whichever is showing.
  const scrolls = {};   // placeId → how far down its page is scrolled
  const screen = (html) => `<div class="screen"><div class="inner">${html}</div></div>`;
  function dyn(root) {
    for (const el of $$('[data-w]', root)) el.style.width = el.dataset.w + '%';
    for (const el of $$('[data-l]', root)) el.style.left = el.dataset.l + '%';
    for (const el of $$('[data-h]', root)) el.style.height = el.dataset.h + '%';
    for (const el of $$('[data-sky]', root)) { const [t, m, b] = el.dataset.sky.split(','); el.style.background = `linear-gradient(${t}, ${m} 60%, ${b})`; }
  }
  const viewKey = (v) => (!v ? 'today' : v.type + (v.draft && v.draft.id ? v.draft.id : '') + (v.placeId || ''));
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
    const was = $('.screen', v), keep = was && was.dataset.key === viewKey(view) ? was.scrollTop : 0;
    if (view && view.type === 'shared') v.innerHTML = screen(sharedView());
    else if (view && view.type === 'plan') v.innerHTML = screen(planView());
    else if (view && view.type === 'plans') v.innerHTML = screen(plansView());
    else if (view && view.type === 'list') v.innerHTML = screen(listView());
    else if (view && view.type === 'spots') v.innerHTML = screen(spotsView());
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
    const sc = $('.screen', v);
    if (sc) { sc.dataset.key = viewKey(view); sc.scrollTop = keep; }
    drawBar(); drawBanner(); dyn(v);
    drawSheet();
    if (view && view.type === 'list') bindSearch();
    if (view && view.type === 'plan') bindVenueSearch();
    if (view && (view.type === 'plan' || view.type === 'shared' || view.type === 'addspot')) mountMap();
  }
  /** Redraws one place where it stands, so a forecast arriving never disturbs a swipe or what is being typed. */
  function update(p) {
    if (S.view && S.view.type === 'list') {
      const rows = $('#listRows');
      if (rows) { rows.innerHTML = listRows(); dyn($('#view')); }
      return;
    }
    if (S.view && S.view.type === 'spots' && S.view.placeId === p.id) { render(); return; }
    if (S.view && S.view.type === 'plans') { render(); return; }
    if (S.sheet && S.sheet.placeId === p.id && (S.sheet.kind === 'day' || S.sheet.kind === 'pick')) drawSheet();
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
    S.current = id; store.set('current', id);
    if (S.view || S.sheet) go(null); else render();
    const p = place();
    loadLogged(p).then(() => load(p)).then(() => update(p));
  }

  // ---------- Going somewhere and coming back: every screen and sheet is a step Back undoes ----------
  const NAV = [];
  function pushStep() {
    NAV.push({ view: S.view, sheet: S.sheet });
    try { history.pushState({ d: NAV.length }, ''); } catch { /* no history in this frame */ }
  }
  /** Leaving a screen keeps what was typed on it. */
  function leave() { keepFields(); autosave(); dropEmptyDraft(); }
  function go(view) {
    leave(); pushStep();
    S.view = view; S.sheet = null; S.editing = false;
    render();
    const sc = $('.screen'); if (sc) sc.scrollTop = 0;
  }
  function openSheet(sheet) { pushStep(); S.sheet = sheet; drawSheet(true); }
  function popTo(depth) {
    let prev = null;
    while (NAV.length > depth) prev = NAV.pop();
    if (!prev) return;
    leave();
    S.view = prev.view; S.sheet = prev.sheet; S.editing = false;
    render();
  }
  function back() {
    if (NAV.length) { try { history.back(); return; } catch { popTo(NAV.length - 1); return; } }
    if (S.sheet) { S.sheet = null; drawSheet(); return; }
    if (S.view) { leave(); S.view = null; render(); }
  }
  window.addEventListener('popstate', (e) => popTo(e.state && typeof e.state.d === 'number' ? e.state.d : 0));

  const BAR = {
    today: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18M6.500 18a5.500 5.500 0 0 1 11 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 5.500v2.500M5.200 9.200l1.800 1.800M18.800 9.200 17 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    plans: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.500" width="16" height="14.500" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4M8.500 14.500l2.300 2.300 4.700-4.700" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    places: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.500-5.400-6.500-10.500a6.500 6.500 0 0 1 13 0C18.500 15.600 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10.500" r="2.300" fill="currentColor"/></svg>',
    here: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M11 1 1 5.200l4.300 1.500L6.800 11z" fill="currentColor"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };
  const tabOf = (v) => (!v || v.type === 'spots' || v.type === 'addspot' ? 'today' : v.type === 'plans' || v.type === 'plan' ? 'plans' : v.type === 'list' ? 'places' : '');
  /** Today, Plans and Places, always there; over Today, a dot for each location and which one you are on. */
  function drawBar() {
    // Only the page showing can be reached by keyboard or read aloud.
    for (const pg of $$('.page')) { const on = pg.dataset.id === S.current; pg.toggleAttribute('inert', !on); if (on) pg.setAttribute('aria-current', 'true'); else pg.removeAttribute('aria-current'); }
    const bar = $('#bar'), tab = tabOf(S.view);
    bar.hidden = !!(S.view && S.view.type === 'shared');
    if (bar.hidden) return;
    const i = S.places.findIndex((p) => p.id === S.current), n = S.places.length;
    const dots = S.view || n < 2 ? '' : `<div class="dotsrow">${n > 7 ? '' : S.places.map((p) => `<button type="button" class="dot" data-act="goto" data-id="${esc(p.id)}" aria-label="${esc(p.name)}"${p.id === S.current ? ' aria-current="true"' : ''}>${p.here ? BAR.here : '<i></i>'}</button>`).join('')}<span class="count num">${i + 1} of ${n}</span></div>`;
    const btn = (key, act, label) => `<button type="button" class="barbtn" data-act="${act}"${tab === key ? ' aria-current="page"' : ''}>${BAR[key]}<span>${label}</span></button>`;
    bar.innerHTML = `${dots}<div class="tabs">${btn('today', 'open-today', 'Today')}${btn('plans', 'open-plans', 'Plans')}${btn('places', 'open-list', 'Places')}</div>`;
  }

  function drawBanner() {
    const el = $('#banner'), p = place(), d = p && DATA[p.id];
    let html = '';
    if (S.notice) html = `<span>${esc(S.notice)}</span>`;
    else if (db.isBlocked()) html = '<span>Plans can’t be saved in this browser mode.</span>';
    else if (d && d.ceiling) html = '<span>Showing saved forecasts. Refreshing again tomorrow.</span>';
    else if (!navigator.onLine) html = `<span>Offline.${d && d.fc && d.source !== 'sample' ? ` Forecast updated ${esc(ago(d.fetchedAt))}.` : ''}</span>`;
    el.hidden = !html || !!(S.view && S.view.type === 'shared');
    el.innerHTML = html;
  }

  const unitsSeg = () => `<div class="seg" role="group" aria-label="Which units are listed first"><button type="button" data-act="units" data-v="imperial" aria-pressed="${settings.imperialFirst}">°F · mi</button><button type="button" data-act="units" data-v="metric" aria-pressed="${!settings.imperialFirst}">°C · km</button></div>`;
  const creditsHtml = () => `<p>Golden Hour has no accounts and collects nothing. To get forecasts and places, your device sends coordinates to Open-Meteo, the open map and the map tile host; a venue search sends what you type to Photon. Ratings are a forecast, not a promise: the first two days are the most reliable.</p>
      <p>Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0), air quality from CAMS. Maps: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Venue search by <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>. Towns from <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0). Sun and moon after SunCalc.</p>
      <p><a href="https://github.com/bradleycowdrey/golden-hour" target="_blank" rel="noopener">Source</a> · <a href="https://bradcowdrey.com/legal" target="_blank" rel="noopener">Terms and privacy</a> · Free and open source, by <a href="https://bradcowdrey.com" target="_blank" rel="noopener">Bradley Cowdrey</a> · ${esc(VERSION)}</p>`;

  // ---------- Places (the tab): your locations, and Add ----------
  /** The answer in words: "Go tonight", "Maybe tomorrow", "Not tonight", "Skip Wednesday". */
  function whenWord(ev) { return ev.day === 0 ? 'tonight' : ev.day === 1 ? 'tomorrow' : dayName(ev.date, true); }
  function answerText(ev) {
    const v = ev.rating.verdict, w = whenWord(ev);
    return v === 'go' ? `Go ${w}` : v === 'maybe' ? `Maybe ${w}` : ev.day <= 1 ? `Not ${w}` : `Skip ${w}`;
  }
  const answerShort = (r) => (r.verdict === 'go' ? 'Go' : r.verdict === 'maybe' ? 'Maybe' : 'Skip');
  function listRows() {
    return S.places.map((p) => {
      const evs = evenings(p), f = focusDay(p, evs), ev = evs[f], r = ev.rating, d = DATA[p.id] || {};
      const when = ev.times.sunset == null ? 'No sunset on this date' : `Sunset ${timeText(ev.times.sunset, p.tz)}`;
      const right = r ? `<span class="rt" aria-hidden="true"><span class="v ${r.verdict}">${icon(r)}${esc(answerText(ev))}</span></span>`
        : `<span class="rt muted small">${d.error && !d.fc ? 'No forecast' : ev.times.state === 'none' ? '' : '…'}</span>`;
      return `<div class="lrow-wrap"><button type="button" class="lrow card" data-act="goto" data-id="${esc(p.id)}"${r ? ` aria-label="${esc(p.name)}. ${esc(answerText(ev))}. ${esc(when)}."` : ''}>
        <span class="swatch" data-sky="${skyFor(r).join(',')}" aria-hidden="true"></span>
        <span class="l"><span class="n">${esc(p.name)}${p.sample ? ' <span class="tag">Sample</span>' : ''}${p.here ? ' <span class="tag">Here</span>' : ''}</span><span class="r">${esc(when)}</span></span>${right}</button>
        ${S.editing && S.places.length > 1 ? `<button type="button" class="chip-x" data-act="remove" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}</div>`;
    }).join('');
  }
  function listView() {
    const real = S.places.filter((x) => !x.sample);
    return `<div class="row top"><h1>Places</h1><span class="sp"></span><button type="button" class="circle" data-act="settings" aria-label="Settings">${BAR.gear}</button></div>
      <section class="search card"><div class="box"><input id="q" type="search" placeholder="Add a town or city" autocomplete="off" aria-label="Add a town or city"></div>
        <div class="results" id="results" aria-live="polite"></div>
        <div class="row" data-gap><button type="button" class="btn" data-act="locate">Use my location</button><span class="sp"></span>${S.places.length > 1 ? `<button type="button" class="btn quiet" data-act="edit">${S.editing ? 'Done' : 'Edit'}</button>` : ''}</div></section>
      <div id="listRows" class="lrows">${listRows()}</div>
      ${real.length === 1 ? '<p class="small hint1">Add another place to swipe between them on Today.</p>' : ''}`;
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
  /** The sun's way down, drawn over the five times: gold while it is up, on the line at sunset, the glow
      after, and the first stars at last light. The better the colour, the stronger the sky. */
  const EV_Y = (x) => 6.75 + 0.36 * x - 0.0003 * x * x;
  function eveningGraphic(ev, p) {
    const t = ev.times, c = ev.rating ? ev.rating.colour : 0.5, glow = (0.35 + 0.65 * c).toFixed(2);
    const marks = [t.goldenStart, t.bestStart, t.sunset, t.afterglowEnd, t.lastLight], n = now();
    let nowX = null;
    if (marks.every((m) => m != null) && n >= marks[0] - 3600000 && n <= marks[4]) {
      if (n < marks[0]) nowX = 50 - (marks[0] - n) / 3600000 * 50;
      else for (let i = 0; i < 4; i++) if (n <= marks[i + 1]) { nowX = 50 + 100 * (i + (n - marks[i]) / Math.max(1, marks[i + 1] - marks[i])); break; }
    }
    const here = nowX == null ? '' : `<g class="evnow"><circle cx="${nowX.toFixed(1)}" cy="${EV_Y(nowX).toFixed(1)}" r="6.500" fill="#fff"/><circle cx="${nowX.toFixed(1)}" cy="${EV_Y(nowX).toFixed(1)}" r="11" fill="none" stroke="#fff" stroke-width="1.500" opacity=".55"/></g>`;
    return `<svg class="evpath" viewBox="0 0 500 124" role="img" aria-label="The sun’s way down through the evening${nowX == null ? '' : ', with where it is now'}">
      <g opacity="${glow}"><rect x="0" y="0" width="500" height="78" fill="url(#ev-sky)"/></g><rect x="0" y="0" width="500" height="78.500" fill="url(#ev-fade)"/>
      <rect x="0" y="78" width="500" height="46" fill="url(#ev-ground)"/>
      <ellipse cx="250" cy="78" rx="${(70 + 60 * c).toFixed(0)}" ry="${(30 + 26 * c).toFixed(0)}" fill="url(#ev-halo)" clip-path="url(#ev-above)"/>
      <ellipse cx="350" cy="78" rx="${(60 + 50 * c).toFixed(0)}" ry="${(16 + 16 * c).toFixed(0)}" fill="url(#ev-ember)" clip-path="url(#ev-above)"/>
      <path d="M0 6.750Q250 96.750 500 111.750" fill="none" stroke="url(#ev-line)" stroke-width="2.500" stroke-linecap="round" clip-path="url(#ev-above)"/>
      <path d="M0 6.750Q250 96.750 500 111.750" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" opacity=".4" clip-path="url(#ev-below)"/>
      <circle cx="50" cy="24" r="20" fill="url(#ev-halo)"/><circle cx="50" cy="24" r="10" fill="#FFE27A"/>
      <circle cx="150" cy="54" r="19" fill="url(#ev-halo)"/><circle cx="150" cy="54" r="10" fill="#FFB347"/>
      <circle cx="250" cy="78" r="13" fill="url(#ev-set)" clip-path="url(#ev-above)"/>
      <circle cx="350" cy="96" r="7" fill="#232125" stroke="#FF9C8A" stroke-width="2" opacity=".9"/>
      <circle cx="450" cy="108" r="5" fill="#232125" stroke="#B9A7FF" stroke-width="1.800" opacity=".8"/>
      <path d="M0 78h500" stroke="#fff" stroke-width="1.500" opacity=".7"/>
      <g fill="#fff"><path d="m450 30 2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><circle cx="478" cy="52" r="1.800" opacity=".8"/><circle cx="424" cy="56" r="1.500" opacity=".7"/><circle cx="470" cy="18" r="1.300" opacity=".6"/><circle cx="404" cy="24" r="1.200" opacity=".45"/></g>
      ${here}</svg>`;
  }
  function eveningCard(ev, p) {
    const t = ev.times, r = ev.rating, f = (ms) => (ms == null ? '–' : esc(timeText(ms, p.tz))), all = t.state === 'twilight';
    const col = (label, time, cls) => `<div class="hour${cls || ''}"><span class="h">${label}</span><span class="f num">${time}</span></div>`;
    const line = r ? esc(r.reason) : all ? 'Twilight lasts all night at this time of year.' : 'The best colour often comes after the sun is down.';
    return `<section class="card"><p class="eyebrow">${TI.clock}<span>The evening</span><span class="sp"></span><span class="aside">Sets ${pointOf(t.azimuth)} · ${Math.round(t.azimuth)}°</span></p>
      <p class="summary">${line}</p>${r ? deltaLine(p, ev) : ''}<hr class="rule">
      ${eveningGraphic(ev, p)}
      <div class="times">${col('Golden', f(t.goldenStart))}${col('Best light', f(t.bestStart))}${col('Sunset', f(t.sunset), ' sun')}${col('Afterglow', all ? 'All night' : f(t.afterglowEnd))}${col('Last light', all ? '–' : f(t.lastLight))}</div>
      <p class="small muted" data-gap>${all ? 'It never gets fully dark.' : `Best light ${f(t.bestStart)} to ${f(t.bestEnd)}. Stay through the afterglow: the best colour often comes after the sun is down. Times assume a flat horizon; hills and buildings can hide the sun sooner.`}</p></section>`;
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
      const canvasWord = r.cap ? 'Hidden this evening' : d.canvas < 5 ? 'None to catch the colour' : d.canvas < 30 ? 'A little' : d.canvas <= 70 ? 'Just right' : 'Heavy';
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

  /** Why this answer: the score, the colour and the range, the evening's times and every input, one tap down. */
  function scoreCard(ev, p) {
    const r = ev.rating;
    const range = rangeText(r);
    return `<section class="card scorecard"><p class="eyebrow">${TI.colour}<span>The rating</span></p>
      <div class="tonight"><span class="big num">${scoreText(r)}</span><span class="tl2"><b class="c-${r.colourClass.toLowerCase()}">${r.colourClass} colour · ${r.colour} of 100</b>
        <span class="small">${range.charAt(0).toUpperCase() + range.slice(1)} out of 5${r.tier === 'outlook' ? '. Three to five days out, so it could change' : ''}.</span></span></div>${deltaLine(p, ev)}</section>`;
  }
  function whyFold(ev, p) {
    const r = ev.rating;
    if (!r) return '';
    const open = store.get('details', false);
    const head = `<section class="fold"><button type="button" class="foldrow" data-act="details-toggle" aria-expanded="${open}">
        <span class="ft"><b>Why</b><small>${scoreText(r)} of 5 · ${r.colourClass} colour · the evening’s times</small></span>
        <span class="fa">${open ? 'Hide' : 'Show'}</span><span class="chev${open ? ' up' : ''}">${SP.chev}</span></button></section>`;
    return open ? `${head}${scoreCard(ev, p)}${eveningCard(ev, p)}${tilesHtml(ev, p)}` : head;
  }

  /** The answer: go or not, why, and one time. */
  function answerBlock(ev, p, evs) {
    const r = ev.rating, t = ev.times, next = r.verdict === 'skip' ? nextGood(evs, ev) : null;
    const tail = r.verdict === 'skip' ? (next ? ` Try ${esc(dayName(next.date, true))}.` : '') : r.tier === 'outlook' ? ' Could change.' : '';
    return `<p class="ans" aria-hidden="true">${icon(r)}<span>${esc(answerText(ev))}</span></p>
      <p class="reason" aria-hidden="true">${esc(r.reason)}${tail}</p>
      <p class="atimes" aria-hidden="true"><b>Sunset ${esc(timeText(t.sunset, p.tz))}</b>${r.verdict === 'skip' ? '' : ` · be there by ${esc(timeText(t.bestStart - 20 * MIN, p.tz))}`}</p>`;
  }
  function spokenAnswer(ev, p, evs) {
    const r = ev.rating, next = r.verdict === 'skip' ? nextGood(evs, ev) : null;
    return `${p.name}. ${answerText(ev)}. ${r.reason}${next ? ` Try ${dayName(next.date, true)}.` : ''} Sunset ${timeText(ev.times.sunset, p.tz)}${r.verdict === 'skip' ? '' : `, be there by ${timeText(ev.times.bestStart - 20 * MIN, p.tz)}`}.`;
  }
  function updatedLine(p) {
    const d = DATA[p.id] || {};
    if (d.source === 'sample') return '<p class="upd">Sample forecast</p>';
    if (!d.fetchedAt) return '';
    const failed = d.error === 'network' || d.error === 'stale', old = now() - d.fetchedAt > 3 * HOUR;
    return `<p class="upd${old || failed ? ' stale' : ''}">${failed ? 'Couldn’t refresh. ' : ''}Updated ${esc(old || failed ? ago(d.fetchedAt) : timeText(d.fetchedAt, p.tz))} · <button type="button" class="link" data-act="retry">${failed ? 'Try again' : 'Refresh'}</button></p>`;
  }

  /** The one place to go: your own nearest spot if you have one, otherwise the top easy-to-reach place. */
  function bestPlace(p) {
    const mine = ownSpots(p), s = allSpots(p);
    return mine[0] || (s && (s.easy[0] || s.dining[0] || s.adventurous[0])) || null;
  }
  /** Where the places stand when there are none to show: still looking, failed, or none found. */
  function placesState(p) {
    const d = DATA[p.id] || {};
    if (d.spots === 'error') return `<p class="pstate">Couldn’t load places near ${esc(p.name)}. <button type="button" class="link" data-act="spots-retry" data-place="${esc(p.id)}">Try again</button></p>`;
    if (!allSpots(p)) return `<p class="pstate" aria-busy="true">Looking for places near ${esc(p.name)}…</p>`;
    return `<p class="pstate">No places listed near ${esc(p.name)} in the open map. You can add your own.</p>`;
  }
  const planWord = (ev) => (ev.day === 0 ? 'this evening' : ev.day === 1 ? 'tomorrow' : dayName(ev.date, true));
  function pickCard(p, ev, evs) {
    const r = ev.rating;
    if (!r || now() > endOf(ev, p)) return '';
    if (r.verdict === 'skip') {
      const next = nextGood(evs, ev);
      if (!next) return '<section class="card pick"><p class="eyebrow">Next good evening</p><p>None in the next five days yet. Look again tomorrow.</p></section>';
      return `<section class="card pick"><p class="eyebrow">Next good evening</p>
        <button type="button" class="srow dayline" data-act="day" data-date="${next.date}"><span class="ic v ${next.rating.verdict}" aria-hidden="true">${icon(next.rating)}</span>
          <span class="sl"><span class="n">${esc(answerText(next))}</span><span class="r">Sunset ${esc(timeText(next.times.sunset, p.tz))}. ${esc(next.rating.reason)}</span></span><span class="chev">${SP.chev}</span></button>
        <div class="cta"><button type="button" class="btn primary" data-act="plan-new" data-date="${next.date}">Plan ${esc(dayName(next.date, true))}</button></div></section>`;
    }
    const best = bestPlace(p);
    return `<section class="card pick"><p class="eyebrow">${best && best.cat === 'own' ? 'Your spot' : 'Where to watch'}</p>
      ${best ? spotRow(best, p) : placesState(p)}
      <div class="cta"><button type="button" class="btn primary" data-act="plan-new" data-date="${ev.date}"${best ? ` data-id="${esc(best.id)}"` : ''}>Plan ${esc(planWord(ev))}</button></div></section>`;
  }
  /** A few more places under the one on top, and the way in to all of them. None is pushed on a Not tonight. */
  function morePlaces(p, ev) {
    const s = allSpots(p), best = bestPlace(p), r = ev.rating;
    const all = `<button type="button" class="more" data-act="spots-all" data-place="${esc(p.id)}">All places near ${esc(p.name)}</button>`;
    if (r && r.verdict === 'skip') return `<section class="card moreplaces">${all}</section>`;
    const picks = ownSpots(p).slice(0, 2);
    if (s) { picks.push(...s.easy.slice(0, 2), ...s.dining.slice(0, 1)); if (r && r.verdict === 'go') picks.push(...s.adventurous.slice(0, 1)); }
    // With an answer, the first place is already on top; without one (no forecast yet) the places still show here.
    const rows = picks.filter((x) => !r || !best || x.id !== best.id).slice(0, 3);
    return `<section class="card moreplaces"><p class="eyebrow">${r ? 'More places' : 'Where to watch'}</p>${rows.length ? rows.map((x) => spotRow(x, p)).join('') : r && best ? '' : placesState(p)}${all}</section>`;
  }
  function weekCard(p, evs) {
    const later = evs.find((e) => !e.rating && e.day > 5), today = localDate(now(), p.tz);
    return `<section class="card daily"><p class="eyebrow">${TI.cal}<span>The evenings ahead</span><span class="sp"></span><button type="button" class="link" data-act="share-week" data-place="${esc(p.id)}">Share</button></p>
      <div class="days">${evs.filter((e) => e.rating || e.times.state === 'none' || e.day <= 5).map((e) => dayRow(e, p)).join('')}
        ${later ? `<div class="day later"><span class="why">${esc(dayName(later.date, true))}, ${esc(dateText(later.date))} and beyond: too early for colour</span></div>` : ''}</div>
      <label class="anydate"><span>Another date</span><input type="date" id="anyDate" data-place="${esc(p.id)}" min="${today}" max="${addDays(today, 366)}" aria-label="See the sunset times on another date"></label>
      <p class="small muted" data-gap>Tap an evening for more. Three to five days out could change. Sunset times are exact for any date.</p></section>`;
  }

  /** One place's page: the answer, one time, one place and the way to plan it; then why, more places and the week. */
  function pageHtml(p) {
    const d = DATA[p.id] || {}, evs = evenings(p), f = focusDay(p, evs), ev = evs[f], r = ev.rating;
    const head = `${r ? `<button type="button" class="circle heroshare" data-act="share-today" aria-label="Share ${esc(whenWord(ev))}’s sunset">${SP.share}</button>` : ''}<h2>${esc(p.name)}${p.sample ? ' <span class="tag">Sample</span>' : ''}</h2>
      <p class="when">${esc(dayName(ev.date, true))}, ${esc(dateText(ev.date))}${p.region ? ` · ${esc(p.region)}` : ''}</p>`;
    let hero;
    if (ev.times.state === 'none') hero = `<section class="hero">${head}<p class="none">No sunset here on this date</p><p class="reason">${ev.times.polar === 'day' ? 'The sun stays up all night.' : 'The sun stays below the horizon.'}</p></section>`;
    else if (r) hero = `<section class="hero answer v-${r.verdict}" aria-label="${esc(spokenAnswer(ev, p, evs))}">${head}${answerBlock(ev, p, evs)}${updatedLine(p)}</section>`;
    else if (d.error) hero = `<section class="hero">${head}<p class="none">${d.error === 'ceiling' ? 'Refreshing again tomorrow' : 'Couldn’t reach the forecast'}</p>
      <p class="atimes"><b>Sunset ${esc(timeText(ev.times.sunset, p.tz))}</b> · be there by ${esc(timeText(ev.times.bestStart - 20 * MIN, p.tz))}</p>
      <div class="cta"><button type="button" class="btn white" data-act="retry">Try again</button></div></section>`;
    else if (d.fc) hero = `<section class="hero">${head}<p class="none">No forecast for this evening yet</p></section>`;
    else hero = `<section class="hero skeleton" aria-busy="true">${head}<div class="bone" data-w="40"></div><div class="bone" data-w="60"></div><div class="bone" data-w="50"></div></section>`;

    const warns = r ? r.warnings.map((w) => `<div class="warn" role="note">${ICON.warn}<span>${esc(w.text)}</span></div>`).join('') : '';
    const sample = p.sample ? `<section class="card ask"><h3>This is a sample forecast</h3><p>Add where you are to see the real one.</p><div class="row" data-gap><button type="button" class="btn white" data-act="add-place">Add my place</button></div></section>` : '';
    const lone = !p.sample && S.places.length === 1 ? '<span>Add another place to swipe between them. </span>' : '';
    return `<div class="two"><div class="col">${hero}${warns}${pickCard(p, ev, evs)}${sample}${howWasIt(p, evs)}</div>
      <div class="col">${whyFold(ev, p)}${ev.times.state === 'none' ? '' : morePlaces(p, ev)}${weekCard(p, evs)}</div></div>
      <p class="small pagefoot">${lone}<button type="button" class="link" data-act="settings">Settings, units and credits</button></p>`;
  }

  // ---------- Sheets: a day, a place, the place picker and Settings, over whatever is showing ----------
  /** The light a photographer plans around, the direction the sun sets, and when to decide. */
  function lightCard(ev, tz, deciding) {
    const t = ev.times, w = G.lightWindows(t), f = (ms) => esc(timeText(ms, tz));
    if (!w) return '';
    const rows = [`<li><span><b>Golden hour ${f(w.golden[0])} to ${f(w.golden[1])}</b><br><span class="small muted">Low, warm light: the time for portraits.</span></span></li>`];
    if (w.blue) rows.push(`<li><span><b>Blue hour ${f(w.blue[0])} to ${f(w.blue[1])}</b><br><span class="small muted">Soft blue light after the glow fades, then dark.</span></span></li>`);
    if (t.azimuth != null) rows.push(`<li><span>The sun sets to the ${esc(compass(t.azimuth))} (${pointOf(t.azimuth)}, ${Math.round(t.azimuth)}°).</span></li>`);
    if (deciding && ev.rating && ev.day <= 1) {
      const d = deciding, x = ev.x;
      rows.push(`<li><span>Decide by ${f(t.bestStart - 20 * MIN - 3 * HOUR)}, three hours before you’d be there. Forecast updated ${esc(d)}.${x && x.wind != null ? ` Wind ${esc(G.windText(G.feltWind(x.wind, x.gusts), settings.imperialFirst))}.` : ''}</span></li>`);
    }
    return `<section class="card light"><p class="eyebrow">${TI.sun}<span>The light</span></p><ul class="facts">${rows.join('')}</ul></section>`;
  }
  function daySheet() {
    const sh = S.sheet, p = place(sh.placeId);
    if (!p) return '';
    const today = localDate(now(), p.tz), ev = eveningOn(p, sh.date), r = ev.rating, t = ev.times, d = DATA[p.id] || {};
    const arrow = (n, on) => `<button type="button" class="circle sm" data-act="sheet-step" data-d="${n}" aria-label="${n < 0 ? 'The evening before' : 'The next evening'}"${on ? '' : ' disabled'}>${n < 0 ? '‹' : '›'}</button>`;
    const head = `<div class="sh-head"><button type="button" class="done" data-act="sheet-close">Done</button><h2 id="sheetTitle">${esc(dayName(sh.date, true))}, ${esc(dateText(sh.date))}</h2><span class="nav">${arrow(-1, sh.date > today)}${arrow(1, sh.date < addDays(today, 366))}</span></div>`;
    if (t.state === 'none') return `${head}<section class="hero sheethero"><p class="when">${esc(p.name)}</p><p class="none">No sunset here on this date</p></section>`;
    const hero = r ? `<section class="hero answer sheethero v-${r.verdict}" aria-label="${esc(spokenAnswer(ev, p, evenings(p)))}"><p class="when">${esc(p.name)}</p>${answerBlock(ev, p, evenings(p))}</section>`
      : `<section class="hero sheethero"><p class="when">${esc(p.name)}</p><p class="ans plain"><span>Sunset ${esc(timeText(t.sunset, p.tz))}</span></p>
          <p class="reason">${ev.day > 5 ? 'Times are exact. Colour can’t be forecast yet.' : 'No forecast for this evening yet.'}</p></section>`;
    const warns = r ? r.warnings.map((w) => `<div class="warn" role="note">${ICON.warn}<span>${esc(w.text)}</span></div>`).join('') : '';
    const cta = now() < endOf(ev, p) ? `<div class="cta"><button type="button" class="btn primary" data-act="plan-new" data-date="${ev.date}" data-place="${esc(p.id)}">Plan ${esc(planWord(ev))}</button></div>` : '';
    const upd = d.fetchedAt && d.source !== 'sample' ? timeText(d.fetchedAt, p.tz) : null;
    return `${head}${hero}${warns}${cta}${lightCard(ev, p.tz, upd)}${r ? scoreCard(ev, p) : ''}${eveningCard(ev, p)}${r ? tilesHtml(ev, p) : ''}`;
  }
  /** Where a new plan happens: your spots and the top places, or somewhere else. */
  function pickSheet() {
    const sh = S.sheet, p = place(sh.placeId);
    if (!p) return '';
    const s = allSpots(p), rows = ownSpots(p).slice(0, 3);
    if (s) rows.push(...s.easy.slice(0, 5), ...s.dining.slice(0, 3), ...s.adventurous.slice(0, 2));
    return `<div class="sh-head"><button type="button" class="done" data-act="sheet-close">Cancel</button><h2 id="sheetTitle">Where?</h2><span></span></div>
      <section class="card"><p class="eyebrow">${esc(dayName(sh.date, true))}, ${esc(dateText(sh.date))} · near ${esc(p.name)}</p>
        ${rows.length ? rows.map((x) => spotRow(x, p, null, 'plan-here', sh.date)).join('') : placesState(p)}</section>
      <div class="cta"><button type="button" class="btn white" data-act="plan-blank" data-date="${sh.date}" data-place="${esc(p.id)}">Somewhere else</button></div>`;
  }
  function statusHtml() {
    const p = place(), d = (p && DATA[p.id]) || {};
    const facts = [`Golden Hour ${VERSION}`, navigator.onLine ? 'Online' : 'Offline', db.isBlocked() ? 'Storage is blocked in this browser mode' : 'Storage is working',
      `${budget(0)} of ${CEILING} forecast requests used today`, p ? `${p.name}: forecast ${d.fc ? `from ${d.source === 'sample' ? 'the sample' : ago(d.fetchedAt)}` : 'not loaded'}${d.error ? ` (${d.error})` : ''}; places ${allSpots(p) ? 'loaded' : d.spots === 'error' ? 'failed' : 'not loaded'}` : ''];
    const rows = STATUS.map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><span><b>${esc(s.what)}</b>: ${s.ok ? '' : 'failed, '}${esc(s.detail)}<br><span class="small muted">${esc(new Intl.DateTimeFormat(navigator.language || 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(s.at))}${s.ms != null ? ` · took ${(s.ms / 1000).toFixed(1)} s` : ''}</span></span></li>`).join('');
    return `<section class="card"><p class="eyebrow">Now</p><ul class="facts">${facts.filter(Boolean).map((f) => `<li><span>${esc(f)}</span></li>`).join('')}</ul></section>
      <section class="card status"><p class="eyebrow">What the app last asked for</p>${rows ? `<ul class="facts">${rows}</ul>` : '<p class="small muted">Nothing yet.</p>'}
        <div class="row" data-gap><button type="button" class="btn" data-act="copy-status">Copy status</button></div>
        <p class="small muted" data-gap>If something isn’t working, a screenshot of this page says what failed. It stays on your device unless you send it.</p></section>`;
  }
  function settingsSheet() {
    const pg = S.sheet.page || 'main';
    const head = (title, sub) => `<div class="sh-head"><button type="button" class="done" data-act="${sub ? 'settings-page' : 'sheet-close'}" data-page="main">${sub ? '‹ Settings' : 'Done'}</button><h2 id="sheetTitle">${title}</h2><span></span></div>`;
    if (pg === 'status') return head('Status', true) + statusHtml();
    if (pg === 'log') return head('My sunset log', true) + logHtml();
    const row = (act, page, label, sub) => `<button type="button" class="plan-row" data-act="${act}"${page ? ` data-page="${page}"` : ''}><span><span class="n">${label}</span>${sub ? `<br><span class="r">${sub}</span>` : ''}</span><span class="sp"></span><span aria-hidden="true">›</span></button>`;
    return `${head('Settings')}<section class="card"><p class="eyebrow">Units listed first</p>${unitsSeg()}</section>
      <section class="card">${row('settings-page', 'log', 'My sunset log', 'How the forecast did on evenings you rated')}${row('settings-page', 'status', 'Status', 'What the app last asked for and what came back')}${row('share-app', '', 'Share Golden Hour', 'Free, no account')}</section>
      <section class="card foot">${creditsHtml()}</section>`;
  }
  function drawSheet(focus) {
    const back = $('#sheetback');
    if (!back) return;
    const sh = S.sheet;
    const html = !sh ? '' : sh.kind === 'day' ? daySheet() : sh.kind === 'spot' ? spotSheet() : sh.kind === 'pick' ? pickSheet() : sh.kind === 'settings' ? settingsSheet() : '';
    document.body.classList.toggle('sheet-open', !!html);
    if (!html) { back.hidden = true; back.innerHTML = ''; return; }
    const top = back.scrollTop;
    back.hidden = false;
    back.innerHTML = `<div class="sheet k-${sh.kind}" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" tabindex="-1">${html}</div>`;
    dyn(back);
    if (sh.kind === 'spot') mountMap();
    if (focus) { back.scrollTop = 0; $('#sheet').focus({ preventScroll: true }); } else back.scrollTop = top;
  }
  function stepSheet(d) {
    const sh = S.sheet;
    if (!sh || sh.kind !== 'day') return;
    const p = place(sh.placeId), today = localDate(now(), p.tz), next = addDays(sh.date, d);
    if (next < today || next > addDays(today, 366)) return;
    sh.date = next; drawSheet(true);
  }

  const compass = (deg) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(G.normalize(deg) / 45) % 8];

  // ---------- How was it? ----------
  /** Yesterday's evening, if it was rated and hasn't been answered or put off: asked once, the next morning. */
  function pendingRating(p, evs) {
    const d = DATA[p.id];
    if (!d || p.sample) return null;
    const date = addDays(evs[0].date, -1);
    if (!d.logged || !d.logged[date]) return null;
    if (S.ratings.some((r) => r.placeId === p.id && r.date === date)) return null;
    if (store.get('hwiSkip', '') === `${p.id}|${date}`) return null;
    return { date, predicted: d.logged[date] };
  }
  function howWasIt(p, evs) {
    const q = pendingRating(p, evs), j = S.justRated;
    if (!q && j && j.placeId === p.id) return `<section class="card" id="ratedCard"><p class="eyebrow">Thanks</p>
      <p>Saved in your sunset log on this device. It helps tune the forecast.</p></section>`;
    if (!q) return '';
    const words = ['Nothing', 'Dull', 'Pleasant', 'Lovely', 'Stunning'];
    return `<section class="card" id="howWasIt"><p class="eyebrow">How was it?</p>
      <p>How was last night’s sunset in ${esc(p.name)}? Your answer stays on this device.</p>
      <div class="rate" data-gap>${words.map((w, i) => `<button type="button" data-act="rate" data-date="${q.date}" data-v="${i + 1}" aria-label="${i + 1} out of 5: ${w}">${i + 1}<small>${w}</small></button>`).join('')}</div>
      <div class="row" data-gap><button type="button" class="btn quiet" data-act="rate-later" data-date="${q.date}">Not now</button><span class="sp"></span><button type="button" class="btn quiet" data-act="rate" data-date="${q.date}" data-v="0">Didn’t see it</button></div></section>`;
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
  function logHtml() {
    const rows = S.ratings.filter((r) => r.observed).sort((a, b) => (a.date < b.date ? 1 : -1));
    const name = (id) => { const p = S.places.find((x) => x.id === id); return p ? p.name : 'A removed place'; };
    const within = rows.filter((r) => Math.abs(r.observed - r.predicted) <= 1).length;
    return `<section class="card">
      ${rows.length ? `<p>${rows.length} evening${rows.length === 1 ? '' : 's'} rated. The forecast was within one star on ${within} of them.</p>
        <div data-gap>${rows.map((r) => `<div class="plan-row"><span><span class="n">${esc(dayName(r.date))} ${esc(dateText(r.date))} · ${esc(name(r.placeId))}</span><br><span class="r">Forecast ${r.predicted.toFixed(1)} · You said ${r.observed} of 5</span></span></div>`).join('')}</div>
        <div class="row" data-gap><button type="button" class="btn" data-act="copy-log">Copy my log</button><a class="btn" target="_blank" rel="noopener" href="${esc(feedbackUrl(rows))}">Send it to GitHub</a></div>
        <p class="small muted" data-gap>Nothing is sent unless you choose to. Sending opens a pre-filled, public report on GitHub for you to review first. It names the town, never where you stood.</p>`
    : '<p class="empty">No evenings rated yet. The morning after an evening, Golden Hour asks how the sunset was.</p>'}</section>`;
  }
  function feedbackUrl(rows) {
    const body = 'My Golden Hour sunset log (forecast → what I saw):\n\n' + rows.slice(0, 40).map((r) => `${r.date}  ${(S.places.find((x) => x.id === r.placeId) || { name: '?' }).name}  forecast ${r.predicted.toFixed(1)}  saw ${r.observed}/5  parts c${r.parts.c.toFixed(2)} s${r.parts.s.toFixed(2)} a${r.parts.a.toFixed(2)} k${r.parts.k.toFixed(2)}`).join('\n');
    return 'https://github.com/bradleycowdrey/golden-hour/issues/new?title=' + encodeURIComponent('Sunset log') + '&body=' + encodeURIComponent(body);
  }

  // ---------- Week and Compare ----------
  /** One evening in the list of ten, as Two Degrees shows a day: the day, the verdict, the score, a bar for
      the colour, and the colour class over the sunset time. */
  function dayRow(ev, p) {
    const label = ev.day === 0 ? 'Today' : ev.day === 1 ? 'Tomorrow' : dayName(ev.date, true), short = ev.day === 0 ? 'Today' : dayName(ev.date);
    const mark = !ev.rating || ev.rating.verdict !== 'go' ? '' : ev.rating.score >= 4.5 ? 'Great' : 'Good';
    const d = `<span class="d">${esc(short)}${mark ? `<small class="best">${mark}</small>` : ''}</span>`;
    const sunset = ev.times.sunset == null ? '' : esc(timeText(ev.times.sunset, p.tz));
    if (ev.times.state === 'none') return `<div class="day none">${d}<span class="why">No sunset here on this date</span><span class="hi"></span></div>`;
    if (!ev.rating) return `<div class="day none">${d}<span class="why">${ev.day > 5 ? 'Too early to call' : 'No forecast yet'}</span><span class="hi"><span>Sunset ${sunset}</span></span></div>`;
    const r = ev.rating, out = r.tier === 'outlook', cls = r.colourClass.toLowerCase();
    return `<button type="button" class="day${out ? ' outlook' : ''}" data-act="day" data-date="${ev.date}" data-place="${esc(p.id)}" aria-label="${esc(label)}. ${esc(answerShort(r))}. ${esc(r.reason)}">${d}
      <span class="ic v ${r.verdict}" aria-hidden="true">${icon(r)}<small>${answerShort(r)}</small></span>
      <span class="sc num" aria-hidden="true">${scoreText(r)}</span>
      <span class="cbar" aria-hidden="true"><i class="f-${cls}" data-w="${Math.max(3, r.colour)}"></i></span>
      <span class="hi" aria-hidden="true"><b class="c-${cls}">${r.colourClass}</b><span>${sunset}</span></span></button>`;
  }

  // ---------- Plans ----------
  const hhmm = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tzOr(tz), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  /** "17:05" on a date in a zone → the moment, or null when it isn't a time. */
  function clockOn(date, text, tz) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(text || '');
    return m && +m[1] < 24 && +m[2] < 60 ? startOfDay(date, tz) + +m[1] * HOUR + +m[2] * MIN : null;
  }
  /** What has happened to a plan's evening since it was made: "was 4.2, now 3.1". */
  function changeText(was, r) {
    if (was == null || !r || Math.abs(r.score - was) < 0.5) return '';
    return `Was ${was.toFixed(1)} when you made this plan, now ${r.score.toFixed(1)}.`;
  }
  function plansView() {
    const today = localDate(now(), deviceTz());
    const upcoming = S.plans.filter((p) => p.date >= addDays(today, -1)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const earlier = S.plans.filter((p) => p.date < addDays(today, -1)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const row = (pl) => {
      const p = S.places.find((x) => x.id === pl.placeId) || null, hasPin = pl.spot.lat != null;
      const ev = (p || hasPin) && pl.date >= today ? venueEvening(p, hasPin ? pl.spot : null, pl.date, pl.tz) : null, r = ev && ev.rating;
      const chip = r ? `<span class="v ${r.verdict}">${icon(r)}${answerShort(r)}</span>` : '';
      const changed = changeText(pl.scoreAtSave, r);
      return `<button type="button" class="plan-row" data-act="plan-open" data-id="${esc(pl.id)}"><span><span class="n">${esc(pl.spot.name || 'No place yet')}</span><br>
        <span class="r">${esc(dayName(pl.date, true))} ${esc(dateText(pl.date))}${pl.times ? ` · be there by ${esc(timeText(pl.times.meetAt, pl.tz))} · sunset ${esc(timeText(pl.times.sunset, pl.tz))}` : ''}</span>
        ${changed ? `<br><span class="r chg">${esc(changed)}</span>` : ''}</span><span class="sp"></span>${chip}<span aria-hidden="true">›</span></button>`;
    };
    return `<div class="row top"><h1>Plans</h1><span class="sp"></span><button type="button" class="btn white" data-act="plan-new">New plan</button></div>
      <section class="card">${upcoming.length ? upcoming.map(row).join('') : '<p class="empty">No plans yet. Start one here, or from Today.</p>'}</section>
      ${earlier.length ? `<section class="card"><p class="eyebrow">Earlier</p>${earlier.map(row).join('')}</section>` : ''}`;
  }

  const TYPES = { outdoor: 'Park, field or open ground', water: 'Beach, pier or waterside', peak: 'Summit or viewpoint', venue: 'Restaurant or bar' };

  /** Everything the Plan screen shows, worked out from the draft and the forecast at the venue. */
  function planModel(dr) {
    const p = S.places.find((x) => x.id === dr.placeId) || null;
    const hasPin = dr.spot.lat != null, tz = p ? p.tz : dr.tz;
    const ev = p || hasPin ? venueEvening(p, hasPin ? dr.spot : null, dr.date, tz) : null;
    const times = ev ? ev.times : null, r = ev ? ev.rating : null;
    const km = hasPin && dr.start ? G.distance(dr.start.lat, dr.start.lon, dr.spot.lat, dr.spot.lon) / 1000 : 0;
    const travel = dr.travelMin != null ? dr.travelMin : G.travelMinutes(km);
    const buffer = G.bufferMinutes(r ? r.score : 0, weekdayOf(dr.date));
    let meetAt = clockOn(dr.date, dr.arriveBy, tz);
    if (meetAt != null && times && times.sunset != null && (meetAt > times.sunset || meetAt < times.sunset - 8 * HOUR)) meetAt = null;   // an arrive-by after sunset is no plan
    const pt = times ? G.planTimes(times, { walkIn: dr.walkIn, travel, buffer, meetAt }) : null;
    const items = r && pt ? G.mergeItems(dr.items, G.bringList(ev.x, r.detail, { spotType: dr.spot.type, walkIn: dr.walkIn, times: pt, imperialFirst: settings.imperialFirst })) : (dr.items || []);
    return { p, ev, r, times, km, travel, buffer, pt, items, hasPin, tz, startBack: pt ? G.startBackBy(pt, dr.walkIn) : null };
  }

  function timeline(pt, tz, opts) {
    const o = opts || {};
    const row = (cls, ms, title, sub) => `<div class="tl ${cls}"><span class="t num">${esc(timeText(ms, tz))}</span><span class="dot"></span><span class="what"><b>${title}</b><span>${sub}</span></span></div>`;
    const start = pt.headBackBy - (o.walkIn || 0) * MIN;
    return `<div class="timeline">
      ${o.leave ? row('', pt.leaveBy, 'Leave by', o.leave) : ''}
      ${row('', pt.meetAt, 'Be there by', o.own ? 'The time you set' : 'Settled 20 minutes before the best light')}
      ${row('sun', pt.sunset, 'Sunset', 'Stay: the best colour often comes after the sun is down')}
      ${row('', pt.stayUntil, 'Afterglow ends', o.twilight ? 'Twilight lasts all night here' : 'The last of the colour')}
      ${row('', start, 'Start back by', o.twilight ? 'It stays light' : `To be back before dark at ${esc(timeText(pt.headBackBy, tz))}`)}
    </div>`;
  }

  const smsUrl = (text) => `sms:${/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`;
  /** Getting home: when to start back, what the walk is like, and a message for someone who should know. */
  function gettingHome(o) {
    const { pt, tz, walkIn, spot, twilight, date } = o, f = (ms) => esc(timeText(ms, tz));
    const start = pt.headBackBy - (walkIn || 0) * MIN, moon = spot.lat != null ? G.moonAt(pt.headBackBy, spot.lat, spot.lon) : null;
    const lead = twilight ? 'It stays light all night at this time of year.' : walkIn > 0
      ? `Start back by about ${f(start)} to reach your car before dark.` : `It is dark by ${f(pt.headBackBy)}.`;
    const facts = [];
    if (!twilight) facts.push(walkIn > 0 ? `The walk back is about ${walkIn} minute${walkIn === 1 ? '' : 's'}, in twilight if you start by then. After ${f(pt.headBackBy)} it is dark.` : 'No walk back to speak of.');
    if (moon) facts.push(moon.up ? `The moon will be up (${esc(moon.name.toLowerCase())}, ${Math.round(moon.fraction * 100)}% lit).` : 'No moon in the sky then.');
    facts.push('Lighting not listed: the map can’t say if the way back is lit. Bring a light.');
    if (o.homeBy != null && o.travel != null) {
      const home = pt.headBackBy + o.travel * MIN;
      if (home <= o.homeBy) facts.push(`Home by ${f(o.homeBy)} fits: starting back at ${f(start)} gets you home about ${f(home)}.`);
      else { const need = o.homeBy - (o.travel + (walkIn || 0)) * MIN, gap = Math.round((pt.sunset - need) / MIN);
        facts.push(`To be home by ${f(o.homeBy)}, start back by ${f(need)}: ${gap > 0 ? `${gap} minutes before the sun sets` : `${-gap} minutes after sunset`}.`); }
    }
    const name = spot.name || 'the sunset spot', where = spot.lat != null ? ` (https://maps.google.com/?q=${spot.lat},${spot.lon})` : '';
    const going = `I’m watching the sunset at ${name}${where} on ${dayName(date, true)}. There by ${timeText(pt.meetAt, tz)}, starting back by ${timeText(start, tz)}. I’ll message when I’m home.`;
    return `<section class="card home"><p class="eyebrow">${TI.moon}<span>Getting home</span></p><p class="lead">${lead}</p>
      <ul class="facts" data-gap>${facts.map((x) => `<li><span>${x}</span></li>`).join('')}</ul>
      <div class="row" data-gap><a class="btn white" href="${esc(smsUrl(going))}">Text a friend where I’ll be</a><a class="btn" href="${esc(smsUrl(`Home safe from the sunset at ${name}.`))}">I’m home</a></div>
      <p class="small muted" data-gap>Times are estimates. We never say a place is lit or safe.</p></section>`;
  }

  function planView() {
    const dr = S.view.draft, mo = planModel(dr), tz = mo.tz, p = mo.p;
    setSky(mo.r, mo.ev && mo.ev.x, (p ? p.id : 'plan') + dr.date);
    const today = localDate(now(), tz), past = mo.pt && now() > mo.pt.headBackBy + 6 * HOUR;
    if (mo.r && dr.scoreAtSave == null) dr.scoreAtSave = mo.r.score;
    const answer = mo.r ? `<p class="planans v ${mo.r.verdict}">${icon(mo.r)}<b>${esc(answerText(mo.ev))}</b></p><p class="small">${esc(mo.r.reason)}${mo.r.tier === 'outlook' ? ' Could change.' : ''}</p>`
      : mo.ev && mo.ev.day > 5 ? '<p class="small">Times are exact. Colour can’t be forecast yet.</p>' : '<p class="small muted">No forecast for this evening yet.</p>';
    const changed = changeText(dr.scoreAtSave, mo.r);
    const better = changed && mo.r && mo.r.verdict !== 'go' && p ? nextGood(evenings(p), mo.ev) : null;
    const head = `<div class="row top"><button type="button" class="btn quiet back" data-act="close-view">‹ Back</button></div>
      <section class="hero planhero"><h2>${esc(dr.spot.name || 'A new plan')}</h2>
      <p class="when"><label class="dateline"><span class="sr">Date</span><input type="date" id="planDate" value="${dr.date}" min="${past ? dr.date : today}" max="${addDays(today, 366)}"${past ? ' disabled' : ''}></label></p></section>`;
    const coords = mo.hasPin ? `${dr.spot.lat.toFixed(5)}, ${dr.spot.lon.toFixed(5)}` : '';
    const placeCard = `<section class="card"><p class="eyebrow">The place</p>
      ${past ? '' : `<div class="box vbox"><input id="venueQ" type="search" placeholder="Find a venue by name or address" autocomplete="off" aria-label="Find a venue by name or address" value="${esc(S.view.venueQ || '')}"></div>
      <div class="results" id="venueResults" aria-live="polite"></div>`}
      <div class="map" id="map" data-gap><div class="msg" id="mapMsg">Loading the map…</div></div>
      ${past ? '' : `<div class="row" data-gap>${p ? `<button type="button" class="btn" data-act="plan-pick">Places near ${esc(p.name)}</button>` : ''}<button type="button" class="btn" data-act="pin-here">Pin my location</button></div>
      <div class="form" data-gap>
        <label class="wide">Name<input id="spotName" maxlength="60" value="${esc(dr.spot.name)}" placeholder="West ridge car park" autocomplete="off"></label>
        <label>Kind of place<select id="spotType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${dr.spot.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Walk in, minutes<input id="walkIn" type="number" inputmode="numeric" min="0" max="240" value="${dr.walkIn}"></label>
        <label>Be there by<input id="arriveBy" type="time" value="${esc(dr.arriveBy || (mo.pt ? hhmm(mo.pt.meetAt, tz) : ''))}"></label>
        <label>Travel, minutes<input id="travelMin" type="number" inputmode="numeric" min="0" max="600" value="${mo.travel}"></label>
        <label>Home by (optional)<input id="homeBy" type="time" value="${esc(dr.homeBy || '')}"></label>
        <label>Coordinates<input id="coords" value="${esc(coords)}" placeholder="39.7392, -104.9903" autocomplete="off"></label>
        <label class="wide">Note for whoever you share it with<input id="planNote" maxlength="200" value="${esc(dr.note || '')}" placeholder="Park in car park B" autocomplete="off"></label>
      </div>`}</section>`;
    if (!mo.pt) return `${head}<div class="two"><div class="col"><section class="card"><p class="eyebrow">The evening</p><p>No sunset here on this date.</p></section></div><div class="col">${placeCard}</div></div>`;
    const leaveSub = dr.start ? `From ${esc(dr.start.label)}: about ${mo.travel} min${dr.travelMin != null ? '' : mo.km >= 0.2 ? ` (${dist(mo.km * 1.4)} by road, roughly)` : ''}, ${dr.walkIn} min walk in, ${mo.buffer} min to spare` : '';
    const upd = p && DATA[p.id] && DATA[p.id].fetchedAt && DATA[p.id].source !== 'sample' ? timeText(DATA[p.id].fetchedAt, tz) : null;
    const timesCard = `<section class="card"><p class="eyebrow">The evening</p>${answer}
      ${changed ? `<p class="chg" role="note">${esc(changed)}${better ? ` ${esc(dayName(better.date, true))} looks better.` : ''}</p>` : ''}
      ${mo.hasPin ? '' : '<p class="small muted">Times are for the town until you choose the place.</p>'}
      <div data-gap>${timeline(mo.pt, tz, { leave: leaveSub, twilight: mo.times.state === 'twilight', walkIn: dr.walkIn, own: !!dr.arriveBy })}</div>
      ${dr.start ? `<div class="row"><span class="small muted">Leaving from <b>${esc(dr.start.label)}</b>. Never shared.</span><span class="sp"></span>
      <button type="button" class="btn quiet" data-act="start-here">Use my location</button>${p && dr.start.kind !== 'place' ? `<button type="button" class="btn quiet" data-act="start-place">Use ${esc(p.name)}</button>` : ''}</div>` : ''}
      <p class="small muted">Travel time is an estimate.${mo.hasPin ? ` <a href="${esc(directionsUrl(dr.spot))}" target="_blank" rel="noopener">Check in Maps</a>.` : ''}</p></section>`;
    const sent = dr.sent, moved = sent && mo.hasPin && (sent.meetAt !== mo.pt.meetAt || sent.date !== dr.date || sent.name !== dr.spot.name);
    const actions = mo.hasPin ? `<section class="card acts"><div class="row"><button type="button" class="btn primary" data-act="share-go">${SP.share}${sent ? 'Share again' : 'Share'}</button>
        ${moved ? `<button type="button" class="btn white" data-act="share-update">Send update</button>` : ''}
        <button type="button" class="btn" data-act="calendar">Add to calendar</button><a class="btn" target="_blank" rel="noopener" href="${esc(directionsUrl(dr.spot))}">Directions</a></div>
        <p class="small muted" data-gap>Sharing sends a picture and a link. Anyone with the link sees the place, the times and your note, never where you’re leaving from.</p>
        <div class="row" data-gap><span class="small muted">Saved on this device.</span><span class="sp"></span><button type="button" class="btn quiet danger" data-act="plan-del">Delete plan</button></div></section>`
      : `<section class="card acts"><p>Choose the place to share this plan.</p><div class="row" data-gap><span class="sp"></span><button type="button" class="btn quiet danger" data-act="plan-del">Delete plan</button></div></section>`;
    const items = mo.items;
    const bring = `<section class="card"><p class="eyebrow">What to bring</p><div class="items">${items.length ? items.map((it, i) => `<div class="item${it.done ? ' done' : ''}">
        <input type="checkbox" id="it${i}" data-act="tick" data-i="${i}"${it.done ? ' checked' : ''} aria-label="${esc(it.name)}">
        <label for="it${i}"><span class="n">${esc(it.name)}${it.isNew ? '<span class="new">New</span>' : ''}</span>${it.why ? `<br><span class="w">${esc(it.why)}</span>` : ''}</label>
        <span class="row"><input class="who" data-act-input="who" data-i="${i}" maxlength="24" value="${esc(it.who || '')}" placeholder="Who?" aria-label="Who brings ${esc(it.name)}">${it.custom ? `<button type="button" class="x" data-act="item-del" data-i="${i}" aria-label="Remove ${esc(it.name)}">×</button>` : ''}</span></div>`).join('') : '<p class="small muted">Nothing special needed.</p>'}</div>
      <div class="additem"><input id="newItem" maxlength="40" placeholder="Add your own" aria-label="Add your own item"><button type="button" class="btn" data-act="item-add">Add</button></div></section>`;
    const home = gettingHome({ pt: mo.pt, tz, walkIn: dr.walkIn, spot: mo.hasPin ? dr.spot : { name: dr.spot.name, lat: null }, twilight: mo.times.state === 'twilight', date: dr.date,
      homeBy: clockOn(dr.date, dr.homeBy, tz), travel: mo.travel });
    preparePlanCard();
    return `${head}<div class="two"><div class="col">${timesCard}${actions}${home}</div><div class="col">${placeCard}${lightCard(mo.ev, tz, upd)}${bring}</div></div>`;
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
    const scoreLine = live ? `<p class="planans v ${live.verdict}">${icon(live)}<b>${answerShort(live)}</b></p><p class="small">${esc(live.reason)}</p>`
      : pl.scoreAtSave != null ? `<p class="small muted">${G.answerOf(pl.scoreAtSave) === 'go' ? 'It looked good' : G.answerOf(pl.scoreAtSave) === 'maybe' ? 'It looked possible' : 'It didn’t look promising'} when this plan was made.</p>` : '';
    return `<section class="hero"><p class="when">${esc(dayName(pl.date, true))} ${esc(dateText(pl.date))}</p><h2>${esc(pl.spot.name || 'Sunset')}</h2><p class="tagline">A sunset plan, shared with you</p></section>
      ${pl.changed ? `<div class="warn chgd" role="note">${ICON.warn}<span>Changed: ${esc(pl.changed)}.</span></div>` : ''}
      ${dropped ? `<div class="warn" role="note">${ICON.warn}<span>The forecast has dropped since this plan was made. Check with whoever sent you this.</span></div>` : ''}
      <div class="two"><div class="col">
        <section class="card"><p class="eyebrow">The evening</p>${scoreLine}<div data-gap>${timeline(pl.times, tz, { twilight: times.state === 'twilight', walkIn: pl.walkIn })}</div>
          ${pl.note ? `<p class="note" data-gap>${esc(pl.note)}</p>` : ''}</section>
        <section class="card"><p class="eyebrow">The place</p><div class="map" id="map"><div class="msg" id="mapMsg">Loading the map…</div></div>
          <div class="row" data-gap><a class="btn primary" target="_blank" rel="noopener" href="${esc(directionsUrl(pl.spot))}">Directions</a><button type="button" class="btn" data-act="calendar">Add to calendar</button></div></section>
      </div><div class="col">
        ${gettingHome({ pt: pl.times, tz, walkIn: pl.walkIn, spot: pl.spot, twilight: times.state === 'twilight', date: pl.date })}
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
    const v = S.sheet && S.sheet.kind === 'spot' ? S.sheet : S.view;
    if (!v) return;
    const shared = v.type === 'shared' || v.kind === 'spot';
    const spot = v.type === 'shared' ? (v.plan && v.plan.spot) : v.kind === 'spot' ? v.spot : v.draft.spot;
    if (shared && !spot) return;
    if (!v.key) v.key = ++viewSeq;
    if (mapEl && mapKey === v.key) { slot.replaceWith(mapEl); if (map) { map.resize(); syncMarker(spot, shared); } return; }
    if (map) { try { map.remove(); } catch { /* already gone */ } }
    map = null; marker = null; mapEl = slot; mapKey = v.key;
    const p = place(), centre = spot && spot.lat != null ? [spot.lon, spot.lat] : [p.lon, p.lat];
    const failed = shared ? 'The map couldn’t load. Directions still works.' : 'The map couldn’t load. Search for the venue, or type coordinates.';
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
    }).catch(() => { note('Map', false, 'the map could not load'); if (mapKey === key) mapFallback(failed); });
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
  /** Finds the places around a location, once a fortnight. It never waits on the forecast, a failure is never
      remembered, and "Looking for places…" shows meanwhile. */
  async function loadSpots(p) {
    const d = DATA[p.id] || (DATA[p.id] = { prev: {}, snaps: {} });
    if (p.sample) { d.spots = finishSample(p); d.near = sampleNear(); return; }
    if (d.spots && d.spots !== 'error') return;
    if (d.spotsLoading) return d.spotsLoading;
    d.spotsTriedAt = now(); d.spots = null;
    d.spotsLoading = (async () => {
      try {
        const body = await overpass(G.spotsQuery(Math.round(p.lat * 100) / 100, Math.round(p.lon * 100) / 100), 'Places', SPOT_TTL);
        d.spotsRaw = body.elements;
        rankInto(p);
        loadNear(p).then(() => update(p));
      } catch { d.spots = 'error'; }
    })();
    try { await d.spotsLoading; } finally { d.spotsLoading = null; }
  }
  function rankInto(p) {
    const d = DATA[p.id];
    d.spots = G.rankSpots(d.spotsRaw, { lat: p.lat, lon: p.lon, elevation: d.elevation == null ? null : d.elevation, facing: evenings(p)[0].times.azimuth });
  }
  /** Parking and toilets within a short walk of the places most likely to be shown: a second, small lookup. */
  async function loadNear(p) {
    const d = DATA[p.id], s = allSpots(p);
    if (!s || (d.near && d.near !== 'error') || d.nearLoading) return;
    const list = [...ownSpots(p).slice(0, 6), ...s.easy.slice(0, 14), ...s.dining.slice(0, 14), ...s.adventurous.slice(0, 6)];
    if (!list.length) { d.near = {}; return; }
    d.nearLoading = true;
    try { d.near = G.matchNear(list, (await overpass(G.nearQuery(list), 'Parking and toilets', SPOT_TTL, true)).elements); } catch { d.near = 'error'; } finally { d.nearLoading = false; }
  }
  function finishSample(p) {
    const out = {};
    for (const [k, list] of Object.entries(SAMPLE_SPOTS)) out[k] = list.map((s) => { const km = G.distance(p.lat, p.lon, s.lat, s.lon) / 1000; return { effort: k === 'easy' ? 'easy' : s.effort, ...s, km, travel: G.travelMinutes(km) }; });
    return out;
  }
  function sampleNear() {
    const out = {};
    for (const list of Object.values(SAMPLE_SPOTS)) list.forEach((s, i) => { out[s.id] = { parking: s.cat !== 'adventurous' || i === 0, toilets: s.cat === 'dining' || i % 2 === 0 }; });
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
  /** What the map says is within a short walk of a place: {parking, toilets}, or null when it wasn't checked. */
  function nearOf(p, s) { const d = DATA[p.id] || {}; return d.near && typeof d.near === 'object' ? d.near[s.id] || null : null; }
  function nearText(p, s) {
    const d = DATA[p.id] || {}, n = nearOf(p, s);
    if (d.near === 'error') return 'Parking and toilets: couldn’t check.';
    if (!n) return d.nearLoading ? 'Checking for parking and toilets…' : '';
    if (n.parking && n.toilets) return 'Parking and toilets nearby.';
    if (n.parking) return 'Parking nearby. Toilets not listed.';
    if (n.toilets) return 'Toilets nearby. Parking not listed.';
    return 'Parking and toilets not listed.';
  }

  const away = (s) => `${s.km < 0.2 ? 'Here' : `${esc(G.distanceText(s.km, settings.imperialFirst, true))} · about ${s.travel} min`}`;
  /** The place on Google Maps, to see photos and what kind of place it is. Opens Google; nothing is sent until tapped. */
  function mapsUrl(s, p) {
    const named = s.cat !== 'own' && s.name;
    const q = named ? [s.name, p && p.name, p && p.region].filter(Boolean).join(', ') : `${s.lat},${s.lon}`;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }
  const effortWord = (s) => (s.cat === 'own' ? 'Your spot' : s.cat === 'dining' ? 'May need a booking' : EFFORT[s.effort] || '');
  /** One row for a place: its picture, name, what it is, how far and how hard. Tapping opens it, or plans there. */
  function spotRow(s, p, i, act, date, extra) {
    return `<button type="button" class="srow" data-act="${act || 'spot-open'}" data-id="${esc(s.id)}" data-place="${esc(p.id)}"${date ? ` data-date="${date}"` : ''}>
      <span class="sbadge c-${s.cat} k-${kindIconName(s)}" aria-hidden="true">${kindIcon(s)}${i != null ? `<b class="rank">${i + 1}</b>` : s.cat === 'own' ? '<b class="rank own"><svg viewBox="0 0 40 40"><use href="#k-heart"/></svg></b>' : ''}</span>
      <span class="sl"><span class="n">${esc(s.name)}</span><span class="r">${esc(s.kind || G.SPOT_CAT[s.cat] || '')} · ${away(s)}</span>${extra ? `<span class="r near">${esc(extra)}</span>` : ''}<span class="e e-${esc(s.cat === 'own' ? 'own' : s.effort || 'own')}">${esc(effortWord(s))}</span></span>
      <span class="chev">${SP.chev}</span></button>`;
  }

  /** All the places near a location, in four parts, with three filters for what you need there. */
  const FILTERS = [['parking', 'Parking'], ['toilets', 'Toilets'], ['walk', 'Short walk']];
  function passes(p, s) {
    const f = S.filters, n = nearOf(p, s);
    return (!f.parking || !!(n && n.parking)) && (!f.toilets || !!(n && n.toilets)) && (!f.walk || WALK_OF_SPOT(s) <= 10);
  }
  function spotsView() {
    const v = S.view, p = place(v.placeId), s = allSpots(p), mine = ownSpots(p), d = DATA[p.id] || {};
    skyOf(p);
    const on = FILTERS.filter(([k]) => S.filters[k]), filtering = on.length > 0;
    const wants = on.map(([, label]) => label.toLowerCase()).join(' and ');
    const total = filtering && s ? [...mine, ...s.easy, ...s.dining, ...s.adventurous].filter((x) => passes(p, x)).length : 0;
    const showNear = S.filters.parking || S.filters.toilets;
    const part = (c, list) => {
      const fit = filtering && total ? list.filter((x) => passes(p, x)) : list;
      const open = v.expanded[c.key], shown = open ? fit : fit.slice(0, 5);
      if (filtering && total && !fit.length) return '';
      return `<section class="card spotcard a-${c.key}"><p class="eyebrow">${SP[c.icon]}<span>${c.title}</span></p><p class="catsub">${c.key === 'dining' ? 'From open map data, not checked. You may need to book' : c.sub}</p>
        ${shown.length ? shown.map((x, i) => spotRow(x, p, i, null, null, showNear ? nearText(p, x) || 'Parking and toilets not checked.' : '')).join('') : '<p class="small muted">None found nearby in open map data.</p>'}
        ${fit.length > 5 ? `<button type="button" class="more" data-act="spots-more" data-k="${c.key}">${open ? 'Show fewer' : `Show ${fit.length - 5} more`}</button>` : ''}</section>`;
    };
    const chips = `<div class="chips" role="group" aria-label="Show places with">${FILTERS.map(([k, label]) => `<button type="button" class="chip" data-act="filter" data-k="${k}" aria-pressed="${!!S.filters[k]}">${label}</button>`).join('')}</div>`;
    const none = filtering && s && !total ? `<p class="pstate" role="status">None listed with ${esc(wants)} here. These are the nearest places${showNear ? ', with what the map says about each' : ''}.</p>` : '';
    const lists = !s ? `<section class="card">${placesState(p)}</section>` : `${none}<div class="spotgrid wide">${CATS.map((c) => part(c, s[c.key])).join('')}</div>`;
    const myFit = filtering && total ? mine.filter((x) => passes(p, x)) : mine;
    return `<div class="row top"><button type="button" class="btn quiet back" data-act="close-view">‹ ${esc(p.name)}</button></div>
      <header class="screenhead"><h1>Places</h1><p>Where to watch the sunset near ${esc(p.name)}${p.sample ? ' (sample)' : ''}</p></header>
      ${chips}${d.near === 'error' && showNear ? '<p class="pstate">Couldn’t check for parking and toilets. <button type="button" class="link" data-act="near-retry">Try again</button></p>' : ''}
      ${lists}
      <section class="card spotcard a-own"><p class="eyebrow">${SP.heart}<span>Your spots</span></p><p class="catsub">Places you love to watch from. Only on this device.</p>
        ${myFit.length ? myFit.map((x) => spotRow(x, p)).join('') : `<p class="small muted">${mine.length ? 'None of yours match.' : 'None yet.'}</p>`}
        <div class="row" data-gap><button type="button" class="btn white" data-act="spot-add" data-place="${esc(p.id)}">Add your own spot</button></div></section>
      <p class="small credit">${p.sample ? 'Sample places. ' : ''}From OpenStreetMap, not checked by us: well-known places, and places named for the sunset, come first. Parking and toilets are those the map lists within a short walk.</p>`;
  }

  /** One place, in a sheet: what it is, what's there, how to get there, and the way to plan the evening. */
  function spotSheet() {
    const sh = S.sheet, p = place(sh.placeId) || place(), sp = sh.spot, own = sp.cat === 'own', saved = S.spots.some((x) => x.id === sp.id || (Math.abs(x.lat - sp.lat) < 1e-4 && Math.abs(x.lon - sp.lon) < 1e-4));
    const km = G.distance(p.lat, p.lon, sp.lat, sp.lon) / 1000, travel = G.travelMinutes(km), ev = shownEvening(p), r = ev.rating;
    const facts = [];
    facts.push(`${km < 0.2 ? 'Right here' : `${esc(G.distanceText(km, settings.imperialFirst))} from ${esc(p.name)}, about ${travel} min by car`}.`);
    const near = nearText(p, sp);
    if (near) facts.push(esc(near));
    if (sp.wheelchair === 'yes') facts.push('Step-free access.'); else if (sp.wheelchair === 'no') facts.push('Not step-free.');
    if (sp.dog === 'yes') facts.push('Dogs allowed.'); else if (sp.dog === 'no') facts.push('No dogs.');
    if (sp.fee === 'yes') facts.push('There may be a fee.');
    if (sp.hours) facts.push(`Hours: ${esc(sp.hours)}. Check before you go.`);
    else if (sp.cat === 'dining') facts.push('Opening hours not listed. Check before you go.');
    if (sp.ele != null && sp.gain != null && sp.gain > 50) facts.push(`${Math.round(sp.gain * 3.28084).toLocaleString('en-US')} ft · ${Math.round(sp.gain).toLocaleString('en-US')} m above ${esc(p.name)}.`);
    if (sp.faces === true) facts.push('Faces the sunset.');
    if (sp.faces === false) facts.push('Faces away from the sunset: look for a clear view west.');
    if (ev.times.lastLight != null) facts.push(`${ev.day === 0 ? 'Tonight' : 'That evening'} it is dark by ${esc(timeText(ev.times.lastLight, p.tz))}. Lighting not listed.`);
    const tonight = r ? `<p class="planans v ${r.verdict}">${icon(r)}<b>${esc(answerText(ev))}</b></p><p class="small">Sunset ${esc(timeText(ev.times.sunset, p.tz))}, be there by ${esc(timeText(ev.times.bestStart - 20 * MIN, p.tz))}.${km > 15 ? ` Forecast for ${esc(p.name)}; a plan uses the forecast here.` : ''}</p>` : '';
    const links = [sp.website ? `<a class="btn" href="${esc(sp.website)}" target="_blank" rel="noopener">Website</a>` : '', sp.phone ? `<a class="btn" href="tel:${esc(sp.phone.replace(/[^\d+]/g, ''))}">Call</a>` : ''].join('');
    const canPlan = now() < endOf(ev, p);
    return `<div class="sh-head"><button type="button" class="done" data-act="sheet-close">Done</button><h2 id="sheetTitle">${esc(sp.kind || G.SPOT_CAT[sp.cat] || 'Your spot')}</h2>
        <span class="nav"><button type="button" class="circle sm" data-act="share-spot" aria-label="Share ${esc(sp.name)}">${SP.share}</button></span></div>
      <section class="hero spothero"><span class="sbadge big c-${sp.cat} k-${kindIconName(sp)}" aria-hidden="true">${kindIcon(sp)}</span><h2>${esc(sp.name)}</h2><p class="when">${esc(effortWord(sp))}${sh.shared ? ' · Shared with you' : ''}</p></section>
      ${tonight ? `<section class="card">${tonight}</section>` : ''}
      <div class="cta row center">${canPlan ? `<button type="button" class="btn primary" data-act="spot-plan">Plan ${esc(planWord(ev))} here</button>` : ''}<a class="btn white" target="_blank" rel="noopener" href="${esc(directionsUrl(sp))}">${SP.car}Directions</a></div>
      <section class="card"><p class="eyebrow">${catIcon(sp.cat)}<span>Know before you go</span></p><ul class="facts">${facts.filter(Boolean).map((f) => `<li><span>${f}</span></li>`).join('')}</ul>
        ${!own && !sp.sample ? `<p class="small muted" data-gap>${esc(G.spotReason(sp))}. From open map data, not checked.</p>` : ''}
        <div class="row" data-gap><a class="btn glink" target="_blank" rel="noopener" href="${esc(mapsUrl(sp, p))}">Photos and reviews on Google Maps</a>${links}</div></section>
      <section class="card"><p class="eyebrow">${SP.landmark}<span>Where</span></p><div class="map" id="map"><div class="msg">Loading the map…</div></div></section>
      <section class="card"><div class="row"><button type="button" class="btn" data-act="share-spot">${SP.share}Share this place</button><span class="sp"></span>
        ${own ? `<button type="button" class="btn quiet danger" data-act="spot-del">Remove</button>` : saved ? '<span class="small muted">In your spots</span>' : `<button type="button" class="btn" data-act="spot-save">${SP.heart}Save to your spots</button>`}</div></section>`;
  }

  /** Add your own spot: a name, a kind, and a pin. */
  function addSpotView() {
    const v = S.view, dr = v.draft, p = place(v.placeId);
    skyOf(p);
    const coords = dr.spot.lat != null ? `${dr.spot.lat.toFixed(5)}, ${dr.spot.lon.toFixed(5)}` : '';
    return `<div class="row top"><button type="button" class="btn quiet back" data-act="close-view">‹ Back</button></div>
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

  // ---------- Sharing: today's sunset, the week, a plan, a place, the app ----------
  const appUrl = () => location.origin + location.pathname;
  /** Opens the share sheet straight from the tap. → true when it was shared or copied, false when cancelled. */
  async function shareOut(o) {
    // The Android app has no web share sheet; it opens Android's own, with the words and the link.
    const droid = window.GoldenHourAndroid;
    if (droid && droid.share) { try { droid.share(o.title || 'Golden Hour', `${o.text}\n${o.url}`); return true; } catch { /* fall through */ } }
    try {
      if (o.file && navigator.canShare && navigator.canShare({ files: [o.file] })) { await navigator.share({ files: [o.file], title: o.title, text: `${o.text}\n${o.url}` }); return true; }
      if (navigator.share) { await navigator.share({ title: o.title, text: o.text, url: o.url }); return true; }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    try { await navigator.clipboard.writeText(`${o.text}\n${o.url}`); toast('Copied, ready to paste'); return true; } catch { window.prompt('Copy and share', `${o.text}\n${o.url}`); return true; }
  }
  /** A picture for a message: the evening's sky with a few lines of large type on it. */
  async function drawCard(r, name, paint) {
    const W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), stops = skyStops(r), grad = g.createLinearGradient(0, 0, 0, H);
    [0, 0.46, 0.72, 0.9, 1].forEach((o, i) => grad.addColorStop(o, stops[i]));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    if (r && !r.cap) { const rg = g.createRadialGradient(W / 2, H * 0.96, 0, W / 2, H * 0.96, 420); rg.addColorStop(0, 'rgba(255,240,200,.9)'); rg.addColorStop(0.25, 'rgba(255,214,150,.5)'); rg.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
    try { await document.fonts.load('300 100px Inter'); await document.fonts.load('600 40px Inter'); } catch { /* system font */ }
    const font = (w, s) => `${w} ${s}px Inter, -apple-system, system-ui, sans-serif`;
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 16;
    /** Text centred at y, wrapped to at most `max` lines; returns the y after it. */
    const text = (str, y, weight, size, max, alpha) => {
      g.font = font(weight, size); g.globalAlpha = alpha == null ? 1 : alpha;
      const words = String(str).split(/\s+/), lines = []; let cur = '';
      for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > W - 140 && cur) { lines.push(cur); cur = w; } else cur = t; }
      lines.push(cur);
      const shown = lines.slice(0, max || 2);
      if (lines.length > shown.length) shown[shown.length - 1] = shown[shown.length - 1].replace(/\W*\w+$/, '') + '…';
      shown.forEach((l, i) => g.fillText(l, W / 2, y + i * size * 1.18));
      g.globalAlpha = 1;
      return y + shown.length * size * 1.18;
    };
    paint(text, g, W, H);
    g.globalAlpha = 0.9; g.font = font(600, 40); g.fillText('Golden Hour', W / 2, H - 120); g.font = font(400, 32); g.fillText(appUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, H - 70);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return blob ? new File([blob], `golden-hour-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'sunset'}.png`, { type: 'image/png' }) : null;
  }
  /** Today's sunset as a picture: the answer, why, and the time. */
  function sunsetCard(p, ev) {
    const r = ev.rating, t = ev.times;
    return drawCard(r, p.name, (text) => {
      let y = text(`${dayName(ev.date, true)}, ${dateText(ev.date)}`.toUpperCase(), 170, 500, 40, 1, 0.9);
      y = text(p.name, y + 80, 400, 88, 2);
      if (r) { y = text(answerText(ev), y + 190, 300, 150, 2); y = text(r.reason, y - 10, 500, 46, 3, 0.95); }
      if (t.sunset != null) { y = text(`Sunset ${timeText(t.sunset, p.tz)}`, Math.max(y + 100, 900), 600, 68, 1);
        if (!r || r.verdict !== 'skip') text(`Be there by ${timeText(t.bestStart - 20 * MIN, p.tz)}`, y + 10, 500, 50, 1, 0.95); }
    });
  }
  /** The evenings ahead as a picture: one line each, the best one marked. */
  function weekCard_(p) {
    const evs = evenings(p).filter((e) => e.rating), best = evs.filter((e) => e.rating.verdict === 'go').sort((a, b) => b.rating.score - a.rating.score)[0];
    return drawCard(best ? best.rating : evs[0] && evs[0].rating, p.name + '-week', (text, g, W) => {
      let y = text('SUNSETS THIS WEEK', 170, 500, 40, 1, 0.9);
      y = text(p.name, y + 80, 400, 88, 1) + 70;
      for (const e of evs.slice(0, 6)) {
        g.textAlign = 'left'; g.font = '500 54px Inter, -apple-system, system-ui, sans-serif'; g.fillText(e.day === 0 ? 'Today' : dayName(e.date, true), 110, y);
        g.font = '600 54px Inter, -apple-system, system-ui, sans-serif'; g.fillText(answerShort(e.rating) + (best && e.date === best.date ? ' · best' : ''), 470, y);
        g.textAlign = 'right'; g.font = '400 48px Inter, -apple-system, system-ui, sans-serif'; g.globalAlpha = 0.9; g.fillText(timeText(e.times.sunset, p.tz), W - 110, y); g.globalAlpha = 1;
        y += 104;
      }
      g.textAlign = 'center';
    });
  }
  /** A plan as a picture: where, when to be there, and when it changed. */
  function planCard(plan, r, changed) {
    const tz = tzOr(plan.tz), t = plan.times, f = (ms) => timeText(ms, tz);
    return drawCard(r, plan.spot.name, (text) => {
      let y = text(changed ? `CHANGED: ${changed}`.toUpperCase() : 'SUNSET PLAN', 170, 600, 40, 2, 0.95);
      y = text(plan.spot.name, y + 80, 400, 84, 2);
      y = text(`${dayName(plan.date, true)}, ${dateText(plan.date)}`, y + 10, 500, 46, 1, 0.95);
      y = text(`Be there by ${f(t.meetAt)}`, Math.max(y + 150, 640), 300, 112, 2);
      y = text(`Sunset ${f(t.sunset)}`, y + 30, 600, 60, 1);
      y = text(`Start back by ${f(t.headBackBy - (plan.walkIn || 0) * MIN)}`, y + 10, 500, 46, 1, 0.95);
      if (plan.note) text(plan.note, y + 50, 500, 42, 2, 0.95);
    });
  }
  const locationLink = (p) => `${appUrl()}#l=${encodeURIComponent([p.name, p.lat.toFixed(4), p.lon.toFixed(4), p.tz || ''].join('~'))}`;
  // The pictures are made ahead of time: a phone only lets the share sheet open straight from the tap, so
  // there is no time to draw one then.
  const cardCache = { key: null, file: null }, weekCache = { key: null, file: null }, planCache = { key: null, file: null };
  const cardKey = (p, ev) => `${p.id}|${ev.date}|${ev.rating ? ev.rating.score : ''}|${settings.imperialFirst}`;
  const weekKey = (p) => `${p.id}|${evenings(p).map((e) => (e.rating ? e.rating.score : '')).join(',')}`;
  let cardTimer = 0, planCardTimer = 0;
  function prepareCard(p) {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(async () => {
      const ev = shownEvening(p), key = cardKey(p, ev), wk = weekKey(p);
      try { if (cardCache.key !== key) { cardCache.file = await sunsetCard(p, ev); cardCache.key = key; } } catch { /* text only */ }
      try { if (weekCache.key !== wk) { weekCache.file = await weekCard_(p); weekCache.key = wk; } } catch { /* text only */ }
    }, 600);
  }
  async function shareToday(p) {
    const ev = shownEvening(p), r = ev.rating, t = ev.times;
    const line = r ? `${answerText(ev)} in ${p.name}. ${r.reason}` : `The sunset in ${p.name}.`;
    const times = t.sunset != null ? ` Sunset ${timeText(t.sunset, p.tz)}${r && r.verdict !== 'skip' ? `, be there by ${timeText(t.bestStart - 20 * MIN, p.tz)}` : ''}.` : '';
    const file = cardCache.key === cardKey(p, ev) ? cardCache.file : null;
    await shareOut({ title: 'Golden Hour', text: `${line}${times}`, url: locationLink(p), file });
    if (!file) prepareCard(p);
  }
  async function shareWeek(p) {
    const evs = evenings(p).filter((e) => e.rating), best = evs.filter((e) => e.rating.verdict === 'go').sort((a, b) => b.rating.score - a.rating.score)[0];
    const lines = evs.map((e) => `${e.day === 0 ? 'Today' : dayName(e.date, true)}: ${answerShort(e.rating)}${best && best.date === e.date ? ' (best)' : ''}, sunset ${timeText(e.times.sunset, p.tz)}`);
    const file = weekCache.key === weekKey(p) ? weekCache.file : null;
    await shareOut({ title: 'Golden Hour', text: `Sunsets this week in ${p.name}:\n${lines.join('\n')}`, url: locationLink(p), file });
    if (!file) prepareCard(p);
  }
  async function shareSpot(sp, p) {
    const url = `${appUrl()}#s=${G.encodeSpot(sp)}`, ev = shownEvening(p), r = ev.rating;
    const tonight = r && G.distance(p.lat, p.lon, sp.lat, sp.lon) < 30000 ? ` ${answerText(ev)}: sunset ${timeText(ev.times.sunset, p.tz)}.` : '';
    await shareOut({ title: sp.name, text: `${sp.name}: a place to watch the sunset${p ? ` near ${p.name}` : ''}.${tonight}`, url });
  }
  const shareApp = () => shareOut({ title: 'Golden Hour', text: 'Golden Hour: is tonight’s sunset worth it, where to watch from, and a plan to send. Free, no account.', url: appUrl() });

  // ---------- Plan actions ----------
  /** A new plan, kept from the first tap. With a place it is ready to share; without one it asks where. */
  function newDraft(date, p, spot) {
    const at = p || place();
    return { id: 'p' + now().toString(36) + Math.random().toString(36).slice(2, 6), placeId: at.id, tz: at.tz, date,
      spot: spot ? { name: spot.name, type: TYPE_OF_SPOT(spot), lat: spot.lat, lon: spot.lon } : { name: '', type: 'outdoor', lat: null, lon: null },
      walkIn: spot ? WALK_OF_SPOT(spot) : 5, start: { lat: at.lat, lon: at.lon, label: at.name, kind: 'place' }, items: [], mapImage: null, createdAt: now() };
  }
  const planDraft = () => (S.view && S.view.type === 'plan' ? S.view.draft : null);
  function startPlan(dr) { go({ type: 'plan', draft: dr }); autosave(); }
  function setPin(lat, lon, name, soon) {
    const dr = S.view.draft;
    keepFields();
    dr.spot.lat = Math.round(lat * 1e5) / 1e5; dr.spot.lon = Math.round(lon * 1e5) / 1e5;
    if (name) dr.spot.name = name;
    autosave();
    if (soon) renderSoon(); else render();
  }
  /** Reads the form back into the draft, so a redraw never loses typing. */
  function keepFields() {
    const dr = S.view && S.view.draft;
    if (!dr || !$('#spotName')) return;
    dr.spot.name = $('#spotName').value.trim().slice(0, 60);
    dr.spot.type = $('#spotType').value;
    if ($('#walkIn')) dr.walkIn = Math.max(0, Math.min(240, Math.round(Number($('#walkIn').value) || 0)));
    if (S.view.type !== 'plan') return;
    if ($('#planNote')) dr.note = $('#planNote').value.trim().slice(0, 200);
    if ($('#homeBy')) dr.homeBy = $('#homeBy').value || null;
    // "Be there by" and "Travel" show the app's own figure until the planner changes them.
    const auto = planModel({ ...dr, arriveBy: null, travelMin: null });
    if ($('#arriveBy')) { const v = $('#arriveBy').value; dr.arriveBy = v && auto.pt && v !== hhmm(auto.pt.meetAt, auto.tz) ? v : null; }
    if ($('#travelMin')) { const v = $('#travelMin').value, n = Math.max(0, Math.min(600, Math.round(Number(v) || 0))); dr.travelMin = v !== '' && n !== auto.travel ? n : null; }
  }
  function toPlan(dr, model) {
    const mo = model || planModel(dr);
    return { id: dr.id, v: 2, placeId: dr.placeId, tz: mo.tz, spot: { ...dr.spot }, date: dr.date, walkIn: dr.walkIn, travel: mo.travel, buffer: mo.buffer, start: dr.start, times: mo.pt,
      items: mo.items.map((i) => ({ ...i, isNew: false })), scoreAtSave: dr.scoreAtSave == null ? (mo.r ? mo.r.score : null) : dr.scoreAtSave, mapImage: dr.mapImage, createdAt: dr.createdAt || now(),
      arriveBy: dr.arriveBy || null, travelMin: dr.travelMin == null ? null : dr.travelMin, homeBy: dr.homeBy || null, note: dr.note || '', sent: dr.sent || null };
  }
  /** Keeps the plan on screen. Called on every change and on leaving, so going back never loses it. */
  function autosave() {
    const dr = planDraft();
    if (!dr || db.isBlocked()) return;
    const mo = planModel(dr);
    dr.items = mo.items;
    dr.mapImage = mapSnapshot() || dr.mapImage;
    const plan = toPlan(dr, mo);
    db.put('plans', plan);
    S.plans = S.plans.filter((x) => x.id !== plan.id).concat(plan);
  }
  /** A plan opened and left with nothing in it is not kept. */
  function dropEmptyDraft() {
    const dr = planDraft();
    if (!dr || dr.spot.lat != null || dr.spot.name || dr.note || (dr.items || []).some((i) => i.custom)) return;
    S.plans = S.plans.filter((x) => x.id !== dr.id); db.del('plans', dr.id);
  }
  function openPlan(id) {
    const pl = S.plans.find((x) => x.id === id);
    if (!pl) return;
    if (S.places.some((p) => p.id === pl.placeId)) S.current = pl.placeId;
    go({ type: 'plan', draft: { id: pl.id, placeId: pl.placeId, tz: pl.tz, date: pl.date, spot: { ...pl.spot }, walkIn: pl.walkIn, start: pl.start, items: pl.items, mapImage: pl.mapImage, createdAt: pl.createdAt,
      arriveBy: pl.arriveBy || null, travelMin: pl.travelMin == null ? null : pl.travelMin, homeBy: pl.homeBy || null, note: pl.note || '', sent: pl.sent || null, scoreAtSave: pl.scoreAtSave } });
    const p = place(pl.placeId);
    if (p) load(p).then(() => { if (planDraft()) { keepFields(); render(); } });
  }
  function shareUrl(plan) { return location.origin + location.pathname + '#p=' + G.encodePlan({ ...plan, spot: { ...plan.spot, name: plan.spot.name || 'Sunset spot' }, sharedAt: now() }); }
  /** What changed since the plan was last sent: the day, the place or the time. */
  function changeLine(sent, plan) {
    if (!sent) return '';
    if (sent.date !== plan.date) return `now ${dayName(plan.date, true)}`;
    if (sent.name !== plan.spot.name) return `now at ${plan.spot.name}`;
    if (sent.meetAt !== plan.times.meetAt) return `now ${timeText(plan.times.meetAt, plan.tz)}`;
    return '';
  }
  const planCardKey = (plan, changed) => [plan.id, plan.date, plan.spot.name, plan.times.meetAt, plan.times.headBackBy, plan.walkIn, plan.note, changed, settings.imperialFirst].join('|');
  /** Draws the plan's picture a moment after the plan settles, so Share can open the sheet at once. */
  function preparePlanCard() {
    clearTimeout(planCardTimer);
    planCardTimer = setTimeout(async () => {
      const dr = planDraft();
      if (!dr) return;
      const mo = planModel(dr);
      if (!mo.hasPin || !mo.pt) return;
      const plan = toPlan(dr, mo), changed = changeLine(dr.sent, plan), key = planCardKey(plan, changed);
      if (planCache.key === key) return;
      try { planCache.file = await planCard({ ...plan, spot: { ...plan.spot, name: plan.spot.name || 'Sunset spot' } }, mo.r, changed); planCache.key = key; } catch { /* text only */ }
    }, 500);
  }
  /** Share, in one tap: the picture if it is ready, the words and the link. An update says what changed. */
  async function shareGo() {
    keepFields(); autosave();
    const dr = planDraft(), mo = planModel(dr);
    if (!mo.hasPin || !mo.pt) return toast('Choose the place first');
    const plan = toPlan(dr, mo), changed = changeLine(dr.sent, plan), url = shareUrl({ ...plan, changed });
    if (url.length > 2000 + location.origin.length + location.pathname.length) return toast('Too many items to fit in a link. Remove a few.');
    const name = plan.spot.name || 'the sunset spot', f = (ms) => timeText(ms, plan.tz);
    const text = `${changed ? `Changed: ${changed}. ` : ''}Sunset at ${name}, ${dayName(plan.date, true)}. Be there by ${f(plan.times.meetAt)}; sunset ${f(plan.times.sunset)}.${plan.note ? ` ${plan.note}` : ''}`;
    const file = planCache.key === planCardKey(plan, changed) ? planCache.file : null;
    const done = await shareOut({ title: 'Golden Hour', text, url, file });
    if (!done || !planDraft() || planDraft().id !== dr.id) return;
    dr.sent = { meetAt: plan.times.meetAt, date: plan.date, name: plan.spot.name, at: now() };
    keepFields(); autosave(); render();
  }
  /** The calendar event: from leave-by for the organiser, from be-there-by for someone it was shared with,
      with a reminder half an hour before. In the iPhone and Android apps it opens the calendar's own "new event" screen. */
  async function addToCalendar() {
    const shared = S.view.type === 'shared';
    const plan = shared ? S.view.plan : (keepFields(), autosave(), toPlan(S.view.draft));
    if (!plan.times || plan.spot.lat == null) return toast('Choose the place first');
    const tz = tzOr(plan.tz), t = plan.times, f = (ms) => timeText(ms, tz), name = plan.spot.name || 'Sunset spot';
    const link = shared ? location.href : shareUrl(plan);
    const lines = [];
    if (!shared) lines.push(`Leave by ${f(t.leaveBy)}`);
    lines.push(`Be there by ${f(t.meetAt)}`, `Sunset ${f(t.sunset)}`, `Stay until ${f(t.stayUntil)} for the afterglow`, `Start back by ${f(t.headBackBy - (plan.walkIn || 0) * MIN)} to be back before dark`);
    if (plan.note) lines.push('', plan.note);
    if (plan.items.length) lines.push('', 'Bring: ' + plan.items.map((i) => (i.who ? `${i.name} (${i.who})` : i.name)).join(', '));
    lines.push('', link);
    const ev = { id: plan.id || 'shared-' + plan.date, now: now(), start: shared ? t.meetAt : t.leaveBy, end: t.headBackBy, title: `Sunset at ${name}`,
      location: `${name} (${plan.spot.lat.toFixed(5)}, ${plan.spot.lon.toFixed(5)})`, description: lines.join('\n'), alarm: 30 };
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.goldenHour;
    if (native) { try { native.postMessage({ type: 'calendar', title: ev.title, start: ev.start, end: ev.end, location: ev.location, notes: ev.description, alarm: ev.alarm }); return; } catch { /* fall through to the file */ } }
    const droid = window.GoldenHourAndroid;
    if (droid && droid.calendar) { try { droid.calendar(JSON.stringify({ title: ev.title, start: Math.round(ev.start), end: Math.round(ev.end), location: ev.location, notes: ev.description })); return; } catch { /* fall through to the file */ } }
    const file = new File([G.ics(ev)], 'golden-hour.ics', { type: 'text/calendar' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: ev.title }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = 'golden-hour.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Calendar file saved. Open it to add the event.');
  }

  // ---------- Finding a venue by name or address (Photon, from open map data) ----------
  let venueTimer = 0, venueSeq = 0;
  function bindVenueSearch() { const q = $('#venueQ'); if (q) q.addEventListener('input', onVenueInput); drawVenueResults(); }
  function drawVenueResults() {
    const list = $('#venueResults'), res = S.view && S.view.venues;
    if (!list) return;
    if (!res) list.innerHTML = '';
    else if (typeof res === 'string') list.innerHTML = `<p class="small muted">${esc(res)}</p>`;
    else list.innerHTML = res.map((r, i) => `<button type="button" class="result" data-act="venue-pick" data-i="${i}"><span><span class="n">${esc(r.name)}</span><br><span class="r">${esc(r.region)}</span></span><span class="sp"></span><span aria-hidden="true">+</span></button>`).join('');
  }
  function onVenueInput(e) {
    const q = e.target.value.trim(), seq = ++venueSeq;
    S.view.venueQ = e.target.value;
    clearTimeout(venueTimer);
    if (q.length < 3) { S.view.venues = null; return drawVenueResults(); }
    venueTimer = setTimeout(async () => {
      const p = place(S.view.draft.placeId), t0 = now();
      let out;
      try {
        const r = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q, limit: '6', lang: 'en', ...(p ? { lat: p.lat.toFixed(3), lon: p.lon.toFixed(3) } : {}) }), { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        out = ((await r.json()).features || []).filter((f) => f.geometry && Array.isArray(f.geometry.coordinates) && Number.isFinite(f.geometry.coordinates[0])).map((f) => {
          const o = f.properties || {}, street = [o.housenumber, o.street].filter(Boolean).join(' ');
          return { name: String(o.name || street || q).slice(0, 60), region: [o.name ? street : '', o.city || o.town || o.village || o.county, o.state, o.country].filter(Boolean).join(', '),
            lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: String(o.osm_value || '') };
        });
        note('Venue search', true, `${out.length} found`, t0);
      } catch (err) { note('Venue search', false, why(err), t0); out = navigator.onLine ? 'Couldn’t search just now. Tap the map, or type coordinates.' : 'Venue search needs a connection.'; }
      if (seq !== venueSeq || !planDraft()) return;
      S.view.venues = Array.isArray(out) && !out.length ? 'No venue found with that name.' : out;
      drawVenueResults();
    }, 350);
  }
  const TYPE_OF_KIND = (k) => (/restaurant|bar|pub|cafe|biergarten|hotel/.test(k) ? 'venue' : /beach|pier|marina|water|coast/.test(k) ? 'water' : /peak|viewpoint|cliff/.test(k) ? 'peak' : 'outdoor');

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
    if (!validTz(r.tz) && !here) p.tzRough = true;
    for (const s of S.places.filter((x) => x.sample)) db.del('places', s.id);
    const at = S.places.findIndex((x) => x.id === id);   // a place already in the list keeps its position
    if (at >= 0) { S.places[at] = p; delete DATA[id]; } else S.places.push(p);
    S.places = S.places.filter((x) => !x.sample);
    await db.put('places', p);
    S.results = null; S.editing = false;
    goTo(id);
  }
  function locate(then) {
    if (!navigator.geolocation) return toast('This browser can’t share where you are. Search for a place instead.');
    const t0 = now();
    navigator.geolocation.getCurrentPosition((pos) => { note('Location', true, 'found', t0); then(pos.coords.latitude, pos.coords.longitude); },
      (err) => {
        const denied = err && err.code === 1;
        note('Location', false, denied ? 'not allowed' : err && err.code === 3 ? 'timed out' : 'unavailable', t0);
        toast(denied ? 'Location is turned off for Golden Hour. Search for a place, or allow it in Settings.' : 'Couldn’t find where you are just now. Try again, or search for a place.');
      }, { timeout: 12000, maximumAge: 5 * MIN });
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
  /** Puts a new screen where the open sheet was, so Back goes to what was under the sheet. */
  function replaceSheetWith(view) { S.sheet = null; S.view = view; render(); const sc = $('.screen'); if (sc) sc.scrollTop = 0; }
  function redraw(p) { if (S.view || S.sheet) render(); else update(p); }
  const ACT = {
    units(el) { settings.imperialFirst = el.dataset.v === 'imperial'; store.set('imperialFirst', settings.imperialFirst); keepFields(); render(); },
    goto(el) { goTo(el.dataset.id, !S.view && !S.sheet); },
    'open-today'() { if (S.view || S.sheet) go(null); else { const pg = $('.page[aria-current="true"]'); if (pg) pg.scrollTo({ top: 0 }); } },
    'open-plans'() { if (!(S.view && S.view.type === 'plans' && !S.sheet)) go({ type: 'plans' }); },
    'open-list'() { if (!(S.view && S.view.type === 'list' && !S.sheet)) { S.results = null; go({ type: 'list' }); loadAll(); } },
    'add-place'() { S.results = null; S.focusSearch = true; go({ type: 'list' }); },
    settings() { openSheet({ kind: 'settings', page: 'main' }); },
    'settings-page'(el) { S.sheet.page = el.dataset.page; drawSheet(true); },
    async 'copy-status'() {
      const text = [`Golden Hour ${VERSION}`, navigator.userAgent, navigator.onLine ? 'online' : 'offline', ...STATUS.map((s) => `${new Date(s.at).toISOString()} ${s.what}: ${s.ok ? 'ok' : 'FAILED'} ${s.detail}${s.ms != null ? ` (${s.ms} ms)` : ''}`)].join('\n');
      try { await navigator.clipboard.writeText(text); toast('Status copied'); } catch { window.prompt('Copy the status', text); }
    },
    'share-today'() { shareToday(place()); },
    'share-week'(el) { shareWeek(place(el.dataset.place)); },
    'share-app'() { shareApp(); },
    'share-spot'() { const sh = S.sheet; if (sh && sh.kind === 'spot') shareSpot(sh.spot, place(sh.placeId) || place()); },
    'spots-all'(el) { go({ type: 'spots', placeId: el.dataset.place || S.current, expanded: {} }); },
    'spots-more'(el) { S.view.expanded[el.dataset.k] = !S.view.expanded[el.dataset.k]; render(); },
    filter(el) { S.filters[el.dataset.k] = !S.filters[el.dataset.k]; render(); },
    async 'spots-retry'(el) {
      const p = place((el && el.dataset.place) || (S.view && S.view.placeId) || (S.sheet && S.sheet.placeId));
      const d = DATA[p.id]; d.spots = null; d.spotsTriedAt = 0;
      const going = loadSpots(p); redraw(p); await going; redraw(p);
    },
    async 'near-retry'() { const p = place(S.view && S.view.placeId), d = DATA[p.id]; d.near = null; const going = loadNear(p); render(); await going; render(); },
    'spot-open'(el) {
      const p = place(el.dataset.place), sp = findSpot(p, el.dataset.id);
      if (sp) openSheet({ kind: 'spot', spot: sp, placeId: p.id });
    },
    'spot-plan'() {
      const sh = S.sheet, p = place(sh.placeId) || place(), ev = shownEvening(p);
      S.current = p.id;
      replaceSheetWith({ type: 'plan', draft: newDraft(ev.date, p, sh.spot) }); autosave();
    },
    async 'spot-save'() {
      const sp = S.sheet.spot, own = { id: 'own-' + now().toString(36), name: sp.name, cat: 'own', kind: sp.kind || 'Your spot', rooftop: !!sp.rooftop, type: TYPE_OF_SPOT(sp), lat: sp.lat, lon: sp.lon, ele: sp.ele == null ? null : sp.ele, createdAt: now() };
      if (db.isBlocked()) return toast('Spots can’t be saved in this browser mode');
      S.spots.push(own); await db.put('spots', own); render(); toast('Saved to your spots');
    },
    async 'spot-del'() {
      if (!window.confirm('Remove this spot?')) return;
      const id = S.sheet.spot.id; S.spots = S.spots.filter((x) => x.id !== id); await db.del('spots', id);
      back();
    },
    'spot-add'(el) { go({ type: 'addspot', placeId: el.dataset.place || S.current, draft: { spot: { name: '', type: 'outdoor', lat: null, lon: null } } }); },
    async 'spot-create'() {
      keepFields();
      const v = S.view, sp = v.draft.spot;
      if (sp.lat == null) return toast('Drop a pin first');
      if (db.isBlocked()) return toast('Spots can’t be saved in this browser mode');
      const own = { id: 'own-' + now().toString(36), name: sp.name || 'My sunset spot', cat: 'own', kind: KIND_OF_TYPE[sp.type] || 'Your spot', type: sp.type, lat: sp.lat, lon: sp.lon, createdAt: now() };
      S.spots.push(own); await db.put('spots', own);
      back(); toast('Spot saved');
    },
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
    async retry() {
      const p = place(), d = DATA[p.id];
      d.triedAt = now();
      const going = load(p, true); update(p); await going; update(p);
      if (d.error && d.fc) toast('Still can’t refresh. Showing the last forecast.');
    },
    day(el) {
      const date = el.dataset.date;
      if (!date) return;
      if (S.sheet && S.sheet.kind === 'day') { S.sheet.date = date; drawSheet(true); } else openSheet({ kind: 'day', placeId: el.dataset.place || S.current, date });
    },
    'details-toggle'() { store.set('details', !store.get('details', false)); S.places.forEach(update); },
    'sheet-close'() { back(); },
    'sheet-step'(el) { stepSheet(Number(el.dataset.d)); },
    'close-view'() { back(); },
    async rate(el) {
      const p = place(), date = el.dataset.date, v = Number(el.dataset.v), rec = DATA[p.id].logged[date];
      const r = { placeId: p.id, date, predicted: rec.score, parts: rec.parts, observed: v || null, at: now() };
      S.ratings.push(r); await db.put('ratings', r);
      S.justRated = v ? r : null;
      update(p); toast(v ? 'Thanks. Saved to your sunset log.' : 'Noted.');
    },
    'rate-later'(el) { store.set('hwiSkip', `${place().id}|${el.dataset.date}`); update(place()); },
    async 'copy-log'() { try { await navigator.clipboard.writeText(JSON.stringify(S.ratings, null, 1)); toast('Log copied'); } catch { toast('Couldn’t copy'); } },
    'plan-new'(el) {
      const p = place(el && el.dataset.place), date = (el && el.dataset.date) || shownEvening(p).date;
      const sp = el && el.dataset.id ? findSpot(p, el.dataset.id) : null;
      if (sp) return startPlan(newDraft(date, p, sp));
      if (allSpots(p) || ownSpots(p).length) return openSheet({ kind: 'pick', placeId: p.id, date });
      startPlan(newDraft(date, p));
    },
    /** A place chosen in the picker: for a new plan, or for the plan already open. */
    'plan-here'(el) {
      const p = place(el.dataset.place), sp = findSpot(p, el.dataset.id), sh = S.sheet;
      if (!sp || !sh) return;
      const dr = planDraft();
      if (sh.repick && dr) {
        dr.spot = { name: sp.name, type: TYPE_OF_SPOT(sp), lat: sp.lat, lon: sp.lon }; dr.walkIn = WALK_OF_SPOT(sp);
        if ($('#spotName')) { $('#spotName').value = sp.name; $('#spotType').value = dr.spot.type; $('#walkIn').value = dr.walkIn; }
        return back();
      }
      replaceSheetWith({ type: 'plan', draft: newDraft(el.dataset.date || sh.date, p, sp) }); autosave();
    },
    'plan-blank'(el) { replaceSheetWith({ type: 'plan', draft: newDraft(el.dataset.date, place(el.dataset.place)) }); },
    'plan-pick'() { const dr = planDraft(); keepFields(); autosave(); openSheet({ kind: 'pick', placeId: dr.placeId, date: dr.date, repick: true }); },
    'venue-pick'(el) {
      const r = S.view.venues && S.view.venues[Number(el.dataset.i)], dr = planDraft();
      if (!r || !dr) return;
      keepFields();
      dr.spot = { name: r.name, type: TYPE_OF_KIND(r.kind), lat: Math.round(r.lat * 1e5) / 1e5, lon: Math.round(r.lon * 1e5) / 1e5 };
      S.view.venues = null; S.view.venueQ = '';
      autosave(); render();
    },
    'plan-open'(el) { openPlan(el.dataset.id); },
    async 'plan-del'() {
      if (!window.confirm('Delete this plan?')) return;
      const id = S.view.draft.id;
      S.view = { type: 'gone' };   // nothing left to save on the way out
      S.plans = S.plans.filter((p) => p.id !== id); await db.del('plans', id);
      if (NAV.length) back(); else { S.view = { type: 'plans' }; render(); }
    },
    'pin-here'() { locate((lat, lon) => setPin(lat, lon)); },
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
    'share-go'() { shareGo(); },
    'share-update'() { shareGo(); },
    calendar() { addToCalendar(); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = ACT[el.dataset.act];
    if (fn) fn(el);
  });
  // A sheet: a tap outside it closes it; on a day, a sideways swipe moves between evenings.
  {
    const backdrop = $('#sheetback'); let swipe = null;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) back(); });
    backdrop.addEventListener('touchstart', (e) => { swipe = e.touches.length === 1 && S.sheet && S.sheet.kind === 'day' ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    backdrop.addEventListener('touchend', (e) => {
      if (!swipe) return;
      const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; swipe = null;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepSheet(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  // A field's change arrives as the finger goes down on whatever is tapped next. Redrawing then would replace
  // that button mid-tap and lose the tap, so the redraw waits until the finger is up.
  let pressing = false, drawLater = false;
  const released = () => { pressing = false; if (drawLater) { drawLater = false; keepFields(); render(); } };
  document.addEventListener('pointerdown', () => { pressing = true; }, true);
  document.addEventListener('pointerup', () => setTimeout(released, 0), true);
  document.addEventListener('pointercancel', () => setTimeout(released, 0), true);
  function renderSoon() { if (pressing) drawLater = true; else render(); }
  const PLAN_FIELDS = ['spotType', 'walkIn', 'spotName', 'arriveBy', 'travelMin', 'homeBy', 'planNote'];
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.act === 'tick') return ACT.tick(t);
    if (t.id === 'anyDate') { if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) { const date = t.value, pid = t.dataset.place; t.value = ''; openSheet({ kind: 'day', placeId: pid || S.current, date }); } return; }
    if (t.id === 'planDate') { const dr = planDraft(); if (dr && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) { keepFields(); dr.date = t.value; dr.arriveBy = null; dr.scoreAtSave = null; if ($('#arriveBy')) $('#arriveBy').value = ''; autosave(); renderSoon(); } return; }
    if (PLAN_FIELDS.includes(t.id)) { keepFields(); autosave(); renderSoon(); }
    if (t.id === 'coords') {
      const m = t.value.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
      if (m && Math.abs(m[1]) <= 90 && Math.abs(m[2]) <= 180) setPin(Number(m[1]), Number(m[2]), null, true);
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
    if (S.sheet) {
      if (e.key === 'Escape') back();
      else if (S.sheet.kind === 'day' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); stepSheet(e.key === 'ArrowRight' ? 1 : -1); }
      return;
    }
    if (S.view || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const next = S.places[S.places.findIndex((p) => p.id === S.current) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) goTo(next.id, true);
  });
  window.addEventListener('resize', () => { const pager = $('#pager'); if (pager) pager.scrollLeft = Math.max(0, S.places.findIndex((p) => p.id === S.current)) * pager.clientWidth; });

  async function loadAll() {
    for (const p of S.places.slice()) { const d = DATA[p.id]; if (!d || !d.fc || now() - d.fetchedAt > 3 * HOUR) { await load(p); update(p); } }
  }

  // ---------- Keeping current: every 30 minutes while open, and on coming back to the app ----------
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    if (S.view && S.view.type !== 'list' && S.view.type !== 'plans') return;
    const p = place();
    if (!p) return;
    const d = DATA[p.id];
    const due = !d || !d.fc || p.sample || now() - d.fetchedAt >= 30 * MIN || (d.error && now() - (d.triedAt || 0) > 2 * MIN);
    if (due) { if (d) d.triedAt = now(); await load(p, true); update(p); }
    else if (d.spots === 'error' && now() - (d.spotsTriedAt || 0) > 2 * MIN) loadSpots(p).then(() => update(p));   // places that failed are looked for again
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
    try { history.replaceState({ d: 0 }, ''); } catch { /* no history in this frame */ }
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
        S.sheet = { kind: 'spot', spot: { ...sp, id: 'shared/' + sp.lat + ',' + sp.lon }, placeId: S.current, shared: true }; }
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
