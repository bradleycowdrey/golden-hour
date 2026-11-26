// App Store screenshots for the iPhone 6.9" display (1320 x 2868), from the real app, on the Cowdrey family's
// template: design/app-store/store-frame.mjs, a word-for-word copy of the master in bradleycowdrey/cowdrey-one (the
// standard is that repository's design/app-store/README.md). A dusk-purple ground, a Fraunces headline, one line in
// Instrument Sans, and the app in a plain iPhone.
//
// Run: scripts/build-web.sh && npm install --no-save playwright@1 && npx playwright install chromium &&
//      node tests/app-store-screens.mjs [--shots=1,2] [--raw=dir] [--reuse]
//   -> docs/app-store/iphone-N-<slug>.png (RGB, no alpha, as App Store Connect wants them)
//   --raw=dir keeps each bare screen there as well; --reuse frames the bare screens in that folder again.
//
// The iPhone app is the web app in a full-screen web view, so each screen is the built web app (docs/) at the size of
// the iPhone 16 Pro Max: 440 x 956 points at 3x, touch, the iPhone's user agent, and the screen's safe areas put in
// where the page asks for them (a browser has none). Golden Hour has only a dark look, so that is what they show. The
// forecast, the places and the map are the stand-ins the tests use (tests/standin.js): Denver at midday on Tuesday
// 23 June 2026, a Go evening. The app is for iPhone only (TARGETED_DEVICE_FAMILY 1 in ios/project.yml), so there is
// no iPad set.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { execSync } from 'node:child_process';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { compose, THEMES } from '../design/app-store/store-frame.mjs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { NOON, DENVER, BOULDER, OSM, NEAR, standIn } = require('./standin.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(root, 'docs'), OUT = path.join(root, 'docs/app-store');
const ARG = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const SHOTS = ARG.shots ? ARG.shots.split(',').map(Number) : null;
const RAW = ARG.raw || null;

/* ---------------- the device ---------------- */
// The iPhone 16 Pro Max in points, and its safe areas: the status bar and Dynamic Island above, the home indicator below.
const IPHONE = { w: 440, h: 956, scale: 3, safe: { top: 62, bottom: 34, left: 0, right: 0 },
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' };
// Where the template draws the Dynamic Island on the screen, in points (store-frame.mjs: 125 x 37, 11 from the top).
const ISLAND = { left: 220 - 62.5, right: 220 + 62.5, top: 11, bottom: 48 };
const GO = NOON + 3 * 86400000;   // Tuesday 23 June, 12:00 in Denver: a Go evening in the stand-in forecast
// The tests' sample evenings, over the eight days a live forecast covers, so every evening ahead has its rating.
const { forecastBody, airBody, archiveBody } = standIn(12);

// The site as GitHub Pages serves it, with the iPhone's safe areas written into the style sheet.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.tsv': 'text/plain', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const file = path.join(SITE, p === '/' ? 'index.html' : p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  if (file.endsWith('.css')) return res.end(fs.readFileSync(file, 'utf8').replace(/env\(safe-area-inset-(top|right|bottom|left)(?:,[^)]*)?\)/g, (m, side) => IPHONE.safe[side] + 'px'));
  fs.createReadStream(file).pipe(res);
});

let browser, BASE;
async function app() {
  const ctx = await browser.newContext({ viewport: { width: IPHONE.w, height: IPHONE.h }, deviceScaleFactor: IPHONE.scale, isMobile: true, hasTouch: true,
    userAgent: IPHONE.ua, colorScheme: 'dark', locale: 'en-US', timezoneId: 'America/Denver', serviceWorkers: 'block' });
  // The iPhone app's side of the page: its message handler, which opens Calendar's own sheet.
  await ctx.addInitScript(() => { window.webkit = { messageHandlers: { goldenHour: { postMessage() {} } } }; });
  await ctx.route(/open-meteo\.com|openfreemap\.org|overpass|photon\.komoot/, (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.hostname === 'geocoding-api.open-meteo.com') { const q = url.searchParams.get('name').toLowerCase(); return json({ results: [DENVER, BOULDER].filter((c) => c.name.toLowerCase().startsWith(q)) }); }
    if (url.hostname === 'api.open-meteo.com') return json(forecastBody(url));
    if (url.hostname === 'air-quality-api.open-meteo.com') return json(airBody());
    if (url.hostname === 'archive-api.open-meteo.com') return json(archiveBody());
    if (/overpass/.test(url.hostname)) return json({ elements: /around:300/.test(url.searchParams.get('data') || '') ? NEAR : OSM });
    if (url.hostname === 'tiles.openfreemap.org') return json({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2B4A4A' } }] });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(String(e)));
  await page.clock.setFixedTime(new Date(GO));
  await page.goto(BASE);
  await page.waitForSelector('#view .hero, #view .card');
  // Denver, as someone would add it: Places, a search, the first result.
  await page.click('#view [data-act="add-place"]');
  await page.fill('#q', 'Denv');
  await page.waitForSelector('.result');
  await page.click('.result');
  await page.waitForFunction(() => { const g = window.__gh, d = g && g.DATA[g.S.current]; return g.S.places[0] && g.S.places[0].normals && d && d.spots && typeof d.spots === 'object' && d.near && typeof d.near === 'object'; }, null, { timeout: 15000 });
  await page.waitForFunction((cur) => document.querySelector('.sky .layer.in') && document.querySelector(cur + '.pick .srow'), CUR);
  page.ctx = ctx;
  return page;
}
const CUR = '.page[aria-current="true"] ';
// Scroll the page (or the open screen) so that the top of `sel` sits `y` points down the screen, then move it the least
// (with `down`, only down the screen) that makes the screen start and end cleanly, for text and controls alike:
//  - no line of text, and no control (a button, pill, chip, field, picture or icon), cut by the tab bar: even a sliver of
//    one showing above the bar counts as cut, and a card shows more than a sliver above it or nothing; nor any line of
//    text, button, field, picture or icon cut by the top of the screen (a card or row may run up under the status bar);
//  - nothing partly under the Dynamic Island: no control's box, and no card's top or bottom edge, in the island's band
//    where it reaches under it, and no text under it; failing that, a line of text may sit wholly behind the island, but
//    none cut by its top or bottom or half behind it (a control never may).
// `y` may be 'here': where `sel` is now.
async function scrollTo(page, scroller, sel, y, down, reach = 200) {
  await page.evaluate(([sc, s, y, down, island, reach]) => {
    const box = document.querySelector(sc), bar = document.querySelector('#bar').getBoundingClientRect().top;
    const across = (q, edge) => q.top < edge && q.bottom > edge;
    const top = island.top - 3, bottom = island.bottom + 2;   // the island, with room around it
    const underIsland = (q) => q.right > island.left && q.left < island.right && q.bottom > top && q.top < bottom;
    const shown = (el) => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
    // A control's visible box: its own when it is a pill or a field, with a fill or a border all round (a quiet button, or a
    // list row with only a hairline between rows, is just its text, which the text rule covers).
    const filled = (el) => { const cs = getComputedStyle(el); return !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' ||
      ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(cs['border' + side + 'Width']) > 0); };
    const CONTROLS = 'button, .btn, .chip, input, select, textarea, [role="button"], [role="tab"], img, svg, .ic';
    const fault = (strict) => {
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        for (const q of range.getClientRects()) {
          if (across({ top: q.top - 4, bottom: q.bottom + 4 }, 0) || across({ top: q.top - 4, bottom: q.bottom + 4 }, bar)) return 'text cut: ' + n.textContent.trim().slice(0, 30);
          const g = { top: q.top + 1, bottom: q.bottom - 1, left: q.left, right: q.right };   // a line's box has its leading above the letters
          if (underIsland(g) && (strict || across(g, top) || across(g, bottom) || q.left < island.left || q.right > island.right)) return 'text under the island: ' + n.textContent.trim().slice(0, 30);
        }
      }
      for (const el of box.querySelectorAll(CONTROLS)) {
        const q = el.getBoundingClientRect();
        if (!q.width || !q.height || !shown(el) || el.closest('#bar')) continue;
        if (el.matches('svg *, .btn svg, button svg, .btn img, button img')) continue;   // an icon inside a button goes with the button
        if (q.height > 120) continue;   // a map or a picture that big is a panel, like a card
        const svgOrImg = el.matches('img, svg, .ic');
        if (!svgOrImg && !filled(el)) continue;
        const t = { top: q.top + 0.3, bottom: q.bottom - 0.3 };   // less than a pixel is nothing
        if (across(t, bar) || (across(t, 0) && el.matches('img, svg, input, .btn, .ic'))) return 'control cut: ' + el.outerHTML.slice(0, 80);
        if (q.bottom > 0 && q.top < bar && underIsland(q)) return 'control under the island: ' + el.outerHTML.slice(0, 80);
      }
      for (const el of box.querySelectorAll('.card, canvas, img, svg')) {
        const q = el.getBoundingClientRect();
        if (!q.height || (!el.matches('.card') && q.height <= 120)) continue;
        if (across(q, bar) && bar - q.top < 16) return 'a sliver of ' + el.className;   // a sliver of a card above the bar
        for (const e of [q.top, q.bottom]) if (strict && e > top && e < bottom && q.left < island.right && q.right > island.left) return 'card edge under the island: ' + el.className;
      }
      return null;
    };
    const base = y === 'here' ? box.scrollTop : box.scrollTop + document.querySelector(s).getBoundingClientRect().top - y;
    for (const strict of [true, false]) {
      for (let d = 0; d <= reach; d += 1 / 3) for (const t of down ? [base - d] : [base - d, base + d]) { box.scrollTop = t; if (Math.abs(box.scrollTop - t) < 1 && !fault(strict)) return; }
    }
    box.scrollTop = base;
    const seen = {};
    for (let d = -reach; d <= reach; d += 1 / 3) { box.scrollTop = base + d; const f = fault(false); if (f) seen[f] = (seen[f] || 0) + 1; }
    box.scrollTop = base;
    throw new Error(`scrollTo ${s}: no clean position within ${reach} points; ` + JSON.stringify(seen));
  }, [scroller, sel, y, down, ISLAND, reach]);
}
const settle = (page, ms = 1200) => page.waitForTimeout(ms);

/* ---------------- the stories, in order ---------------- */
// One idea each. Every headline is two lines (lines: 2), so the phone sits where every family app's does; the template then needs each sub-line to fit on one line.
const STORIES = [
  { slug: 'tonight', head: 'Is tonight\nworth it?', sub: 'Go, Maybe or Not, why, and when to be there.',
    // As it opens, then down the least that ends the list at a row's end above the tab bar.
    async shoot(page) { await settle(page); await scrollTo(page, CUR.trim(), CUR + '.hero', 'here'); await settle(page); } },
  { slug: 'plan', head: 'Plan the evening,\nstart to finish.', sub: 'When to leave, and when to head back by dark.',
    async shoot(page) {
      await page.click(CUR + '.pick [data-act="plan-new"]');
      await page.waitForSelector('#spotName');
      await settle(page);
      await scrollTo(page, '.screen', '.screen', 'here');   // as it opens, moved the least that ends it cleanly above the tab bar
      await settle(page);
    } },
  { slug: 'share', head: 'Sunsets are better\nwith a friend.', sub: 'Share it in a tap, or put it in your calendar.',
    async shoot(page) {
      await page.click(CUR + '.pick [data-act="plan-new"]');
      await page.waitForSelector('[data-act="share-go"]');
      await settle(page, 600);
      // Its card whole and low on the screen, with the evening's last times above it and Getting home's heading below:
      // with the card nearer the top, a line of text or a button always meets the island (the screen is too dense there),
      // and with it any lower the screen is the Plan shot again.
      await scrollTo(page, '.screen', '.acts', 560, false, 12);
      await settle(page);
    } },
  { slug: 'evenings-ahead', head: 'The evenings\nahead.', sub: 'The week’s sunsets rated, evening by evening.',
    async shoot(page) { await scrollTo(page, CUR.trim(), CUR + '.moreplaces', 4); await settle(page); } },
  { slug: 'places', head: 'Find the best\nplace to watch.', sub: 'Viewpoints, parks and rooftops, with filters.',
    async shoot(page) {
      await page.click(CUR + '[data-act="spots-all"]');
      await page.waitForSelector('.chips');
      await settle(page);
      await scrollTo(page, '.screen', '.screen', 'here');   // as it opens, moved the least that ends it cleanly above the tab bar
      await settle(page);
    } },
  { slug: 'tomorrow', head: 'Tomorrow’s light,\nhour by hour.', sub: 'Golden hour, blue hour, and where the sun sets.',
    async shoot(page) {
      await page.locator(CUR + 'button.day').nth(1).click();
      await page.waitForSelector('#sheet .light');
      await settle(page);
    } },
];

/* ---------------- capture and frame ---------------- */
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');
const FONTS = { fraunces: b64('design/app-store/fraunces.woff2'), instrument: b64('design/app-store/instrument-sans.woff2') };

await new Promise((r) => server.listen(0, '127.0.0.1', r));
BASE = `http://localhost:${server.address().port}/`;
browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
fs.mkdirSync(OUT, { recursive: true });
if (RAW) fs.mkdirSync(RAW, { recursive: true });
let bad = 0;
for (const [k, story] of STORIES.entries()) {
  if (SHOTS && !SHOTS.includes(k + 1)) continue;
  const rawFile = RAW && path.join(RAW, `iphone-${story.slug}.png`);
  let raw;
  if (ARG.reuse) raw = fs.readFileSync(rawFile);
  else {
    const page = await app();
    await story.shoot(page);
    raw = await page.screenshot();
    if (page.problems.length) { bad++; console.error(`${story.slug}: ${page.problems.join('; ')}`); }
    await page.ctx.close();
    if (RAW) fs.writeFileSync(rawFile, raw);
  }
  const file = `iphone-${k + 1}-${story.slug}.png`;
  fs.writeFileSync(path.join(OUT, file), await compose(browser, 'iphone', { head: story.head, sub: story.sub, png: raw, title: 'Golden Hour', file, lines: 2 }, THEMES.goldenhour, FONTS));
  console.log('wrote docs/app-store/' + file);
}
await browser.close();
server.close();
if (bad) process.exit(1);
