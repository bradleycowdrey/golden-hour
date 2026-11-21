/* Golden Hour: the interface. The rules live in core.js (GH); this file fetches, stores and draws.
   Release 1 of docs/SPEC.md: places, the star rating, "How was it?", times, the week, compare, a plan for one
   pinned spot, what to bring, offline, the share link and the calendar file. */
(function () {
  'use strict';
  const G = window.GH;
  const VERSION = '__VERSION__';
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
  const STORES = { places: 'id', evenings: ['placeId', 'date'], plans: 'id', ratings: ['placeId', 'date'], snapshots: ['placeId', 'date'], cache: 'url' };
  const db = (() => {
    let handle = null, blocked = false;
    const mem = {};
    for (const s of Object.keys(STORES)) mem[s] = new Map();
    const keyOf = (s, v) => { const k = STORES[s]; return Array.isArray(k) ? k.map((f) => v[f]).join('|') : v[k]; };
    const open = () => new Promise((res) => {
      try {
        const rq = indexedDB.open('golden-hour', 1);
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
  const S = { places: [], current: null, tab: 'tonight', day: null, view: null, plans: [], ratings: [], searching: false, results: null, notice: null };
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
  const HOURLY_P0 = 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation,precipitation_probability,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m';
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
    return { fc: { p0: hourly(a.body.hourly), up: upList.map((u) => hourly(u.hourly)), aq: c && c.body && c.body.hourly ? hourly(c.body.hourly) : null },
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
      Object.assign(d, { fc: G.sampleForecast(start, 9 * 24), source: 'sample', fetchedAt: now(), error: null });
      return;
    }
    if (d.loading) return d.loading;
    if (!force && d.fc && now() - d.fetchedAt < 30 * MIN) return;
    d.loading = (async () => {
      try {
        const r = await fetchForecast(p.lat, p.lon);
        const first = d.fetchedAt !== r.fetchedAt;
        Object.assign(d, { fc: r.fc, source: r.stale ? 'cache' : 'live', fetchedAt: r.fetchedAt, error: null, ceiling: r.ceiling });
        if (first) await remember(p);
      } catch (e) {
        d.error = e && e.ceiling ? 'ceiling' : 'network';
      } finally { d.loading = null; }
    })();
    await d.loading;
    fetchNormals(p);
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
  const ICON = {
    go: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.100 2.100M17 17l2.100 2.100M4.9 19.100l2.100-2.100M17 7l2.100-2.100" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    maybe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16a7 7 0 0 1 14 0z" fill="currentColor"/><path d="M2 20h20M12 4v3M4.200 9.200l2 2M19.800 9.200l-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19a5 5 0 0 1-.6-9.960A6 6 0 0 1 18 10.500 4.300 4.300 0 0 1 17.500 19z" fill="currentColor"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 17.500v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  const STAR = 'M15 2.500l3.700 7.900 8.600 1.100-6.300 6 1.600 8.500L15 21.800 7.400 26l1.600-8.500-6.300-6 8.600-1.100z';
  const starRow = () => `<svg viewBox="0 0 150 30" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<path transform="translate(${i * 30} 0)" d="${STAR}"/>`).join('')}</svg>`;
  /** Five stars filled to `value`. Hidden from screen readers: the sentence beside them says it. */
  const stars = (value, outlook, small) => `<span class="stars${outlook ? ' outlook' : ''}${small ? ' sm' : ''}" aria-hidden="true"><span class="base">${starRow()}</span><span class="fill" data-w="${Math.max(0, Math.min(100, value / 5 * 100)).toFixed(1)}">${starRow()}</span></span>`;
  const verdictHtml = (r, withQ) => `<span class="verdict ${r.verdict}">${ICON[r.verdict]}<span>${r.verdictWord}${withQ && r.qualifier ? `<span class="q">, ${esc(r.qualifier)}</span>` : ''}</span></span>`;
  const scoreText = (r) => (r.tier === 'outlook' ? r.shown.toFixed(1) : r.score.toFixed(1));
  const rangeText = (r) => `likely ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}`;
  const spoken = (label, r) => `${label}. ${scoreText(r)} out of 5 stars, ${rangeText(r)}. ${r.verdictWord}${r.qualifier ? ', ' + r.qualifier : ''}. ${r.reason}`;
  function evLabel(ev, p, evs) {
    const f = focusDay(p, evs);
    if (ev.day === 0) return 'Tonight';
    if (ev.day === 1) return f === 1 ? 'Tomorrow evening' : 'Tomorrow';
    return dayName(ev.date, true);
  }

  /** The sky behind everything, drawn from the evening's forecast: [top, mid, bottom]. */
  function skyFor(r) {
    if (!r) return ['#1B2440', '#33324A', '#5B4A55'];
    if (r.cap || (r.parts.s < 0.2 && r.parts.c < 0.3)) return ['#272A33', '#3A3D46', '#565960'];
    let sky = r.parts.c >= 0.7 ? ['#1A1F4A', '#7A3B6B', '#E8824A'] : r.parts.c >= 0.4 ? ['#1D2A4F', '#5C4A6E', '#C98A62']
      : r.detail.canvas < 5 ? ['#16305F', '#3F5C8C', '#F0B36A'] : ['#232B45', '#4A4660', '#8F7468'];
    const haze = (1 - r.parts.a) * 0.55;   // hazy air washes the colour toward grey
    if (haze > 0.05) sky = sky.map((hex) => mix(hex, '#6A6660', haze));
    return sky;
  }
  function mix(a, b, k) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const x = p(a), y = p(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
  }
  function setSky(r) {
    const [t, m, b] = skyFor(r), st = document.documentElement.style;
    st.setProperty('--sky-top', t); st.setProperty('--sky-mid', m); st.setProperty('--sky-bottom', b);
  }

  function toast(text, action, onAction) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    t.hidden = false;
    clearTimeout(toast.timer);
    if (action) $('button', t).onclick = () => { t.hidden = true; onAction(); };
    else toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- Drawing: the frame ----------
  function render() {
    const shared = S.view && S.view.type === 'shared';
    $('#unitsImperial').setAttribute('aria-pressed', String(settings.imperialFirst));
    $('#unitsMetric').setAttribute('aria-pressed', String(!settings.imperialFirst));
    $('#places').hidden = shared || !!S.view;
    $('#tabs').hidden = shared;
    for (const t of ['tonight', 'week', 'plans']) $(`#tab${t[0].toUpperCase()}${t.slice(1)}`).toggleAttribute('aria-current', false);
    if (!shared) $(`#tab${S.tab[0].toUpperCase()}${S.tab.slice(1)}`).setAttribute('aria-current', 'page');
    drawPlaces(); drawSearch(); drawBanner();
    const v = $('#view');
    if (shared) v.innerHTML = sharedView();
    else if (S.view && S.view.type === 'plan') v.innerHTML = planView();
    else if (S.view && S.view.type === 'log') v.innerHTML = logView();
    else if (S.tab === 'week') v.innerHTML = weekView();
    else if (S.tab === 'plans') v.innerHTML = plansView();
    else v.innerHTML = tonightView();
    drawFoot();
    for (const el of $$('[data-w]', v)) el.style.width = el.dataset.w + '%';
    if (S.view && (S.view.type === 'plan' || shared)) mountMap();
  }

  function drawPlaces() {
    const el = $('#places');
    el.innerHTML = S.places.map((p) => `<span class="chip-wrap"><button type="button" class="chip" data-act="place" data-id="${esc(p.id)}"${p.id === S.current ? ' aria-current="true"' : ''}>${esc(p.name)}${p.sample ? ' <span class="tag">Sample</span>' : ''}</button>${S.editing && S.places.length > 1 ? `<button type="button" class="chip-x" data-act="remove" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}</span>`).join('')
      + `<button type="button" class="chip add" data-act="search" aria-label="Add a place" aria-expanded="${S.searching}">+</button>`
      + (S.places.length > 1 ? `<button type="button" class="btn quiet" data-act="edit">${S.editing ? 'Done' : 'Edit'}</button>` : '');
  }

  function drawSearch() {
    const el = $('#search');
    el.hidden = !S.searching || !!S.view;
    if (el.hidden) { el.innerHTML = ''; return; }
    if (!$('#q', el)) {
      el.innerHTML = `<div class="box"><input id="q" type="search" placeholder="Search for a place" autocomplete="off" aria-label="Search for a place"></div>
        <div class="row" id="searchActions"><button type="button" class="btn" data-act="locate">Use my location</button><span class="sp"></span><button type="button" class="btn quiet" data-act="search">Close</button></div>
        <div class="results" id="results" aria-live="polite"></div>`;
      $('#q', el).addEventListener('input', onSearchInput);
      $('#q', el).focus();
    }
    const list = $('#results', el);
    if (S.results === null) list.innerHTML = '';
    else if (typeof S.results === 'string') list.innerHTML = `<p class="small muted">${esc(S.results)}</p>`;
    else list.innerHTML = S.results.map((r, i) => `<button type="button" class="result" data-act="add" data-i="${i}"><span><span class="n">${esc(r.name)}</span><br><span class="r">${esc(r.region)}</span></span><span class="sp"></span><span aria-hidden="true">+</span></button>`).join('');
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

  function drawFoot() {
    $('#foot').innerHTML = `<p>Golden Hour has no accounts and collects nothing. To get forecasts and places, your device sends coordinates to Open-Meteo and the map tile host. Ratings are a forecast, not a promise: the first two days are the most reliable.</p>
      <p>Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0), air quality from CAMS. Maps: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Places from <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0). Sun and moon after SunCalc.</p>
      <p><button type="button" class="btn quiet" data-act="log">My sunset log</button> · <a href="https://github.com/bradleycowdrey/golden-hour" target="_blank" rel="noopener">Source</a> · <a href="https://bradcowdrey.com/legal" target="_blank" rel="noopener">Terms and privacy</a> · Free and open source, by <a href="https://bradcowdrey.com" target="_blank" rel="noopener">Bradley Cowdrey</a> · ${esc(VERSION)}</p>`;
  }

  // ---------- Tonight ----------
  function timesStrip(ev, tz) {
    const t = ev.times, f = (ms) => (ms == null ? '–' : esc(timeText(ms, tz)));
    const all = t.state === 'twilight';
    return `<div class="times">
      <div><div class="t num">${f(t.goldenStart)}</div><div class="l">Golden hour</div></div>
      <div><div class="t num">${f(t.bestStart)}</div><div class="l">Best window</div></div>
      <div class="sun"><div class="t num">${f(t.sunset)}</div><div class="l">Sunset</div></div>
      <div><div class="t num">${all ? 'All night' : f(t.afterglowEnd)}</div><div class="l">${all ? 'Twilight' : 'Afterglow ends'}</div></div>
      <div><div class="t num">${all ? '–' : f(t.lastLight)}</div><div class="l">Last light</div></div>
    </div>`;
  }

  function partsCard(ev) {
    const r = ev.rating, x = ev.x, p = r.detail, pct = (v) => Math.round(v * 100);
    const row = (name, v, weight, why) => `<div class="part"><span class="name">${name} <span class="muted small">${weight}</span></span><span class="val">${pct(v)}%</span><span class="bar"><i data-w="${pct(v)}"></i></span><span class="why">${why}</span></div>`;
    const aq = x.aod != null ? `haze ${x.aod.toFixed(2)} (aerosol depth)` : x.visibility != null ? `visibility ${dist(x.visibility / 1000)}` : 'no reading';
    return `<details class="card parts"><summary>What’s behind the score</summary>
      ${row('Colour', r.parts.c, '40%', `${Math.round(p.canvas)}% mid and high cloud overhead, ${Math.round(x.low || 0)}% low cloud; ${Math.round(p.blockC)}% cloud in the light’s path to the west`)}
      ${row('Seeing the sun set', r.parts.s, '20%', `${Math.round(p.blockS)}% cloud between here and the sun at the horizon`)}
      ${row('Air clarity', r.parts.a, '20%', `${aq}; humidity ${Math.round(x.humidity || 0)}%`)}
      ${row('Comfort', r.parts.k, '20%', `wind ${wind(p.w)}; feels like ${x.apparent == null ? '–' : temp(x.apparent)}${p.normal != null ? `, usual ${temp(p.normal)}` : ''}; ${Math.round(x.rainChance || 0)}% chance of rain`)}
      <p class="small muted">Clean air and comfort only count when there is a sky worth watching${r.gate < 0.995 ? ` (counted at ${pct(r.gate)}% this evening)` : ''}.${r.cap ? ' Capped at 1.5 stars.' : ''}</p></details>`;
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

  function tonightView() {
    const p = place();
    if (!p) return '';
    const d = DATA[p.id] || {}, evs = evenings(p), f = focusDay(p, evs);
    const ev = evs[S.day == null ? f : S.day] || evs[f], r = ev.rating;
    setSky(r);
    const label = evLabel(ev, p, evs);
    const head = `<p class="when">${esc(label)} · ${esc(dayName(ev.date))} ${esc(dateText(ev.date))}</p><h2>${esc(p.name)}</h2>`;
    let hero;
    if (ev.times.state === 'none') hero = `<section class="hero">${head}<p class="none">No sunset here on this date</p><p class="reason">${ev.times.polar === 'day' ? 'The sun stays up all night.' : 'The sun stays below the horizon.'}</p></section>`;
    else if (r) {
      const stale = d.source !== 'sample' && now() - d.fetchedAt > 3 * HOUR;
      hero = `<section class="hero" aria-label="${esc(spoken(label, r))}">${head}
        <div class="score${stale ? ' stale' : ''}" aria-hidden="true"><span class="n">${scoreText(r)}</span><span class="of">/ 5</span></div>
        <div aria-hidden="true">${stars(r.tier === 'outlook' ? r.shown : r.score, r.tier === 'outlook')}</div>
        <div aria-hidden="true">${verdictHtml(r, true)}</div>
        <p class="range" aria-hidden="true">${r.tier === 'outlook' ? 'Outlook' : r.tier === 'forecast' ? 'Forecast' : 'Tonight'} · ${rangeText(r)} <span class="muted">(typical)</span></p>
        <p class="reason" aria-hidden="true">${esc(r.reason)}</p>
        ${stale ? '<p class="delta">Out of date. Reconnect to refresh.</p>' : deltaLine(p, ev)}
        ${p.sample ? '<p class="delta">A sample forecast. Add your own place to see the real one.</p>' : ''}
      </section>`;
    } else if (ev.day > 5) hero = `<section class="hero">${head}<p class="none">Too early to call</p><p class="reason">Sunset is at ${esc(timeText(ev.times.sunset, p.tz))}. A rating appears five days ahead.</p></section>`;
    else if (d.error) hero = `<section class="hero">${head}<p class="none">${d.error === 'ceiling' ? 'Refreshing again tomorrow' : 'Couldn’t reach the forecast'}</p><div class="cta"><button type="button" class="btn white" data-act="retry">Try again</button></div></section>`;
    else if (d.fc) hero = `<section class="hero">${head}<p class="none">No forecast for this evening yet</p></section>`;
    else hero = `<section class="hero skeleton" aria-busy="true">${head}<div class="bone" data-w="40"></div><div class="bone" data-w="60"></div><div class="bone" data-w="50"></div></section>`;

    const warns = r ? r.warnings.map((w) => `<div class="warn" role="note">${ICON.warn}<span>${esc(w.text)}</span></div>`).join('') : '';
    const canPlan = ev.times.state !== 'none' && now() < endOf(ev, p);
    const cta = canPlan ? `<div class="cta"><button type="button" class="btn primary" data-act="plan-new" data-date="${ev.date}">Plan this evening</button></div>` : '';
    const timesCard = ev.times.state === 'none' ? '' : `<section class="card"><p class="eyebrow">The evening<span class="sp"></span><span class="aside">Sun sets to the ${esc(compass(ev.times.azimuth))}</span></p>${timesStrip(ev, p.tz)}
      <p class="small muted" data-gap>${ev.times.state === 'twilight' ? 'Twilight lasts all night at this time of year.' : 'The best colour often comes after the sun is down. Stay through the afterglow.'}</p></section>`;
    const back = S.day != null && S.day !== f ? `<button type="button" class="btn quiet back" data-act="day" data-day="">‹ Back to ${f === 1 ? 'tomorrow' : 'tonight'}</button>` : '';
    return `${back}<div class="two"><div class="col">${hero}${warns}${cta}</div><div class="col">${howWasIt(p, evs)}${timesCard}${r ? partsCard(ev) : ''}</div></div>`;
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
    setSky(null);
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
  function dayRow(ev, p, evs, best) {
    const label = ev.day === 0 ? 'Today' : ev.day === 1 ? 'Tomorrow' : dayName(ev.date, true);
    const d = `<span class="d">${esc(label)}<small>${esc(dateText(ev.date))}</small></span>`;
    const sunset = ev.times.sunset == null ? '' : `<span class="s num">Sunset ${esc(timeText(ev.times.sunset, p.tz))}</span>`;
    if (ev.times.state === 'none') return `<div class="day">${d}<span class="mid"><span class="why">No sunset here on this date</span></span><span class="right"></span></div>`;
    if (!ev.rating) return `<div class="day">${d}<span class="mid"><span class="why">${ev.day > 5 ? 'Too early to call' : 'No forecast yet'}</span></span><span class="right">${sunset}</span></div>`;
    const r = ev.rating, out = r.tier === 'outlook';
    const badge = best && best.ev.date === ev.date ? ` <span class="best">${best.label}</span>` : '';
    return `<button type="button" class="day" data-act="day" data-day="${ev.day}" aria-label="${esc(spoken(label, r))}">${d}
      <span class="mid" aria-hidden="true"><span class="line1">${stars(out ? r.shown : r.score, out, true)}<span class="sc">${scoreText(r)}</span>${badge}</span>
      <span class="why">${out ? `${rangeText(r)} · ` : ''}${esc(r.reason)}</span></span>
      <span class="right" aria-hidden="true"><span class="v ${r.verdict}">${ICON[r.verdict]}${r.verdictWord}</span>${sunset}</span></button>`;
  }
  function weekView() {
    const p = place();
    if (!p) return '';
    const evs = evenings(p), best = bestOf(evs);
    setSky(evs[focusDay(p, evs)].rating);
    const real = S.places.filter((x) => !x.sample || S.places.length === 1);
    const toggle = real.length > 1 ? `<button type="button" class="tog" data-act="compare" aria-pressed="${settings.compare}"><i></i>Compare places</button>` : '';
    if (settings.compare && real.length > 1) {
      const cols = evs.slice(0, 6);
      const head = `<tr><th class="p">Place</th>${cols.map((e) => `<th>${esc(e.day === 0 ? 'Today' : dayName(e.date))}</th>`).join('')}</tr>`;
      const rows = real.slice(0, 5).map((q) => {
        const qe = evenings(q);
        return `<tr><th class="p" scope="row">${esc(q.name)}</th>${qe.slice(0, 6).map((e) => (e.rating
          ? `<td><button type="button" data-act="cell" data-id="${esc(q.id)}" data-day="${e.day}" aria-label="${esc(q.name)}, ${esc(spoken(e.day === 0 ? 'Today' : dayName(e.date, true), e.rating))}"><span>${scoreText(e.rating)}</span><span class="v ${e.rating.verdict}">${ICON[e.rating.verdict]}</span></button></td>`
          : `<td><span class="muted small">${DATA[q.id] && DATA[q.id].error ? '!' : '–'}</span></td>`)).join('')}</tr>`;
      }).join('');
      return `<section class="card"><p class="eyebrow">Compare places<span class="sp"></span>${toggle}</p><div class="grid-scroll"><table class="cmp">${head}${rows}</table></div>
        <p class="small muted" data-gap>Stars out of 5 for each evening. Tap a cell to open that place and evening.</p></section>`;
    }
    return `<section class="card"><p class="eyebrow">${esc(p.name)} · the next ten evenings<span class="sp"></span>${toggle}</p>${evs.map((e) => dayRow(e, p, evs, best)).join('')}
      <p class="small muted" data-gap>Today and the next two evenings are a forecast. Days three to five are an outlook and may change. Beyond that it is too early to call.</p></section>`;
  }

  // ---------- Plans ----------
  function plansView() {
    setSky(null);
    const today = localDate(now(), deviceTz());
    const upcoming = S.plans.filter((p) => p.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
    const earlier = S.plans.filter((p) => p.date < today).sort((a, b) => (a.date < b.date ? 1 : -1));
    const row = (p) => `<button type="button" class="plan-row" data-act="plan-open" data-id="${esc(p.id)}"><span><span class="n">${esc(p.spot.name)}</span><br><span class="r">${esc(dayName(p.date, true))} ${esc(dateText(p.date))} · meet at ${esc(timeText(p.times.meetAt, p.tz))} · sunset ${esc(timeText(p.times.sunset, p.tz))}</span></span><span class="sp"></span><span aria-hidden="true">›</span></button>`;
    return `<section class="card"><p class="eyebrow">Plans</p>${upcoming.length ? upcoming.map(row).join('') : '<p class="empty">No plans yet. Pick an evening to start one.</p>'}</section>
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
    setSky(mo.r);
    const saved = !!dr.saved, past = mo.pt && now() > mo.pt.headBackBy + 6 * HOUR;
    const dayLabel = `${dayName(dr.date, true)} ${dateText(dr.date)}`;
    const score = mo.r ? `<span class="row">${stars(mo.r.tier === 'outlook' ? mo.r.shown : mo.r.score, mo.r.tier === 'outlook', true)}<b class="num">${scoreText(mo.r)}</b><span class="v ${mo.r.verdict}">${mo.r.verdictWord}</span><span class="small muted">${esc(mo.r.reason)}</span></span>` : '<span class="small muted">No rating for this evening yet.</span>';
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
    setSky(v.live || null);
    if (!v.plan) return `<section class="card"><p class="eyebrow">Golden Hour</p><p>This plan link is incomplete. Ask for it again.</p><div class="row" data-gap><a class="btn" href="./">Open Golden Hour</a></div></section>`;
    const pl = v.plan, tz = tzOr(pl.tz), [y, m, d] = ymd(pl.date);
    const times = G.eveningTimes(G.solarNoonGuess(y, m + 1, d, pl.spot.lon), pl.spot.lat, pl.spot.lon);
    const groups = new Map();
    for (const it of pl.items) { const k = it.who || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it.name); }
    const names = Array.from(groups.keys()).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const live = v.live;
    const dropped = live && pl.scoreAtSave != null && pl.scoreAtSave >= 3.5 && live.verdict !== 'go';
    const scoreLine = live ? `<span class="row">${stars(live.tier === 'outlook' ? live.shown : live.score, live.tier === 'outlook', true)}<b class="num">${scoreText(live)}</b><span class="v ${live.verdict}">${live.verdictWord}</span><span class="small muted">${esc(live.reason)}</span></span>`
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
    const v = S.view, shared = v.type === 'shared';
    const spot = shared ? (v.plan && v.plan.spot) : v.draft.spot;
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
    dr.walkIn = Math.max(0, Math.min(240, Math.round(Number($('#walkIn').value) || 0)));
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
    S.tab = 'plans';
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
    render(); window.scrollTo(0, 0);
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
    if (q.length < 2) { S.results = null; return drawSearch(); }
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
      drawSearch();
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
    S.current = id; S.searching = false; S.results = null; S.day = null; store.set('current', id);
    render();
    await loadLogged(p); await load(p, true);
    render();
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
    tab(el) { keepFields(); autosave(); S.tab = el.dataset.v; S.view = null; S.day = null; S.searching = false; render(); window.scrollTo(0, 0); if (S.tab === 'week' && settings.compare) loadAll(); },
    async place(el) { S.current = el.dataset.id; S.day = null; store.set('current', S.current); render(); const p = place(); await loadLogged(p); await load(p); render(); },
    search() { S.searching = !S.searching; S.results = null; render(); },
    edit() { S.editing = !S.editing; render(); },
    async remove(el) {
      const id = el.dataset.id;
      S.places = S.places.filter((p) => p.id !== id); await db.del('places', id);
      if (S.current === id) S.current = S.places[0].id;
      if (S.places.length < 2) S.editing = false;
      render(); load(place()).then(render);
    },
    add(el) { const r = S.results[Number(el.dataset.i)]; if (r) addPlace(r); },
    locate() { locate(async (lat, lon) => { const n = await nameNear(lat, lon); addPlace({ ...n, lat, lon, tz: deviceTz() }, true); }); },
    async retry() { const p = place(); DATA[p.id].error = null; render(); await load(p, true); render(); },
    day(el) { S.day = el.dataset.day === '' ? null : Number(el.dataset.day); S.tab = 'tonight'; S.view = null; render(); window.scrollTo(0, 0); },
    async cell(el) { S.current = el.dataset.id; store.set('current', S.current); S.day = Number(el.dataset.day); S.tab = 'tonight'; render(); window.scrollTo(0, 0); await loadLogged(place()); render(); },
    compare() { settings.compare = !settings.compare; store.set('compare', settings.compare); render(); if (settings.compare) loadAll(); },
    async rate(el) {
      const p = place(), date = el.dataset.date, v = Number(el.dataset.v), rec = DATA[p.id].logged[date];
      const r = { placeId: p.id, date, predicted: rec.score, parts: rec.parts, observed: v || null, at: now() };
      S.ratings.push(r); await db.put('ratings', r);
      render(); toast(v ? 'Thanks. Saved to your sunset log.' : 'Noted.');
    },
    log() { S.view = { type: 'log' }; render(); window.scrollTo(0, 0); },
    async 'copy-log'() { try { await navigator.clipboard.writeText(JSON.stringify(S.ratings, null, 1)); toast('Log copied'); } catch { toast('Couldn’t copy'); } },
    'close-view'() { keepFields(); autosave(); S.view = null; render(); window.scrollTo(0, 0); },
    'plan-new'(el) { S.view = { type: 'plan', draft: newDraft(el.dataset.date) }; render(); window.scrollTo(0, 0); },
    'plan-open'(el) { openPlan(el.dataset.id); },
    'plan-save'() { savePlan(); },
    async 'plan-del'() {
      if (!window.confirm('Delete this plan?')) return;
      const id = S.view.draft.id;
      S.plans = S.plans.filter((p) => p.id !== id); await db.del('plans', id);
      S.view = null; render();
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'newItem') ACT['item-add'](); });

  async function loadAll() {
    for (const p of S.places.slice(0, 5)) { const d = DATA[p.id]; if (!d || !d.fc || now() - d.fetchedAt > 3 * HOUR) { await load(p); render(); } }
  }

  // ---------- Keeping current: every 30 minutes while open, and on coming back to the tab ----------
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    if (S.view && S.view.type === 'shared') return;
    const p = place();
    if (!p) return;
    const d = DATA[p.id];
    if (!d || !d.fc || now() - d.fetchedAt >= 30 * MIN || p.sample) { await load(p, true); if (!$('input:focus')) render(); }
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
    const [places, plans, ratings, cached] = await Promise.all([db.all('places'), db.all('plans'), db.all('ratings'), db.all('cache')]);
    for (const c of cached || []) if (now() - c.fetchedAt > 3 * DAY) db.del('cache', c.url);
    S.places = (places || []).filter((p) => !p.sample);
    if (!S.places.length) { S.places = [SAMPLE]; S.searching = true; }
    S.plans = plans || []; S.ratings = ratings || [];
    S.current = store.get('current', null);
    if (!S.places.some((p) => p.id === S.current)) S.current = S.places[0].id;
    const p = place();
    if (p.sample) await load(p);
    render();
    await loadLogged(p); await load(p);
    render();
  }
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#p=')) openShared(location.hash); });
  window.__gh = { S, DATA, settings, render, db };   // read by tests/web.test.js
  start();
})();
