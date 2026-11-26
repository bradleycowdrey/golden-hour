// The stand-in services shared by the web app's tests (tests/web.test.js) and its App Store screenshots
// (tests/app-store-screens.mjs): Denver and its neighbours as Open-Meteo's place search gives them, the open map's
// places to watch from and the parking and toilets near them, and the core's sample evenings in Open-Meteo's shape.
const G = require('../web/core.js');

const NOON = Date.UTC(2026, 5, 20, 18, 0);              // 12:00 in Denver
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
// Parking and toilets the map lists: both by Inspiration Point, parking only by Sunset Park, private parking (ignored) by Linger.
const NEAR = [
  { type: 'node', id: 101, lat: 39.7828, lon: -105.0568, tags: { amenity: 'parking' } },
  { type: 'way', id: 102, center: { lat: 39.7825, lon: -105.0564 }, tags: { amenity: 'toilets' } },
  { type: 'node', id: 103, lat: 39.7501, lon: -105.0401, tags: { amenity: 'parking' } },
  { type: 'node', id: 104, lat: 39.7598, lon: -105.0114, tags: { amenity: 'parking', access: 'private' } },
];
const TROMSO = { name: 'Tromsø', admin1: 'Troms', country: 'Norway', latitude: 69.6492, longitude: 18.9553, timezone: 'Europe/Oslo' };

// ---------- The stand-in forecast: the core's sample evenings, in Open-Meteo's shape ----------
const START = Date.UTC(2026, 5, 19, 0);
/** The forecast, air quality and archive answers for `days` days of sample evenings from 19 June. */
function standIn(days) {
  const sample = G.sampleForecast(START, days * 24);
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
  return { sample, secs, forecastBody, airBody, archiveBody };
}

module.exports = { NOON, START, DENVER, BOULDER, TROMSO, OSM, NEAR, standIn };
