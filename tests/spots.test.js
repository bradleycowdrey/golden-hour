// Golden Hour Places, from open map data: node --test tests/spots.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../web/core.js');
const at = { lat: 39.739, lon: -104.99, elevation: 1609, facing: 244 };
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });

test('sorted into landmarks, adventurous places and dining', () => {
  const r = G.rankSpots([
    node(1, 39.75, -105.0, { name: 'City Viewpoint', tourism: 'viewpoint' }),
    node(2, 39.59, -105.64, { name: 'Mount Evans', natural: 'peak', ele: '4348' }),
    node(3, 39.75, -104.99, { name: 'Up Top', amenity: 'bar', rooftop: 'yes' }),
    node(4, 39.73, -105.24, { name: 'High Lookout', tourism: 'viewpoint', ele: '2200' }),
  ], at);
  assert.deepEqual(r.easy.map((s) => s.name), ['City Viewpoint']);
  assert.deepEqual(r.adventurous.map((s) => [s.name, s.effort]), [['High Lookout', 'medium'], ['Mount Evans', 'high']]);
  assert.deepEqual(r.dining.map((s) => [s.name, s.kind]), [['Up Top', 'Bar']]);
});

test('famous places and places named for the sunset rank first, then the nearest', () => {
  const r = G.rankSpots([
    node(1, 39.74, -104.99, { name: 'Little Park', leisure: 'park' }),
    node(2, 39.80, -105.10, { name: 'Sunset Park', leisure: 'park' }),
    node(3, 39.78, -105.06, { name: 'Inspiration Point', tourism: 'viewpoint', wikidata: 'Q1' }),
    node(4, 39.75, -105.0, { name: 'Near Viewpoint', tourism: 'viewpoint' }),
  ], at);
  assert.deepEqual(r.easy.map((s) => s.name), ['Inspiration Point', 'Sunset Park', 'Near Viewpoint', 'Little Park']);
  assert.equal(G.spotReason(r.easy[0]), 'Well known');
  assert.equal(G.spotReason(r.easy[1]), 'Named for the sunset');
});

test('a viewpoint facing the sunset ranks above one facing away', () => {
  const r = G.rankSpots([node(1, 39.75, -105.0, { name: 'East View', tourism: 'viewpoint', direction: '90' }), node(2, 39.751, -105.0, { name: 'West View', tourism: 'viewpoint', direction: 'W' === 'W' ? '250' : '' })], at);
  assert.deepEqual(r.easy.map((s) => [s.name, s.faces]), [['West View', true], ['East View', false]]);
});

test('duplicates and unnamed places are dropped; ways use their centre', () => {
  const r = G.rankSpots([
    node(1, 39.75, -105.0, { name: 'Pier', man_made: 'pier' }),
    node(2, 39.7501, -105.0001, { name: 'Pier', man_made: 'pier' }),
    node(3, 39.76, -105.0, { tourism: 'viewpoint' }),
    { type: 'way', id: 4, center: { lat: 39.77, lon: -105.02 }, tags: { name: 'Beach', natural: 'beach' } },
  ], at);
  assert.deepEqual(r.easy.map((s) => s.name).sort(), ['Beach', 'Pier']);
});

test('the query asks for each kind of place, and a spot survives a share link', () => {
  const q = G.spotsQuery(39.74, -104.99);
  for (const part of ['tourism=viewpoint', 'natural=peak', 'man_made=pier', 'natural=beach', 'rooftop=yes', 'outdoor_seating', '.food out center tags']) assert.ok(q.includes(part), part);
  const link = G.encodeSpot({ name: 'Lookout <b>', lat: 39.7322345, lon: -105.2392, cat: 'adventurous', kind: 'Summit', effort: 'high' });
  assert.match(link, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(G.decodeSpot(link), { name: 'Lookout <b>', lat: 39.73223, lon: -105.2392, cat: 'adventurous', kind: 'Summit', effort: 'high' });
  assert.equal(G.decodeSpot('nope'), null);
});

test('each kind of place is named for its icon', () => {
  const r = G.rankSpots([
    node(1, 39.75, -105.0, { name: 'Point Light', man_made: 'lighthouse' }),
    node(2, 39.751, -105.0, { name: 'Lookout', man_made: 'tower', 'tower:type': 'observation' }),
    node(3, 39.752, -105.0, { name: 'Marina', leisure: 'marina' }),
    node(4, 39.753, -105.0, { name: 'Lake', natural: 'water', wikidata: 'Q9' }),
    node(5, 39.754, -105.0, { name: 'Bluffs', natural: 'cliff' }),
    node(6, 39.755, -105.0, { name: 'Rose Garden', leisure: 'garden', wikidata: 'Q8' }),
    node(7, 39.756, -105.0, { name: 'High Bar', amenity: 'bar', rooftop: 'yes' }),
    node(8, 39.757, -105.0, { name: 'Corner Pub', amenity: 'pub', outdoor_seating: 'yes' }),
  ], at);
  const kinds = Object.fromEntries([...r.easy, ...r.dining].map((x) => [x.name, x.kind]));
  assert.deepEqual(kinds, { 'Point Light': 'Lighthouse', Lookout: 'Lookout tower', Marina: 'Harbour', Lake: 'Lake', Bluffs: 'Cliff', 'Rose Garden': 'Garden', 'High Bar': 'Bar', 'Corner Pub': 'Pub' });
  assert.equal(r.dining.find((x) => x.name === 'High Bar').rooftop, true);
  assert.equal(r.dining.find((x) => x.name === 'Corner Pub').rooftop, false);
  for (const part of ['man_made=lighthouse', '"tower:type"=observation', 'leisure=marina', 'natural=cliff']) assert.ok(G.spotsQuery(39.7, -105).includes(part), part);
});
