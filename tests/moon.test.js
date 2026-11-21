// The moon for an evening: node --test tests/moon.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../web/core.js');
const MIN = 60000, HOUR = 3600000;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what || ''} ${a} is not within ${tol} of ${b}`);
const denver = (y, m, d) => { const t = G.eveningTimes(G.solarNoonGuess(y, m, d, -104.99), 39.739, -104.99); return { t, m: G.moonEvening(t.sunset, 39.739, -104.99, t.lastLight) }; };

test('phase and the next full and new moons', () => {
  const { m } = denver(2026, 11, 24);                       // full moon, 24 November 2026
  assert.equal(m.name, 'Full Moon');
  assert.ok(m.fraction > 0.99);
  near(m.age, 14.8, 1, 'age in days');
  near(m.nextFull, Date.UTC(2026, 11, 24, 1, 28), 3 * HOUR, 'next full moon, 24 December 2026 01:28 UTC');
  near(m.nextNew, Date.UTC(2026, 11, 9, 0, 52), 3 * HOUR, 'next new moon, 9 December 2026 00:52 UTC');
  assert.equal(G.nextPhase(Date.UTC(2026, 11, 9, 6), 0.5) > Date.UTC(2026, 11, 9, 6), true, 'always after the given time');
});

test('a full moon rises opposite the setting sun', () => {
  const { t, m } = denver(2026, 11, 24);
  assert.ok(m.rise && m.rise.time <= t.sunset && t.sunset - m.rise.time < 2 * HOUR, 'up when the sun sets, risen shortly before');
  assert.ok(m.upAtSunset);
  const opposite = Math.abs(G.normalize(m.azimuth - m.sunAzimuth + 180) - 180);
  assert.ok(opposite > 150, `about opposite the sun (${opposite.toFixed(0)}°)`);
  assert.ok(m.set && m.set.time > t.sunset, 'the next set is after sunset');
  near(G.sunPosition(t.sunset, 39.739, -104.99).azimuth, m.sunAzimuth, 0.01);
});

test('rise and set are where the moon crosses the horizon', () => {
  for (const [y, mo, d] of [[2026, 11, 24], [2026, 11, 28], [2026, 12, 2], [2026, 12, 15]]) {
    const { m } = denver(y, mo, d);
    for (const e of [m.rise, m.set].filter(Boolean)) near(G.moonPosition(e.time, 39.739, -104.99).altitude, 0, 0.3, `${y}-${mo}-${d}`);
  }
  const { t, m } = denver(2026, 11, 28);                    // waning gibbous: not up at sunset, rises later
  assert.ok(!m.upAtSunset && m.rise.time > t.sunset);
});

test('moonlight for the walk back, and distance', () => {
  const full = denver(2026, 11, 24).m, late = G.moonEvening(denver(2026, 11, 24).t.sunset, 39.739, -104.99, denver(2026, 11, 24).t.sunset + 5 * HOUR);
  assert.ok(late.light > full.light && late.light > 0.6, 'a high full moon is bright');
  assert.equal(denver(2026, 12, 9).m.light, 0, 'no light at new moon');
  const d = full.distance;
  assert.ok(d > 356000 && d < 407000, `distance ${d}`);
});
