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

This is **Release 1** of the plan in [docs/SPEC.md](docs/SPEC.md). Version 0.10.0.

## What it does

- **One answer.** Open it and the top of the page says "Go tonight", "Maybe tonight" or "Not tonight", why,
  and one time: sunset, and when to be there. A Not tonight names the next good evening. The score, the
  colour class and every input are one tap down, under Why.
- **One place, one tap.** Under the answer is the place to watch from (your own nearest spot, or the top
  easy-to-reach one) and "Plan this evening". The plan is kept from the first tap and shared in one more.
- **Getting home.** Every plan says when to start back so the walk is done before dark, offers "Text a
  friend where I'll be" and "I'm home", and never claims a place is lit or safe.
- **Three places to be**: Today (a page for each location, swiped between), Plans and Places. A day, a
  place and Settings open as sheets over the page, and Back always goes one step back.
- **Places you can check**: landmarks, adventurous places, dining with a view and your own spots, from
  OpenStreetMap. Each says whether the map lists parking and toilets within a short walk, links to Google
  Maps for photos, and can be filtered by Parking, Toilets and Short walk.
- **A chosen date and venue**: any date up to a year ahead has exact times (colour is forecast five days
  out); find a venue by name or address; golden hour and blue hour; an arrive-by, travel time and home-by
  you can set; a note; and "has it changed?" on every saved plan.
- **Sharing**: a picture card for tonight, for the week and for a plan, with a link; "Send update" says
  what changed. Add to calendar carries a reminder 30 minutes before you leave.
- **When something fails it says so**: the last forecast stays, marked with how old it is; places say
  "Looking for places…", then either arrive or offer Try again. Settings, Status lists what the app last
  asked for and what came back.
- **The sky behind each place is its sunset**, imperial and metric side by side, works offline once opened.

The fix plan this build follows, with a "done when" test for each change, is [docs/FIX-PLAN.md](docs/FIX-PLAN.md).
Before a release, walk [docs/PHONE-CHECKLIST.md](docs/PHONE-CHECKLIST.md) on a real phone.

## Privacy

Golden Hour has no accounts and collects nothing. To get forecasts and places, your device sends
coordinates to Open-Meteo and the map tile host. Fonts and the map library are served from this site.
A venue search sends what you type to Photon (photon.komoot.io). Places, plans and your sunset log stay in your browser.
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
The upload needs three repository secrets (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`) and
an app in App Store Connect with the bundle ID `com.bradcowdrey.goldenhour`.

## Android

`android/` holds a first Android app, built the same way as the iPhone one: the web app in a full-screen
web view, loading the published site. Back goes back a step, Share and Add to calendar use Android's own
screens, and links that leave the site open in their own apps.

`.github/workflows/android.yml` builds it on every change. With the four `ANDROID_` secrets set
(`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) the
release APK and bundle are signed with the upload key, and on `main` they are attached to the release for
the current version: `GoldenHour.apk` installs directly, `GoldenHour.aab` is the file for Google Play.

## Testing

- `node --test tests/core.test.js tests/moon.test.js tests/spots.test.js`: the rules (35 tests): the rating
  against golden vectors, evening and plan times, start-back time, light windows, the share link, the
  calendar file, places ranking, and parking and toilets matching.
- `node tests/web.test.js [screenshots-dir]`: drives the built app in a browser (Playwright, 210 checks) with
  stand-in services. It walks the fix plan's "done when" lines and forces every failure: forecast down,
  a refresh that fails, the open map down, answering with an error note, with nothing, or after 20 seconds,
  parking lookup down, venue search down, map tiles down, location refused. Also Back from every screen,
  a touch swipe between locations, layout and tap targets at four widths, contrast, and doubled text size.

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
