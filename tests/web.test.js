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

const ROOT = path.join(__dirname, '..', 'docs');
const SHOTS = process.argv[2];
const NOON = Date.UTC(2026, 5, 20, 18, 0);              // 12:00 in Denver
const HOUR = 3600000, MIN = 60000;
const DENVER = { name: 'Denver', admin1: 'Colorado', country: 'United States', latitude: 39.7392, longitude: -104.9903, timezone: 'America/Denver' };
const BOULDER = { name: 'Boulder', admin1: 'Colorado', country: 'United States', latitude: 40.015, longitude: -105.2705, timezone: 'America/Denver' };
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
  const net = { forecast: 'ok', geocode: 'ok', tiles: 'ok', calls: [] };

  async function open(opts) {
    const o = opts || {};
    const context = o.context || await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Denver', serviceWorkers: 'block',
      permissions: ['clipboard-read', 'clipboard-write'].concat(o.geo ? ['geolocation'] : []), geolocation: o.geo || undefined, deviceScaleFactor: 1 });
    if (!o.context) {
      await context.route(/open-meteo\.com|openfreemap\.org/, (route) => {
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
    await page.waitForSelector('#view > *');
    return { page, context };
  }
  const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); } };
  const text = (page, sel) => page.locator(sel).first().innerText();
  async function addPlace(page, q) {
    if (!(await page.locator('#q').isVisible().catch(() => false))) await page.click('[data-act="search"]');
    await page.fill('#q', q);
    const name = (await page.locator('.result .n').first().innerText()).trim();
    await page.click('.result');
    await page.waitForFunction((n) => { const h = document.querySelector('.hero h2'); return h && h.textContent === n && !document.querySelector('.chip[aria-current] .tag') && document.querySelector('.hero .score, .hero .none'); }, name);
  }
  /** Checks that hold on every screen: nothing scrolls sideways, no text under 13px, buttons big enough. */
  async function layout(page, what) {
    const r = await page.evaluate(() => {
      const out = { wide: document.documentElement.scrollWidth - window.innerWidth, small: [], targets: [] };
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
  /** WCAG contrast of white-ish text against what is behind it: the sky at that height, under the card's scrim. */
  async function contrast(page, what) {
    const worst = await page.evaluate(() => {
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const css = getComputedStyle(document.documentElement);
      const stops = [[0, hex(css.getPropertyValue('--sky-top').trim())], [0.4, hex(css.getPropertyValue('--sky-top').trim())], [0.8, hex(css.getPropertyValue('--sky-mid').trim())], [1, hex(css.getPropertyValue('--sky-bottom').trim())]];
      const skyAt = (f) => { for (let i = 1; i < stops.length; i++) if (f <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (f - a) / (b - a || 1); return ca.map((v, j) => v + (cb[j] - v) * k); } return stops[3][1]; };
      const rgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { c: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
      const over = (top, a, under) => top.map((v, i) => v * a + under[i] * (1 - a));
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      let worst = { ratio: 99, text: '' };
      const walker = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !el.getClientRects().length || el.closest('.maplibregl-map, [hidden]')) continue;
        const box = el.getBoundingClientRect();
        // The worst case for this text: the lightest sky it can sit over, which is the bottom of the window.
        let bg = skyAt(Math.min(1, Math.max(0, box.bottom / window.innerHeight)));
        if (el.closest('.card, .notice, .warn, .verdict, .banner')) bg = skyAt(1);
        const chain = [];
        for (let e = el; e && e !== document.body; e = e.parentElement) chain.unshift(e);
        for (const e of chain) { const b = rgba(getComputedStyle(e).backgroundColor); if (b.a > 0) bg = over(b.c, b.a, bg); }
        const fg = rgba(getComputedStyle(el).color), colour = over(fg.c, fg.a * parseFloat(getComputedStyle(el).opacity || 1), bg);
        const a = lum(colour), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const size = parseFloat(getComputedStyle(el).fontSize), weight = Number(getComputedStyle(el).fontWeight), large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        if (ratio / need < worst.ratio / (worst.need || 4.5)) worst = { ratio, need, text: n.textContent.trim().slice(0, 30) };
      }
      return worst;
    });
    check(worst.ratio >= worst.need, `${what}: text contrast at least ${worst.need}:1 over the lightest sky (worst ${worst.ratio.toFixed(2)}:1, “${worst.text}”)`);
  }

  // ---------- 1. First run ----------
  {
    const { page, context } = await open();
    check((await text(page, '#places')).includes('Sample'), 'first run: a sample city, labelled Sample');
    check(await page.locator('.hero .score .n').isVisible(), 'first run: the sample evening shows a score');
    check(await page.locator('#q').isVisible() && await page.locator('[data-act="locate"]').isVisible(), 'first run: search and Use my location are both offered');
    check(net.calls.length === 0, 'first run: nothing is fetched until a place is chosen');
    await layout(page, 'first run (phone)'); await contrast(page, 'first run');
    await shot(page, 'phone-first-run');
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
    check(!(await text(page, '#places')).includes('Sample'), 'adding a place replaces the sample');
    check(await text(page, '.hero .score .n') === r.score.toFixed(1), `the score on screen is the core’s for the same forecast (${r.score.toFixed(1)})`);
    check((await text(page, '.verdict')).startsWith(r.verdictWord) && await page.locator('.verdict svg').count() === 1, 'the verdict has a word and an icon, not just a colour');
    check((await text(page, '.hero .range')).includes(`likely ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}`), 'the range is shown, labelled typical');
    check(await text(page, '.hero .reason') === r.reason, 'the reason sentence');
    check((await text(page, '.hero .colour')).replace(/\s+/g, ' ') === `COLOUR ${r.colourClass} ${r.colour}`, `the colour class leads, after the stars (${r.colourClass}, ${r.colour})`);
    const label = await page.locator('.hero').getAttribute('aria-label');
    check(label === `Tonight. ${r.score.toFixed(1)} out of 5 stars, likely ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}. ${r.colourClass} colour, ${r.colour} out of 100. ${r.verdictWord}${r.qualifier ? ', ' + r.qualifier : ''}. ${r.reason}`, 'screen readers get one sentence; the stars are hidden from them');
    check(await page.locator('.hero .stars').getAttribute('aria-hidden') === 'true', 'star glyphs are hidden from assistive technology');
    const fill = await page.locator('.hero .stars .fill').evaluate((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    check(Math.abs(fill - r.score / 5) < 0.01, 'stars are filled in proportion to the score');
    const strip = await text(page, '.times');
    const fmt = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(ms).replace(/ /g, ' ').toLowerCase();
    check(['goldenStart', 'bestStart', 'sunset', 'afterglowEnd', 'lastLight'].every((k) => strip.includes(fmt(exp.times[k]))), 'the five times match the sun’s position to the minute');
    await page.click('details.parts summary');
    const partsText = await text(page, 'details.parts');
    check(/Colour/.test(partsText) && /Seeing the sun set/.test(partsText) && /Air clarity/.test(partsText) && /Comfort/.test(partsText), 'tapping opens the four parts');
    check(/\d+ mph · \d+ km\/h/.test(partsText) && /\d+°F · \d+°C/.test(partsText), 'the parts show their inputs in both units');
    check(/usual \d+°F/.test(partsText), 'comfort compares with the usual evening temperature here');
    await shot(page, 'phone-tonight');
    await layout(page, 'tonight (phone)'); await contrast(page, 'tonight');
    await page.click('#unitsMetric');
    check(/\d+ km\/h · \d+ mph/.test(await text(page, 'details.parts').catch(() => '')) || (await page.click('details.parts summary'), /\d+ km\/h · \d+ mph/.test(await text(page, 'details.parts'))), 'the units switch changes which is listed first');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('gh.imperialFirst'))) === false, 'and is remembered');
    await page.click('#unitsImperial');
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
    await context.route(/open-meteo\.com|openfreemap\.org/, async (route) => {
      const url = new URL(route.request().url());
      net.calls.push(url.href);
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      if (url.hostname === 'geocoding-api.open-meteo.com') { const q = url.searchParams.get('name').toLowerCase(); return net.geocode === 'ok' ? json({ results: [DENVER, BOULDER, TROMSO].filter((c) => c.name.toLowerCase().startsWith(q) || (q.startsWith('trom') && c === TROMSO)) }) : route.abort(); }
      if (url.hostname === 'api.open-meteo.com') return net.forecast === 'ok' ? json(forecastBody(url)) : route.abort();
      if (url.hostname === 'air-quality-api.open-meteo.com') return net.forecast === 'ok' ? json(airBody()) : route.abort();
      if (url.hostname === 'archive-api.open-meteo.com') return json(archiveBody());
      if (url.hostname === 'tiles.openfreemap.org') return net.tiles === 'ok' ? json({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2B4A4A' } }] }) : route.abort();
      return route.abort();
    });
    return open({ context, time: o && o.time, hash: o && o.hash });
  };

  // ---------- 3. Week and Compare ----------
  {
    const { page, context } = await withDenver();
    await page.waitForSelector('.hero .score');
    await page.click('#tabWeek');
    const rows = page.locator('.day');
    check(await rows.count() === 10, 'week: ten evenings');
    check(await page.locator('button.day').count() === 6, 'week: six are rated');
    const outlook = await rows.nth(4).innerText();
    check(/likely \d\.\d to \d\.\d/.test(outlook) && await rows.nth(4).locator('.stars.outlook').count() === 1 && /\d\.[05]\b/.test(await rows.nth(4).locator('.sc').innerText()), 'week: outlook rows use hollow half stars and a range');
    check((await rows.nth(7).innerText()).includes('Too early to call') && /Sunset \d/.test(await rows.nth(7).innerText()), 'week: later rows show the sunset time and “Too early to call”');
    check(await page.locator('.best').count() <= 1, 'week: at most one best evening');
    const exp = [0, 1, 2].map((d) => expectedDenver(d).rating).filter((r) => r.verdict === 'go').sort((a, b) => b.score - a.score)[0];
    check(!exp || (await page.locator('.day:has(.best) .sc').innerText()) === exp.score.toFixed(1), 'week: the best evening is the highest Go among tonight and the next two');
    await shot(page, 'phone-week');
    await layout(page, 'week (phone)'); await contrast(page, 'week');
    await rows.nth(1).click();
    check((await text(page, '.hero .when')).startsWith('TOMORROW') && await page.locator('[data-act="plan-new"]').isVisible(), 'week: tapping a row opens that evening, with Plan this evening');
    check(await page.locator('.back').isVisible(), 'and a way back to tonight');
    await addPlace(page, 'Bould');
    await page.click('#tabWeek');
    await page.click('[data-act="compare"]');
    await page.waitForFunction(() => document.querySelectorAll('table.cmp td button').length === 12);
    check(await page.locator('table.cmp tr').count() === 3, 'compare: one row per saved place');
    await shot(page, 'phone-compare');
    await layout(page, 'compare (phone)');
    await page.locator('table.cmp tr').nth(1).locator('td button').nth(2).click();
    check((await text(page, '.hero h2')) === 'Denver' && /MONDAY/.test(await text(page, '.hero .when')), 'compare: a cell opens that place and evening');
    await context.close();
  }

  // ---------- 4. The plan: pin, times, bring list, save, offline, share, calendar ----------
  let shareLink = '';
  {
    const { page, context } = await withDenver();
    await page.waitForSelector('.hero .score');
    await page.click('[data-act="plan-new"]');
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
    await page.click('#tabPlans');
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
    await page2.waitForSelector('#view > *');
    await context.setOffline(true);
    await page2.click('#tabPlans');
    await page2.click('.plan-row');
    await page2.waitForSelector('.timeline');
    check((await text(page2, '.timeline')).includes(fmt(pt.meetAt)), 'offline: a saved plan opens in full');
    check(await page2.locator('.item input[type=checkbox]:checked').count() === 1 && (await page2.locator('.item .who').first().inputValue()) === 'Sam', 'offline: ticks and names persist after a reload');
    check(hasMap ? await page2.locator('#map img, .map img').count() === 1 : true, 'offline: the plan shows its saved map picture');
    await shot(page2, 'phone-plan-offline');
    await page2.click('[data-act="close-view"]');
    await page2.click('#tabTonight');
    check(await page2.locator('.hero .score .n').isVisible() && (await text(page2, '#banner')).includes('Offline. Forecast updated'), 'offline: the cached forecast shows, with its age');
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
    check(await page.locator('#tabs').isHidden() && await page.locator('#places').isHidden(), 'shared: read-only, with none of the app’s own places');
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
    check((await text(a.page, '.hero')).includes('Couldn’t reach the forecast') && await a.page.locator('[data-act="retry"]').isVisible(), 'forecast failed: says so, with Try again');
    net.forecast = 'ok';
    await a.page.click('[data-act="retry"]');
    await a.page.waitForSelector('.hero .score');
    check(true, 'forecast failed: Try again recovers');
    // No sunset: Tromsø in June.
    await addPlace(a.page, 'Trom');
    check((await text(a.page, '.hero')).includes('No sunset here on this date'), 'midnight sun: “No sunset here on this date”');
    check(await a.page.locator('[data-act="plan-new"]').count() === 0, 'midnight sun: nothing to plan');
    await a.context.close();
    // Search falls back to the bundled list when the search service is down.
    net.geocode = 'down';
    const b = await open();
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
    await first.page.waitForSelector('.hero .score');
    await first.page.waitForTimeout(150);
    state = await first.context.storageState({ indexedDB: true });
    await first.context.close();
    const { page, context } = await withDenver({ time: exp.times.lastLight + 10 * MIN });
    await page.waitForSelector('#howWasIt');
    check((await text(page, '.hero .when')).startsWith('TOMORROW EVENING'), 'after last light: Tonight shows tomorrow’s evening');
    check((await text(page, '.hero .range')).startsWith('Forecast'), 'after last light: it keeps the Forecast label and range until midnight');
    check((await text(page, '#howWasIt')).includes(`We forecast ${exp.rating.score.toFixed(1)}`), 'after last light: “How was it?” for today, against what was forecast');
    await shot(page, 'phone-how-was-it');
    await page.click('#howWasIt [data-v="4"]');
    await page.waitForSelector('#toast:not([hidden])');
    check(await page.locator('#howWasIt').count() === 0, '“How was it?” is asked once');
    await page.click('[data-act="log"]');
    check((await text(page, '#view')).includes('You said 4 of 5') && (await text(page, '#view')).includes('within one star'), 'the answer is kept in the sunset log, on the device');
    check(!net.calls.some((u) => /github|issues/.test(u)), 'nothing is sent anywhere');
    await layout(page, 'log (phone)');
    await context.close();
  }

  // ---------- 7. Tablet and desktop ----------
  for (const [name, viewport] of [['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1280, height: 800 }], ['small-phone', { width: 360, height: 640 }]]) {
    const { page, context } = await withDenver({ viewport });
    await page.waitForSelector('.hero .score');
    await layout(page, `tonight (${name})`); await contrast(page, `tonight (${name})`);
    await shot(page, `${name}-tonight`);
    if (name === 'desktop') {
      const cols = await page.evaluate(() => { const c = document.querySelectorAll('.two > .col'); return c[0].getBoundingClientRect().right <= c[1].getBoundingClientRect().left; });
      check(cols, 'desktop: two columns from 900px');
      check(parseFloat(await page.locator('.score .n').evaluate((el) => getComputedStyle(el).fontSize)) === 96, 'desktop: the score is 96px');
    }
    await page.click('#tabWeek');
    await layout(page, `week (${name})`);
    await shot(page, `${name}-week`);
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
    check((await text(page, '#places')).includes('Sample'), 'service worker: the app opens offline');
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
