/* Golden Hour core: the sun, the star rating, the evening's times, the plan, the share link and the calendar
   file. Pure functions, no network and no DOM, so the same rules can be tested in Node and ported to Swift
   and Kotlin against the same fixtures (tests/fixtures). The rules are specified in docs/SPEC.md; section
   numbers in the comments refer to it. */
(function (root) {
  'use strict';

  const clamp = (x) => Math.max(0, Math.min(1, x));
  const MIN = 60000, HOUR = 3600000;

  // ---------- Sun and moon (from Bearings; after SunCalc by Vladimir Agafonkin, BSD-2-Clause) ----------
  const RAD = Math.PI / 180, DAY_MS = 86400000, J1970 = 2440588, J2000 = 2451545, OBLIQ = RAD * 23.4397;
  function normalize(deg) { const d = deg % 360; return d < 0 ? d + 360 : d; }
  const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;
  const fromJulian = (j) => (j + 0.5 - J1970) * DAY_MS;
  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQ) - Math.tan(b) * Math.sin(OBLIQ), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQ) + Math.cos(b) * Math.sin(OBLIQ) * Math.sin(l));
  const azimuthOf = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const altitudeOf = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;
  const solarMeanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);
  function eclipticLongitude(M) {
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + RAD * 102.9372 + Math.PI;
  }
  function sunCoords(d) { const L = eclipticLongitude(solarMeanAnomaly(d)); return { dec: declination(L, 0), ra: rightAscension(L, 0) }; }
  function astroRefraction(h) { if (h < 0) h = 0; return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)); }

  /** The sun's direction: {azimuth (degrees from north, clockwise), altitude (geometric, degrees)}. */
  function sunPosition(ms, lat, lon) {
    const lw = RAD * -lon, phi = RAD * lat, d = toDays(ms), c = sunCoords(d), H = siderealTime(d, lw) - c.ra;
    return { azimuth: normalize(azimuthOf(H, phi, c.dec) / RAD + 180), altitude: altitudeOf(H, phi, c.dec) / RAD };
  }

  function moonCoords(d) {
    const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.229350 * d);
    const l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist };
  }
  function moonPosition(ms, lat, lon) {
    const lw = RAD * -lon, phi = RAD * lat, d = toDays(ms), c = moonCoords(d), H = siderealTime(d, lw) - c.ra;
    let h = altitudeOf(H, phi, c.dec);
    h += astroRefraction(h);
    return { azimuth: normalize(azimuthOf(H, phi, c.dec) / RAD + 180), altitude: h / RAD };
  }
  const PHASES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  function moonPhase(ms) {
    const d = toDays(ms), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    const fraction = (1 + Math.cos(inc)) / 2, phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI;
    return { fraction, phase, name: PHASES[Math.round(phase * 8) % 8] };
  }

  // ---------- Distance, bearing, and a point a distance away ----------
  const EARTH_R = 6371008.8;
  function distance(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    return normalize(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / RAD);
  }
  /** The point `km` from a place along a bearing (degrees from north). */
  function destination(lat, lon, bearingDeg, km) {
    const d = km * 1000 / EARTH_R, b = bearingDeg * RAD, p1 = lat * RAD, l1 = lon * RAD;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
  }

  // ---------- The evening's times (section 5) ----------
  /** Local solar noon, near enough to pick the right day: noon UTC shifted by the longitude. */
  function solarNoonGuess(year, month, day, lon) { return Date.UTC(year, month - 1, day, 12) - lon / 15 * HOUR; }

  /** The evening of the solar day containing `ms`: when the sun's centre passes each altitude on the way
      down (geometric, without refraction; sunset itself is the usual -0.833°).
      {noon, goldenStart, bestStart, sunset, bestEnd, afterglowEnd, lastLight, azimuth, state}
      state: 'ok', 'twilight' (the sun sets but never gets 4° or 6° down: twilight all night), or
      'none' (no sunset on this date; `polar` says 'day' or 'night'). */
  function eveningTimes(ms, lat, lon) {
    const J0 = 0.0009, lw = RAD * -lon, phi = RAD * lat, d = toDays(ms);
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
    const transit = (a) => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const at = (deg) => {
      const w = Math.acos((Math.sin(deg * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
      return Number.isNaN(w) ? null : fromJulian(transit(J0 + (w + lw) / (2 * Math.PI) + n));
    };
    const out = { noon: fromJulian(transit(ds)), goldenStart: at(6), bestStart: at(1), sunset: at(-0.833), bestEnd: at(-3),
      afterglowEnd: at(-4), lastLight: at(-6), azimuth: null, state: 'ok' };
    if (out.sunset === null) {
      out.state = 'none';
      out.polar = altitudeOf(0, phi, dec) > 0 ? 'day' : 'night';
      return out;
    }
    out.azimuth = sunPosition(out.sunset, lat, lon).azimuth;
    if (out.afterglowEnd === null || out.lastLight === null) out.state = 'twilight';
    // A sun that barely clears 6° or 1° at noon: fall back to noon, so the windows still have a start.
    if (out.goldenStart === null) out.goldenStart = out.noon;
    if (out.bestStart === null) out.bestStart = out.noon;
    return out;
  }

  // ---------- Reading the forecast at sunset (section 4.1) ----------
  /** The index i with times[i] <= t < times[i+1] (times in ms, ascending), or -1. */
  function bracket(times, t) {
    if (!times || times.length < 2 || t < times[0] || t >= times[times.length - 1]) return -1;
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
    return lo;
  }
  /** A continuous value at t, linearly between the two hours around it. null when either hour is missing. */
  function interp(times, values, t) {
    const i = bracket(times, t);
    if (i < 0 || !values) return null;
    const a = values[i], b = values[i + 1];
    if (a == null || b == null) return a == null ? (b == null ? null : b) : a;
    const k = (t - times[i]) / (times[i + 1] - times[i]);
    return a + (b - a) * k;
  }
  /** The larger of the two hours around t (for sums and probabilities). */
  function larger(times, values, t) {
    const i = bracket(times, t);
    if (i < 0 || !values) return null;
    const a = values[i], b = values[i + 1];
    if (a == null && b == null) return null;
    return Math.max(a == null ? -Infinity : a, b == null ? -Infinity : b);
  }
  /** Both hours' values around t (for categories such as weather_code). */
  function both(times, values, t) {
    const i = bracket(times, t);
    if (i < 0 || !values) return [];
    return [values[i], values[i + 1]].filter((v) => v != null);
  }

  /** The inputs the rating needs for one evening, read from Open-Meteo style hourly data.
      p0: {time[], cloud_cover_low[], ...} at the place; up: four of {time[], cloud_cover_low[], cloud_cover_mid[],
      cloud_cover_high[]} at 50, 100, 200 and 300 km toward the sunset; aq: {time[], aerosol_optical_depth[],
      pm2_5[], us_aqi[]} or null. Times are milliseconds. Returns null when the forecast doesn't cover sunset. */
  function inputsAt(p0, up, aq, sunsetMs) {
    const t = sunsetMs, tc = sunsetMs + 30 * MIN, tb = sunsetMs + 60 * MIN;
    if (bracket(p0.time, t) < 0) return null;
    const v = (k, at) => interp(p0.time, p0[k], at);
    const i = bracket(p0.time, t);
    let rain12 = 0;
    for (let j = Math.max(0, i - 11); j <= i; j++) rain12 += (p0.precipitation && p0.precipitation[j]) || 0;
    const aqv = (k) => (aq && aq[k] ? interp(aq.time, aq[k], t) : null);
    return {
      low: v('cloud_cover_low', t), mid: v('cloud_cover_mid', t), high: v('cloud_cover_high', t),
      visibility: v('visibility', t), humidity: v('relative_humidity_2m', t),
      precipitation: larger(p0.time, p0.precipitation, t), rainChance: larger(p0.time, p0.precipitation_probability, t),
      codes: both(p0.time, p0.weather_code, t),
      apparent: v('apparent_temperature', tc), wind: v('wind_speed_10m', tc), gusts: v('wind_gusts_10m', tc),
      windFrom: p0.wind_direction_10m ? p0.wind_direction_10m[bracket(p0.time, tc) < 0 ? i : bracket(p0.time, tc)] : null,
      apparentLater: v('apparent_temperature', tb), windLater: v('wind_speed_10m', tb), gustsLater: v('wind_gusts_10m', tb),
      rain12,
      up: (up || []).map((u) => ({ low: interp(u.time, u.cloud_cover_low, t) || 0, mid: interp(u.time, u.cloud_cover_mid, t) || 0,
        high: interp(u.time, u.cloud_cover_high, t) || 0 })),
      aod: aqv('aerosol_optical_depth'), pm25: aqv('pm2_5'), aqi: aqv('us_aqi'),
    };
  }

  // ---------- The evening normal (section 4.5) ----------
  /** From 30 years of daily highs and lows: for each day of the year (0-365), the average high and low over
      that day ± 7 days. dates: ['1991-01-01', ...]; max, min in °C. Returns {max: [366], min: [366]}. */
  function normals(dates, max, min) {
    const sumMax = new Float64Array(366), sumMin = new Float64Array(366), count = new Float64Array(366);
    for (let i = 0; i < dates.length; i++) {
      if (max[i] == null || min[i] == null) continue;
      const doy = dayOfYear(dates[i]);
      sumMax[doy] += max[i]; sumMin[doy] += min[i]; count[doy]++;
    }
    const out = { max: [], min: [] };
    for (let d = 0; d < 366; d++) {
      let a = 0, b = 0, c = 0;
      for (let k = -7; k <= 7; k++) { const j = (d + k + 366) % 366; a += sumMax[j]; b += sumMin[j]; c += count[j]; }
      out.max.push(c ? Math.round(a / c * 10) / 10 : null);
      out.min.push(c ? Math.round(b / c * 10) / 10 : null);
    }
    return out;
  }
  /** 0 for 1 January … 365 for 31 December in a leap year (every year uses leap-year numbering). */
  function dayOfYear(date) {
    const [, m, d] = date.split('-').map(Number);
    return [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335][m - 1] + d - 1;
  }
  /** The usual feels-about-right temperature for an evening: 65% of the way from the low to the high. */
  function eveningNormal(table, date) {
    if (!table) return null;
    const d = dayOfYear(date), hi = table.max[d], lo = table.min[d];
    return hi == null || lo == null ? null : lo + 0.65 * (hi - lo);
  }

  // ---------- The four parts and the score (sections 4.2 and 4.3) ----------
  // Colour in the clouds is the point, so it carries most of the score; the rest only shade it.
  const WEIGHTS = { c: 0.70, s: 0.10, a: 0.10, k: 0.10 };
  /** The colour class: a name for the colour score (0 to 1), richest first. */
  const COLOUR_CLASSES = [[0.85, 'Brilliant'], [0.65, 'Rich'], [0.45, 'Warm'], [0.25, 'Soft'], [0, 'Muted']];
  function colourClass(c) { return COLOUR_CLASSES.find(([min]) => c >= min)[1]; }
  const isThunder = (c) => c >= 95 && c <= 99;
  const isFog = (c) => c === 45 || c === 48;
  const isSnow = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
  const isSteadyRain = (c) => c >= 51 && c <= 67;

  /** `w`: the wind people will feel, m/s: the mean, or 0.7 of the gusts if that's more. */
  function feltWind(wind, gusts) { return Math.max(wind || 0, 0.7 * (gusts || 0)); }

  function parts(x, normal) {
    const up = [0, 1, 2, 3].map((i) => x.up[i] || { low: 0, mid: 0, high: 0 });
    const low = x.low || 0;
    const blockS = Math.max(up[0].low, up[1].low, 0.5 * up[2].mid);
    const blockC = Math.max(up[0].low, up[1].low, up[2].low, up[3].low, 0.5 * up[2].mid, 0.5 * up[3].mid, 0.3 * up[2].high, 0.3 * up[3].high);
    const s = 1 - clamp((blockS - 20) / 60);
    const lit = 1 - clamp((blockC - 20) / 60);
    const canvas = Math.max(x.mid || 0, x.high || 0);
    let canvasTerm;
    if (canvas < 5) canvasTerm = 0.1;                     // a cloudless sky has nothing to catch the colour
    else if (canvas < 30) canvasTerm = 0.1 + 0.9 * (canvas - 5) / 25;
    else if (canvas <= 70) canvasTerm = 1;
    else canvasTerm = 1 - 0.8 * clamp((canvas - 70) / 30) * clamp((blockC - 10) / 40);
    let a;
    if (x.aod != null) a = x.aod <= 0.15 ? 1 : x.aod <= 0.6 ? 1 - 0.8 * (x.aod - 0.15) / 0.45 : x.aod < 1 ? 0.2 * (1 - (x.aod - 0.6) / 0.4) : 0;
    else a = x.visibility == null ? 1 : clamp((x.visibility - 5000) / 25000);
    a = Math.max(0, a - 0.15 * clamp(((x.humidity == null ? 0 : x.humidity) - 75) / 20));
    // Colour: cloud to catch the light, no low cloud in front of it, light that can reach it, and air
    // clean enough not to wash it out.
    const c = canvasTerm * (1 - low / 100) * (0.4 + 0.6 * lit) * (0.7 + 0.3 * a);

    const w = feltWind(x.wind, x.gusts);
    const wind = 1 - clamp((w - 3.5) / 5.5);
    let temp = 1;
    const t = x.apparent;
    if (t != null) {
      if (normal != null) {
        const d = t - normal;
        temp = d < -3 ? 1 - clamp((-3 - d) / 9) : d > 4 ? 1 - clamp((d - 4) / 6) : 1;
      } else {
        temp = t < 10 ? clamp(t / 10) : t > 27 ? 1 - clamp((t - 27) / 8) : 1;
      }
      if (t < 0 || t > 35) temp = Math.min(temp, 0.5);
    }
    const rain = x.rainChance != null && x.rainChance > 50 ? 0.5 : 1;
    const k = (0.6 * wind + 0.4 * temp) * rain;
    return { c, s, a, k, blockS, blockC, canvas, lit, w, wind, temp, rain, normal: normal == null ? null : normal };
  }

  /** Why an evening is capped at 1.5 stars, or null: 'thunder', 'snow', 'rain', 'fog' or 'overcast'. */
  function capReason(x) {
    const codes = x.codes || [];
    if (codes.some(isThunder)) return 'thunder';
    if ((x.precipitation || 0) >= 0.2 && codes.some(isSnow)) return 'snow';
    if ((x.precipitation || 0) >= 0.2 && codes.some(isSteadyRain)) return 'rain';
    if (codes.some(isFog)) return 'fog';
    const up = x.up || [];
    if ((x.low || 0) >= 85 && up[0] && up[0].low >= 85 && up[1] && up[1].low >= 85) return 'overcast';
    return null;
  }

  const round1 = (v) => Math.round(v * 10 + 1e-9) / 10;
  const TIERS = [
    { label: 'Tonight', range: 0.5 }, { label: 'Forecast', range: 0.8 }, { label: 'Outlook', range: 1.2 },
  ];
  /** 'tonight' for day 0, 'forecast' for days 1 and 2, 'outlook' for 3 to 5, otherwise 'none' (not rated). */
  function tierOf(day) { return day === 0 ? 'tonight' : day <= 2 ? 'forecast' : day <= 5 ? 'outlook' : 'none'; }
  function verdictOf(score) { return score >= 3.5 ? 'go' : score >= 2.5 ? 'maybe' : 'skip'; }
  const VERDICT_WORD = { go: 'Go', maybe: 'Maybe', skip: 'Skip' };

  /** The rating for one evening.
      x: inputsAt(); opts: {day (0 = today), normal (°C or null), spotType ('outdoor', 'water', 'peak', 'venue'),
      imperialFirst}. */
  function rate(x, opts) {
    const o = opts || {};
    const p = parts(x, o.normal);
    const sky = WEIGHTS.c * p.c + WEIGHTS.s * p.s;
    const gate = clamp(sky / 0.30);
    const cap = capReason(x);
    let score = round1(5 * (sky + gate * (WEIGHTS.a * p.a + WEIGHTS.k * p.k)));
    if (cap) score = Math.min(score, 1.5);
    const tier = tierOf(o.day || 0);
    const base = (TIERS[{ tonight: 0, forecast: 1, outlook: 2 }[tier]] || TIERS[2]).range;
    const range = round1(base + (o.spotType === 'water' || o.spotType === 'peak' ? 0.3 : 0));
    const shown = tier === 'outlook' ? Math.round(score * 2) / 2 : score;
    const lo = round1(Math.max(0, score - range)), hi = round1(Math.min(5, score + range));
    const verdict = verdictOf(score);
    let qualifier = '';
    if (cap) qualifier = '';
    else if (tier === 'outlook') qualifier = 'may change';
    else if (verdict === 'go' && lo < 3.5) qualifier = 'could slip to Maybe';
    else if (verdict === 'skip' && hi >= 2.5) qualifier = 'could reach Maybe';
    else if (verdict === 'maybe') {
      const up = hi >= 3.5, down = lo < 2.5;
      if (up && down) qualifier = 3.5 - score <= score - 2.5 ? 'could reach Go' : 'could slip to Skip';
      else if (up) qualifier = 'could reach Go';
      else if (down) qualifier = 'could slip to Skip';
    }
    const smoke = x.pm25 != null && x.aod != null && x.pm25 > 35 && x.aod > 0.5;
    const warnings = [];
    if ((x.codes || []).some(isThunder)) warnings.push({ id: 'thunder', text: 'Thunderstorms forecast. Avoid exposed ground.' });
    if (x.aqi != null && x.aqi > 150) warnings.push({ id: 'air', text: 'Air quality is unhealthy this evening.' });
    return {
      parts: { c: p.c, s: p.s, a: p.a, k: p.k }, colour: Math.round(p.c * 100), colourClass: colourClass(p.c), detail: p, gate, cap, score, shown, range, lo, hi, tier, verdict,
      verdictWord: VERDICT_WORD[verdict], qualifier, smoke, warnings,
      reason: reason(x, p, cap, smoke, !!o.imperialFirst),
    };
  }

  // ---------- The reason sentence (section 4.6) ----------
  function reason(x, p, cap, smoke, imperialFirst) {
    if (cap === 'thunder') return 'Thunderstorms nearby: one to skip.';
    if (cap === 'rain') return 'Rain will likely hide it.';
    if (cap === 'snow') return 'Snow will likely hide it.';
    if (cap === 'fog') return 'Fog will likely hide it.';
    if (cap === 'overcast') return 'Low cloud will likely block it.';
    if (smoke) return 'Smoky: a red sun, muted sky.';
    let s;
    if (p.s < 0.4) s = 'Cloud to the west will likely hide the sun';
    else if (p.c >= 0.8 && p.s >= 0.6) s = 'High cloud should catch the colour; clear to the west';
    else if (p.c >= 0.6 && p.s < 0.6) s = 'Colour likely overhead, though the sun may slip behind cloud';
    else if (p.canvas < 5) s = 'Clear sky: no cloud to catch the colour';
    else if ((x.low || 0) >= 40) s = 'Low cloud may block some of it';
    else if (p.canvas > 70) s = 'A thick cloud layer may mute it';
    else s = 'Some cloud to catch a little colour';
    let m = '', short = '';
    if (p.a < 0.5) m = short = 'hazy';
    else if (p.wind < 0.5) { m = 'breezy: ' + windText(p.w, imperialFirst); short = 'breezy: ' + windText(p.w, imperialFirst, true); }
    else if (p.temp < 0.5) m = short = (p.normal != null ? x.apparent < p.normal : x.apparent < 15) ? 'cold for the time of year' : 'hot for the time of year';
    else if (p.rain < 1) m = short = 'showers possible';
    if (!m) return s + '.';
    const full = `${s}; ${m}.`;
    return full.length <= 90 ? full : `${s}; ${short}.`;
  }

  // ---------- Units: imperial and metric, side by side ----------
  const cToF = (c) => c * 9 / 5 + 32;
  /** "68°F · 20°C" or "20°C · 68°F"; with `one`, only the first. */
  function tempText(c, imperialFirst, one) {
    const f = `${Math.round(cToF(c))}°F`, m = `${Math.round(c)}°C`;
    return one ? (imperialFirst ? f : m) : imperialFirst ? `${f} · ${m}` : `${m} · ${f}`;
  }
  /** "18 mph · 29 km/h" (metres per second in). */
  function windText(mps, imperialFirst, one) {
    const i = `${Math.round(mps * 2.2369363)} mph`, m = `${Math.round(mps * 3.6)} km/h`;
    return one ? (imperialFirst ? i : m) : imperialFirst ? `${i} · ${m}` : `${m} · ${i}`;
  }
  /** "2.4 mi · 3.9 km" (kilometres in). */
  function distanceText(km, imperialFirst, one) {
    const mi = km / 1.609344, f = (v) => (v < 9.95 ? v.toFixed(1) : String(Math.round(v)));
    const i = `${f(mi)} mi`, m = `${f(km)} km`;
    return one ? (imperialFirst ? i : m) : imperialFirst ? `${i} · ${m}` : `${m} · ${i}`;
  }
  /** Countries that list imperial first. */
  function prefersImperial(region) { return ['US', 'LR', 'MM'].includes(region || ''); }

  // ---------- The plan (section 6.1) ----------
  /** Minutes on the road, from the great-circle distance: about a third longer by road, at 30, 50 or 80 km/h.
      Rounded to 10 minutes; 0 when the start is at the spot. */
  function travelMinutes(km) {
    if (km < 0.2) return 0;
    const speed = km < 10 ? 30 : km <= 40 ? 50 : 80;
    return Math.max(10, Math.round(km * 1.4 / speed * 60 / 10) * 10);
  }
  /** 10 minutes, plus 15 on a great evening or from Friday to Sunday (weekday: 0 = Sunday). */
  function bufferMinutes(score, weekday) { return 10 + (score >= 4.0 || weekday === 5 || weekday === 6 || weekday === 0 ? 15 : 0); }

  /** times: eveningTimes(); o: {walkIn, travel, buffer, closing (ms or null)}. */
  function planTimes(times, o) {
    if (!times || times.state === 'none') return null;
    const meetAt = times.bestStart - 20 * MIN;
    const twilight = times.state === 'twilight';
    const stayUntil = twilight ? times.sunset + 45 * MIN : times.afterglowEnd;
    let headBackBy = twilight ? times.sunset + 90 * MIN : times.lastLight;
    if (o.closing != null) headBackBy = Math.min(headBackBy, o.closing - 15 * MIN);
    return { leaveBy: meetAt - ((o.walkIn || 0) + (o.travel || 0) + (o.buffer || 0)) * MIN, meetAt, sunset: times.sunset, stayUntil, headBackBy };
  }

  // ---------- What to bring (section 6.2) ----------
  /** x: inputsAt(); p: rate().detail; o: {spotType, walkIn, who, times: planTimes(), imperialFirst}.
      Returns up to seven of {id, name, why}, most important first. */
  function bringList(x, p, o) {
    const t = x.apparentLater != null ? x.apparentLater : x.apparent;
    const w = feltWind(x.windLater != null ? x.windLater : x.wind, x.gustsLater != null ? x.gustsLater : x.gusts);
    const outdoor = o.spotType !== 'venue', imp = !!o.imperialFirst;
    const out = [];
    if (o.spotType === 'venue') out.push({ id: 'booking', name: 'Booking', why: 'Worth booking a table.' });
    if (t != null && t < 10) out.push({ id: 'coat', name: 'Coat', why: `${tempText(t, imp)} an hour after sunset` });
    else if (t != null && t <= 16) out.push({ id: 'layer', name: 'Warm layer', why: `${tempText(t, imp)} an hour after sunset` });
    if (w > 4.5) out.push({ id: 'windproof', name: 'Windproof layer', why: `Breezy: ${windText(w, imp)}` });
    const late = o.times && o.times.headBackBy > o.times.sunset + 20 * MIN;
    if ((o.walkIn || 0) >= 5 || late) out.push({ id: 'light', name: 'Torch or phone light', why: 'The walk back is after dark' });
    if (outdoor && x.rain12 >= 1) out.push({ id: 'mat', name: 'Waterproof mat', why: 'The ground will be wet' });
    if (outdoor) out.push({ id: 'blanket', name: 'Blanket or chairs', why: 'Somewhere to sit' });
    if (t != null && t >= 13 && w < 3 && o.spotType === 'water') out.push({ id: 'repellent', name: 'Insect repellent', why: 'Calm and mild near water' });
    if ((o.walkIn || 0) > 15) out.push({ id: 'water', name: 'Water', why: 'A longer walk in' });
    if (p.s > 0.5) out.push({ id: 'sunglasses', name: 'Sunglasses', why: 'The sun will be low and bright' });
    if (o.who === 'family') out.push({ id: 'snacks', name: 'Snacks', why: 'For the wait' });
    return out.slice(0, 7);
  }

  /** Merges a fresh bring list into a saved one: ticked items stay; new rule items are marked new; an unticked
      rule item whose rule no longer holds goes, unless it carries a name. Custom items always stay. */
  function mergeItems(saved, fresh) {
    const byId = new Map((saved || []).map((i) => [i.id, i]));
    const out = [];
    for (const f of fresh) {
      const s = byId.get(f.id);
      out.push(s ? { ...s, name: f.name, why: f.why } : { ...f, done: false, isNew: !!(saved && saved.length) });
      byId.delete(f.id);
    }
    for (const s of byId.values()) if (s.custom || s.done || s.who) out.push(s);
    return out;
  }

  // ---------- After dark (section 6.5) ----------
  /** {up, fraction, name} for the moon at a time and place. */
  function moonAt(ms, lat, lon) {
    const ph = moonPhase(ms);
    return { up: moonPosition(ms, lat, lon).altitude > 0, fraction: ph.fraction, name: ph.name };
  }

  // ---------- The moon this evening ----------
  const SYNODIC = 29.530588853;   // days from one new moon to the next
  /** The moon's distance from the earth's centre, km. */
  function moonDistance(ms) { return moonCoords(toDays(ms)).dist; }
  /** When the moon's phase next reaches `target` (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter) after `ms`. */
  function nextPhase(ms, target) {
    const off = (t) => { let d = moonPhase(t).phase - target; d -= Math.round(d); return d; };   // -0.5..0.5, rising through 0
    let a = ms, fa = off(a);
    for (let i = 0; i < 130; i++) {
      const b = a + 6 * HOUR, fb = off(b);
      if (fa < 0 && fb >= 0 && fb - fa < 0.5) {
        let lo = a, hi = b;
        for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (off(mid) < 0) lo = mid; else hi = mid; }
        return Math.round((lo + hi) / 2);
      }
      a = b; fa = fb;
    }
    return null;
  }
  /** Everything about the moon for the evening around `sunset`: its phase, when it rises and sets nearest the
      evening and in which direction, where it is when the sun goes down, how much light it gives for the walk
      back, how far away it is, and when it is next full and new. */
  function moonEvening(sunset, lat, lon, headBack) {
    // Every moonrise and moonset from a day before sunset to a day and a half after, each refined to the minute.
    const STEP = 5 * MIN, from = sunset - 24 * HOUR, to = sunset + 36 * HOUR, rises = [], sets = [];
    let prevAlt = moonPosition(from, lat, lon).altitude;
    for (let t = from + STEP; t <= to; t += STEP) {
      const alt = moonPosition(t, lat, lon).altitude;
      if ((prevAlt < 0) !== (alt < 0)) {
        let lo = t - STEP, hi = t;
        for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if ((moonPosition(mid, lat, lon).altitude >= 0) === (alt >= 0)) hi = mid; else lo = mid; }
        const at = Math.round(hi / MIN) * MIN, ev = { time: at, azimuth: moonPosition(at, lat, lon).azimuth };
        (alt >= 0 ? rises : sets).push(ev);
      }
      prevAlt = alt;
    }
    const upNow = moonPosition(sunset, lat, lon).altitude > 0;
    // The rise that matters: if the moon is already up at sunset, the one that brought it up; otherwise the next.
    const rise = upNow ? rises.filter((e) => e.time <= sunset).pop() || null : rises.find((e) => e.time > sunset) || null;
    // The set that matters: the next one after sunset.
    const set = sets.find((e) => e.time > sunset) || null;
    const ph = moonPhase(sunset), atSunset = moonPosition(sunset, lat, lon), sun = sunPosition(sunset, lat, lon);
    const back = headBack == null ? sunset + 90 * MIN : headBack, atBack = moonPosition(back, lat, lon), phBack = moonPhase(back);
    // Moonlight for the walk back: how much of the moon is lit, and how high it is (none when it is down).
    const light = atBack.altitude > 0 ? phBack.fraction * Math.min(1, Math.sin(atBack.altitude * RAD) / Math.sin(40 * RAD)) : 0;
    const dist = moonDistance(sunset);
    return {
      phase: ph.phase, fraction: ph.fraction, name: ph.name, age: ph.phase * SYNODIC, waxing: ph.phase < 0.5,
      rise, set, upAtSunset: atSunset.altitude > 0, altitude: atSunset.altitude, azimuth: atSunset.azimuth, sunAzimuth: sun.azimuth,
      upAtHeadBack: atBack.altitude > 0, altitudeAtHeadBack: atBack.altitude, light,
      distance: dist, supermoon: dist < 362000 && ph.fraction > 0.9,
      nextFull: nextPhase(sunset, 0.5), nextNew: nextPhase(sunset, 0),
    };
  }

  // ---------- The share link (section 8.1) ----------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function toBase64Url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)];
      if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | ((c || 0) >> 6)];
      if (i + 2 < bytes.length) out += B64[c & 63];
    }
    return out;
  }
  function fromBase64Url(text) {
    const out = [];
    let buf = 0, bits = 0;
    for (const ch of text) {
      const v = B64.indexOf(ch);
      if (v < 0) throw new Error('bad character');
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return new Uint8Array(out);
  }
  const SHARE_VERSION = 1, MAX_CUSTOM = 10, MAX_ITEM = 40, MAX_LINK = 2000;
  const cut = (s, n) => String(s == null ? '' : s).slice(0, n);
  const mins = (ms) => Math.round(ms / MIN);

  /** The text after "#p=" for a plan. It carries the spot, the date, the four shared times, the walk in, the
      bring list with names and the score. Never leave-by, travel or the start: those would say roughly how far
      away the organiser lives. */
  function encodePlan(plan) {
    let custom = 0;
    const items = (plan.items || []).filter((i) => !i.custom || custom++ < MAX_CUSTOM)
      .map((i) => [cut(i.name, MAX_ITEM), i.who ? cut(i.who, 24) : 0]);
    const t = plan.times;
    const body = { v: SHARE_VERSION, n: cut(plan.spot.name, 60), la: Math.round(plan.spot.lat * 1e5) / 1e5, lo: Math.round(plan.spot.lon * 1e5) / 1e5,
      ty: plan.spot.type || 'outdoor', d: plan.date, tz: plan.tz || '', m: mins(t.meetAt), s: mins(t.sunset), u: mins(t.stayUntil), h: mins(t.headBackBy),
      w: plan.walkIn || 0, sc: plan.scoreAtSave == null ? null : plan.scoreAtSave, at: mins(plan.sharedAt || Date.now()), i: items };
    return toBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  }
  /** The plan in a link, or null when the link is incomplete, damaged, or from a newer version. Every string in
      it is untrusted: show it as text only. */
  function decodePlan(text) {
    try {
      const o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(text)));
      if (!o || o.v !== SHARE_VERSION) return null;
      const num = (v) => typeof v === 'number' && Number.isFinite(v);
      if (typeof o.n !== 'string' || !num(o.la) || !num(o.lo) || Math.abs(o.la) > 90 || Math.abs(o.lo) > 180) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.d) || ![o.m, o.s, o.u, o.h].every(num)) return null;
      const items = Array.isArray(o.i) ? o.i.slice(0, 20).filter((i) => Array.isArray(i) && typeof i[0] === 'string')
        .map((i) => ({ name: cut(i[0], MAX_ITEM), who: typeof i[1] === 'string' ? cut(i[1], 24) : '' })) : [];
      return { shared: true, spot: { name: cut(o.n, 60), lat: o.la, lon: o.lo, type: ['outdoor', 'water', 'peak', 'venue'].includes(o.ty) ? o.ty : 'outdoor' },
        date: o.d, tz: typeof o.tz === 'string' ? cut(o.tz, 40) : '', walkIn: num(o.w) ? Math.max(0, Math.min(600, o.w)) : 0,
        times: { meetAt: o.m * MIN, sunset: o.s * MIN, stayUntil: o.u * MIN, headBackBy: o.h * MIN },
        scoreAtSave: num(o.sc) ? o.sc : null, sharedAt: num(o.at) ? o.at * MIN : null, items };
    } catch { return null; }
  }

  // ---------- Golden Hour Places: where to watch from, from open map data ----------
  /** One Overpass query for the places around a location: well-known viewpoints, beaches, piers and parks near by;
      peaks and notable viewpoints farther out; and bars and restaurants with a terrace, a rooftop or a view. */
  function spotsQuery(lat, lon) {
    const a = (r) => `around:${r},${lat.toFixed(4)},${lon.toFixed(4)}`, notable = '[~"^(wikidata|wikipedia)$"~"."]';
    return `[out:json][timeout:25][maxsize:33554432];(` +
      `nwr(${a(25000)})[tourism=viewpoint][name];nwr(${a(25000)})[man_made=pier][name];nwr(${a(25000)})[natural=beach][name];` +
      `nwr(${a(25000)})[leisure=park][name]${notable};nwr(${a(25000)})[name~"sunset",i][~"^(tourism|leisure|natural|man_made)$"~"."];` +
      `)->.easy;(nwr(${a(70000)})[natural=peak][name]${notable};nwr(${a(70000)})[tourism=viewpoint][name]${notable};nwr(${a(20000)})[natural=peak][name];)->.adv;(` +
      `nwr(${a(15000)})[amenity~"^(bar|pub|restaurant|cafe|biergarten)$"][name][outdoor_seating~"^(yes|rooftop|roof|terrace|balcony)$"];` +
      `nwr(${a(15000)})[amenity~"^(bar|pub|restaurant|cafe)$"][name][rooftop=yes];` +
      `nwr(${a(15000)})[amenity~"^(bar|pub|restaurant|cafe)$"][name~"rooftop|roof|sky|sunset|view|terrace|deck|vista|summit|harbou?r|pier|beach|lookout",i];` +
      `)->.food;.easy out center tags 150;.adv out center tags 150;.food out center tags 150;`;
  }
  const SPOT_CAT = { easy: 'Landmark', adventurous: 'Adventurous', dining: 'Dining' };
  /** Sorts open map data into the three kinds of Golden Hour Places, best first. "Best" means what open data can
      show: famous places (with a Wikipedia or Wikidata entry) and places named for the sunset first, then the kind
      of place, then the nearest. o: {lat, lon, elevation (m, of the location), facing (sunset azimuth)} */
  function rankSpots(elements, o) {
    const seen = new Set(), out = { easy: [], adventurous: [], dining: [] };
    for (const e of elements || []) {
      const t = e.tags || {}, name = (t.name || '').trim(), lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
      if (!name || lat == null || lon == null) continue;
      const key = `${e.type}/${e.id}`, dedupe = `${name.toLowerCase()}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
      if (seen.has(key) || seen.has(dedupe)) continue;
      seen.add(key); seen.add(dedupe);
      const km = distance(o.lat, o.lon, lat, lon) / 1000, famous = !!(t.wikidata || t.wikipedia), sunsetNamed = /sunset/i.test(name) || /sunset/i.test(t.description || '');
      const ele = t.ele != null && Number.isFinite(parseFloat(t.ele)) ? parseFloat(t.ele) : null;
      const gain = ele != null && o.elevation != null ? ele - o.elevation : null;
      let cat, effort, score = (famous ? 40 : 0) + (sunsetNamed ? 30 : 0), kind;
      if (t.amenity) {
        cat = 'dining'; effort = 'low';
        kind = { bar: 'Bar', pub: 'Pub', restaurant: 'Restaurant', cafe: 'Café', biergarten: 'Beer garden' }[t.amenity] || 'Bar';
        if (t.rooftop === 'yes' || /^(rooftop|roof)$/.test(t.outdoor_seating || '')) score += 22;
        if (/rooftop|roof|sky|view|vista|lookout|terrace|deck/i.test(name)) score += 12;
        if (/^(terrace|balcony)$/.test(t.outdoor_seating || '')) score += 8;
        if (t.website || t['contact:website']) score += 6;
        if (t.opening_hours) score += 3;
        score -= km * 1.2;
      } else if (t.natural === 'peak' || (gain != null && gain > 250)) {
        cat = 'adventurous';
        effort = t.natural === 'peak' ? (gain == null || gain > 600 ? 'high' : 'medium') : gain > 600 ? 'high' : 'medium';
        kind = t.natural === 'peak' ? 'Summit' : 'Viewpoint';
        if (t.tourism === 'viewpoint' || t.natural === 'peak') score += 10;
        score -= km * 0.35;
      } else {
        cat = 'easy'; effort = 'easy';
        kind = t.tourism === 'viewpoint' ? 'Viewpoint' : t.man_made === 'pier' ? 'Pier' : t.natural === 'beach' ? 'Beach' : t.leisure === 'park' ? 'Park' : 'Landmark';
        score += { Viewpoint: 16, Pier: 13, Beach: 13, Park: 5, Landmark: 8 }[kind];
        if (t.tourism === 'attraction') score += 8;
        score -= km * 0.9;
      }
      // A viewpoint that says which way it looks: better when that is toward the sunset.
      let faces = null;
      if (t.direction != null && o.facing != null) {
        const d = parseFloat(t.direction);
        if (Number.isFinite(d)) { faces = Math.abs(normalize(d - o.facing + 180) - 180) <= 60; score += faces ? 12 : -10; }
      }
      const website = t.website || t['contact:website'] || null, phone = t.phone || t['contact:phone'] || null;
      out[cat].push({ id: key, name, cat, kind, effort, km, travel: travelMinutes(km), score: Math.round(score * 10) / 10, lat, lon, famous, sunsetNamed, faces,
        ele, gain: gain == null ? null : Math.round(gain), website: website && /^https?:\/\//.test(website) ? website : null, phone, hours: t.opening_hours || null,
        wheelchair: t.wheelchair || null, fee: t.fee || null, dog: t.dog || null });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => b.score - a.score || a.km - b.km);
    return out;
  }
  /** Why a place ranks where it does, in a few words. */
  function spotReason(s) {
    const bits = [];
    if (s.famous) bits.push('Well known');
    if (s.sunsetNamed) bits.push('Named for the sunset');
    if (s.faces === true) bits.push('Faces the sunset');
    if (s.cat === 'dining') bits.push('Terrace or rooftop');
    if (!bits.length) bits.push(s.cat === 'adventurous' ? 'High ground' : 'Open view');
    return bits.join(' · ');
  }
  /** A spot in a share link: base64url of compact JSON. */
  function encodeSpot(s) {
    const body = { v: 1, n: cut(s.name, 60), la: Math.round(s.lat * 1e5) / 1e5, lo: Math.round(s.lon * 1e5) / 1e5, c: s.cat, k: cut(s.kind || '', 20), e: s.effort || '' };
    return toBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  }
  function decodeSpot(text) {
    try {
      const o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(text)));
      const num = (v) => typeof v === 'number' && Number.isFinite(v);
      if (!o || o.v !== 1 || typeof o.n !== 'string' || !num(o.la) || !num(o.lo) || Math.abs(o.la) > 90 || Math.abs(o.lo) > 180) return null;
      return { name: cut(o.n, 60), lat: o.la, lon: o.lo, cat: ['easy', 'adventurous', 'dining', 'own'].includes(o.c) ? o.c : 'own', kind: cut(o.k || '', 20),
        effort: ['easy', 'medium', 'high', 'low', ''].includes(o.e) ? o.e : '' };
    } catch { return null; }
  }

  // ---------- The calendar file (section 8.2) ----------
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  /** Folds a line at 75 octets, on character boundaries (RFC 5545 section 3.1). */
  function fold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = '', size = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
      cur += ch; size += n;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  /** o: {id, start, end, title, location, description, now}. */
  function ics(o) {
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bradley Cowdrey//Golden Hour//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:${icsText(o.id)}@goldenhour`, `DTSTAMP:${icsTime(o.now)}`, `DTSTART:${icsTime(o.start)}`, `DTEND:${icsTime(o.end)}`,
      `SUMMARY:${icsText(o.title)}`, `LOCATION:${icsText(o.location)}`, `DESCRIPTION:${icsText(o.description)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(o.title)}`, 'TRIGGER:-PT90M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // ---------- A sample forecast, clearly labelled, for when live data can't load ----------
  /** Deterministic hourly data in the forecast's shape, with a different evening each day, so the app has
      something honest to show offline and in previews. */
  function sampleForecast(startMs, hours) {
    const time = [], rows = { cloud_cover_low: [], cloud_cover_mid: [], cloud_cover_high: [], visibility: [], precipitation: [],
      precipitation_probability: [], weather_code: [], relative_humidity_2m: [], apparent_temperature: [], wind_speed_10m: [], wind_gusts_10m: [], wind_direction_10m: [] };
    const days = [
      { low: 5, mid: 20, high: 55, vis: 32000, rain: 0, pop: 5, code: 2, rh: 55, t: 19, wind: 2.5 },
      { low: 10, mid: 45, high: 30, vis: 26000, rain: 0, pop: 10, code: 2, rh: 60, t: 18, wind: 3.2 },
      { low: 70, mid: 60, high: 40, vis: 14000, rain: 0.6, pop: 70, code: 61, rh: 88, t: 14, wind: 5.5 },
      { low: 0, mid: 0, high: 2, vis: 40000, rain: 0, pop: 0, code: 0, rh: 40, t: 21, wind: 1.8 },
      { low: 35, mid: 30, high: 20, vis: 20000, rain: 0, pop: 20, code: 3, rh: 70, t: 16, wind: 7.5 },
      { low: 8, mid: 15, high: 80, vis: 30000, rain: 0, pop: 5, code: 2, rh: 50, t: 20, wind: 2.2 },
    ];
    for (let h = 0; h < hours; h++) {
      const d = days[Math.floor(h / 24) % days.length];
      time.push(startMs + h * HOUR);
      rows.cloud_cover_low.push(d.low); rows.cloud_cover_mid.push(d.mid); rows.cloud_cover_high.push(d.high);
      rows.visibility.push(d.vis); rows.precipitation.push(d.rain); rows.precipitation_probability.push(d.pop);
      rows.weather_code.push(d.code); rows.relative_humidity_2m.push(d.rh);
      rows.apparent_temperature.push(d.t - 3 * Math.cos((h % 24) / 24 * 2 * Math.PI)); rows.wind_speed_10m.push(d.wind); rows.wind_gusts_10m.push(d.wind * 1.5); rows.wind_direction_10m.push(250 + 20 * (Math.floor(h / 24) % 4));
    }
    const upstream = (shift) => ({ time, cloud_cover_low: rows.cloud_cover_low.map((v) => Math.max(0, v - shift)), cloud_cover_mid: rows.cloud_cover_mid,
      cloud_cover_high: rows.cloud_cover_high });
    return { p0: { time, ...rows }, up: [upstream(0), upstream(5), upstream(10), upstream(10)], aq: null };
  }

  const api = {
    clamp, normalize, sunPosition, moonPosition, moonPhase, astroRefraction, distance, bearing, destination,
    solarNoonGuess, eveningTimes, bracket, interp, larger, both, inputsAt, normals, dayOfYear, eveningNormal,
    WEIGHTS, COLOUR_CLASSES, colourClass, feltWind, parts, capReason, tierOf, verdictOf, rate, reason,
    tempText, windText, distanceText, prefersImperial, cToF,
    travelMinutes, bufferMinutes, planTimes, bringList, mergeItems, moonAt, moonEvening, moonDistance, nextPhase, SYNODIC,
    toBase64Url, fromBase64Url, encodePlan, decodePlan, spotsQuery, rankSpots, spotReason, encodeSpot, decodeSpot, SPOT_CAT, MAX_LINK, ics, fold, sampleForecast,
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GH = api;
})(typeof self !== 'undefined' ? self : this);
