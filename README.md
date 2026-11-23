<p align="center"><img src="web/icon.png" width="128" alt="Golden Hour icon"></p>

<h1 align="center">Golden Hour</h1>
<p align="center"><b>Which evenings are worth it, and a plan for the ones that are.</b><br>
A free, open-source sunset forecast and evening planner for the web. No ads, no account, no tracking.<br>
Made by <a href="https://bradcowdrey.com">Bradley Cowdrey · bradcowdrey.com</a></p>

---

Golden Hour rates every coming sunset from 0.0 to 5.0 stars for the places you care about, says which
evenings to go and which to skip, and on the good ones plans the outing: where you'll watch from, when to
leave, what to bring, and when to head home. It is in the same family as
[Two Degrees](https://github.com/bradleycowdrey/two-degrees) and
[Bearings](https://github.com/bradleycowdrey/bearings), and shows imperial and metric side by side.

This is **Release 1** of the plan in [docs/SPEC.md](docs/SPEC.md). Version 0.9.4.

## What it does

- **A star rating for each evening, led by colour.** Colour in the clouds is 70% of the score and gets
  its own class under the stars: Brilliant, Rich, Warm, Soft or Muted. A cloudless evening is not a Go.
  It reads cloud at three heights here and up to 300 km toward the sunset, haze, wind and how the
  temperature compares with what is usual for the place. Each evening also has a verdict (Go, Maybe,
  Skip), a range and one plain sentence of why. Tap to see the four parts behind the score.
- **A page for each place, swiped between**, as in Two Degrees on the iPhone: each on its own evening's
  sky, with a dot for each place and a list of them all.
- **The sky behind each place is its sunset.** A picture of the evening as it might look, drawn from the
  forecast: the better the sunset, the more vivid the screen, with drifting clouds lit from below.
- **Laid out as Two Degrees lays out a city**: the reading on the sky in thin, large type; one line an
  evening with a bar for its colour; and a tile, with its own graphic, for every input to the score: colour,
  cloud cover, cloud toward the sunset, air clarity, visibility, wind, feels like, rain and humidity.
- **Golden Hour Places**: where to watch from near each location, in four parts: landmarks that are easy to
  reach, adventurous places that take some effort, dining with a view (may need a booking), and your own
  spots. The top three of each sit at the foot of every location's page; each opens on its own screen with
  directions, tonight's rating there and "Plan this evening here". Ranked from OpenStreetMap: well-known
  places and places named for the sunset first.
- **Where to watch, straight under the rating**: ideas to swipe through, so the first screen answers "is it
  worth it?" and "where could I go?". Each place links to Google Maps for photos and reviews.
- **Tap an evening for its detail** in a sheet over the page, as in Two Degrees: swipe or use the arrows to
  move between evenings; the location's page stays where it was.
- **Share in one tap**: tonight's sunset (with a picture of the sky), any place, or the app itself.
- **The moon this evening**: its phase and the month at a glance, where it is in the sky as the sun goes
  down, moonrise and moonset, moonlight for the walk back, and how near it is.
- **The evening**: the sun's way down drawn over its times (golden hour, best light, sunset, the afterglow and last light), with where it sets.
- **The week**: six rated evenings, each Go marked Good or Great, and four more with their sunset times. Days three
  to five are an outlook; beyond that it says "Too early to call".
- **Compare places** side by side for the same evenings.
- **A plan for a spot you pin on the map**: leave by, meet at, sunset, stay until, head back by; what to
  bring, each with a reason; and the walk back, last light and the moon.
- **Share the plan with one link.** The link never carries where you are leaving from.
- **Add to calendar**, as a file any calendar opens.
- **Works offline** once opened, including saved plans.
- **"How was it?"** after last light, kept on your device, to tune the rating against real evenings.

## Privacy

Golden Hour has no accounts and collects nothing. To get forecasts and places, your device sends
coordinates to Open-Meteo and the map tile host. Fonts and the map library are served from this site.
Places, plans and your sunset log stay in your browser.
"Photos and reviews on Google Maps" opens Google with the place's name, only when you tap it. "Send it to
GitHub", after you rate an evening, opens a pre-filled public report for you to review before posting.

## Run it

```sh
git clone https://github.com/bradleycowdrey/golden-hour.git
cd golden-hour
scripts/build-web.sh                 # web/ → docs/, with the version stamped in
npx serve docs                       # then open the address it prints
```

`web/` holds the source: `index.html`, `app.css`, `core.js` (the rules: pure functions, no network or
page) and `app.js` (fetching, storage and the interface). `docs/` is what GitHub Pages serves; never edit
it by hand. Bump `VERSION` and rebuild to release.

## iPhone (TestFlight)

`ios/` holds a first iPhone app: the web app in a full-screen web view, loading the published site, which
keeps it working offline once opened. Links that leave the site open in their own apps. It has no widget,
notifications or calendar feed yet; those need native code.

`.github/workflows/ios-testflight.yml` compiles it on every change and uploads it to TestFlight from `main`.
The upload needs four repository secrets (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID`) and
an app in App Store Connect with the bundle ID `com.bradcowdrey.goldenhour`.

## Testing

- `node --test tests/core.test.js`: the rating against golden vectors (`tests/fixtures/vectors.json`,
  to be shared with the Swift and Kotlin ports), every threshold and cap, the reason sentences, evening
  times at several latitudes, plan times, the bring list, the share link and the calendar file.
- `node --test tests/spots.test.js`: sorting and ranking Golden Hour Places, and place share links.
- `node --test tests/moon.test.js`: the moon's phase, next full and new moons, moonrise and moonset, and moonlight.
- `node tests/web.test.js [screenshots-dir]`: drives the built app in a browser (Playwright) with a
  stand-in forecast: first run, search, the rating and times, the week, compare, the whole plan flow,
  sharing, the calendar file, offline, every listed state, layout and tap targets at four widths, and
  text contrast over the lightest sky.

## Not yet verified on real services

The tests answer Open-Meteo and the map tiles themselves. Before relying on it, check on a real phone
and connection: live forecast, air-quality and archive requests; map tiles from OpenFreeMap; the share
sheet and calendar file on iOS Safari and Android Chrome. The rating's weights are starting values,
to be tuned from at least 20 logged evenings (docs/SPEC.md, section 12).

## Credits

Weather by [Open-Meteo](https://open-meteo.com) (CC BY 4.0); air quality from CAMS. Maps by
[OpenFreeMap](https://openfreemap.org), © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
drawn with [MapLibre](https://maplibre.org) (BSD-3-Clause). Places from [GeoNames](https://www.geonames.org)
(CC BY 4.0). Sun and moon after SunCalc by Vladimir Agafonkin (BSD-2-Clause). Inter is under the SIL
Open Font License.

## Terms and privacy

Using Golden Hour means agreeing to the [Terms of Use and Privacy](https://bradcowdrey.com/legal), which
cover every app Bradley Cowdrey publishes. In short: it's free and provided as is, a forecast is not a
promise, and you use it at your own risk.

## License

MIT. See [LICENSE](LICENSE).
