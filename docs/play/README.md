# Golden Hour on Google Play

Everything Google Play needs for Golden Hour (package `com.bradcowdrey.goldenhour`), and how new builds reach
testers. A personal developer account must run a **closed test with at least 12 testers, opted in for 14 days in
a row**, before it can apply for production.

## What's in this folder

- `listing.json`: the store listing: title "Golden Hour: Sunset Forecast", the short and full description, contact
  email and website. Play's limits are 30, 80 and 4,000 characters.
- `icon.png`: 512 × 512, from the full-bleed iPhone icon (`ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`).
  Play rounds the corners itself.
- `feature-graphic.png`: 1024 × 500, the icon, "Golden Hour" and "Sunset forecast and evening planner" on the sky.
- `phone-1.png` to `phone-6.png`: 1080 × 2160 screenshots of the web app the Android app shows, taken at a Pixel 7's
  width with the stand-in forecast and places from `tests/web.test.js` (Denver, a Go evening): tonight's answer,
  the plan's times, Share, Add to calendar and getting home, the evenings ahead, places to watch from, and
  tomorrow's light and rating. Everything between the status and navigation bars is the page, so these are the
  app's screen without the bars.

## How it gets to Play

- **Store listing**: `.github/workflows/play-listing.yml` sends this folder to Play whenever it changes on `main`,
  or when you run it by hand (Actions, Google Play listing, Run workflow).
- **New builds for testers**: the last step of `.github/workflows/android.yml` ("Google Play closed test") sends
  the signed App Bundle to the closed test (Play's `alpha` track). It runs only on `main`, only with the upload
  key, and only for runs you start by hand (Actions, Android, Run workflow) or pushes that change `VERSION`.
  Other pushes, pull requests and branches build and test but never upload.
- **Version codes**: `versionCode` is the number of commits in `main`'s history (`git rev-list --count HEAD`, the
  same build number as the iPhone app; the workflow checks out the full history and stops on a shallow one).
  Every commit on `main` raises it, so each upload is higher than the last. Running the same commit again gives
  the same code, and Play's check makes the step skip it. Branches never upload, because their count can run ahead
  of `main`. Don't force-push `main` to a shorter history, or the codes would go down.
- Each release is named like "0.10.0 (36)". Its "What's new" says it's that version of Golden Hour; the app shows
  the published web app, so testers get each new version of the site as soon as it's live, without a new build.

## Repository secrets

- `PLAY_SERVICE_ACCOUNT_JSON`: the JSON key of the Google Cloud service account with the Google Play Android
  Developer API enabled (the same one as the other apps). Without it, both Play steps do nothing and every build
  still passes.
- `ANDROID_KEYSTORE_B64` (or `ANDROID_KEYSTORE`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD` (falls back to the keystore password): the **upload key** that signs the release APK and
  App Bundle. Without these the workflow builds only the debug APK and skips Play. The build's notice shows the
  key's SHA-256, to compare with Play Console (Test and release, App integrity, Upload key certificate).

## One-time steps in Play Console

The app already exists in Play Console with the package name `com.bradcowdrey.goldenhour`, and Google holds the
app signing key (Play App Signing); the key in the secrets is the upload key.

1. **Let the workflow in** (if the service account isn't already allowed for all apps): Users and permissions,
   the service account's email, app permissions for Golden Hour: Release apps to testing tracks, Manage testing
   tracks and edit tester lists, and Manage store presence.
2. **Set up the closed test**: Test and release, Testing, Closed testing. Use the default track (Closed testing,
   Alpha) or create one. Testers: an email list with at least 12 testers' Google account emails (a few spare
   helps). Countries and regions: the countries your testers are in (or all).
3. **The first build**: run the Android workflow by hand on `main`. Its "Google Play closed test" step uploads the
   App Bundle as a draft release on the closed test. If Play still wants the first bundle uploaded by hand, the
   step's log says so ("NEEDS YOU"): download the run's `golden-hour-android` artifact, and in the closed testing
   track, Create new release, upload `app-release.aab`, Next, Save. After that the workflow uploads each new
   version itself.
4. **App content** (Policy and programs, App content): the answers below.
5. **Store settings**: App category: Weather. Contact details: email legal@bradcowdrey.com, website
   https://bradleycowdrey.github.io/golden-hour/ (the listing workflow sends these too).
6. **Store listing**: filled in by "Google Play listing" (it runs when this folder changes on `main`; run it by
   hand if the listing is empty).
7. **Send for review**: Publishing overview, Send changes for review, then roll out the first release to the
   closed test. Share the test's opt-in link with the testers.
8. **12 testers, 14 days**: at least 12 testers must stay opted in for 14 days in a row. Then Dashboard, Apply
   for production, and answer Google's questions about the test.

**Before sending for review:** the privacy policy URL (https://bradcowdrey.com/legal) must describe Golden Hour's
data, and the Terms in `cowdrey-md/TERMS.md` don't list Golden Hour yet. Section 25 says each new app gets a
column there, and entries in Sections 6 and 15, before release. Add them first: no account, no ads, no
analytics; places, plans and the sunset log stay on the device; coordinates of your places go to Open-Meteo,
OpenStreetMap's Overpass servers and OpenFreeMap; venue searches to Photon; place searches to Open-Meteo; the
app loads from GitHub Pages; location only on "Use my location", approximate on Android.

## Suggested App content answers

Checked against the Android app (`android/`: it shows https://bradleycowdrey.github.io/golden-hour/ and asks
only for approximate location), the web app it shows (`web/app.js`) and the family Terms (Sections 15 and 25,
once Golden Hour is added).

- **Privacy policy**: https://bradcowdrey.com/legal
- **Ads**: No, the app has no ads.
- **App access**: All functionality is available without special access (no account, no login).
- **Content rating**: category "All Other App Types". Violence, sexuality, language, crude humour, gambling,
  fear: No. Controlled substances: Yes to references to alcohol only, and No to showing or encouraging its use:
  the places include bars, pubs and beer gardens, drawn as a glass of wine or a pint. Users interact or exchange
  content: No (no accounts or messaging; Share hands a picture and a link to an app the person picks).
  Shares the user's location with other users: No ("Text a friend where I'll be" opens the person's messaging
  app with the sunset spot's map link, and a shared plan never says where you leave from). Digital purchases:
  No. Web browser or search engine: No (it shows only Golden Hour's own site; other links open in the
  person's browser). The alcohol reference may raise the rating (around Teen / PEGI 12); answering No, as
  for a map that lists venues, would likely give Everyone / PEGI 3. Either fits the 13-and-over audience.
- **Target audience**: 13 to 15, 16 to 17, and 18 and over. Not designed for children; the Terms aren't
  directed at children under 13, and the listing doesn't appeal to children.
- **Data safety**:
  - Collects or shares user data: Yes. Encrypted in transit: Yes (HTTPS only). Accounts: none. Way to request
    deletion: No (nothing is kept by Bradley; places, plans and the log stay on the phone, and Delete plan,
    removing a place, or uninstalling erases them).
  - **Location, approximate**: Collected: Yes. Shared: Yes. Processed ephemerally: No. Optional (you can search
    for a place instead). Purpose: App functionality only. Why: the coordinates of the places you add go to
    Open-Meteo for the forecast, air quality and usual temperatures (rounded to about 1 km), to OpenStreetMap's
    Overpass servers for places to watch from and parking and toilets near them, to Photon as a hint for venue
    searches (about 100 m), and to OpenFreeMap for the map tiles of that area. With "Use my location", that
    place is where you are; Android gives the app only approximate location.
  - **App activity, in-app search history**: Collected: Yes. Shared: Yes. Processed ephemerally: No. Optional.
    Purpose: App functionality. Why: what you type to find a town goes to Open-Meteo's place search, and a venue
    search to Photon. The app keeps no search history itself.
  - Every other type (precise location, personal info, financial, health, messages, photos and videos, audio,
    files, calendar, contacts, web browsing, app info and performance, device or other IDs): not collected. No
    analytics, no crash reporting, no advertising ID.
  - Where Google's definitions leave room for judgement: Open-Meteo, Overpass, Photon and OpenFreeMap aren't
    Bradley's service providers, they're independent public services under their own privacy policies, so
    "Shared: Yes" is the cautious answer (as for the other apps), and since the app can't vouch for their logs,
    "ephemeral" is No. Precise location is No because Android gives the app only approximate location; a spot
    you pin by tapping the map (sent to Overpass to look for parking and toilets nearby) is a place you chose,
    not where your phone is. Calling the town search "search history" is cautious; leaving it out could also be
    argued, as nothing is kept. Things the person does on purpose aren't counted: Share and "Text a friend" hand
    the content to an app they pick; Add to calendar opens their calendar app's new-event screen (the app has no
    calendar permission); "Send it to GitHub", after rating an evening, opens GitHub's issue form in their browser
    with their sunset log filled in, and nothing is posted unless they submit it. The app's pages come from GitHub
    Pages, which sees only standard web requests; a shared plan's details sit after the # in its link and aren't
    sent to the server. Android's own backup may copy the app's storage to the person's Google account; that
    isn't collection by the app.
- **Advertising ID**: No. **News app**: No. **Government app**: No. **Financial features**: none. **Health**: none.
  Golden Hour asks for no background location and runs no foreground service; if Play Console asks, say so.
