// Tests for the web app as built (docs/), run with Playwright:  node tests/web.test.js [screenshot-dir]
// The page is served over HTTP as on the site, with the forecast, the open map, the venue search and the map
// tiles answered by this script, and the clock fixed at midday in Denver. It walks the fix plan's "done when"
// tests (docs/FIX-PLAN.md, releases A to C), including every failure state, at phone, tablet and desktop widths.
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
const { NOON, DENVER, BOULDER, TROMSO, OSM, NEAR, standIn } = require('./standin.js');   // NOON: 12:00 in Denver, 20 June
const HOUR = 3600000, MIN = 60000;

let passed = 0, failed = 0;
const results = [];
function check(ok, what) { ok ? passed++ : failed++; results.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) console.log('FAIL ' + what); }

// ---------- The stand-in forecast: the core's sample evenings, in Open-Meteo's shape (tests/standin.js) ----------
const { sample, secs, forecastBody, airBody, archiveBody } = standIn(9);
/** What the core says for Denver: `base` days after 20 June is "today", and `day` counts from there. */
const expectedDenver = (day, base, normal) => {
  const date = new Date(Date.UTC(2026, 5, 20 + (base || 0) + day));
  const t = G.eveningTimes(G.solarNoonGuess(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), DENVER.longitude), DENVER.latitude, DENVER.longitude);
  const aq = { time: sample.p0.time, aerosol_optical_depth: secs.map(() => 0.12), pm2_5: secs.map(() => 6), us_aqi: secs.map(() => 35) };
  return { times: t, rating: G.rate(G.inputsAt(sample.p0, sample.up, aq, t.sunset), { day, normal: normal === undefined ? 10 + 0.65 * 14 : normal, imperialFirst: true }) };
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
  const net = { forecast: 'ok', geocode: 'ok', tiles: 'ok', overpass: 'ok', near: 'ok', photon: 'ok', calls: [] };

  async function open(opts) {
    const o = opts || {};
    const context = o.context || await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Denver', serviceWorkers: 'block',
      permissions: ['clipboard-read', 'clipboard-write'].concat(o.geo ? ['geolocation'] : []), geolocation: o.geo || undefined, deviceScaleFactor: 1 });
    if (!o.context) {
      await context.addInitScript(() => {
        window.__shares = [];
        navigator.share = async (d) => { window.__shares.push({ title: d.title || '', text: d.text || '', url: d.url || '', files: (d.files || []).map((f) => `${f.name}|${f.type}|${f.size}`) }); };
        navigator.canShare = (d) => !((d && d.files) || []).some((f) => f.type === 'text/calendar');
      });
      await context.route(/open-meteo\.com|openfreemap\.org|overpass|photon\.komoot/, async (route) => {
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
        if (/overpass/.test(url.hostname)) {
          if (/around:300/.test(url.searchParams.get('data') || '')) return net.near === 'down' ? route.abort() : json({ elements: net.near === 'none' ? [] : NEAR });
          if (net.overpass === 'down') return route.abort();
          if (net.overpass === 'remark') return json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' });
          if (net.overpass === 'empty') return json({ elements: [] });
          if (net.overpass === 'slow') await new Promise((r) => setTimeout(r, 20000));
          return json({ elements: OSM });
        }
        if (url.hostname === 'photon.komoot.io') {
          if (net.photon !== 'ok') return route.abort();
          return json({ features: /boat/i.test(url.searchParams.get('q')) ? [{ geometry: { coordinates: [-105.0431, 39.7473] }, properties: { name: 'The Boathouse', street: 'W Byron Pl', housenumber: '4700', city: 'Denver', state: 'Colorado', country: 'United States', osm_value: 'restaurant' } }] : [] });
        }
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
    await page.waitForFunction((n) => { const h = document.querySelector('.page[aria-current="true"] .hero h2'); return h && h.textContent.trim() === n && document.querySelector('.page[aria-current="true"] .hero .ans, .page[aria-current="true"] .hero .none'); }, name);
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

  const DAY = 86400000;
  const GO = NOON + 3 * DAY;                              // Tuesday 23 June: a Go evening in the stand-in forecast
  const fmt = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(ms).replace(' AM', ' am').replace(' PM', ' pm').replace(/ /g, ' ');
  const norm = (s) => s.replace(/[  ]/g, ' ').replace(/ (AM|PM)/g, (m) => m.toLowerCase());
  const answerOf = (r, when) => (r.verdict === 'go' ? `Go ${when}` : r.verdict === 'maybe' ? `Maybe ${when}` : `Not ${when}`);
  const shares = (page) => page.evaluate(() => window.__shares);
  const waitPlaces = (page) => page.waitForFunction(() => { const g = window.__gh, d = g.DATA[g.S.current]; return d && d.spots && typeof d.spots === 'object' && d.near && typeof d.near === 'object'; }, null, { timeout: 15000 });
  /** The times at the place on top of the page (Inspiration Point), `day` days after 23 June: what every screen shows. */
  const pickTimesOn = (day) => G.eveningTimes(G.solarNoonGuess(2026, 6, 23 + day, OSM[0].lon), OSM[0].lat, OSM[0].lon);
  const reset = () => Object.assign(net, { forecast: 'ok', geocode: 'ok', tiles: 'ok', overpass: 'ok', near: 'ok', photon: 'ok' });

  // ---------- 1. First run: the sample, and the answer in ten seconds ----------
  {
    const { page, context } = await open();
    check((await text(page, CUR + '.hero h2')).includes('Sample'), 'first run: a sample town, labelled Sample');
    check(/^(Go|Maybe|Not) tonight$/.test((await text(page, CUR + '.hero .ans')).trim()), 'first run: the top of the page is the answer in words');
    check(/Sunset \d+:\d\d/.test(norm(await text(page, CUR + '.hero .atimes'))), 'first run: one time under it');
    check(/^\d\.\d\s+of 5$/.test(norm(await text(page, CUR + '.hero .hscore')).trim()) && await page.locator(CUR + '.hero .dial .arc').count() === 1 && await page.locator(CUR + '.hero .stars').count() === 0, 'the score sits beside the answer, on one line, with no stars');
    check(net.calls.length === 0, 'first run: nothing is fetched until a place is chosen');
    const tabs = (await page.locator('#bar .barbtn span').allInnerTexts()).map((t) => t.trim());
    check(tabs.join('|') === 'Today|Plans|Places' && await page.locator('#bar .barbtn[aria-current="page"]').innerText() === 'Today', 'the bar: Today, Plans, Places, with the one you are on marked');
    const fold = await page.evaluate(() => { const hero = document.querySelector('.page[aria-current="true"] .hero'), pick = document.querySelector('.page[aria-current="true"] .pick, .page[aria-current="true"] .ask'); return pick ? pick.getBoundingClientRect().top < window.innerHeight && hero.getBoundingClientRect().bottom <= window.innerHeight : false; });
    check(fold, 'the answer, the time and what to do next are on the first screen without scrolling');
    await layout(page, 'first run (phone)'); await contrast(page, 'first run');
    await shot(page, 'phone-first-run');
    await page.click(CUR + '[data-act="add-place"]');
    check(await page.locator('#q').isVisible() && await page.locator('[data-act="locate"]').isVisible(), 'first run: Add my place opens search and Use my location');
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'q'), 'and puts the cursor in the search box');
    check(await page.locator('#bar').isVisible() && await page.locator('#bar .barbtn[aria-current="page"]').innerText() === 'Places', 'the bar stays, now on Places');
    await layout(page, 'places tab (phone)'); await contrast(page, 'places tab');
    await shot(page, 'phone-places-tab');
    await page.click('[data-act="locate"]');
    await page.waitForSelector('#toast:not([hidden])');
    check(/turned off/.test(await text(page, '#toast')), 'location not allowed: says it is turned off, and to search or allow it');
    await page.goBack();
    await page.waitForSelector(CUR + '.hero');
    check(await page.locator('#q').count() === 0 && await page.locator('#bar .barbtn[aria-current="page"]').innerText() === 'Today', 'the browser’s Back returns to Today');
    await context.close();
  }

  // ---------- 2. A "Not tonight": it says so, says why, and offers the next good evening ----------
  let skipState;
  {
    const { page, context } = await open();
    await addPlace(page, 'Denv');
    await page.waitForFunction(() => window.__gh.S.places[0].normals);
    await waitPlaces(page);
    await page.waitForTimeout(150);
    const exp = expectedDenver(0), r = exp.rating;
    check(r.verdict === 'skip', 'the stand-in forecast makes 20 June a skip');
    check(await page.locator('.page').count() === 1 && !(await text(page, CUR + '.hero h2')).includes('Sample'), 'adding a place replaces the sample');
    check((await text(page, CUR + '.hero .ans')).trim() === 'Not tonight', 'a skip evening reads “Not tonight”');
    const next = [1, 2, 3, 4, 5].map((d) => expectedDenver(d)).find((e) => e.rating.verdict === 'go');
    const nextName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'long' }).format(next.times.sunset);
    const reason = (await text(page, CUR + '.hero .reason')).trim();
    check(reason.startsWith(r.reason) && reason.endsWith(`Try ${nextName}.`), `with the reason and the next good evening (“${reason}”)`);
    check(norm(await text(page, CUR + '.hero .atimes')) === `Sunset ${fmt(exp.times.sunset)}`, 'a Not tonight shows the sunset time and no “be there by”');
    check(await page.locator(CUR + '.pick [data-act="plan-new"]').innerText() === `Plan ${nextName}` && !/this evening/.test(await text(page, CUR + '.pick')), `the button plans ${nextName}, not this evening`);
    check(await page.locator(CUR + '.pick .srow[data-act="spot-open"]').count() === 0 && await page.locator(CUR + '.moreplaces .srow').count() === 0, 'no place is pushed on a Not tonight');
    check(/^Updated \d+:\d\d (am|pm) · Refresh$/.test(norm(await text(page, CUR + '.upd')).trim()), 'when the forecast was updated, with Refresh');
    check(await page.locator('.page[aria-current="true"] .small').filter({ hasText: 'Add another place to swipe between them' }).count() === 1, 'with one location, a line says how to get more to swipe between');
    await layout(page, 'not tonight (phone)'); await contrast(page, 'not tonight');
    await shot(page, 'phone-not-tonight');
    // The day's sheet for the next good evening.
    await page.click(CUR + '.pick .dayline');
    await page.waitForSelector('#sheet .ans');
    check((await text(page, '#sheet .ans')).trim() === `Go ${nextName}` && (await text(page, '#sheetTitle')).startsWith(nextName), 'the next good evening opens as a sheet over the page');
    check((await text(page, CUR + '.hero .ans')).trim() === 'Not tonight', 'and the page underneath has not moved');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#sheetback', { state: 'hidden' });
    skipState = await context.storageState({ indexedDB: true });
    await context.close();
  }

  // ---------- 3. A Go evening: one answer, one time, one place, and why ----------
  let state;   // a context with Denver saved, on a Go evening
  {
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await page.waitForFunction(() => window.__gh.S.places[0].normals);
    await waitPlaces(page);
    await page.waitForTimeout(150);
    const exp = expectedDenver(0, 3), r = exp.rating;
    check(r.verdict === 'go', 'the stand-in forecast makes 23 June a Go');
    check((await text(page, CUR + '.hero .ans')).trim() === 'Go tonight' && (await text(page, CUR + '.hero .reason')).trim() === r.reason, 'the answer and its reason are the core’s for the same forecast');
    const pickT = G.eveningTimes(G.solarNoonGuess(2026, 6, 23, OSM[0].lon), OSM[0].lat, OSM[0].lon);   // the place on top: its own times, as its plan shows
    check(norm(await text(page, CUR + '.hero .atimes')) === `Sunset ${fmt(pickT.sunset)} · be there by ${fmt(pickT.bestStart - 20 * MIN)}`, 'one time: sunset, and be there by 20 minutes before the best light');
    const pf = norm(await text(page, CUR + '.pick .pfacts')).replace(/\s+/g, ' ');
    check(/Leave by \d+:\d\d pm/.test(pf) && /Golden hour/.test(pf) && pf.includes(`Start back by ${fmt(pickT.lastLight - 5 * MIN)}`), 'the place on top says when to leave, the golden hour and when to start back');
    check(/Parking and toilets nearby/.test(await text(page, CUR + '.pick .srow')) && await page.locator(CUR + '.pick a.btn').innerText() === 'Directions', 'with parking and toilets on its row, and Directions beside the plan button');
    check(norm(await text(page, CUR + '.daily')).includes(`Sunset is about ${fmt(pickT.sunset)} all week`), 'the week says the same sunset time as the top');
    check((await page.locator(CUR + 'button.day .ic small').allInnerTexts()).every((w) => ['Great', 'Good', 'Maybe', 'Skip'].includes(w.trim())), 'each evening has one word: Great, Good, Maybe or Skip');
    check(/Outlook|Forecast|typical|°/.test(await text(page, CUR + '.hero')) === false, 'no “Outlook”, “Forecast”, “(typical)” or compass degrees on the answer');
    check((await text(page, CUR + '.pick .srow .n')).trim() === 'Inspiration Point' && (await text(page, CUR + '.pick [data-act="plan-new"]')).trim() === 'Plan this evening', 'one place: the top easy-to-reach one, with Plan this evening');
    check(await page.locator(CUR + '.dt').count() === 0 && await page.locator(CUR + '[data-act="details-toggle"]').getAttribute('aria-expanded') === 'false', 'the score and the tiles are one tap down, under Why');
    const noSide = await page.evaluate(() => Array.from(document.querySelectorAll('.page[aria-current="true"] *')).filter((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)).length);
    check(noSide === 0, 'nothing on the page scrolls sideways, so a swipe anywhere moves between locations');
    await layout(page, 'go evening (phone)'); await contrast(page, 'go evening');
    await shot(page, 'phone-today');
    await page.click(CUR + '[data-act="details-toggle"]');
    check((await text(page, CUR + '.scorecard .big')).trim() === r.score.toFixed(1) && (await text(page, CUR + '.scorecard')).includes(`${r.colourClass} colour`) && !/of 100/.test(await text(page, CUR + '.scorecard')), `Why shows the score (${r.score.toFixed(1)}) and the colour class`);
    const strip = norm(await text(page, CUR + '.times'));
    check(['goldenStart', 'bestStart', 'sunset', 'afterglowEnd', 'lastLight'].every((k) => strip.includes(fmt(pickT[k]))), 'and the five times, to the minute');
    check(await page.locator(CUR + '.dt').count() === 15 && await page.evaluate(() => localStorage.getItem('gh.details')) === 'true', 'and every tile; the choice is remembered');
    check(/flat horizon/.test(await text(page, CUR + '.card:has(.evpath)')), 'a note says times assume a flat horizon');
    await shot(page, 'phone-why');
    await page.click(CUR + '[data-act="details-toggle"]');
    // The week
    const rows = page.locator(CUR + 'button.day');
    check(await rows.count() === 4, 'the week: an evening a line, for the days the stand-in forecast covers');
    await page.locator(CUR + '.daily').scrollIntoViewIfNeeded();
    await shot(page, 'phone-week');
    await rows.nth(1).click();
    await page.waitForSelector('#sheet .sh-head');
    const e1 = expectedDenver(1, 3);
    check((await text(page, '#sheet .ans')).trim() === answerOf(e1.rating, 'tomorrow') && await page.locator('#sheet .dt').count() === 15 && await page.locator('#sheet .light').count() === 1, 'tapping an evening opens its sheet: the answer, the light, the score and every tile');
    const l1 = pickTimesOn(1);
    const light = norm(await text(page, '#sheet .light'));
    check(light.includes(`Golden hour ${fmt(l1.goldenStart)} to ${fmt(l1.afterglowEnd)}`) && light.includes(`Blue hour ${fmt(l1.afterglowEnd)} to ${fmt(l1.lastLight)}`) && /sets to the north-west/.test(light), 'golden hour, blue hour and where the sun sets');
    check(light.includes(`Decide by ${fmt(l1.bestStart - 20 * MIN - 3 * HOUR)}`) && /Wind \d+ mph/.test(light), 'a decide-by time three hours before, with the wind');
    await layout(page, 'day sheet (phone)');
    await shot(page, 'phone-day-sheet');
    await page.click('#sheet [data-act="sheet-step"][data-d="1"]');
    check((await text(page, '#sheet .ans')).trim().split(' ')[0] === answerOf(expectedDenver(2, 3).rating, 'x').split(' ')[0], 'the arrows step to the next evening');
    await page.goBack();
    await page.waitForSelector('#sheetback', { state: 'hidden' });
    check((await text(page, CUR + '.hero .ans')).trim() === 'Go tonight', 'Back closes the sheet, and Today is as it was');
    // Any date, months ahead
    await page.fill(CUR + '#anyDate', '2027-06-12');
    await page.locator(CUR + '#anyDate').dispatchEvent('change');
    await page.waitForSelector('#sheet .sh-head');
    const far = G.eveningTimes(G.solarNoonGuess(2027, 6, 12, DENVER.longitude), DENVER.latitude, DENVER.longitude);
    check((await text(page, '#sheetTitle')).trim() === 'Saturday, Jun 12' && norm(await text(page, '#sheet .ans')).trim() === `Sunset ${fmt(far.sunset)}`, 'any date, a year ahead: the exact sunset time');
    check(/Times are exact\. Colour can’t be forecast yet\./.test(await text(page, '#sheet')) && await page.locator('#sheet .dt, #sheet .scorecard').count() === 0 && await page.locator('#sheet [data-act="plan-new"]').isVisible(), 'with “Times are exact. Colour can’t be forecast yet.”, no rating, and a way to plan it');
    await shot(page, 'phone-any-date');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#sheetback', { state: 'hidden' });
    state = await context.storageState({ indexedDB: true });
    await context.close();
  }

  // ---------- 4. The plan: one tap, kept from the first tap, shared in one more ----------
  let sharedUrl = null, organiserVerdict = null;
  {
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await waitPlaces(page);
    await page.waitForTimeout(150);
    const exp = expectedDenver(0, 3, null);
    const spot = OSM[0];
    const spotTimes = G.eveningTimes(G.solarNoonGuess(2026, 6, 23, spot.lon), spot.lat, spot.lon);
    await page.click(CUR + '.pick [data-act="plan-new"]');                                       // tap 1
    await page.waitForSelector('#spotName');
    check(await page.inputValue('#spotName') === 'Inspiration Point' && (await text(page, '.planhero h2')).trim() === 'Inspiration Point', 'Plan this evening opens a plan with the place filled in');
    check(await page.evaluate(() => window.__gh.S.plans.length) === 1, 'and the plan is saved at once, with no Save button');
    check(await page.locator('[data-act="plan-save"]').count() === 0 && await page.locator('[data-act="share-go"]').isVisible(), 'Share is there straight away');
    check(await page.locator('#bar').isVisible() && await page.locator('#bar .barbtn[aria-current="page"]').innerText() === 'Plans', 'the bar is still there, on Plans');
    const tl = norm(await text(page, '.timeline'));
    const meet = spotTimes.bestStart - 20 * MIN, startBack = spotTimes.lastLight - 5 * MIN;
    check(tl.includes(`${fmt(meet)}`) && tl.includes('Be there by') && tl.includes(`${fmt(spotTimes.sunset)}`), 'the times are for the venue itself');
    check(tl.includes(`${fmt(startBack)}`) && tl.includes('Start back by') && tl.includes(`before dark at ${fmt(spotTimes.lastLight)}`), `Start back by is last light minus the 5-minute walk (${fmt(startBack)})`);
    const home = norm(await text(page, '.home'));
    check(home.includes(`Start back by about ${fmt(startBack)} to reach your car before dark.`) && /Lighting not listed/.test(home) && /never say a place is lit or safe/.test(home), 'Getting home: when to start back, and “Lighting not listed”');
    const sms = await page.locator('.home a.btn').evaluateAll((els) => els.map((e) => [e.textContent.trim(), decodeURIComponent(e.getAttribute('href'))]));
    check(sms.length === 2 && sms[0][0] === 'Text a friend where I’ll be' && /^sms:/.test(sms[0][1]) && sms[0][1].includes('Inspiration Point') && norm(sms[0][1]).includes(`starting back by ${fmt(startBack)}`) && sms[0][1].includes('I’ll message when I’m home'), '“Text a friend where I’ll be” opens a message with the place, the times and “I’ll message when I’m home”');
    check(sms[1][0] === 'I’m home' && /Home safe/.test(sms[1][1]), 'and “I’m home” opens the second message');
    organiserVerdict = await page.locator('.planans').first().getAttribute('class');
    await layout(page, 'plan (phone)'); await contrast(page, 'plan');
    await shot(page, 'phone-plan');
    // Share in one tap (tap 2): the picture, the words and the link.
    await page.waitForFunction(() => true); await page.waitForTimeout(900);
    await page.click('[data-act="share-go"]');                                                    // tap 2
    await page.waitForFunction(() => window.__shares.length === 1);
    const sh = (await shares(page))[0];
    sharedUrl = (sh.text.match(/https?:\/\/\S+#p=\S+/) || [sh.url])[0];
    check(/\.png\|image\/png\|\d{4,}/.test(sh.files[0] || '') && /#p=/.test(sharedUrl) && norm(sh.text).includes(`Be there by ${fmt(meet)}`), 'one tap on Share opens the share sheet with a picture, the times and the link: a sent plan in two taps from Today');
    const decoded = G.decodePlan(sharedUrl.split('#p=')[1]);
    check(decoded && decoded.spot.name === 'Inspiration Point' && decoded.times.meetAt === Math.round(meet / MIN) * MIN && decoded.walkIn === 5, 'the link carries the place, the times and the walk in');
    check(!/39\.739|-104\.99|start|leaveBy/.test(JSON.stringify(decoded)), 'and never where you are leaving from');
    await page.waitForSelector('[data-act="share-go"]:has-text("Share again")');
    // Change the plan: an arrive-by of my own, then Send update.
    const earlier = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(meet - 30 * MIN);
    const leaveBefore = norm(await text(page, '.timeline .tl:first-child .t'));
    await page.fill('#arriveBy', earlier); await page.locator('#arriveBy').dispatchEvent('change');
    await page.waitForSelector('[data-act="share-update"]');
    const tl2 = norm(await text(page, '.timeline'));
    check(tl2.includes(fmt(meet - 30 * MIN)) && tl2.includes('The time you set') && norm(await text(page, '.timeline .tl:first-child .t')) !== leaveBefore, 'an arrive-by you set moves Be there by and Leave by');
    await page.fill('#planNote', 'Park in car park B'); await page.locator('#planNote').dispatchEvent('change');
    await page.waitForTimeout(900);
    await page.click('[data-act="share-update"]');
    await page.waitForFunction(() => window.__shares.length === 2);
    const up = (await shares(page))[1], upPlan = G.decodePlan(((up.text.match(/#p=(\S+)/) || [])[1]) || up.url.split('#p=')[1]);
    check(norm(up.text).startsWith(`Changed: now ${fmt(meet - 30 * MIN)}.`) && upPlan.changed === norm(`now ${fmt(meet - 30 * MIN)}`).replace(/ (am|pm)/, (m) => m) && upPlan.note === 'Park in car park B', 'Send update re-sends it with “Changed: now …” on top, and the note');
    check(await page.locator('[data-act="share-update"]').count() === 0, 'once sent, there is nothing left to update');
    // Travel time and home-by.
    await page.fill('#travelMin', '45'); await page.locator('#travelMin').dispatchEvent('change');
    check(/about 45 min/.test(await text(page, '.timeline .tl:first-child')), 'a travel time you set is used for Leave by');
    await page.fill('#homeBy', '19:00'); await page.locator('#homeBy').dispatchEvent('change');
    check(/To be home by 7:00 pm, start back by/.test(norm(await text(page, '.home'))) && /minutes before the sun sets/.test(await text(page, '.home')), 'a home-by time that doesn’t fit says when you would have to start back');
    await page.fill('#homeBy', '23:00'); await page.locator('#homeBy').dispatchEvent('change');
    check(/Home by 11:00 pm fits/.test(norm(await text(page, '.home'))), 'and one that fits says so');
    check(/href="[^"]*maps[^"]*"[^>]*>Check in Maps/.test(await page.locator('.col').first().innerHTML()), 'travel is marked an estimate, with Check in Maps');
    // Calendar: a file with a 30-minute reminder and the start-back time.
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="calendar"]')]);
    const ics = fs.readFileSync(await download.path(), 'utf8').replace(/\r\n /g, '');
    check(/TRIGGER:-PT30M/.test(ics) && /Start back by/.test(ics) && /SUMMARY:Sunset at Inspiration Point/.test(ics), 'Add to calendar: an event with a reminder 30 minutes before, and when to start back');
    // Back, and the plan is in Plans.
    await page.click('[data-act="close-view"]');
    await page.waitForSelector(CUR + '.hero');
    await page.click('#bar [data-act="open-plans"]');
    await page.waitForSelector('.plan-row');
    check(await page.locator('.plan-row').count() === 1 && (await text(page, '.plan-row .n')).trim() === 'Inspiration Point', 'going back never loses the plan: it is in Plans');
    check(await page.locator('.plan-row .v').count() === 1 && await page.locator('[data-act="plan-new"]').isVisible(), 'Plans shows today’s answer beside each plan, and has a New plan button');
    await layout(page, 'plans (phone)');
    await shot(page, 'phone-plans');
    // "Has it changed?"
    await page.evaluate(() => { const g = window.__gh; g.S.plans[0].scoreAtSave = 1.2; g.db.put('plans', g.S.plans[0]); g.render(); });
    check(/Was 1\.2 when you made this plan, now \d\.\d\./.test(await text(page, '.plan-row .chg')), 'a plan whose evening has changed says “Was 1.2 when you made this plan, now …”');
    await page.click('.plan-row');
    await page.waitForSelector('#spotName');
    check(/Was 1\.2 when you made this plan/.test(await text(page, '.chg')), 'and says so on the plan');
    // A new plan somewhere else: a name typed, then Back, is kept; an untouched one is not.
    await page.click('[data-act="close-view"]');
    await page.waitForSelector('.plan-row');
    await page.click('[data-act="plan-new"]');
    await page.waitForSelector('#sheet [data-act="plan-blank"]');
    check(await page.locator('#sheet .srow[data-act="plan-here"]').count() >= 5, 'New plan asks where, from your spots and the top places');
    await page.click('#sheet [data-act="plan-blank"]');
    await page.waitForSelector('#spotName');
    await page.click('[data-act="close-view"]');
    await page.waitForSelector('.plan-row');
    check(await page.locator('.plan-row').count() === 1, 'a new plan left untouched is not kept');
    await page.click('[data-act="plan-new"]');
    await page.click('#sheet [data-act="plan-blank"]');
    await page.waitForSelector('#spotName');
    await page.fill('#spotName', 'Grandma’s porch');
    await page.click('[data-act="close-view"]');
    await page.waitForFunction(() => document.querySelectorAll('.plan-row').length === 2);
    check((await page.locator('.plan-row .n').allInnerTexts()).map((t) => t.trim()).includes('Grandma’s porch'), 'open a plan, type a name, go back: it is in Plans with the name');
    // Venue search, and any date.
    await page.locator('.plan-row', { hasText: 'Grandma’s porch' }).click();
    await page.waitForSelector('#venueQ');
    await page.fill('#venueQ', 'The Boathouse');
    await page.waitForSelector('#venueResults .result');
    await page.click('#venueResults .result');
    await page.waitForFunction(() => document.querySelector('#coords') && document.querySelector('#coords').value.startsWith('39.7473'));
    check(await page.inputValue('#spotName') === 'The Boathouse' && await page.inputValue('#spotType') === 'venue' && await page.locator('[data-act="share-go"]').isVisible(), 'find a venue by name: it pins the venue, names the plan and makes it shareable');
    await page.fill('#planDate', '2027-06-12'); await page.locator('#planDate').dispatchEvent('change');
    await page.waitForFunction(() => /Colour can’t be forecast yet/.test(document.querySelector('.screen').textContent));
    const farT = G.eveningTimes(G.solarNoonGuess(2027, 6, 12, -105.0431), 39.7473, -105.0431);
    check(norm(await text(page, '.timeline')).includes(fmt(farT.sunset)) && norm(await text(page, '.light')).includes(`Golden hour ${fmt(farT.goldenStart)}`), 'a plan for a date a year ahead has exact times, golden hour and “Colour can’t be forecast yet”');
    await shot(page, 'phone-plan-far');
    net.photon = 'down';
    await page.fill('#venueQ', 'Nowhere at all');
    await page.waitForFunction(() => /Couldn’t search just now/.test(document.querySelector('#venueResults').textContent));
    check(true, 'venue search down: says so, and that the map or coordinates still work');
    reset();
    await context.close();
  }

  // ---------- 5. The shared plan: the same answer for whoever opens it ----------
  {
    const { page, context } = await open({ time: GO, hash: '#' + sharedUrl.split('#')[1] });
    await page.waitForSelector('.timeline');
    await page.waitForFunction(() => document.querySelector('.planans'), null, { timeout: 15000 });
    const cls = await page.locator('.planans').first().getAttribute('class');
    check(cls === organiserVerdict, `organiser and guest see the same answer for the same plan (${cls})`);
    const spot = OSM[0], st = G.eveningTimes(G.solarNoonGuess(2026, 6, 23, spot.lon), spot.lat, spot.lon);
    check(norm(await text(page, '.timeline')).includes(fmt(st.lastLight - 5 * MIN)) && /Start back by/.test(await text(page, '.timeline')), 'the guest sees when to start back too');
    check(await page.locator('.home a.btn').count() === 2 && await page.locator('#howWasIt').count() === 0 && await page.locator('#bar').isHidden(), 'with Getting home, and never “How was it?”');
    await layout(page, 'shared plan (phone)');
    await shot(page, 'phone-shared');
    await context.close();
  }

  // ---------- 6. Places: one place sheet, all places, filters ----------
  {
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await waitPlaces(page);
    await page.waitForTimeout(150);
    await page.click(CUR + '.pick .srow');
    await page.waitForSelector('#sheet .spothero');
    const know = await text(page, '#sheet');
    check(/Parking and toilets nearby\./.test(know) && /Lighting not listed/.test(know) && /Photos and reviews on Google Maps/.test(know), 'a place opens as a sheet: parking and toilets when the map lists them, “Lighting not listed”, and Google Maps for photos');
    check(await page.locator('#bar').count() === 1 && (await text(page, CUR + '.hero .ans')).trim() === 'Go tonight', 'over the page, which stays where it was');
    await layout(page, 'place sheet (phone)');
    await shot(page, 'phone-place');
    await page.click('#sheet [data-act="spot-plan"]');
    await page.waitForSelector('#spotName');
    check(await page.inputValue('#spotName') === 'Inspiration Point', '“Plan this evening here” starts the plan there');
    await page.goBack();
    await page.waitForSelector(CUR + '.hero');
    check(await page.locator('#sheetback').isHidden(), 'Back from that plan returns to Today');
    await page.click(CUR + '[data-act="spots-all"]');
    await page.waitForSelector('.chips');
    check(await page.locator('.spotcard.a-easy .srow').count() >= 3 && /not checked/.test(await text(page, '.spotcard.a-dining .catsub')), 'all places, with dining marked “From open map data, not checked”');
    await layout(page, 'all places (phone)'); await contrast(page, 'all places');
    await shot(page, 'phone-places');
    await page.click('.chip[data-k="parking"]'); await page.click('.chip[data-k="toilets"]');
    const fit = (await page.locator('.spotgrid .srow .n').allInnerTexts()).map((t) => t.trim());
    check(fit.length === 1 && fit[0] === 'Inspiration Point' && /Parking and toilets nearby/.test(await text(page, '.spotgrid .srow')), 'Parking and Toilets on: only the place the map confirms, in two taps');
    await page.click('.chip[data-k="toilets"]');
    const park = (await page.locator('.spotgrid .srow .n').allInnerTexts()).map((t) => t.trim());
    check(park.length === 2 && park.includes('Sunset Park') && !park.includes('Linger'), 'Parking alone adds the park with parking; private parking does not count');
    await page.click('.chip[data-k="parking"]'); await page.click('.chip[data-k="walk"]');
    const walk = (await page.locator('.spotgrid .srow .n').allInnerTexts()).map((t) => t.trim());
    check(walk.includes('Inspiration Point') && !walk.includes('Mount Evans'), 'Short walk leaves out the high-effort places');
    await page.click('.chip[data-k="walk"]');
    await page.locator('.spotcard.a-dining .srow', { hasText: 'Linger' }).click();
    await page.waitForSelector('#sheet .spothero');
    const btns = (await page.locator('#sheet a.btn').allInnerTexts()).map((t) => t.trim());
    check(btns.includes('Call') && !btns.some((b) => /book/i.test(b)) && /Opening hours not listed/.test(await text(page, '#sheet')), 'dining: the phone button says Call, and missing hours are said');
    await page.keyboard.press('Escape');
    await context.close();
  }
  {
    // Nothing listed nearby: the filter says so and still shows the nearest places.
    net.near = 'none';
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await waitPlaces(page);
    await page.click(CUR + '[data-act="spots-all"]');
    await page.click('.chip[data-k="parking"]'); await page.click('.chip[data-k="toilets"]');
    check(/None listed with parking and toilets here\./.test(await text(page, '.pstate')) && await page.locator('.spotgrid .srow').count() >= 5 && /Parking and toilets not listed\./.test(await text(page, '.spotgrid .srow')), 'no place with parking and toilets: “None listed with parking and toilets here”, then the nearest places marked “not listed”');
    await shot(page, 'phone-places-none');
    reset();
    await context.close();
  }

  // ---------- 7. When things fail: each state says so, and Try again works ----------
  {
    // The forecast is down from the start: the sunset time and the places still show.
    net.forecast = 'down';
    const { page, context } = await open({ time: GO });
    await page.click('#bar [data-act="open-list"]');
    await page.fill('#q', 'Denv'); await page.waitForSelector('.result'); await page.click('.result');
    await page.waitForFunction(() => /Couldn’t reach the forecast/.test((document.querySelector('.page[aria-current="true"] .hero') || {}).textContent || ''), null, { timeout: 20000 });
    const t0 = pickTimesOn(0);
    check(norm(await text(page, CUR + '.hero .atimes')).includes(`Sunset ${fmt(t0.sunset)}`) && await page.locator(CUR + '[data-act="retry"] >> nth=0').isVisible(), 'forecast down: says so, still gives the sunset time, and offers Try again');
    await page.waitForSelector(CUR + '.moreplaces .srow', { timeout: 15000 });
    check((await page.locator(CUR + '.moreplaces .srow .n').allInnerTexts()).map((t) => t.trim()).includes('Inspiration Point'), 'forecast down: the places still load');
    await shot(page, 'phone-forecast-down');
    net.forecast = 'ok';
    await page.click(CUR + '[data-act="retry"] >> nth=0');
    await page.waitForSelector(CUR + '.hero .ans', { timeout: 15000 });
    check((await text(page, CUR + '.hero .ans')).trim() === 'Go tonight', 'Try again brings the answer');
    // Then it goes down again, seven hours later: the last forecast stays, marked.
    net.forecast = 'down';
    await page.clock.setFixedTime(new Date(GO + 7 * HOUR + 5 * MIN));
    await page.click(CUR + '[data-act="retry"] >> nth=0');
    await page.waitForFunction(() => /Couldn’t refresh/.test((document.querySelector('.page[aria-current="true"] .upd') || {}).textContent || ''), null, { timeout: 20000 });
    check(/^Couldn’t refresh\. Updated 7 h ago · Try again$/.test(norm(await text(page, CUR + '.upd')).trim()) && await page.locator(CUR + '.hero .ans').isVisible(), 'a failed refresh keeps the last forecast, marked “Couldn’t refresh. Updated 7 h ago · Try again”');
    await shot(page, 'phone-stale');
    // Status says what failed.
    await page.click(CUR + '[data-act="settings"]');
    await page.click('#sheet [data-act="settings-page"][data-page="status"]');
    const status = await text(page, '#sheet .status');
    check(/Forecast: failed/.test(status) && /Places: \d+ found/.test(status) && /Parking and toilets: \d+ found/.test(status), 'Settings, Status lists what the app asked for and what failed');
    await layout(page, 'status (phone)');
    await shot(page, 'phone-status');
    reset();
    await context.close();
  }
  for (const [mode, label] of [['down', 'the open map is down'], ['remark', 'the open map answers with an error note'], ['empty', 'the open map answers with nothing']]) {
    net.overpass = mode;
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await page.waitForFunction(() => /Couldn’t load places near Denver/.test((document.querySelector('.page[aria-current="true"] .pick') || {}).textContent || ''), null, { timeout: 20000 });
    check(await page.locator(CUR + '.pick [data-act="spots-retry"]').isVisible() && await page.locator(CUR + '.pick [data-act="plan-new"]').isVisible(), `${label}: “Couldn’t load places near Denver. Try again”, and you can still plan`);
    check(await page.evaluate(() => window.__gh.db.all('cache').then((rows) => rows.filter((r) => /^overpass:/.test(r.url)).length)) === 0, `${label}: the failed answer is not remembered`);
    if (mode === 'down') await shot(page, 'phone-places-down');
    net.overpass = 'ok';
    await page.click(CUR + '.pick [data-act="spots-retry"]');
    await page.waitForSelector(CUR + '.pick .srow', { timeout: 15000 });
    check((await text(page, CUR + '.pick .srow .n')).trim() === 'Inspiration Point', `${label}: Try again loads them`);
    reset();
    await context.close();
  }
  {
    // Slow: twenty seconds, longer than the old fifteen-second limit. A note shows, then the place fills in.
    net.overpass = 'slow';
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await page.waitForSelector(CUR + '.pick .pstate[aria-busy="true"]');
    check(/Looking for places near Denver/.test(await text(page, CUR + '.pick .pstate')), 'places slow: “Looking for places near Denver…” shows meanwhile');
    await shot(page, 'phone-places-looking');
    await page.waitForSelector(CUR + '.pick .srow', { timeout: 40000 });
    check((await text(page, CUR + '.pick .srow .n')).trim() === 'Inspiration Point', 'places answering after 20 seconds still arrive');
    reset();
    // The failed-then-reopened case: down now, and the app looks again when it is next opened.
    net.overpass = 'down';
    await page.evaluate(() => window.__gh.db.all('cache').then((rows) => Promise.all(rows.filter((r) => /^overpass:/.test(r.url)).map((r) => window.__gh.db.del('cache', r.url)))));
    await page.reload();
    await page.waitForFunction(() => /Couldn’t load places/.test((document.querySelector('.page[aria-current="true"] .pick') || {}).textContent || ''), null, { timeout: 20000 });
    net.overpass = 'ok';
    await page.reload();
    await page.waitForSelector(CUR + '.pick .srow', { timeout: 15000 });
    check(true, 'a failed lookup is tried again when the app next opens');
    // Parking and toilets lookup down.
    await context.close();
    reset();
  }
  {
    net.near = 'down';
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await page.waitForSelector(CUR + '.pick .srow', { timeout: 15000 });
    await page.waitForFunction(() => window.__gh.DATA[window.__gh.S.current].near === 'error', null, { timeout: 15000 });
    await page.click(CUR + '[data-act="spots-all"]');
    await page.click('.chip[data-k="parking"]');
    check(/Couldn’t check for parking and toilets/.test(await text(page, '.screen')), 'parking and toilets lookup down: says it couldn’t check');
    net.near = 'ok';
    await page.click('[data-act="near-retry"]');
    await page.waitForFunction(() => document.querySelectorAll('.spotgrid .srow').length === 2, null, { timeout: 15000 });
    check(true, 'and Try again fills it in');
    reset();
    // Map tiles down: the plan still works.
    net.tiles = 'down';
    await page.click('#bar [data-act="open-today"]');
    await page.click(CUR + '.pick [data-act="plan-new"]');
    await page.waitForSelector('#spotName');
    await page.waitForFunction(() => /couldn’t load|couldn’t start/.test((document.querySelector('#map') || {}).textContent || ''), null, { timeout: 25000 });
    check(await page.locator('[data-act="share-go"]').isVisible() && /Search for the venue, or type coordinates/.test(await text(page, '#map')), 'map down: the plan and Share still work, and it says what to do instead');
    reset();
    await context.close();
  }
  {
    // Location: unavailable is a different message from not allowed.
    const { page, context } = await open({ geo: { latitude: 39.7392, longitude: -104.9903 }, time: GO });
    await page.click('#bar [data-act="open-list"]');
    await page.click('[data-act="locate"]');
    await page.waitForFunction(() => document.querySelector('.page[aria-current="true"] .hero .ans'), null, { timeout: 15000 });
    check((await text(page, CUR + '.hero h2')).trim() === 'Denver', 'Use my location adds where you are');
    await addPlace(page, 'Bould');
    await page.click('#bar [data-act="open-list"]');
    await page.click('[data-act="locate"]');
    await page.waitForFunction(() => { const h = document.querySelector('.page[aria-current="true"] .hero h2'); return h && h.textContent.trim() === 'Denver'; });
    const order = await page.evaluate(() => window.__gh.S.places.map((p) => p.name));
    check(order.join('|') === 'Denver|Boulder', 'Use my location a second time keeps its position in the list');
    await context.close();
  }

  // ---------- 8. Locations: swipe, dots, "2 of 3", Back ----------
  {
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await addPlace(page, 'Bould');
    check(await page.locator('.page').count() === 2 && await page.locator('#bar .dot').count() === 2 && (await text(page, '#bar .count')).trim() === '2 of 2', 'a second place gets its own page, its own dot, and “2 of 2”');
    check(await page.locator('.small').filter({ hasText: 'Add another place to swipe between them' }).count() === 0, 'the one-location hint is gone');
    const snap = await page.evaluate(() => getComputedStyle(document.getElementById('pager')).scrollSnapType);
    check(/x mandatory/.test(snap), 'pages snap, one place to a screen');
    // A touch swipe that starts on the place card moves between locations.
    const card = await page.locator(CUR + '.pick').boundingBox();
    const cdp = await context.newCDPSession(page);
    const y = card.y + card.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y }] });
    for (let x = 80; x <= 340; x += 26) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const swiped = await page.waitForFunction(() => document.querySelector('.page[aria-current="true"] .hero h2').textContent.trim() === 'Denver', null, { timeout: 5000 }).then(() => true).catch(() => false);
    check(swiped, 'a swipe that starts on the place card changes location');
    check((await text(page, '#bar .count')).trim() === '1 of 2' && await page.locator('#bar .dot[aria-current="true"]').getAttribute('aria-label') === 'Denver', 'and the dots follow');
    await page.locator('#bar .dot').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.page[aria-current="true"] .hero h2').textContent.trim() === 'Boulder');
    check(true, 'tapping a dot opens that place');
    check(await page.evaluate(() => localStorage.getItem('gh.current')) === '"40.02,-105.27"', 'the place you were on is remembered');
    await shot(page, 'phone-two-places');
    // Back from every kind of screen and sheet returns one level.
    const depth = () => page.evaluate(() => [window.__gh.S.view ? window.__gh.S.view.type : 'today', window.__gh.S.sheet ? window.__gh.S.sheet.kind : ''].join('/'));
    const trail = [];
    await page.click('#bar [data-act="open-plans"]'); trail.push(await depth());
    await page.click('#bar [data-act="open-list"]'); trail.push(await depth());
    await page.click('[data-act="settings"]'); trail.push(await depth());
    await page.goBack(); await page.waitForSelector('#sheetback', { state: 'hidden' }); trail.push(await depth());
    await page.goBack(); await page.waitForSelector('.plan-row, .empty'); trail.push(await depth());
    await page.goBack(); await page.waitForSelector(CUR + '.hero'); trail.push(await depth());
    check(trail.join(' ') === 'plans/ list/ list/settings list/ plans/ today/', `Back returns one level each time (${trail.join(' ')})`);
    for (const [act, sel] of [['open-plans', '.screen'], ['open-list', '#q']]) { await page.click(`#bar [data-act="${act}"]`); await page.waitForSelector(sel); check(await page.locator('#bar .tabs').isVisible(), `the bar is there on ${act.replace('open-', '')}`); }
    // Edit and remove a place.
    await page.click('[data-act="edit"]');
    await page.locator('.chip-x').first().click();
    const gone = await page.waitForFunction(() => document.querySelectorAll('.lrow').length === 1, null, { timeout: 5000 }).then(() => true).catch(() => false);
    check(gone, 'Edit removes a place');
    await page.click('[data-act="settings"]');
    await page.click('#sheet .seg [data-v="metric"]');
    check(await page.evaluate(() => localStorage.getItem('gh.imperialFirst')) === 'false', 'units are in Settings');
    await layout(page, 'settings (phone)');
    await shot(page, 'phone-settings');
    await context.close();
  }

  // ---------- 9. Sharing today and the week ----------
  {
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await waitPlaces(page);
    await page.waitForTimeout(1500);
    await page.click(CUR + '[data-act="share-today"]');
    await page.waitForFunction(() => window.__shares.length === 1);
    await page.click(CUR + '[data-act="share-week"]');
    await page.waitForFunction(() => window.__shares.length === 2);
    const [a, b] = await shares(page);
    check(/\.png\|image\/png/.test(a.files[0] || '') && /^Go tonight in Denver\./.test(a.text) && /be there by/.test(a.text), 'share tonight: the picture, the answer and the time, in one tap');
    check(/-week\.png\|image\/png/.test(b.files[0] || '') && /Sunsets this week in Denver:/.test(b.text) && /\(best\)/.test(b.text) && b.text.split('\n').length >= 6, 'share the week: a picture and a line an evening, the best one marked, in two taps');
    const png = await page.evaluate(async () => { const f = await window.__gh.card(); const bmp = await createImageBitmap(f); return [bmp.width, bmp.height]; });
    check(png[0] === 1080 && png[1] === 1350, 'the picture is 1080 by 1350');
    await context.close();
  }

  // ---------- 10. "How was it?": once, the next morning ----------
  {
    const { page, context } = await open({ time: GO });
    await addPlace(page, 'Denv');
    await page.waitForFunction(() => window.__gh.S.places[0].normals);
    await page.waitForTimeout(300);
    check(await page.locator('#howWasIt').count() === 0, 'no “How was it?” on the evening itself');
    await page.clock.setFixedTime(new Date(GO + 20 * HOUR));   // 8 am the next morning
    await page.reload();
    await page.waitForSelector('#howWasIt', { timeout: 15000 });
    check(/last night’s sunset in Denver/.test(await text(page, '#howWasIt')) && !/GitHub/.test(await text(page, '#howWasIt')), 'the next morning it asks about last night, with no mention of GitHub');
    await page.click('#howWasIt [data-act="rate-later"]');
    await page.waitForSelector('#howWasIt', { state: 'detached' });
    await page.reload();
    await page.waitForSelector(CUR + '.hero .ans', { timeout: 15000 });
    await page.waitForTimeout(400);
    check(await page.locator('#howWasIt').count() === 0, '“Not now” puts it away for good');
    await page.click(CUR + '[data-act="settings"]');
    await page.click('#sheet [data-act="settings-page"][data-page="log"]');
    check(/No evenings rated yet/.test(await text(page, '#sheet')), 'the sunset log, and sending it to GitHub, live in Settings');
    await context.close();
  }

  // ---------- 11. Other sizes ----------
  for (const [name, viewport] of [['small-phone', { width: 320, height: 568 }], ['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1280, height: 800 }]]) {
    const { page, context } = await open({ time: GO, viewport });
    await addPlace(page, 'Denv');
    await waitPlaces(page);
    await page.waitForTimeout(200);
    await layout(page, `today (${name})`); await contrast(page, `today (${name})`);
    await shot(page, `${name}-today`);
    await page.click(CUR + '.pick [data-act="plan-new"]');
    await page.waitForSelector('#spotName');
    await layout(page, `plan (${name})`);
    await shot(page, `${name}-plan`);
    await page.click('#bar [data-act="open-list"]');
    await layout(page, `places tab (${name})`);
    await context.close();
  }
  {
    // Large text: at 200% nothing is cut off sideways.
    const { page, context } = await open({ time: GO, viewport: { width: 390, height: 844 } });
    await addPlace(page, 'Denv');
    await waitPlaces(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.waitForTimeout(200);
    const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...Array.from(document.querySelectorAll('.page[aria-current], .screen')).map((e) => e.scrollWidth - e.clientWidth)));
    check(wide <= 0, 'with the page’s base text size doubled, nothing scrolls sideways');
    const unlabelled = await page.evaluate(() => Array.from(document.querySelectorAll('button, a.btn, input, select')).filter((e) => e.getClientRects().length && !(e.textContent.trim() || e.getAttribute('aria-label') || e.labels && e.labels.length || e.getAttribute('placeholder'))).length);
    check(unlabelled === 0, 'every button and field has a name a screen reader can say');
    await context.close();
  }

  // ---------- 12. The service worker: the app opens with no network at all ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Denver' });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('golden-hour-')) && (await (await caches.open((await caches.keys())[0])).keys()).length >= 8);
    await page.reload();
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.hero .ans');
    check((await text(page, '.hero h2')).includes('Sample'), 'service worker: the app opens offline');
    await context.close();
  }

  // ---------- 13. The build ----------
  {
    const web = path.join(__dirname, '..', 'web'), version = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
    for (const f of ['index.html', 'app.css', 'core.js']) check(fs.readFileSync(path.join(web, f), 'utf8') === fs.readFileSync(path.join(ROOT, f), 'utf8'), `docs/${f} is the build of web/${f}`);
    for (const f of ['app.js', 'sw.js']) check(fs.readFileSync(path.join(web, f), 'utf8').replace(/__VERSION__/g, version) === fs.readFileSync(path.join(ROOT, f), 'utf8'), `docs/${f} is web/${f} with the version stamped in`);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check(/script-src 'self'/.test(html) && /style-src 'self'/.test(html) && !/unsafe-inline|unsafe-eval/.test(html), 'content security policy: scripts and styles from this site only');
    check(/connect-src[^;]*photon\.komoot\.io/.test(html), 'the venue search host is allowed by the policy');
    check(!/https?:\/\/(fonts\.googleapis|unpkg|cdn)/.test(html + fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8')), 'fonts and libraries are self-hosted');
  }
  check(problems.length === 0, `no script errors or policy violations${problems.length ? ': ' + problems.slice(0, 4).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
