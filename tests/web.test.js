// Tests for the web app as built (docs/), run with Playwright:  node tests/web.test.js [screenshot-dir]
// The page is served over HTTP as on the site, with Open-Meteo and the map tiles answered by this script,
// and the clock fixed at midday in Denver on 20 June 2026. It walks every Release 1 feature and state in
// docs/SPEC.md (sections 10 and 14), at phone, tablet and desktop widths.
const path = require('path');
const fs = require('fs');
const http = require('http');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const G = require('../web/core.js');
const document_has = () => true;   // the sprite is checked below, in the page
const G_decode = (text) => { const sp = G.decodeSpot(text.split('#s=')[1] || ''); return !!sp && sp.name === 'Linger'; };

const ROOT = path.join(__dirname, '..', 'docs');
const SHOTS = process.argv[2];
const NOON = Date.UTC(2026, 5, 20, 18, 0);              // 12:00 in Denver
const HOUR = 3600000, MIN = 60000;
const DENVER = { name: 'Denver', admin1: 'Colorado', country: 'United States', latitude: 39.7392, longitude: -104.9903, timezone: 'America/Denver' };
const BOULDER = { name: 'Boulder', admin1: 'Colorado', country: 'United States', latitude: 40.015, longitude: -105.2705, timezone: 'America/Denver' };
const OSM = [
  { type: 'node', id: 1, lat: 39.7826, lon: -105.0566, tags: { name: 'Inspiration Point', tourism: 'viewpoint', wikidata: 'Q1' } },
  { type: 'node', id: 2, lat: 39.75, lon: -105.04, tags: { name: 'Sunset Park', leisure: 'park' } },
  { type: 'way', id: 3, center: { lat: 39.749, lon: -105.045 }, tags: { name: 'Sloan’s Lake Park', leisure: 'park', wikipedia: 'en:Sloan' } },
  { type: 'node', id: 4, lat: 39.75, lon: -105.03, tags: { name: 'Lakeside Pier', man_made: 'pier' } },
  { type: 'node', id: 5, lat: 39.73, lon: -104.97, tags: { name: 'City Viewpoint', tourism: 'viewpoint' } },
  { type: 'node', id: 6, lat: 39.70, lon: -105.00, tags: { name: 'Ruby Hill Viewpoint', tourism: 'viewpoint' } },
  { type: 'node', id: 7, lat: 39.7322, lon: -105.2392, tags: { name: 'Lookout Mountain', natural: 'peak', ele: '2190', wikidata: 'Q2' } },
  { type: 'node', id: 8, lat: 39.6935, lon: -105.1488, tags: { name: 'Green Mountain', natural: 'peak', ele: '2005' } },
  { type: 'node', id: 9, lat: 39.5883, lon: -105.6438, tags: { name: 'Mount Evans', natural: 'peak', ele: '4348', wikipedia: 'en:Evans' } },
  { type: 'node', id: 10, lat: 39.7597, lon: -105.0113, tags: { name: 'Linger', amenity: 'restaurant', outdoor_seating: 'rooftop', website: 'https://example.com/linger', phone: '+1 303 555 0100' } },
  { type: 'node', id: 11, lat: 39.7637, lon: -105.0102, tags: { name: 'Sky Bar', amenity: 'bar', rooftop: 'yes' } },
  { type: 'node', id: 12, lat: 39.74, lon: -104.99, tags: { name: 'Terrace Café', amenity: 'cafe', outdoor_seating: 'terrace' } },
];
const TROMSO = { name: 'Tromsø', admin1: 'Troms', country: 'Norway', latitude: 69.6492, longitude: 18.9553, timezone: 'Europe/Oslo' };

let passed = 0, failed = 0;
const results = [];
function check(ok, what) { ok ? passed++ : failed++; results.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) console.log('FAIL ' + what); }

// ---------- The stand-in forecast: the core's sample evenings, in Open-Meteo's shape ----------
const START = Date.UTC(2026, 5, 19, 0);
const sample = G.sampleForecast(START, 9 * 24);
const secs = sample.p0.time.map((t) => t / 1000);
function forecastBody(url) {
  const lats = url.searchParams.get('latitude').split(',');
  const one = (i) => {
    const src = lats.length > 1 ? sample.up[i] : sample.p0, hourly = { time: secs };
    for (const k of url.searchParams.get('hourly').split(',')) hourly[k] = src[k] || sample.p0[k];
    return { latitude: Number(lats[i]), hourly };
  };
  return lats.length > 1 ? lats.map((_, i) => one(i)) : one(0);
}
const airBody = () => ({ hourly: { time: secs, aerosol_optical_depth: secs.map(() => 0.12), pm2_5: secs.map(() => 6), us_aqi: secs.map(() => 35) } });
function archiveBody() {
  const time = [], max = [], min = [];
  for (let t = Date.UTC(1991, 0, 1); t <= Date.UTC(1992, 11, 31); t += 86400000) { time.push(new Date(t).toISOString().slice(0, 10)); max.push(24); min.push(10); }
  return { daily: { time, temperature_2m_max: max, temperature_2m_min: min } };
}
const expectedDenver = (day) => {
  const date = new Date(Date.UTC(2026, 5, 20 + day));
  const t = G.eveningTimes(G.solarNoonGuess(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), DENVER.longitude), DENVER.latitude, DENVER.longitude);
  const aq = { time: sample.p0.time, aerosol_optical_depth: secs.map(() => 0.12), pm2_5: secs.map(() => 6), us_aqi: secs.map(() => 35) };
  return { times: t, rating: G.rate(G.inputsAt(sample.p0, sample.up, aq, t.sunset), { day, normal: 10 + 0.65 * 14, imperialFirst: true }) };
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.tsv': 'text/plain', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://localhost:${server.address().port}/`;
  const browser = await playwright.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const problems = [];
  const net = { forecast: 'ok', geocode: 'ok', tiles: 'ok', overpass: 'ok', calls: [] };

  async function open(opts) {
    const o = opts || {};
    const context = o.context || await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Denver', serviceWorkers: 'block',
      permissions: ['clipboard-read', 'clipboard-write'].concat(o.geo ? ['geolocation'] : []), geolocation: o.geo || undefined, deviceScaleFactor: 1 });
    if (!o.context) {
      await context.route(/open-meteo\.com|openfreemap\.org|overpass/, (route) => {
        const url = new URL(route.request().url());
        net.calls.push(url.href);
        const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
        if (url.hostname === 'geocoding-api.open-meteo.com') {
          if (net.geocode !== 'ok') return route.abort();
          const q = url.searchParams.get('name').toLowerCase();
          return json({ results: [DENVER, BOULDER, TROMSO].filter((c) => c.name.toLowerCase().startsWith(q) || (q.startsWith('trom') && c === TROMSO)) });
        }
        if (url.hostname === 'api.open-meteo.com') return net.forecast === 'ok' ? json(forecastBody(url)) : route.abort();
        if (url.hostname === 'air-quality-api.open-meteo.com') return net.forecast === 'ok' ? json(airBody()) : route.abort();
        if (url.hostname === 'archive-api.open-meteo.com') return json(archiveBody());
        if (/overpass/.test(url.hostname)) return net.overpass === 'down' ? route.abort() : json({ elements: OSM });
        if (url.hostname === 'tiles.openfreemap.org') {
          if (net.tiles !== 'ok') return route.abort();
          return json({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2B4A4A' } }] });
        }
        return route.abort();
      });
    }
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(o.time || NOON));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(BASE + (o.hash || ''));
    await page.waitForSelector('#view .hero, #view .card');
    return { page, context };
  }
  const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); } };
  const text = (page, sel) => page.locator(sel).first().innerText();
  const CUR = '.page[aria-current="true"] ';
  async function addPlace(page, q) {
    if (!(await page.locator('#q').isVisible().catch(() => false))) await page.click('#bar [data-act="open-list"]');
    await page.fill('#q', q);
    await page.waitForSelector('.result');
    const name = (await page.locator('.result .n').first().innerText()).trim();
    await page.click('.result');
    await page.waitForFunction((n) => { const h = document.querySelector('.page[aria-current="true"] .hero h2'); return h && h.textContent.trim() === n && document.querySelector('.page[aria-current="true"] .hero .score, .page[aria-current="true"] .hero .none'); }, name);
  }
  /** Checks that hold on every screen: nothing scrolls sideways, no text under 13px, buttons big enough. */
  async function layout(page, what) {
    const r = await page.evaluate(() => {
      const out = { wide: Math.max(document.documentElement.scrollWidth - window.innerWidth, ...Array.from(document.querySelectorAll('.page[aria-current], .screen')).map((e) => e.scrollWidth - e.clientWidth)), small: [], targets: [] };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !el.getClientRects().length || el.closest('.maplibregl-map, [hidden]')) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 12.99) out.small.push(`${n.textContent.trim().slice(0, 24)} (${size}px)`);
      }
      for (const el of document.querySelectorAll('button, a.btn, input:not([type=checkbox]), select, summary')) {
        const b = el.getBoundingClientRect();
        if (!b.width || el.closest('.maplibregl-map, [hidden]')) continue;
        if (Math.min(b.width, b.height) < 27.5 || Math.max(b.width, b.height) < 43.5) out.targets.push(`${(el.textContent || el.id).trim().slice(0, 20)} ${Math.round(b.width)}×${Math.round(b.height)}`);
      }
      return out;
    });
    check(r.wide <= 0, `${what}: no sideways scroll`);
    check(r.small.length === 0, `${what}: no text under 13px${r.small.length ? ': ' + r.small.slice(0, 4).join('; ') : ''}`);
    check(r.targets.length === 0, `${what}: tap targets at least 44px on one side and 28px on the other${r.targets.length ? ': ' + r.targets.slice(0, 5).join('; ') : ''}`);
  }
  /** WCAG contrast of the text against what is really behind it. The sky is drawn to a canvas from the page's own
      pictures; text straight on the sky is checked against the brightest sky inside its box, and text on a card
      against the brightest sky anywhere on screen (the worst it can scroll over), under the card's own fill. */
  async function contrast(page, what) {
    await page.waitForFunction(() => document.querySelector('.sky .layer.in'));
    const worst = await page.evaluate(async () => {
      const W = window.innerWidth, H = window.innerHeight, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const layers = document.querySelectorAll('.sky .layer');
      for (const svg of layers[layers.length - 1].querySelectorAll('svg')) {
        const clone = svg.cloneNode(true), wide = svg.classList.contains('clouds'), w = wide ? W * 1.12 : W;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', w); clone.setAttribute('height', H);
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
        await img.decode();
        g.drawImage(img, wide ? -W * 0.06 : 0, 0, w, H);
      }
      const sun = layers[layers.length - 1].querySelector('.sun');
      if (sun) {   // the sun is a soft disc of its own: paint it as the page does
        const b = sun.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2, rad = b.width / 2, grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, '#FFFBEC'); grad.addColorStop(0.4, '#FFF1C6'); grad.addColorStop(0.5, 'rgba(255,226,150,.8)'); grad.addColorStop(1, 'rgba(255,205,120,0)');
        g.globalAlpha = parseFloat(sun.style.opacity || 1); g.fillStyle = grad; g.fillRect(b.left, b.top, b.width, b.height); g.globalAlpha = 1;
      }
      const px = g.getImageData(0, 0, W, H).data;
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const brightest = (x0, y0, x1, y1) => {
        let best = [0, 0, 0], bl = -1;
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
        const sx = Math.max(1, Math.floor((x1 - x0) / 24)), sy = Math.max(1, Math.floor((y1 - y0) / 12));
        for (let y = y0; y <= y1; y += sy) for (let x = x0; x <= x1; x += sx) { const i = (y * W + x) * 4, c = [px[i], px[i + 1], px[i + 2]], l = lum(c); if (l > bl) { bl = l; best = c; } }
        return best;
      };
      const whole = brightest(0, 0, W - 1, H - 1);
      const rgba = (s) => { const m = s.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number), unit = /^color\(/.test(s); return { c: m.slice(0, 3).map((v) => (unit ? v * 255 : v)), a: m.length > 3 ? m[3] : 1 }; };
      const over = (top, a, under) => top.map((v, i) => v * a + under[i] * (1 - a));
      let worst = { ratio: 99, need: 4.5, text: '' };
      const view = document.querySelector('.page[aria-current], .screen'), top = view ? view.scrollTop : 0;
      const walker = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !el.getClientRects().length || el.closest('.maplibregl-map, [hidden], .page:not([aria-current])')) continue;
        const box = el.getBoundingClientRect();
        // Text on the sky is judged where it rests before any scrolling; text on a card, against the brightest sky there is.
        let bg = el.closest('.card, .notice, .warn, .banner, .bar') ? whole : brightest(box.left, box.top + top, box.right, box.bottom + top);
        const chain = [];
        for (let e = el; e && e !== document.body; e = e.parentElement) chain.unshift(e);
        for (const e of chain) { const b = rgba(getComputedStyle(e).backgroundColor); if (b.a > 0) bg = over(b.c, b.a, bg); }
        const fg = rgba(getComputedStyle(el).color), colour = over(fg.c, fg.a * parseFloat(getComputedStyle(el).opacity || 1), bg);
        const a = lum(colour), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const size = parseFloat(getComputedStyle(el).fontSize), weight = Number(getComputedStyle(el).fontWeight), large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        if (ratio / need < worst.ratio / worst.need) worst = { ratio, need, text: n.textContent.trim().slice(0, 30) };
      }
      return worst;
    });
    check(worst.ratio >= worst.need, `${what}: text contrast at least ${worst.need}:1 over the brightest sky behind it (worst ${worst.ratio.toFixed(2)}:1, “${worst.text}”)`);
  }

  // ---------- 1. First run ----------
  {
    const { page, context } = await open();
    check((await text(page, CUR + '.hero h2')).includes('Sample'), 'first run: a sample city, labelled Sample');
    check(await page.locator(CUR + '.hero .score .n').isVisible(), 'first run: the sample evening shows a score');
    check(net.calls.length === 0, 'first run: nothing is fetched until a place is chosen');
    check(await page.locator('#bar .dot').count() === 1 && await page.locator('#bar [data-act="open-plans"]').isVisible() && await page.locator('#bar [data-act="open-list"]').isVisible(), 'the bottom bar: Plans, a dot for each place, and Places');
    await layout(page, 'first run (phone)'); await contrast(page, 'first run');
    await shot(page, 'phone-first-run');
    await page.click(CUR + '[data-act="add-place"]');
    check(await page.locator('#q').isVisible() && await page.locator('[data-act="locate"]').isVisible(), 'first run: Add a place opens search and Use my location');
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'q'), 'and puts the cursor in the search box');
    await layout(page, 'places list (phone)'); await contrast(page, 'places list');
    await shot(page, 'phone-places-first-run');
    await page.click('[data-act="locate"]');
    await page.waitForSelector('#toast:not([hidden])');
    check((await text(page, '#toast')).includes('Search for a place instead'), 'location refused: “Search for a place instead”, and nothing else changes');
    check(await page.locator('#q').isVisible(), 'location refused: search still works');
    await context.close();
  }

  // ---------- 2. A place, the rating, the times ----------
  let state;   // a context with Denver saved, reused below
  {
    const { page, context } = await open();
    await addPlace(page, 'Denv');
    await page.waitForFunction(() => window.__gh.S.places[0].normals);
    await page.waitForTimeout(100);
    const exp = expectedDenver(0), r = exp.rating;
    check(await page.locator('.page').count() === 1 && !(await text(page, CUR + '.hero h2')).includes('Sample'), 'adding a place replaces the sample');
    check(await text(page, CUR + '.hero .score .n') === r.score.toFixed(1), `the score on screen is the core’s for the same forecast (${r.score.toFixed(1)})`);
    check((await text(page, CUR + '.verdict')).startsWith(r.verdictWord) && await page.locator(CUR + '.verdict svg').count() === 1, 'the verdict has a word and an icon, not just a colour');
    check((await text(page, CUR + '.hero .range')).includes(`likely ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}`), 'the range is shown, labelled typical');
    check(await text(page, CUR + '.summary') === r.reason, 'the reason sentence opens the evening card');
    check((await text(page, CUR + '.hero .colour')).replace(/\s+/g, ' ') === `${r.colourClass} colour · ${r.colour}`, `the colour class leads, after the stars (${r.colourClass}, ${r.colour})`);
    const label = await page.locator(CUR + '.hero').getAttribute('aria-label');
    check(label === `Tonight. ${r.score.toFixed(1)} out of 5 stars, likely ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}. ${r.colourClass} colour, ${r.colour} out of 100. ${r.verdictWord}${r.qualifier ? ', ' + r.qualifier : ''}. ${r.reason}`, 'screen readers get one sentence; the stars are hidden from them');
    check(await page.locator(CUR + '.hero .stars').getAttribute('aria-hidden') === 'true', 'star glyphs are hidden from assistive technology');
    const fill = await page.locator(CUR + '.hero .stars .fill').evaluate((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    check(Math.abs(fill - r.score / 5) < 0.01, 'stars are filled in proportion to the score');
    const strip = await text(page, CUR + '.times');
    const fmt = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(ms).replace(/ /g, ' ').toLowerCase();
    check(['goldenStart', 'bestStart', 'sunset', 'afterglowEnd', 'lastLight'].every((k) => strip.includes(fmt(exp.times[k]))), 'the five times match the sun’s position to the minute');
    const tiles = (await page.locator(CUR + '.dt .eyebrow > span:first-of-type').allInnerTexts()).map((t) => t.trim());
    check(['COLOUR', 'CLOUD COVER', 'TOWARD THE SUNSET', 'AIR CLARITY', 'VISIBILITY', 'WIND', 'FEELS LIKE', 'RAIN', 'HUMIDITY', 'SUNSET', 'MOON', 'AT SUNSET', 'MOONRISE', 'MOONSET', 'MOONLIGHT', 'DISTANCE'].every((n) => tiles.includes(n)) && tiles.length === 16, `every input to the score has its own tile (${tiles.length})`);
    const tileText = (name) => page.locator(CUR + `.dt[aria-label="${name}"]`).innerText();
    check((await tileText('Colour')).includes(r.colourClass) && (await tileText('Colour')).includes(`${r.colour} of 100`), 'the Colour tile shows the class and the score out of 100');
    check(/High.*\d+%.*Mid.*\d+%.*Low.*\d+%/.test((await tileText('Cloud cover')).replace(/\n/g, ' ')), 'the Cloud cover tile shows high, mid and low cloud');
    check(/\d+ mph\s+\d+ km\/h/.test(await tileText('Wind')) && /\d+°F\s+\d+°C/.test(await tileText('Feels like')), 'tiles show their readings in both units');
    const gfx = await page.locator(CUR + '.dt').evaluateAll((els) => els.filter((e) => !e.querySelector('.gfx svg, .gfx .sbar, .gfx .clbars, .gfx .pathg')).map((e) => e.getAttribute('aria-label')));
    check(gfx.length === 0, `every tile has a graphic${gfx.length ? ': missing on ' + gfx.join(', ') : ''}`);
    check(await page.locator(CUR + '.dt.wide').count() === 5 && await page.locator(CUR + '.dt[aria-label="Wind"] svg.compass').count() === 1, 'the colour tiles and the two big moon tiles run the full width; Wind has its compass');
    const moonExp = G.moonEvening(exp.times.sunset, DENVER.latitude, DENVER.longitude, exp.times.lastLight);
    const moonText = (await tileText('Moon')).replace(/\s+/g, ' ');
    check(moonText.includes(moonExp.name) && moonText.includes(`${Math.round(moonExp.fraction * 100)}% lit`) && await page.locator(CUR + '.dt[aria-label="Moon"] .phases span').count() === 8, 'the Moon tile shows the phase, how much is lit, and the month as eight moons');
    const fmt2 = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(ms).replace(/\u202f/g, ' ').toLowerCase();
    check(!moonExp.rise || (await tileText('Moonrise')).includes(fmt2(moonExp.rise.time)), 'Moonrise shows the time the core works out');
    check(!moonExp.set || (await tileText('Moonset')).includes(fmt2(moonExp.set.time)), 'Moonset shows the time the core works out');
    check(await page.locator(CUR + '.dt[aria-label="At sunset"] svg.horizon text').count() === 5, 'At sunset draws the whole horizon, north to north, with the sun and the moon');
    check(/Usual: \d+°F/.test(await tileText('Feels like')), 'Feels like compares with the usual evening temperature here');
    const dot = await page.locator(CUR + '.dt[aria-label="Colour"] .sbar u').evaluate((el) => parseFloat(el.style.left) / 100);
    check(Math.abs(dot - r.colour / 100) < 0.011, 'the dot on the Colour scale sits at the score');
    const grid = await page.locator(CUR + '.dt').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    check(grid === 2, 'tiles are two across on a phone');
    await page.locator(CUR + '.details').scrollIntoViewIfNeeded();
    await shot(page, 'phone-tiles');
    await page.locator(CUR).evaluate((el) => el.scrollTo(0, 0));
    await shot(page, 'phone-tonight');
    await layout(page, 'tonight (phone)'); await contrast(page, 'tonight');
    await page.click('#bar [data-act="open-list"]');
    await page.click('.seg [data-v="metric"]');
    await page.click('[data-act="close-view"]');
    check(/\d+ km\/h\s+\d+ mph/.test(await page.locator(CUR + '.dt[aria-label="Wind"]').innerText()), 'the units switch, in Places, changes which is listed first');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('gh.imperialFirst'))) === false, 'and is remembered');
    await page.click('#bar [data-act="open-list"]'); await page.click('.seg [data-v="imperial"]'); await page.click('[data-act="close-view"]');
    const p0 = net.calls.find((u) => u.includes('//api.open-meteo.com') && !/latitude=[^&]*(,|%2C)/.test(u));
    check(!!p0 && /forecast_days=8/.test(p0) && /past_days=1/.test(p0) && /timeformat=unixtime/.test(p0) && /timezone=GMT/.test(p0) && /wind_speed_unit=ms/.test(p0), 'the forecast request asks for 8 days, 1 past day, GMT, unix time and metres per second');
    const up = net.calls.find((u) => u.includes('//api.open-meteo.com') && /latitude=[^&]*(,|%2C)/.test(u));
    check(!!up && decodeURIComponent(up).match(/latitude=([^&]*)/)[1].split(',').length === 4 && /cloud_cover_high/.test(up), 'one request covers the four points toward the sunset, with high cloud');
    state = await context.storageState({ indexedDB: true });
    await context.close();
  }
  const withDenver = async (o) => {
    const context = await browser.newContext({ viewport: (o && o.viewport) || { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Denver', serviceWorkers: 'block', storageState: state,
      permissions: ['clipboard-read', 'clipboard-write'], deviceScaleFactor: 1, acceptDownloads: true });
    const seed = await open({ viewport: { width: 390, height: 844 } });   // only to borrow the route handler
    await seed.context.close();
    await context.route(/open-meteo\.com|openfreemap\.org|overpass/, async (route) => {
      const url = new URL(route.request().url());
      net.calls.push(url.href);
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      if (url.hostname === 'geocoding-api.open-meteo.com') { const q = url.searchParams.get('name').toLowerCase(); return net.geocode === 'ok' ? json({ results: [DENVER, BOULDER, TROMSO].filter((c) => c.name.toLowerCase().startsWith(q) || (q.startsWith('trom') && c === TROMSO)) }) : route.abort(); }
      if (url.hostname === 'api.open-meteo.com') return net.forecast === 'ok' ? json(forecastBody(url)) : route.abort();
      if (url.hostname === 'air-quality-api.open-meteo.com') return net.forecast === 'ok' ? json(airBody()) : route.abort();
      if (url.hostname === 'archive-api.open-meteo.com') return json(archiveBody());
      if (/overpass/.test(url.hostname)) return net.overpass === 'down' ? route.abort() : json({ elements: OSM });
      if (url.hostname === 'tiles.openfreemap.org') return net.tiles === 'ok' ? json({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2B4A4A' } }] }) : route.abort();
      return route.abort();
    });
    return open({ context, time: o && o.time, hash: o && o.hash });
  };

  // ---------- 3. The ten evenings, swiping between places, and Compare ----------
  {
    const { page, context } = await withDenver();
    await page.waitForSelector(CUR + '.hero .score');
    const rows = page.locator(CUR + '.day');
    check(await rows.count() === 7, 'each place’s page lists the six rated evenings and one line for the rest');
    check(await page.locator(CUR + 'button.day').count() === 6, 'six are rated');
    check(/outlook/.test(await rows.nth(4).getAttribute('class')) && /^\d\.[05]$/.test(await rows.nth(4).locator('.sc').innerText()) && !/outlook/.test(await rows.nth(1).getAttribute('class')), 'outlook rows are dimmed and rounded to half a star');
    const bars = await page.locator(CUR + 'button.day .cbar i').evaluateAll((els) => els.map((e) => Math.round(parseFloat(e.style.width))));
    check(bars.length === 6 && bars.every((w, i) => w === Math.max(3, expectedDenver(i).rating.colour)), 'each rated evening has a bar for its colour score, on one scale');
    check(await page.locator(CUR + 'button.day').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height <= 64)), 'one line an evening');
    check(/^Friday, Jun 26 and beyond: too early to call$/.test((await rows.nth(6).innerText()).trim()), 'one line: “Friday, Jun 26 and beyond: too early to call”');
    check(await page.locator(CUR + '.best').count() <= 1, 'at most one best evening');
    const exp = [0, 1, 2].map((d) => expectedDenver(d).rating).filter((r) => r.verdict === 'go').sort((a, b) => b.score - a.score)[0];
    check(!exp || (await page.locator(CUR + '.day:has(.best) .sc').innerText()) === exp.score.toFixed(1), 'the best evening is the highest Go among tonight and the next two');
    await page.locator(CUR + '.daily').scrollIntoViewIfNeeded();
    await shot(page, 'phone-week');
    await layout(page, 'place page (phone)'); await contrast(page, 'place page');
    await rows.nth(1).click();
    await page.waitForFunction(() => /TOMORROW/i.test(document.querySelector('.page[aria-current="true"] .hero .when').textContent));
    check(await page.locator(CUR + '[data-act="plan-new"]').isVisible(), 'tapping an evening shows it at the top, with Plan this evening');
    check(await page.locator(CUR).evaluate((el) => el.scrollTop) === 0 && await page.locator(CUR + '.back').isVisible(), 'the page returns to the top, with a way back to tonight');

    // A second place: its own page, swiped to.
    await addPlace(page, 'Bould');
    check(await page.locator('.page').count() === 2 && await page.locator('#bar .dot').count() === 2, 'a second place gets its own page and its own dot');
    check((await text(page, CUR + '.hero h2')) === 'Boulder' && await page.locator('#bar .dot[aria-current="true"]').getAttribute('aria-label') === 'Boulder', 'adding a place opens its page');
    const snap = await page.evaluate(() => getComputedStyle(document.getElementById('pager')).scrollSnapType);
    check(/x mandatory/.test(snap), 'pages snap, one place to a screen');
    await page.evaluate(() => document.getElementById('pager').scrollTo({ left: 0 }));
    await page.waitForFunction(() => document.querySelector('.page[aria-current="true"] .hero h2').textContent.trim() === 'Denver');
    check(await page.locator('#bar .dot[aria-current="true"]').getAttribute('aria-label') === 'Denver', 'swiping moves to the next place, and the dots follow');
    check(await page.evaluate(() => localStorage.getItem('gh.current')) === '"39.74,-104.99"', 'the place you were on is remembered');
    check(await page.locator('.page:not([aria-current])').evaluate((el) => el.inert), 'the page that is off screen can’t be tabbed into');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.page[aria-current="true"] .hero h2').textContent.trim() === 'Boulder');
    check(true, 'the arrow keys move between places');
    await page.locator('#bar .dot').first().click();
    await page.waitForFunction(() => document.querySelector('.page[aria-current="true"] .hero h2').textContent.trim() === 'Denver');
    check(true, 'tapping a dot opens that place');
    const widths = await page.evaluate(() => Array.from(document.querySelectorAll('.page')).map((p) => p.getBoundingClientRect().width === window.innerWidth));
    check(widths.every(Boolean), 'every page is the full width of the screen');
    await page.waitForTimeout(700);
    await shot(page, 'phone-two-places');

    // The list of places, and Compare.
    await page.click('#bar [data-act="open-list"]');
    await page.waitForFunction(() => document.querySelectorAll('.lrow .big').length === 2);
    const row = await text(page, '.lrow');
    check(/Denver/.test(row) && /sunset \d/.test(row) && await page.locator('.lrow .swatch').count() === 2, 'the list shows each place with tonight’s score, its sunset and a swatch of its sky');
    await shot(page, 'phone-places');
    await layout(page, 'places (phone)'); await contrast(page, 'places');
    await page.click('[data-act="compare"]');
    await page.waitForFunction(() => document.querySelectorAll('table.cmp td button').length === 12);
    check(await page.locator('table.cmp tr').count() === 3, 'compare: one row per saved place');
    await shot(page, 'phone-compare');
    await layout(page, 'compare (phone)');
    await page.locator('table.cmp tr').nth(1).locator('td button').nth(2).click();
    await page.waitForSelector(CUR + '.hero');
    check((await text(page, CUR + '.hero h2')) === 'Denver' && /Monday/.test(await text(page, CUR + '.hero .when')), 'compare: a cell opens that place and evening');
    await page.click('#bar [data-act="open-list"]');
    await page.locator('.lrow').nth(1).click();
    check((await text(page, CUR + '.hero h2')) === 'Boulder', 'the list: tapping a place opens its page');
    await context.close();
  }

  // ---------- 3b. Golden Hour Places, and sharing ----------
  {
    const { page, context } = await withDenver();
    await page.waitForSelector(CUR + '.hero .score');
    await page.waitForSelector(CUR + '.ghplaces .srow');
    const cards = page.locator(CUR + '.ghplaces .spotcard');
    check(await cards.count() === 3, 'each location’s page ends with Golden Hour Places: landmarks, adventurous, dining');
    const heads = (await cards.locator('.eyebrow > span:first-of-type').allInnerTexts()).map((h) => h.trim());
    check(heads.join('|') === 'LANDMARKS|ADVENTUROUS|DINING WITH A VIEW', `in that order (${heads.join(', ')})`);
    check(await cards.nth(0).locator('.srow').count() === 3, 'the top three of each');
    const icons = await page.locator(CUR + '.ghplaces .srow .sbadge use').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    check(icons.length === 9 && icons.every((h) => /^#k-[a-z]+$/.test(h) && document_has(h)), `every place has a picture of its kind (${[...new Set(icons)].join(' ')})`);
    const kinds = Object.fromEntries(await page.locator(CUR + '.ghplaces .srow').evaluateAll((els) => els.map((e) => [e.querySelector('.n').textContent.trim(), e.querySelector('.sbadge use').getAttribute('href')])));
    check(kinds['Lookout Mountain'] === '#k-summit' && kinds['Sky Bar'] === '#k-rooftop' && (kinds['Inspiration Point'] || '#k-viewpoint') === '#k-viewpoint', 'summits, rooftops and viewpoints each have their own picture');
    check(await page.locator(CUR + '.ghplaces .srow .sbadge .rank').allInnerTexts().then((t) => t.join('') === '123123123'), 'each keeps its rank, one to three, on the corner of its picture');
    const first = (await cards.nth(0).locator('.srow .n').first().innerText()).trim();
    check(first === 'Sloan’s Lake Park' || first === 'Inspiration Point' || first === 'Sunset Park', `famous and sunset-named places rank first (${first})`);
    check((await cards.nth(1).innerText()).includes('Lookout Mountain') && /effort/i.test(await cards.nth(1).innerText()), 'adventurous places say how much effort they take');
    check((await cards.nth(2).innerText()).includes('May need a booking'), 'dining says it may need a booking');
    await page.locator(CUR + '.ghplaces').scrollIntoViewIfNeeded();
    await shot(page, 'phone-places-section');
    await layout(page, 'place page with places (phone)');

    const missing = await page.evaluate(() => Array.from(document.querySelectorAll('.srow use, .sbadge use')).map((u) => u.getAttribute('href')).filter((h) => !document.querySelector(h)));
    check(missing.length === 0, `every picture is drawn in the page${missing.length ? ': missing ' + missing.join(' ') : ''}`);
    await page.click(CUR + '[data-act="spots-all"]');
    await page.waitForSelector('.screenhead h1');
    check((await text(page, '.screenhead h1')) === 'Golden Hour Places', 'See all opens Golden Hour Places');
    const parts = (await page.locator('.screen .spotcard .eyebrow > span:first-of-type').allInnerTexts()).map((h) => h.trim());
    check(parts.join('|') === 'LANDMARKS|ADVENTUROUS|DINING WITH A VIEW|YOUR SPOTS', 'four parts: landmarks, adventurous, dining, your spots');
    check(await page.locator('.screen .spotcard').first().locator('.srow').count() === 5, 'the top five of each');
    await page.click('.screen [data-act="spots-more"]');
    check(await page.locator('.screen .spotcard').first().locator('.srow').count() === 6, 'and the rest on Show more');
    await shot(page, 'phone-golden-hour-places');
    await layout(page, 'Golden Hour Places (phone)'); await contrast(page, 'Golden Hour Places');

    check((await page.locator('.screen .spotcard').nth(2).locator('.srow .n').first().innerText()).trim() === 'Sky Bar', 'a rooftop with a view in its name ranks first for dining');
    await page.locator('.screen .spotcard').nth(2).locator('.srow', { hasText: 'Linger' }).click();
    await page.waitForSelector('.spothero h2');
    check((await text(page, '.spothero h2')) === 'Linger', 'a place opens on its own screen');
    check(await page.locator('a:has-text("Website")').count() === 1 && await page.locator('a:has-text("Call to book")').count() === 1, 'with its website and a way to book');
    check(/here/i.test(await text(page, '.screen')), 'and tonight’s sunset there');
    await shot(page, 'phone-spot');
    await layout(page, 'a place (phone)'); await contrast(page, 'a place');
    await page.locator('[data-act="share-spot"]').first().click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t.includes('#s=')));
    const spotLink = await page.evaluate(() => navigator.clipboard.readText());
    check(/^Linger: a great place to watch the sunset near Denver\./.test(spotLink) && G_decode(spotLink), 'sharing a place copies a message and a link to it');
    await page.click('[data-act="spot-save"]');
    await page.waitForFunction(() => document.querySelector('.screen').textContent.includes('In your spots'), null, { timeout: 5000 }).catch(() => {});
    check((await text(page, '.screen')).includes('In your spots'), 'Save to your spots');
    await page.click('[data-act="spot-plan"]');
    await page.waitForSelector('.timeline');
    check(await page.inputValue('#spotName') === 'Linger' && await page.inputValue('#spotType') === 'venue', 'Plan this evening here fills in the plan with the place');
    await page.click('[data-act="close-view"]');

    await page.waitForSelector(CUR + '[data-act="spots-all"]');
    await page.click(CUR + '[data-act="spots-all"]');
    check((await page.locator('.screen .spotcard').nth(3).innerText()).includes('Linger'), 'a saved place appears under Your spots');
    await page.click('[data-act="spot-add"]');
    await page.fill('#spotName', 'The bench'); await page.dispatchEvent('#spotName', 'change');
    await page.fill('#coords', '39.7400, -105.0100'); await page.dispatchEvent('#coords', 'change');
    await page.click('[data-act="spot-create"]');
    check((await page.locator('.screen .spotcard').nth(3).innerText()).includes('The bench'), 'Add your own spot');
    await page.click('[data-act="close-view"]');
    await page.waitForSelector(CUR + '.ghplaces');
    check((await page.locator(CUR + '.ghplaces .spotcard').count()) === 4, 'your spots join the foot of the page');

    await page.click(CUR + '[data-act="share-today"]');
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t.startsWith('Tonight')), null, { timeout: 10000 });
    const today = await page.evaluate(() => navigator.clipboard.readText());
    const r0 = expectedDenver(0).rating;
    check(today.startsWith(`Tonight's sunset in Denver: ${r0.score.toFixed(1)}/5, ${r0.colourClass.toLowerCase()} colour.`) && /#l=Denver~39\.7392~-104\.9903~America%2FDenver/.test(today), `one tap shares tonight’s sunset, with a link that opens it (${today.slice(0, 160)})`);
    const card = await page.evaluate(async () => { const f = await window.__gh.card(); return f ? [f.type, f.size] : null; });
    check(card && card[0] === 'image/png' && card[1] > 20000, 'and a picture of it, for apps that take one');
    await context.close();

    const opened = await open({ hash: '#l=Boulder~40.0150~-105.2705~America%2FDenver' });
    await opened.page.waitForFunction(() => { const h = document.querySelector('.page[aria-current="true"] .hero h2'); return h && h.textContent.trim() === 'Boulder'; });
    check(true, 'a shared location link adds that location and opens it');
    await opened.context.close();
    const spotOpen = await open({ hash: '#s=' + spotLink.split('#s=')[1] });
    await spotOpen.page.waitForSelector('.spothero h2');
    check((await text(spotOpen.page, '.spothero h2')) === 'Linger' && (await text(spotOpen.page, '.spothero')).includes('Shared with you'), 'a shared place link opens that place');
    await spotOpen.context.close();

    net.overpass = 'down';
    const down = await open();
    await addPlace(down.page, 'Bould');
    await down.page.waitForSelector(CUR + '[data-act="spots-retry"]');
    check((await text(down.page, CUR + '.ghplaces')).includes('Couldn’t load places near Boulder'), 'when places can’t load, it says so, with Try again');
    net.overpass = 'ok';
    await down.page.click(CUR + '[data-act="spots-retry"]');
    await down.page.waitForSelector(CUR + '.ghplaces .srow');
    check(true, 'Try again finds them');
    await down.context.close();
  }

  // ---------- 4. The plan: pin, times, bring list, save, offline, share, calendar ----------
  let shareLink = '';
  {
    const { page, context } = await withDenver();
    await page.waitForSelector(CUR + '.hero .score');
    await page.click(CUR + '[data-act="plan-new"]');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {});
    const hasMap = await page.locator('.maplibregl-canvas').count() === 1;
    check(hasMap, 'plan: the map loads from this site’s own copy of MapLibre, under the content security policy');
    check(hasMap && (await text(page, '#map')).includes('Tap the map to drop a pin'), 'plan: the map says to tap to drop a pin');
    await shot(page, 'phone-plan-empty');
    if (hasMap) {
      await page.locator('.maplibregl-canvas').click({ position: { x: 120, y: 100 } });
      await page.waitForSelector('.timeline');
      check(await page.locator('.pin').count() === 1 && /^\d+\.\d{5}, -\d+\.\d{5}$/.test(await page.inputValue('#coords')), 'plan: tapping the map drops the pin');
    }
    await page.fill('#coords', '39.7323, -105.2391'); await page.dispatchEvent('#coords', 'change');
    await page.waitForSelector('.timeline');
    await page.fill('#spotName', 'Lookout <b>Mountain</b>'); await page.dispatchEvent('#spotName', 'change');
    await page.selectOption('#spotType', 'peak');
    await page.fill('#walkIn', '10'); await page.dispatchEvent('#walkIn', 'change');
    check(await page.locator('.maplibregl-canvas').count() === (hasMap ? 1 : 0) && await page.inputValue('#spotName') === 'Lookout <b>Mountain</b>', 'plan: editing keeps the map and what was typed');
    check((await text(page, '.hero h2')) === 'Lookout <b>Mountain</b>' && await page.locator('.hero h2 b').count() === 0, 'plan: a name is shown as text, never as markup');
    const exp = expectedDenver(0);
    const spotTimes = G.eveningTimes(G.solarNoonGuess(2026, 6, 20, -105.2391), 39.7323, -105.2391);
    const km = G.distance(DENVER.latitude, DENVER.longitude, 39.7323, -105.2391) / 1000, travel = G.travelMinutes(km), buffer = G.bufferMinutes(exp.rating.score, 6);
    const pt = G.planTimes(spotTimes, { walkIn: 10, travel, buffer });
    const fmt = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(ms).replace(/ /g, ' ').toLowerCase();
    const tl = await text(page, '.timeline');
    check(['leaveBy', 'meetAt', 'sunset', 'stayUntil', 'headBackBy'].every((k) => tl.includes(fmt(pt[k]))), `plan: leave by, meet at, sunset, stay until and head back by follow the rules (${travel} min travel, ${buffer} min buffer)`);
    check(tl.includes('From Denver') && (await text(page, '.col:nth-child(2)')).includes('Never shared'), 'plan: “Leaving from” is shown, and said to be never shared');
    const items = await page.locator('.item').count();
    check(items >= 1 && items <= 7, `plan: the bring list has ${items} items, never more than seven`);
    check((await text(page, '.items')).includes('Torch or phone light') && /°F · \d+°C|The walk back/.test(await text(page, '.items')), 'plan: each item says why');
    const dark = await text(page, '.facts');
    check(dark.includes('about 10 minutes') && dark.includes(fmt(pt.headBackBy)) && /moon/i.test(dark), 'plan: after-dark facts: the walk back, last light, the moon');
    await page.fill('#newItem', 'Camera'); await page.click('[data-act="item-add"]');
    await page.locator('.item .who').first().fill('Sam'); await page.locator('.item .who').first().dispatchEvent('change');
    await page.locator('.item input[type=checkbox]').nth(1).check();
    check((await text(page, '.items')).includes('Camera'), 'plan: you can add your own item');
    await shot(page, 'phone-plan');
    await layout(page, 'plan (phone)'); await contrast(page, 'plan');
    await page.click('[data-act="plan-save"]');
    await page.waitForSelector('[data-act="share"]');
    check(await page.locator('[data-act="calendar"]').isVisible() && await page.locator('a:has-text("Directions")').isVisible(), 'plan: once saved it offers Share, Add to calendar and Directions');
    check(/google\.com\/maps\/dir\/\?api=1&destination=39\.7323,-105\.2391/.test(await page.locator('a:has-text("Directions")').getAttribute('href')), 'plan: Directions opens maps at the spot');
    const saved = await page.evaluate(() => window.__gh.S.plans[0]);
    check(hasMap ? /^data:image\/jpeg/.test(saved.mapImage || '') : true, 'plan: a picture of the map is kept with the plan for offline');

    // Share
    await page.click('[data-act="share"]');
    check((await text(page, '#shareNotice')).includes('Anyone with this link can see the place, time and names'), 'share: the notice comes first');
    await page.click('[data-act="share-go"]');
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t.includes('#p=')));
    shareLink = await page.evaluate(() => navigator.clipboard.readText());
    const payload = shareLink.split('#p=')[1];
    const json = new TextDecoder().decode(G.fromBase64Url(payload));
    check(shareLink.length < 2000 + 60, `share: the link is ${shareLink.length} characters`);
    check(!/leave|travel|start|buffer/i.test(json) && !json.includes('104.99') && !json.includes(String(Math.round(pt.leaveBy / MIN))), 'share: the link holds no leave-by time, travel time or start point');
    check(json.includes('"w":10'), 'share: it does hold the walk in, which belongs to the spot');

    // Calendar
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="calendar"]')]);
    const ics = fs.readFileSync(await download.path(), 'utf8');
    const stamp = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString().replace(/[-:]/g, '').replace('.000', '');
    const dt = (k) => { const m = ics.match(new RegExp(k + ':(\\d{8}T\\d{6}Z)')); return m ? Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[1].slice(9, 11), +m[1].slice(11, 13), +m[1].slice(13, 15)) : 0; };
    check(Math.abs(dt('DTSTART') - pt.leaveBy) < 1000 && Math.abs(dt('DTEND') - pt.headBackBy) < 1000, 'calendar: the organiser’s event runs from leave-by to head-back-by');
    check(ics.includes('TRIGGER:-PT90M') && ics.includes('SUMMARY:Sunset at Lookout <b>Mountain</b>') && ics.replace(/\r\n /g, '').includes('#p='), 'calendar: an alert 90 minutes before, the title, and the share link in the notes');
    void stamp;

    // Saved, reloaded, offline
    await page.click('[data-act="close-view"]');
    check((await text(page, '.plan-row')).includes('Lookout') && (await text(page, '.plan-row')).includes('meet at'), 'plans: the saved plan is listed');
    await shot(page, 'phone-plans');
    await layout(page, 'plans (phone)');
    net.forecast = 'down'; net.tiles = 'down';
    await context.setOffline(true);
    await page.evaluate(() => { window.__reloaded = true; });
    const page2 = await context.newPage();
    await page2.clock.setFixedTime(new Date(NOON + 45 * MIN));
    await context.setOffline(false);            // the test server stands in for the offline app shell (the service worker is tested below)
    await page2.goto(BASE);
    await page2.waitForSelector('#view .hero');
    await context.setOffline(true);
    await page2.click('#bar [data-act="open-plans"]');
    await page2.click('.plan-row');
    await page2.waitForSelector('.timeline');
    check((await text(page2, '.timeline')).includes(fmt(pt.meetAt)), 'offline: a saved plan opens in full');
    check(await page2.locator('.item input[type=checkbox]:checked').count() === 1 && (await page2.locator('.item .who').first().inputValue()) === 'Sam', 'offline: ticks and names persist after a reload');
    check(hasMap ? await page2.locator('#map img, .map img').count() === 1 : true, 'offline: the plan shows its saved map picture');
    await shot(page2, 'phone-plan-offline');
    await page2.click('[data-act="close-view"]');
    check(await page2.locator('.plan-row').count() === 1, 'back from a saved plan returns to the list of plans');
    await page2.click('[data-act="close-view"]');
    check(await page2.locator(CUR + '.hero .score .n').isVisible() && (await text(page2, '#banner')).includes('Offline. Forecast updated'), 'offline: the cached forecast shows, with its age');
    await context.setOffline(false); net.forecast = 'ok'; net.tiles = 'ok';
    await context.close();
  }

  // ---------- 5. The shared plan, as its recipient sees it ----------
  {
    const { page, context } = await open({ hash: '#' + shareLink.split('#')[1] });
    await page.waitForSelector('.timeline');
    check((await text(page, '.hero h2')) === 'Lookout <b>Mountain</b>' && await page.locator('.hero h2 b').count() === 0, 'shared: the name arrives as text, not markup');
    check(await page.locator('.tl').count() === 4 && !(await text(page, '.timeline')).includes('Leave by'), 'shared: four times, and no leave-by');
    const bring = await text(page, '.group');
    check(bring.includes('SAM') && bring.includes('Camera'), 'shared: the whole bring list, grouped by name');
    check((await text(page, '#view')).includes('Plan as of') && await page.locator('[data-act="calendar"]').isVisible() && await page.locator('a:has-text("Directions")').isVisible(), 'shared: “Plan as of”, Add to calendar and Directions');
    check(await page.locator('#bar').isHidden() && await page.locator('.pager').count() === 0, 'shared: read-only, with none of the app’s own places');
    await page.waitForSelector('.card .stars', { timeout: 5000 }).catch(() => {});
    check(await page.locator('.card .stars').count() === 1, 'shared: the live score for the spot when online');
    await shot(page, 'phone-shared');
    await layout(page, 'shared (phone)'); await contrast(page, 'shared');
    await context.close();
    const bad = await open({ hash: '#p=' + shareLink.split('#p=')[1].slice(0, 30) });
    check((await text(bad.page, '#view')).includes('This plan link is incomplete. Ask for it again'), 'shared: an incomplete link says so');
    await bad.context.close();
  }

  // ---------- 6. Other states ----------
  {
    // The forecast can't be reached and nothing is cached.
    net.forecast = 'down';
    const a = await open();
    await addPlace(a.page, 'Denv');
    check((await text(a.page, CUR + '.hero')).includes('Couldn’t reach the forecast') && await a.page.locator(CUR + '[data-act="retry"]').isVisible(), 'forecast failed: says so, with Try again');
    net.forecast = 'ok';
    await a.page.click(CUR + '[data-act="retry"]');
    await a.page.waitForSelector(CUR + '.hero .score');
    check(true, 'forecast failed: Try again recovers');
    // No sunset: Tromsø in June.
    await addPlace(a.page, 'Trom');
    check((await text(a.page, CUR + '.hero')).includes('No sunset here on this date'), 'midnight sun: “No sunset here on this date”');
    check(await a.page.locator(CUR + '[data-act="plan-new"]').count() === 0, 'midnight sun: nothing to plan');
    await a.context.close();
    // Search falls back to the bundled list when the search service is down.
    net.geocode = 'down';
    const b = await open();
    await b.page.click('#bar [data-act="open-list"]');
    await b.page.fill('#q', 'Reykjav');
    await b.page.waitForSelector('.result');
    check((await text(b.page, '.result')).includes('Reykjav'), 'search works offline, from the bundled list of places');
    net.geocode = 'ok';
    await b.context.close();
  }
  {
    // After last light: tonight rolls over to tomorrow, and "How was it?" is asked once.
    const exp = expectedDenver(0);
    const first = await withDenver({ time: NOON + 2 * HOUR });          // an afternoon look logs today's forecast
    await first.page.waitForSelector(CUR + '.hero .score');
    await first.page.waitForTimeout(150);
    state = await first.context.storageState({ indexedDB: true });
    await first.context.close();
    const { page, context } = await withDenver({ time: exp.times.lastLight + 10 * MIN });
    await page.waitForSelector('#howWasIt');
    check((await text(page, CUR + '.hero .when')).startsWith('Tomorrow evening'), 'after last light: Tonight shows tomorrow’s evening');
    check((await text(page, CUR + '.hero .range')).startsWith('Forecast'), 'after last light: it keeps the Forecast label and range until midnight');
    check((await text(page, '#howWasIt')).includes(`We forecast ${exp.rating.score.toFixed(1)}`), 'after last light: “How was it?” for today, against what was forecast');
    await shot(page, 'phone-how-was-it');
    await page.click('#howWasIt [data-v="4"]');
    await page.waitForSelector('#toast:not([hidden])');
    check(await page.locator('#howWasIt').count() === 0, '“How was it?” is asked once');
    await page.click(CUR + '[data-act="log"]');
    check((await text(page, '#view')).includes('You said 4 of 5') && (await text(page, '#view')).includes('within one star'), 'the answer is kept in the sunset log, on the device');
    check(!net.calls.some((u) => /github|issues/.test(u)), 'nothing is sent anywhere');
    await layout(page, 'log (phone)');
    await context.close();
  }

  // ---------- 7. Tablet and desktop ----------
  for (const [name, viewport] of [['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1280, height: 800 }], ['small-phone', { width: 360, height: 640 }]]) {
    const { page, context } = await withDenver({ viewport });
    await page.waitForSelector(CUR + '.hero .score');
    await layout(page, `place page (${name})`); await contrast(page, `place page (${name})`);
    await shot(page, `${name}-place`);
    if (name === 'desktop') {
      const cols = await page.evaluate(() => { const c = document.querySelectorAll('.page[aria-current="true"] .two > .col'); return c[0].getBoundingClientRect().right <= c[1].getBoundingClientRect().left; });
      check(cols, 'desktop: two columns from 900px');
      check(parseFloat(await page.locator(CUR + '.score .n').evaluate((el) => getComputedStyle(el).fontSize)) >= 96, 'desktop: the score is at least 96px');
    }
    await page.click('#bar [data-act="open-list"]');
    await layout(page, `places (${name})`);
    await shot(page, `${name}-places`);
    await context.close();
  }

  // ---------- 8. The service worker: the app opens with no network at all ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Denver' });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('golden-hour-')) && (await (await caches.open((await caches.keys())[0])).keys()).length >= 8);
    await page.reload();
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.hero .score');
    check((await text(page, '.hero h2')).includes('Sample'), 'service worker: the app opens offline');
    await context.close();
  }

  // ---------- 9. The build ----------
  {
    const web = path.join(__dirname, '..', 'web'), version = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
    for (const f of ['index.html', 'app.css', 'core.js']) check(fs.readFileSync(path.join(web, f), 'utf8') === fs.readFileSync(path.join(ROOT, f), 'utf8'), `docs/${f} is the build of web/${f}`);
    for (const f of ['app.js', 'sw.js']) check(fs.readFileSync(path.join(web, f), 'utf8').replace(/__VERSION__/g, version) === fs.readFileSync(path.join(ROOT, f), 'utf8'), `docs/${f} is web/${f} with the version stamped in`);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check(/script-src 'self'/.test(html) && /style-src 'self'/.test(html) && !/unsafe-inline|unsafe-eval/.test(html), 'content security policy: scripts and styles from this site only');
    check(!/https?:\/\/(fonts\.googleapis|unpkg|cdn)/.test(html + fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8')), 'fonts and libraries are self-hosted');
  }
  check(problems.length === 0, `no script errors or policy violations${problems.length ? ': ' + problems.slice(0, 4).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
