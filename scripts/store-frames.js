// Turns the raw App Store captures (STORE_SHOTS=<folder> node tests/web.test.js) into the listing's
// screenshots, to the family's App Store standard (docs/APP-STORE-LOOK.md): on Golden Hour's sunset sky, a
// Fraunces headline and a one-line subhead above the real capture in a drawn iPhone (titanium rim, black
// bezel, Dynamic Island). The sizes and positions are the same numbers as Bearings' scripts/store-frames.js.
//
// Usage: node scripts/store-frames.js --in <raw captures> --out <folder> [--strip <file.png>]
// Raw captures (6.9-inch, 1320 x 2868): today.png week.png place.png plan.png home.png
// Writes iphone-1-today.png … iphone-5-home.png at the store size (1320 x 2868).
const path = require('path');
const fs = require('fs');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const IN = opt('--in'), OUT = opt('--out'), STRIP = opt('--strip');
if (!IN || !OUT) { console.error('Usage: node scripts/store-frames.js --in <raw captures> --out <folder> [--strip <file.png>]'); process.exit(2); }

const STORY = [
  { id: 'today', head: ['Is tonight’s', 'sunset worth it?'], sub: 'One answer: go, maybe or not tonight.' },
  { id: 'place', head: ['Know where', 'to watch.'], sub: 'Places nearby, with parking and toilets.' },
  { id: 'plan', head: ['A plan in', 'one tap.'], sub: 'When to leave and when to be there.' },
  { id: 'home', head: ['Back before', 'dark.'], sub: 'When to start back, and a text to a friend.' },
  { id: 'week', head: ['Pick the', 'best evening.'], sub: 'The week ahead, one line each.' },
];

// The standard (docs/APP-STORE-LOOK.md). iPhone 6.9-inch: screen corners 62 pt, Dynamic Island 126 x 37 pt.
const D = { W: 1320, H: 2868, pt: 3, side: 70, headTop: 216, head: 124, sub: 52, subGap: 32, body: 1024, top: 640, inset: 0.036, rim: 0.011, radiusPt: 62 };

const dataURL = (file) => `data:${file.endsWith('.woff2') ? 'font/woff2' : 'image/png'};base64,${fs.readFileSync(file).toString('base64')}`;
const FRAUNCES = path.join(__dirname, 'fonts', 'fraunces.woff2');
const INTER = path.join(__dirname, '..', 'web', 'fonts', 'inter-latin-wght-normal.woff2');

// Runs in the page: builds one frame and resolves when it is drawn.
async function build(cfg) {
  const D = cfg.D, W = D.W, H = D.H, root = document.body;
  const el = (tag, css, parent, html) => { const e = document.createElement(tag); e.style.cssText = css; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  root.style.cssText = `margin:0;width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#1A1F4A`;

  // The sky, as on the app icon: night indigo at the top, where the white words sit, down to the sunset.
  el('div', `position:absolute;inset:0;background:
    radial-gradient(90% 34% at 50% 103%, rgba(255,214,140,.5), rgba(255,214,140,0) 70%),
    linear-gradient(180deg, #171B44 0%, #2A2458 24%, #5B3168 48%, #9A456C 68%, #D76C55 86%, #EE9450 100%)`, root);

  // The words: every frame's headline and subhead at the same place and size.
  const head = el('div', `position:absolute;left:${D.side}px;right:${D.side}px;top:${D.headTop}px;text-align:center;color:#fff`, root);
  const fit = (e, size) => { e.style.fontSize = size + 'px'; for (const l of e.children) { while (l.scrollWidth > head.clientWidth && size > 40) { size -= 2; e.style.fontSize = size + 'px'; } } return size; };
  const line = (l) => `<div style="white-space:nowrap;width:max-content;margin:0 auto">${l}</div>`;
  const title = el('div', 'font-family:Fraunces,serif;font-weight:560;font-variation-settings:"opsz" 72;line-height:1.04;letter-spacing:-.004em', head, cfg.frame.head.map(line).join(''));
  const headSize = fit(title, D.head);
  const sub = el('div', `font:600 1px/1.2 var(--sans);letter-spacing:-.01em;color:rgba(255,255,255,.9);margin-top:${D.subGap}px`, head, line(cfg.frame.sub));
  const subSize = fit(sub, D.sub);

  // The device: rim, bezel, the capture at its own pixels scaled to fit, buttons, Dynamic Island, status bar.
  const shot = await load(cfg.image), capW = shot.naturalWidth, capH = shot.naturalHeight;
  const B = D.body, inset = Math.round(B * D.inset), rim = Math.round(B * D.rim);
  const sw = B - 2 * inset, k = sw / capW, sh = Math.round(capH * k), bh = sh + 2 * inset;
  const sr = D.radiusPt * D.pt * k, br = sr + inset;
  const box = el('div', `position:absolute;left:${(W - B) / 2}px;top:${D.top}px;width:${B}px;height:${bh}px`, root);
  const button = (css) => el('div', `position:absolute;background:linear-gradient(90deg,#2b2d31,#74777d 50%,#2b2d31);border-radius:${B * 0.006}px;${css}`, box);
  const bw = Math.round(B * 0.011), out = -Math.round(B * 0.0065);
  button(`left:${out}px;top:${bh * 0.17}px;width:${bw}px;height:${bh * 0.04}px`);
  button(`left:${out}px;top:${bh * 0.235}px;width:${bw}px;height:${bh * 0.068}px`);
  button(`left:${out}px;top:${bh * 0.318}px;width:${bw}px;height:${bh * 0.068}px`);
  button(`right:${out}px;top:${bh * 0.265}px;width:${bw}px;height:${bh * 0.105}px`);
  button(`right:${out}px;top:${bh * 0.56}px;width:${bw}px;height:${bh * 0.055}px;border-radius:${bw}px`);
  el('div', `position:absolute;inset:0;border-radius:${br}px;background:linear-gradient(135deg,#8a8d93 0%,#43464b 14%,#26282c 45%,#2e3034 70%,#55585e 88%,#9a9da3 100%);
    box-shadow:0 ${B * 0.07}px ${B * 0.13}px rgba(20,8,30,.55),0 ${B * 0.012}px ${B * 0.03}px rgba(20,8,30,.35)`, box);
  el('div', `position:absolute;inset:${rim}px;border-radius:${br - rim}px;background:#000;box-shadow:inset 0 0 0 ${Math.max(2, B * 0.0022)}px rgba(255,255,255,.07)`, box);
  const screen = el('div', `position:absolute;left:${inset}px;top:${inset}px;width:${sw}px;height:${sh}px;border-radius:${sr}px;overflow:hidden;background:#000;isolation:isolate`, box);
  const content = el('div', `position:absolute;left:0;top:0;width:${capW}px;height:${capH}px;transform:scale(${k});transform-origin:0 0`, screen);
  shot.style.cssText = 'position:absolute;left:0;top:0;display:block';
  content.appendChild(shot);
  const p = D.pt, iw = 126 * p, ih = 37.33 * p, it = 11 * p;
  const isl = el('div', `position:absolute;left:${(capW - iw) / 2}px;top:${it}px;width:${iw}px;height:${ih}px;border-radius:${ih}px;background:#000;
    box-shadow:inset 0 0 0 ${1.2 * p}px rgba(255,255,255,.09), 0 0 0 ${0.6 * p}px rgba(0,0,0,.9)`, content);
  el('div', `position:absolute;right:${ih * 0.3}px;top:${ih * 0.3}px;width:${ih * 0.4}px;height:${ih * 0.4}px;border-radius:50%;
    background:radial-gradient(circle at 35% 35%, #2a3550 0%, #0b0f1a 55%, #05070c 100%);box-shadow:0 0 0 ${0.8 * p}px rgba(255,255,255,.05)`, isl);
  // The status bar iOS draws over a full-screen web view: 9:41, signal, Wi-Fi, battery.
  el('div', `position:absolute;left:${52 * p}px;top:${20 * p}px;font:600 ${17 * p}px/1 var(--sans);letter-spacing:-.01em;color:#fff`, content, '9:41');
  el('div', `position:absolute;right:${34 * p}px;top:${19 * p}px;width:${78 * p}px;height:${20 * p}px`, content,
    `<svg viewBox="0 0 78 20" width="100%" height="100%" fill="#fff"><rect x="0" y="12" width="3.2" height="4.5" rx="1"/><rect x="4.8" y="9.5" width="3.2" height="7" rx="1"/><rect x="9.6" y="7" width="3.2" height="9.5" rx="1"/><rect x="14.4" y="4.5" width="3.2" height="12" rx="1"/>
      <path d="M32.5 7.2c2.5 0 4.7 1 6.4 2.6l1.2-1.3A11 11 0 0 0 32.500 5.300a11 11 0 0 0-7.600 3.200l1.200 1.300a9.200 9.200 0 0 1 6.400-2.600zm0 3.600c1.500 0 2.800.6 3.800 1.500l1.200-1.300a7.300 7.300 0 0 0-10 0l1.200 1.300c1-.9 2.300-1.500 3.800-1.500zm0 3.500c-.8 0-1.500.3-2 .8l2 2.200 2-2.200c-.5-.5-1.200-.8-2-.8z"/>
      <rect x="47.500" y="4.500" width="25" height="12" rx="3.800" fill="none" stroke="#fff" stroke-opacity=".4"/><rect x="49" y="6" width="22" height="9" rx="2.500"/><rect x="73.800" y="8.500" width="1.600" height="4" rx=".8" fill-opacity=".45"/></svg>`);
  await document.fonts.ready;
  return { headSize, subSize };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: D.W, height: D.H }, deviceScaleFactor: 1 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Fraunces; src: url(${dataURL(FRAUNCES)}) format("woff2"); font-weight: 100 900; }
    @font-face { font-family: Inter; src: url(${dataURL(INTER)}) format("woff2"); font-weight: 100 900; }
    :root { --sans: Inter, -apple-system, "Helvetica Neue", Arial, sans-serif; }
  </style></head><body></body></html>`;
  const made = [];
  for (let i = 0; i < STORY.length; i++) {
    const frame = STORY[i], raw = path.join(IN, frame.id + '.png');
    if (!fs.existsSync(raw)) { console.log('skipped ' + frame.id + ' (no capture)'); continue; }
    await page.setContent(html);
    await page.evaluate(() => Promise.all([document.fonts.load('560 100px Fraunces'), document.fonts.load('600 50px Inter')]));
    const sizes = await page.evaluate(build, { D, frame, image: dataURL(raw) });
    const out = path.join(OUT, `iphone-${i + 1}-${frame.id}.png`);
    await page.screenshot({ path: out });
    made.push(out);
    console.log(`${path.basename(out)}  headline ${sizes.headSize}px  subhead ${sizes.subSize}px`);
  }
  if (STRIP && made.length) {
    const h = 900, w = Math.round(h * D.W / D.H), gap = 16;
    await page.setViewportSize({ width: made.length * (w + gap) + gap, height: h + 2 * gap });
    await page.setContent(`<body style="margin:0;background:#E9ECF1;display:flex;gap:${gap}px;padding:${gap}px">${made.map((f) => `<img src="${dataURL(f)}" style="width:${w}px;height:${h}px;display:block">`).join('')}</body>`);
    await page.screenshot({ path: STRIP });
  }
  await browser.close();
})();
