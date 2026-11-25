# The App Store look, for every app

One standard for the App Store pictures of every app Bradley Cowdrey publishes (Cowdrey One, Cowdrey.MD,
Cowdrey.PDF, Bearings, Two Degrees, Meridian, Golden Hour), so they match when they sit side by side in
Cowdrey One and on the App Store. The type is Cowdrey One's: Fraunces for the headline, a plain sans below it.
The numbers are those of Bearings' `scripts/store-frames.js`, which Golden Hour's `scripts/store-frames.js` copies.

## iPhone 6.9-inch (1320 × 2868)

| Part | Standard |
|---|---|
| Background | The app's own sky, dark at the top so white words read |
| Headline | Fraunces, weight 560, optical size 72, **124 px**, line height 1.04, tracking −0.004 em, white, centred, two lines; first line's top at 216 px |
| Subhead | Sans (SF Pro on a Mac, Inter elsewhere), semibold 600, **52 px**, one line, white at 90%, 32 px under the headline |
| Side margins for the words | 70 px |
| A line that is too wide | Set smaller in steps of 2 px; it never wraps |
| Phone | Drawn iPhone, body **1024 px** wide, centred, top at **640 px**; titanium rim 1.1% of the body, bezel 3.6%, screen corners 62 pt, Dynamic Island 126 × 37 pt, 11 pt from the top |
| Status bar | 9:41, full signal, Wi-Fi, full battery |
| Screen | The app's real screen, never redrawn |

A small uppercase line above the headline (Bearings has one) is not part of the standard.

## iPad 13-inch (2064 × 2752)

Headline 150 px on one line, subhead 62 px, side margins 140 px, device body 1560 px wide with its top at
600 px. Otherwise as the iPhone.

## Where each app stands (25 November 2026)

| App | Headline face | To do |
|---|---|---|
| Bearings | Fraunces | Remove the small uppercase line; otherwise the standard |
| Cowdrey.MD | Fraunces | Phone to 1024 px at 640 px |
| Cowdrey.PDF | Fraunces | Phone to 1024 px at 640 px; headline to two lines |
| Meridian | Sans | Headline to Fraunces at 124 px; phone to 1024 px at 640 px |
| Two Degrees | Inter semibold | Headline to Fraunces at 124 px; phone to 1024 px at 640 px (it runs off the bottom today) |
| Golden Hour | Fraunces | Built to the standard: `docs/app-store/` |

## Golden Hour's pictures

```sh
scripts/build-web.sh
STORE_SHOTS=/tmp/raw node tests/web.test.js          # the app's real screens, with the stand-in forecast
node scripts/store-frames.js --in /tmp/raw --out docs/app-store
```
