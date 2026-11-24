# Golden Hour: plan and spec

Version 15. An app by Bradley Cowdrey, in the same family as Two Degrees, Bearings and Meridian. Items marked **(verify)** come from memory or secondary sources
and must be checked against primary documentation before they are relied on.

**How to read this.** Sections 1 to 3 and 12 to 15 are the plan: what it is, the order of work, how
success is judged, the risks and the decisions still open. Sections 4 to 11 are the technical spec
a builder works from.

## 1. What it is

**Job.** When an evening is free, tell me by lunchtime whether the sunset is worth going out for, and
hand me a plan I can send to the people coming with me.

**Who.** Designed primarily for women planning an evening for a partner, friends or family. She is
usually the organiser.

**Alternatives today.** A weather app plus a maps app plus a group chat; or a sunset-score app
(Alpenglow, Sunsethue, SunsetWx), which rates the sky and may alert you, but does not plan the
outing.

**Difference.** Golden Hour plans the outing end to end (where, when to leave, what to bring, when
to head home) and shares it with one link, with no account.

## 2. Ground rules

1. No first-party server, no account, no analytics, no API keys. The app is static files.
2. Honest privacy wording: "Golden Hour has no accounts and collects nothing. To get forecasts and
   places, your device sends coordinates to Open-Meteo, OpenStreetMap's Overpass servers and the map
   tile host." Fonts and libraries are self-hosted, so no other third party is contacted.
3. Web app first. iPhone second (it brings the self-updating calendar and notifications). Then Mac
   and Android.
4. Sunset only until Release 5.
5. Signature move: imperial and metric side by side everywhere (temperature, distance, wind,
   elevation), with one setting for which is listed first. Formulas in this document use metric;
   the interface shows wind in mph and km/h.
6. Where the app does not know something, it says so. It never guesses hours, safety or bookings.
7. Published the way the other apps are: free, no ads, open source under the MIT licence, in the
   public repository `bradleycowdrey/golden-hour`, served by GitHub Pages at
   bradcowdrey.com/golden-hour, credited "Bradley Cowdrey · bradcowdrey.com", with the terms at
   bradcowdrey.com/legal.

## 3. Releases and cut lines

Features are force-ranked: releases are in order, and items inside a release are in build order.
Nothing below a cut line starts until the release above it meets its exit measure (section 12).
Acceptance criteria for the next release are written, in the format of section 14, before its cut
line is crossed.

| # | Feature | Depends on | Why it ranks here |
| --- | --- | --- | --- |
| **Release 1 (web): go or skip, and one plan** | | | |
| 1.0 | Design pass: mock-ups reviewed by the owner (section 10.4) | | Fixes the look before the interface is built; the logic of 1.1 to 1.3 proceeds in parallel |
| 1.1 | Places: current location, search, saved places | | Everything is per place |
| 1.2 | Star rating per evening, with parts, reason and warnings | 1.1 | The core promise |
| 1.3 | "How was it?" rating and forecast log, kept on the device | 1.2 | Tuning needs three weeks of evenings, so logging starts first |
| 1.4 | Times: golden hour, best window, sunset, afterglow, last light | 1.1 | Needed by the plan |
| 1.5 | Week: six rated evenings; go, maybe, skip; best evening | 1.2 | "Which day" is the first question |
| 1.6 | Compare places: saved places side by side for the same evenings | 1.5 | "Here or there" is the second |
| 1.7 | Plan for one spot the user pins on the map | 1.2, 1.4 | The differentiator, in its thinnest form |
| 1.8 | What to bring (up to seven items, each with a why) | 1.7 | Turns the forecast into preparation |
| 1.9 | Saved on the device; works offline | 1.7 | Spots often have no signal |
| 1.10 | Share the plan with one link | 1.7, 1.9 | She is the organiser |
| 1.11 | Add to calendar (one-off event) | 1.7, 1.10 | The calendar is the stated goal |
| *Cut line 1* | | | |
| **Release 2 (web): where to go** | | | |
| 2.1 | Spots within about an hour, from open map data | 1.1 | Replaces the hand-placed pin |
| 2.2 | Spot type toggles: nature, common areas, rooftops and restaurants, bars | 2.1 | Owner request |
| 2.3 | View check: does the spot face that evening's sunset | 2.1 | Ranks spots |
| 2.4 | Who is coming: two of us, friends, family | 2.1, 1.8 | Changes ranking and the list |
| 2.5 | Open and closing times, or "check hours"; lit paths, parking, toilets, dogs | 2.1 | A locked gate ruins the evening |
| 2.6 | Plan B when a planned evening's forecast drops | 2.1, 1.9 | Rescues a planned evening |
| 2.7 | "Usually busy" and "quieter" toggles (heuristic) | 2.1 | Owner request; lower because the data is weak |
| 2.8 | One-question survey card after a user's third rating | 1.3 | The Release 2 exit measure |
| *Cut line 2* | | | |
| **Release 3 (web): precision** | | | |
| 3.1 | Sunset time at the spot, allowing for terrain | 2.3 | Corrects arrival time in hilly places |
| 3.2 | More warnings: tide at beaches, strong wind on summits | 1.2, 2.1 | Rare, but they decide the evening |
| 3.3 | Forecast ranges from several weather models | 1.2 | Better ranges |
| *Cut line 3* | | | |
| **Release 4 (iPhone)** | | | |
| 4.1 | Golden Hour calendar on the phone, rewritten as forecasts change | R1 | The self-updating calendar |
| 4.2 | Notifications: "Tonight looks great", "Tonight changed" with plan B | 2.6 | Ongoing updates |
| 4.3 | Widgets | R1 | |
| **Release 5, in order** | | | |
| 5.1 | Mac and Android | R4 | |
| 5.2 | Sunrise | 1.2 | |
| 5.3 | Pick a date ahead for an occasion, with a backup | 1.5 | |
| 5.4 | Dinner or a drink nearby afterwards | 2.5 | |
| 5.5 | Full-moon note: the moon rising opposite the sunset | 1.4 | |
| 5.6 | Last ride home: a link to the local transit operator | 2.1 | |

Not planned, because no open keyless data exists: live crowd levels, live parking, booking a table
inside the app, true drive times, and mapped cliff edges (viewpoints and peaks carry a standing line
instead: "Watch your footing near edges as the light fades").

## 4. The star rating

One score per evening per place, from 0.0 to 5.0.

### 4.1 Inputs

Two Open-Meteo forecast requests per place, both with `forecast_days=8`, `past_days=1`,
`timeformat=unixtime`, `timezone=GMT` and `wind_speed_unit=ms` (the API's default is km/h). GMT makes every point report the same hours; the extra
days make sure six local evenings and the previous 12 hours are covered in every time zone. The
place's own time zone comes from the geocoding result, or from the browser for the current location.

- **P0**, the place. Hourly: `cloud_cover_low`, `cloud_cover_mid`, `cloud_cover_high`,
  `visibility` (metres), `precipitation`, `precipitation_probability`, `weather_code`,
  `relative_humidity_2m`, `apparent_temperature`, `wind_speed_10m`, `wind_gusts_10m`.
- **P50, P100, P200, P300**, four points 50, 100, 200 and 300 km from the place along that evening's
  sunset azimuth, in one multi-coordinate request. Hourly: `cloud_cover_low`, `cloud_cover_mid`,
  `cloud_cover_high`.

And one air quality request at P0, hourly: `aerosol_optical_depth`, `pm2_5`, `us_aqi`
**(verify names)**, with `forecast_days=7`, `timeformat=unixtime` and `timezone=GMT`. It covers about five days in practice.

Open-Meteo defines low cloud as up to 3 km, mid as 3 to 8 km and high as above 8 km. Cloud cover is
a fraction of the sky, not a position, which is why the points toward the sun are sampled.

Why those distances: a cloud at height h is lit from below by sunlight that grazes the ground up to
about √(2Rh) away (R is the earth's radius): roughly 160 km for cloud at 2 km, 280 km at 6 km and
360 km at 10 km. Cloud in that path can cut the light off before it arrives. Low cloud beyond about
150 km is below the viewer's horizon, so it cannot hide the sun itself, but it can still shade the
high cloud overhead. That is why the two block terms below differ.

**Time.** "Sunset" throughout means the time returned by the Bearings `sunTimes` function (the
sun's centre 0.833° below the horizon). Continuous inputs are linearly interpolated between the two
forecast hours that bracket sunset. For `precipitation` and `precipitation_probability`, take the
larger of the two hours. `weather_code` is a category: a rule that names a code applies if either
hour has it. Comfort inputs use sunset plus 30 minutes.

### 4.2 The four parts (each 0 to 1)

The goal is colour in the clouds. Colour therefore carries 70% of the score, and the other three
parts 10% each. A cloudless evening, however clean and calm, is not a Go. (Owner decision, replacing
the earlier 40/20/20/20 split.)

`clamp(x)` limits x to the range 0 to 1.

**Sun visible (S), weight 10%.** Can you watch the sun reach the horizon?

- `blockS` = the largest of: `cloud_cover_low` at P50 and P100; 0.5 × `cloud_cover_mid` at P200.
- S = 1 − clamp((blockS − 20) / 60).

**Air clarity (A), weight 10%.**

- With aerosol optical depth `aod`: A = 1.0 when aod ≤ 0.15; falls linearly to 0.2 at 0.6; falls
  linearly to 0 at 1.0.
- Without it (including day 5 when the air quality forecast has run out):
  A = clamp((`visibility` − 5000) / 25000).
- In both cases subtract 0.15 × clamp((`relative_humidity_2m` − 75) / 20). Floor at 0.

**Colour (C), weight 70%.** Is there cloud to catch the light, can the light reach it, and is the
air clean enough not to wash it out?

- `blockC` = the largest of: `cloud_cover_low` at P50, P100, P200 and P300; 0.5 × `cloud_cover_mid`
  at P200 and P300; 0.3 × `cloud_cover_high` at P200 and P300 (a thick cirrus shield ahead of a
  front dims the light; the 0.3 is a starting value to tune).
- `lit` = 1 − clamp((blockC − 20) / 60).
- `canvas` = the larger of `cloud_cover_mid` and `cloud_cover_high` at P0.
- `canvasTerm` = 0.1 when canvas < 5 (nothing to catch the colour); rises linearly from 0.1 to 1.0
  between 5 and 30; 1.0 from 30 to 70; above 70 it is
  1 − 0.8 × clamp((canvas − 70) / 30) × clamp((blockC − 10) / 40). A solid deck with a clear strip
  toward the sun keeps full marks; a solid deck with no strip falls to 0.2.
- C = canvasTerm × (1 − `cloud_cover_low` at P0 / 100) × (0.4 + 0.6 × lit) × (0.7 + 0.3 × A).

**The colour class.** C is shown as a score out of 100 with a name, directly under the stars and
beside every score in the app:

| Colour score | Class |
| --- | --- |
| 85 to 100 | Brilliant |
| 65 to 84 | Rich |
| 45 to 64 | Warm |
| 25 to 44 | Soft |
| 0 to 24 | Muted |

**Comfort (K), weight 10%.** K = (0.6 × wind + 0.4 × temp) × rain.

- `w` = the larger of `wind_speed_10m` and 0.7 × `wind_gusts_10m`, in m/s.
- wind = 1 − clamp((w − 3.5) / 5.5). Full marks at or under 3.5 m/s (8 mph), zero at 9 m/s (20 mph).
  These are thresholds on the forecast wind, which is measured at 10 m; wind at seated height is
  roughly 0.7 of that **(verify)**, so 3.5 m/s forecast is about 2.5 m/s where people sit, the level
  the Lawson criteria used in building design treat as suitable for long sitting.
- temp compares `apparent_temperature` with the place's evening normal for that date (section 4.5).
  d = apparent − normal. temp = 1.0 when −3 °C ≤ d ≤ +4 °C; falls linearly to 0 at d = −12 °C and at
  d = +10 °C. Whatever the normal, temp is at most 0.5 when apparent is below 0 °C or above 35 °C.
- rain = 0.5 when `precipitation_probability` > 50, otherwise 1.

### 4.3 The score

- sky = 0.70 C + 0.10 S.
- gate = clamp(sky / 0.30).
- **score = 5 × (sky + gate × (0.10 A + 0.10 K))**, rounded to one decimal.
- The gate means clean air and a pleasant evening only count when there is a sky worth watching.
  Comfort can take away at most half a star and can never lift a dead sky.
- **Cap at 1.5** when any of these holds at sunset: `precipitation` ≥ 0.2 mm with `weather_code`
  51 to 67, 71 to 77, 85 or 86; fog (45 or 48); thunderstorm (95 to 99); or `cloud_cover_low` ≥ 85
  at P0, P50 and P100. Rain showers (80 to 82) are not capped: broken showers can give the best
  skies.
- The four parts are always available on tap, with their inputs.

Worked examples, used as golden test vectors (`tests/fixtures/vectors.json`). Unless a row says
otherwise: humidity is 75% or less, gusts are no more than 12.8 m/s, and there is no cloud at the
upstream points.

| Evening | C | Class | S | A | K | gate | Stars |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50% high cloud, clear to the west, clean air, calm, normal temperature | 1.00 | Brilliant | 1.0 | 1.0 | 1.0 | 1.00 | 5.0 |
| Cloudless, clean, calm | 0.10 | Muted | 1.0 | 1.0 | 1.0 | 0.57 | 1.4 |
| Row 1 with wind at 9 m/s | 1.00 | Brilliant | 1.0 | 1.0 | 0.4 | 1.00 | 4.7 |
| 50% high cloud, 80% low cloud 100 km to the west | 0.40 | Soft | 0.0 | 1.0 | 1.0 | 0.93 | 2.3 |
| Hazy (aod 0.6), 40% mid cloud, calm | 0.76 | Rich | 1.0 | 0.2 | 1.0 | 1.00 | 3.8 |
| 84% low cloud everywhere, clean, calm | 0.01 | Muted | 0.0 | 1.0 | 1.0 | 0.01 | 0.0 |
| 95% high cloud, clear strip to the west | 1.00 | Brilliant | 1.0 | 1.0 | 1.0 | 1.00 | 5.0 |
| 95% high cloud, 60% low cloud 300 km to the west | 0.20 | Muted | 1.0 | 1.0 | 1.0 | 0.80 | 2.0 |

Tuning candidates for the first hindcast: the 0.7 + 0.3 × A haze term; where the class boundaries
sit; and temp comparing a feels-like temperature with an air-temperature normal.

### 4.4 Verdict, lead time and ranges

Tiers are defined by evening, counted in the place's local calendar. Day 0 is today.

| Evening | Label | Shown as | Typical range |
| --- | --- | --- | --- |
| Day 0 | Tonight | One decimal | ± 0.5 |
| Days 1 and 2 | Forecast | One decimal | ± 0.8 |
| Days 3 to 5 | Outlook | Nearest half star, outlined stars, "may change" | ± 1.2 |
| Days 6 to 9 | Not rated | Sunset time and "Too early to call" | |

- The ranges are placeholders, labelled "typical" in the interface. After the hindcast each is
  replaced by the measured error that 70% of evenings fell within, per tier.
- Range format: "3.6, likely 3.1 to 4.1", limited to 0.0 to 5.0.
- **Go** at 3.5 or above. **Maybe** from 2.5 to 3.4. **Skip** below 2.5. Each has a word and an icon
  as well as a colour.
- For Tonight and Forecast, when the range crosses a threshold the verdict names the nearer one:
  "Go, could slip to Maybe", "Maybe, could reach Go", "Maybe, could slip to Skip", "Skip, could
  reach Maybe". Outlook verdicts carry only "may change". Capped evenings get no qualifier.
- **A day's detail** opens in a sheet over the location's page (Done, arrows and a sideways swipe between
  evenings; Escape closes). The page underneath always shows tonight, or tomorrow once tonight is over.
- **Where to watch**: a row of places to swipe through sits straight under the rating: your own spots, then
  the top of each kind in turn. A place's screen links to Google Maps for photos and reviews.
- **After "How was it?"** a card offers "Send it to GitHub": a pre-filled public issue with the date, the
  location's name, the forecast, its four parts and what you saw.
- **What's behind the score** is folded away on a location's page: one row shows or hides the tiles, and
  the choice is remembered. A day's sheet always shows them.
- **Good and Great**: in the list of evenings, every Go evening is marked Good, or Great when its score is
  4.5 or above. No single evening is called best.
- After last light the Tonight screen shows the next evening, but tiers do not shift until local
  midnight: until then that evening keeps the Forecast label and range. 
- Spots of type beach, pier or peak add 0.3 to the range, with the note "Coastal and mountain cloud
  is hard to forecast."
- Release 3.3 replaces the ranges with the spread of the score across weather models, using
  Open-Meteo's `models=` parameter. Each model multiplies the request cost.

### 4.5 Evening normal

Fetched once per place and kept permanently: Open-Meteo archive API, daily `temperature_2m_max` and
`temperature_2m_min`, 1991-01-01 to 2020-12-31. For each day of the year, average each over that day
± 7 days across the 30 years. Evening normal = min + 0.65 × (max − min); the 0.65 is a starting
approximation to tune. Until the fetch completes, temp = 1.0 from 10 to 27 °C apparent and falls
linearly to 0 at 0 °C and at 35 °C.

### 4.6 The reason sentence and warnings

The reason is at most 90 characters, cause first, no hype. The first matching row wins. A modifier
is appended after a semicolon when one applies. Capped rows take no modifier.

| Condition | Sentence |
| --- | --- |
| Capped: thunderstorm | Thunderstorms nearby: one to skip. |
| Capped: rain or snow | Rain will likely hide it. (or "Snow") |
| Capped: fog | Fog will likely hide it. |
| Capped: low overcast | Low cloud will likely block it. |
| Smoke: `pm2_5` > 35 µg/m³ and aod > 0.5 | Smoky: a red sun, muted sky. |
| S < 0.4 | Cloud to the west will likely hide the sun. |
| C ≥ 0.8 and S ≥ 0.6 | High cloud should catch the colour; clear to the west. |
| C ≥ 0.6 and S < 0.6 | Colour likely overhead, though the sun may slip behind cloud. |
| canvas < 5 | Clear sky: no cloud to catch the colour. |
| Low cloud at P0 ≥ 40 | Low cloud may block some of it. |
| canvas > 70 | A thick cloud layer may mute it. |
| Otherwise | Some cloud to catch a little colour. |

Modifiers, first that applies: A < 0.5 "hazy"; wind < 0.5 "breezy: 18 mph · 29 km/h"; temp < 0.5
"cold for the time of year" or "hot for the time of year"; rain = 0.5 "showers possible". If the
sentence would pass 90 characters, the second unit is dropped.

**Warnings in Release 1**, shown as a labelled line under the reason, never as a score:

- Thunderstorm: `weather_code` 95 to 99 in either hour. "Thunderstorms forecast. Avoid exposed
  ground."
- Air quality: `us_aqi` above 150. "Air quality is unhealthy this evening."

## 5. Times

All from solar altitude, using the Bearings `sunPosition` and `sunTimes` functions. Altitudes in this
table are geometric altitudes of the sun's centre, without refraction.

| Name | Definition |
| --- | --- |
| Golden hour starts | Sun at +6° |
| Best window | Sun from +1° to −3° |
| Sunset | As returned by `sunTimes` (later, the terrain-adjusted time, section 9) |
| Afterglow | From sunset until the sun is 4° down. High cloud is lit from below until about 3° |
| Last light | End of civil twilight, sun at −6° |

- No sunset or no sunrise on the date: "No sunset here on this date", not rated.
- The sun sets but never reaches −4° or −6°: afterglow and last light show "Twilight all night".

## 6. The plan

### 6.1 Plan times

- `walkIn` minutes: entered by the user in Release 1 (default 5); from the spot in Release 2.
- Start: the device location when allowed, otherwise the selected place. It is shown on the Plan
  screen as "Leaving from", can be edited there, and is never shared.
- `travel` minutes: great-circle distance from the start to the spot × 1.4, at 30 km/h under
  10 km, 50 km/h from 10 to 40 km, 80 km/h beyond. Rounded to 10 minutes and always written
  "about". The Maps hand-off gives the real figure.
- `buffer` = 10 minutes, plus 15 when the score is 4.0 or more or the day is Friday to Sunday
  (busier parking).
- **Meet at** = start of the best window − 20 minutes.
- **Leave by** = meet at − walkIn − travel − buffer. Shown only to the person who made the plan.
- **Stay until** = end of afterglow. Copy: "The best colour often comes after the sun is down."
- **Head back by** = last light, or 15 minutes before a known closing time, whichever is earlier.
- On "twilight all night" dates, stay until is sunset + 45 minutes and head back by is sunset + 90
  minutes.
- Restaurants and bars (Release 2): "Book for [sunset − 60 minutes]. Ask for a west-facing or
  terrace table."

"Within about an hour" means `travel` ≤ 60. Farther spots (to 90) appear only when their score is at
least 1.0 higher than the best spot inside the hour.

### 6.2 What to bring

A checklist that persists on the device. Rules use the weather at sunset + 60 minutes unless stated.
Rows are in priority order; when more than seven apply, the first seven are shown. The user can add
their own items, which do not count toward seven. Each item can carry a person's name.

| Item | Rule | Why line |
| --- | --- | --- |
| Booking | Spot is a restaurant or bar | "Worth booking", with phone or website when known |
| Coat | Apparent temperature below 10 °C (50 °F) | "48°F · 9°C an hour after sunset" |
| Warm layer | Apparent temperature 10 to 16 °C (50 to 61 °F) | Same form |
| Windproof layer | `w` above 4.5 m/s (10 mph) | "Breezy: 14 mph · 23 km/h" |
| Torch or phone light | walkIn of 5 minutes or more, or head back by is later than sunset + 20 minutes | "The walk back is after dark" |
| Waterproof mat | Outdoor spot, and 1 mm or more of rain in the last 12 hours | "The ground will be wet" |
| Blanket or chairs | Outdoor spot | |
| Insect repellent | Apparent temperature ≥ 13 °C (55 °F), `w` under 3 m/s, spot is a beach, pier or park | "Calm and mild near water" |
| Water | walkIn above 15 minutes | |
| Sunglasses | S above 0.5 | "The sun will be low and bright" |
| Snacks | Who is coming = family (Release 2) | |

When the forecast changes: ticked items stay; newly triggered items appear marked "New"; an
unticked item whose rule no longer holds is removed, unless it carries a name.

### 6.3 Who is coming (Release 2)

A segmented control, defaulting to the last choice.

- **Two of us**: no change to ranking.
- **Friends**: common areas, restaurants and bars rank higher.
- **Family**: spots with walkIn of 10 minutes or less, toilets within 300 m and step-free access
  rank higher where the map data says so. This overrides "stay until", which becomes sunset + 15
  minutes, with the afterglow shown as optional.

### 6.4 Plan B (Release 2)

Triggered when a saved plan's evening drops from Go to Maybe or Skip, or falls by 1.0 or more.
The app offers, in order: the best-scoring spot within the hour whose score is 3.5 or more;
otherwise the next Go evening at the same spot. On the web it appears as a banner on the plan when
the app is opened. On iPhone it arrives as a notification. Choosing plan B makes a new plan and a
new link; see 8.1 for what holders of the old link see.

### 6.5 After-dark information, stated as facts

| Fact | From | Release |
| --- | --- | --- |
| The walk back, in minutes | walkIn | 1 |
| Time of last light | Section 5 | 1 |
| Whether the moon is up at head-back time, and how full | Bearings `moonPosition`, `moonPhase` | 1 |
| Closing or gate time | `opening_hours` | 2 |
| Whether the path is lit | `lit` tag | 2 |
| Distance to parking and toilets | Second map query | 2 |

Standing line from Release 2: "Based on open map data, which may be out of date." The app never
calls a place safe and never scores safety.

## 7. Spots (Release 2)

### 7.1 Source and query

OpenStreetMap through the Overpass API. One query per place per radius R (metres):

```
[out:json][timeout:25][maxsize:33554432];
(
  nwr(around:R,LAT,LON)[tourism=viewpoint];
  nwr(around:R,LAT,LON)[natural=beach];
  nwr(around:R,LAT,LON)[natural=peak][name];
  nwr(around:R,LAT,LON)[man_made=pier];
  nwr(around:R,LAT,LON)[leisure=park][name];
)->.outdoor;
(
  nwr(around:15000,LAT,LON)[amenity~"^(bar|pub|restaurant|cafe)$"][outdoor_seating~"^(yes|rooftop|roof|terrace|balcony)$"];
  nwr(around:15000,LAT,LON)[amenity~"^(bar|pub|restaurant|cafe)$"][rooftop=yes];
)->.venues;
.outdoor out center tags 150;
.venues out center tags 80;
```

- R = 15000 first. Then 40000 and 80000 with the venues block, parks and piers removed and `[name]`
  required on viewpoints and beaches. Overpass does not sort by distance, so a result of exactly
  150 is treated as truncated and the ring is queried again as four quadrant bounding boxes, in the
  form `nwr(S,W,N,E)[...]`. Results are de-duplicated by OSM type and id across radii. The `rooftop`
  key is **(verify)**.
- When a spot is opened, a second query: `[out:json][timeout:10];
  nwr(around:500,LAT,LON)[amenity~"^(parking|toilets)$"]; out center tags 20;`
- Two public endpoints with failover (`overpass-api.de` and one mirror, **verify current list**). On
  HTTP 429 or 504: one retry on the other endpoint, then stop and show the state in 10.3. Never a
  retry loop.
- Results are kept for 14 days per place.
- Tags read: `name`, `opening_hours`, `lit`, `wheelchair`, `fee`, `dog`, `phone`, `website`,
  `direction`, `wikipedia`, `wikidata`. A spot's detail shows dogs, fee and step-free access when
  the tags exist.
- Rooftop tagging is sparse. Expect few venue results outside large cities. User-pinned spots are a
  first-class source in every release.

### 7.2 Toggles

| Toggle | Map data |
| --- | --- |
| Nature | Viewpoints, peaks, beaches |
| Common areas | Parks, piers |
| Rooftops and restaurants | Restaurants and cafes from the venues set |
| Bars | Bars and pubs from the venues set |
| Usually busy (heuristic) | Venues, plus outdoor spots with a `wikipedia` or `wikidata` tag |
| Quieter (heuristic) | Outdoor spots without those tags |

The two heuristic toggles are labelled "likely" in the interface.

### 7.3 Scoring and ranking

- Spots within 15 km of the place use the place's own forecast and score.
- Farther spots are grouped by 0.1° cell. Only the ten best candidates by type, view check and
  distance get their own forecast, fetched when the Spots screen is opened and cached like any
  other.
- Order: score; view check (pass, not checked, fail); travel; then the who-is-coming preferences.

**View check (2.3).** One elevation request for nine points: at the sunset azimuth and 30° either
side, each at 0.5, 1 and 2 km.

- Beach, pier: passes when all nine are within 1 m of each other and none is higher than the spot
  (open water toward the sun). Otherwise fails.
- Park: passes when the horizon angle over the nine points (the formula in 9.1) is under 2°;
  otherwise "View not checked", because the elevation data includes trees and buildings.
- Viewpoint: passes when its `direction` tag is within 60° of the sunset azimuth; fails when the
  tag points elsewhere; "View not checked" when there is no tag.
- Peak: passes.
- Venue: "View not checked".

### 7.4 Hours (2.5)

`opening_hours` is parsed with the open-source opening_hours.js library, self-hosted. Three
outcomes only: "Open until 9:00 pm", "Closes before sunset", or "Check hours".

## 8. Sharing and calendar

### 8.1 Share link (1.10)

- State lives in the URL fragment (after `#`), which browsers do not send to any server.
- Encoding: base64url of the UTF-8 bytes of compact JSON with a version field (`v:1`). Under 2,000
  characters: why lines are not encoded, and custom items are limited to ten of 40 characters each.
- Contents: spot name and coordinates, date, **meet at, sunset, stay until, head back by**, the
  bring list with names, the walk in (it belongs to the spot), and the score when shared. Never
  leave-by, travel or any start point: those would reveal roughly how far away the organiser lives.
- Every string decoded from a link is untrusted and is rendered as text, never as HTML.
- Before sharing: "Anyone with this link can see the place, time and names."
- Recipient view: read-only, no install. The spot with a map link, the four times, the whole bring
  list grouped by name, after-dark facts, the live score when online, "Plan as of [time]", and Add
  to calendar.
- A link is a snapshot. If the live score for that evening is now Maybe or Skip, the recipient sees
  "The forecast has dropped since this plan was made. Check with whoever sent you this." When the
  organiser switches to plan B she sends a new link.
- The same link serves for letting someone at home know the plan. There is no separate feature.

### 8.2 Add to calendar (1.11)

A `.ics` file built in the browser:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Bradley Cowdrey//Golden Hour//EN
BEGIN:VEVENT
UID:<plan id>@goldenhour
DTSTAMP:<now, UTC>
DTSTART:<start, UTC>
DTEND:<head back by, UTC>
SUMMARY:Sunset at <spot name>
LOCATION:<spot name> (<lat>, <lon>)
DESCRIPTION:<times, bring list, share link>
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:Sunset at <spot name>
TRIGGER:-PT90M
END:VALARM
END:VEVENT
END:VCALENDAR
```

- CRLF line endings; lines folded at 75 octets; in text fields backslashes are escaped first, then
  commas, semicolons and newlines (RFC 5545).
- `DTSTART` is leave-by for the organiser's own event and meet-at for an event added from a shared
  link.
- Delivery: when `navigator.canShare({files})` is true, the share sheet; otherwise a file download.
  iOS Safari and Android Chrome behaviour is **(verify on devices)**, and acceptance criterion 1.11
  is the test.
- A Google Calendar link as well **(verify the template URL format)**.

## 9. Terrain and extra warnings (Release 3)

### 9.1 Terrain-adjusted sunset (3.1)

- One Open-Meteo elevation request: 100 points spaced logarithmically from 0.1 to 60 km along the
  sunset azimuth (Copernicus 90 m data). When the spot stands more than 300 m above the average of
  that profile, a second request of 100 points, logarithmic from 60 to 150 km, extends it, because a
  high viewpoint sees much farther.
- Horizon angle = the largest, over the points, of atan((hᵢ − h₀ − 2 m − dᵢ² / (2 × 7/6 × R)) / dᵢ),
  where h is elevation, d is distance, and 7/6 R allows for refraction.
- Sunset at the spot is when the sun's apparent upper edge (geometric centre altitude + refraction
  + 0.267°) falls to that angle. Refraction in degrees = 1.02 / tan(a + 10.3 / (a + 5.11)) / 60,
  with a the geometric altitude in degrees and the tan argument in degrees: about 0.48° at a = 0
  and 0.57° when the sun appears on the horizon (a ≈ −0.57°). Use only for a above −2°
  **(verify the formula, or reuse the Bearings `astroRefraction` function)**.
- The sun's direction shifts as it descends, so the profile is recomputed at the azimuth of the
  found time, twice.
- Cached per spot per 2° of azimuth. Trees and buildings are not in the data, and the copy says so.
- It changes "meet at". It does not change colour timing, which depends on the clouds.

### 9.2 Warnings (3.2)

- **Tide**, beaches and piers only: Open-Meteo marine API, hourly `sea_level_height_msl`
  **(verify)**. Shown as "Tide rising" or "Tide falling" at sunset, "approximate", and hidden when
  the API returns no data for the point. The model grid is about 8 km and is unreliable in bays and
  estuaries, so no heights are shown.
- **Summit wind**, peaks only: `wind_gusts_10m` above 12 m/s (27 mph). "Strong gusts on exposed
  ground."

## 10. Screens, flows and states

### 10.1 Screens

The layout follows Two Degrees on the iPhone (itself after Apple's Weather): **one full page per
place, swiped between, each on its own evening's sky**, with a bottom bar. (Owner decision; this
replaces the earlier Tonight, Week and Plans tabs.)

1. **A place's page.** One page per saved place, the full width of the screen. Swipe left or right
   (or use the arrow keys, or tap a dot) to change place; each page scrolls up and down on its own
   and keeps its position. From top to bottom: the evening's name and the place; the score as a
   large numeral with five proportionally filled stars; the colour class; the verdict; the range;
   the reason; any warning; "Plan this evening"; the times strip; **the next ten evenings** (six
   rated, four "Too early to call", the best one badged); and **the tiles**.
   The page is laid out as Two Degrees lays out a city, and should be read beside it:
   - **The reading**, straight on the sky: the place at 34 px, then the day, then the score in thin
     type at about 100 px with "/ 5" beside it, the stars, the colour class ("Rich colour · 84"), the
     verdict, and the range. No pills or boxes.
   - **The evening** card: one sentence (the reason), then a column for each of the five moments
     with a small sun-and-horizon glyph and the time.
   - **The next ten evenings**: one line each, as Two Degrees shows ten days: the day, the verdict
     icon and word, the score, a bar for the colour score on one shared scale, and the colour class
     over the sunset time. Outlook rows are dimmed. Each Go evening is marked Good or Great under its day.
   - **The tiles**: every input to the score as its own frosted card, with an accent on its title
     and a faint glow, a large reading, a graphic, and one line of what it means. **Every tile has
     a graphic.** Three run the full width because together they make the colour: Colour (the sky
     as forecast in miniature, and a scale from Muted to Brilliant), Cloud cover (high, mid and low
     as three bars) and Toward the sunset (a column of cloud at each of four distances, from you to
     the sun). The rest sit two across (three, then four, where there is room): Air clarity,
     Visibility, Wind (a compass), Feels like (against the usual), Rain, Humidity, Sunset (the
     sun's path and where it meets the horizon).
   - **The moon's tiles**, after the sunset's: Moon (wide: the phase drawn large, how much is lit,
     the day of the lunar month, the month as eight moons with tonight's ringed, and when it is next
     full and new); At sunset (wide: the whole horizon, north round to north, with the sun where it
     goes down and the moon where it is, and a note to turn around when a full moon is rising
     opposite the sunset); Moonrise and Moonset (time, compass direction, and how they fall against
     sunset); Moonlight (how much light it gives for the walk back); and Distance (near or far
     this month, and supermoons). The rise shown is the one that brought the moon up if it is up at
     sunset, otherwise the next; the set shown is the next after sunset.
2. **The bottom bar.** Plans on the left, a dot for each place in the middle (an arrow for the
   current location; a count such as "3 of 12" beyond seven places), and Places on the right.
3. **Places.** The list of places, each a card with a swatch of its sky, tonight's score, colour
   class, verdict, sunset time and reason. Search to add a place, "Use my location", Edit to remove,
   the units switch, and "Compare places": a grid of one row per place and one column per rated
   evening.
4. **Plans.** A list of saved plans, soonest first. Empty state: "No plans yet. Pick an evening to
   start one." Past plans move under "Earlier".
5. **Plan.** The spot on a map, the plan times as a timeline, the bring checklist, after-dark
   facts, then Share, Add to calendar and Directions.
6. **Spots** (Release 2). A list and a map, reached from a place's page.

From 900 px wide a place's page has two columns: the evening on the left, its details on the right.

### 10.1a Golden Hour Places (owner redesign, version 0.8)

The flow is: see what the evening brings, see where you could go, make a plan. So every location's page
ends with **Golden Hour Places**: the top three of each kind, each row opening the place on its own
screen, and "See all Golden Hour Places".

- **Golden Hour Places** (the full screen) has four parts, each showing its top five with "Show more":
  1. **Landmarks**: well-known spots that are easy to reach (viewpoints, piers, beaches, notable parks).
  2. **Adventurous**: places that take effort (summits, high viewpoints), marked medium or high effort.
  3. **Dining with a view**: bars, restaurants and cafés with a terrace, a rooftop or a view in their
     name, marked "May need a booking".
  4. **Your spots**: places the user has saved or added (name, kind, a pin), kept on the device.
- **Ranking.** Open map data has no ratings or reviews, so "what most people agree on" is approximated
  from what it does have: places with a Wikipedia or Wikidata entry and places named for the sunset first,
  then the kind of place, a viewpoint that faces the sunset, a rooftop, then the nearest. The screen says
  so. Effort is estimated from height above the location (over 250 m: medium; over 600 m: high).
- **Source.** One Overpass query per location (`spotsQuery` in core.js), cached for 14 days, with two
  public endpoints in turn. A sample location shows bundled sample places and asks nothing of the network.
- **A place's screen**: its kind and effort; Plan this evening here (which fills in the plan with the
  place, its kind and a walk-in time from its effort); Directions; a map; tonight's rating; what the map
  data knows (elevation and height above town, opening hours, fees, dogs, step-free access); its website
  and a call-to-book link where known; Share; and Save to your spots.
- **Sharing.** A share button at the top of every location shares that evening's sunset in one tap: a
  sentence, a link that opens the app on that location (`#l=name~lat~lon~tz`), and, where the phone
  accepts files, a picture of the sky with the score and times (drawn ahead of the tap, because phones
  only open the share sheet straight from a tap). Every place has a share button (`#s=` link that opens
  that place). Locations and Golden Hour Places offer "Share Golden Hour".
- **Each place has a picture of its kind**: an illustrated icon on a tile coloured for its part (warm for
  landmarks, green for adventurous, violet for dining, pink for your spots), with its rank in a white
  chip on the corner. There is one icon for each kind: viewpoint, beach, pier, park, garden, lake,
  lighthouse, lookout tower, cliff, harbour, landmark, summit, restaurant, bar, pub, café, beer garden
  and rooftop, and a pin for anything else. The query also finds lighthouses, observation towers,
  marinas, cliffs, and notable gardens and lakes.
- **The cards are tiles**: each part has its own accent (a glow at the top and a coloured title), effort
  is a tinted pill (green easy, amber medium, red high, violet "May need a booking", pink your spot),
  and the parts sit side by side where there is room (three across from 1,000 px).
- The saved cities are now called **Locations**; "Golden Hour Places" means places to watch from.
- **The evenings ahead** lists only the rated evenings, then one line: "[Day, date] and beyond: too
  early to call".

### 10.2 The plan flow

**Release 1**, four taps to a saved plan: (1) Plan this evening; (2) drop a pin on the map, or use
my location; (3) name it and set the walk in; (4) Save. Share and Add to calendar are one tap each
from the saved plan, followed by the notice and the system share sheet.

**Release 2**, four taps: (1) Plan this evening; (2) who is coming, preselected; (3) pick one of
three ranked spots, or pin your own; (4) Save.

Tapping any rated evening on a place's page shows that evening with the same "Plan this evening"
button.

### 10.3 States

| State | What the user sees |
| --- | --- |
| First run | A bundled sample city's page labelled "Sample", with "Add a place", which opens search and "Use my location" |
| Location refused | "Search for a place instead." Nothing else changes |
| Loading | Card skeletons on the sky |
| Offline | Cached forecast with "Updated 2 h ago". Saved plans open with a saved map image |
| Forecast older than 3 hours | The score greyed, with "Out of date. Reconnect to refresh" |
| Forecast request failed | The last cached score, or "Couldn't reach the forecast. Try again" |
| Daily request ceiling reached | Cached scores with "Refreshing again tomorrow" |
| Storage blocked or full | "Plans can't be saved in this browser mode" |
| No spots, or spot lookup failed | "No listed spots within an hour. Pin your own, or try again later" |
| Share link incomplete or from a newer version | "This plan link is incomplete. Ask for it again" |
| Plan's date has passed | Read-only, under "Earlier", with "How was it?" |
| Planned evening dropped (Release 2) | The plan B banner (6.4) |
| No sunset on this date | "No sunset here on this date" |
| After last light | Tonight rolls over to tomorrow, and "How was it?" is offered for today |
| Twilight all night | Tonight rolls over at local midnight |

### 10.4 Look

**The sky is the sunset.** Behind every screen is a picture of the evening as it might look, drawn
from the forecast, in the manner of Apple's Weather backgrounds. The better the sunset, the more
vivid the screen:

- Five colours run from the top of the sky to the horizon. A flat evening is grey-blue; as the
  colour score rises they deepen to indigo, violet, magenta, red-orange and gold. A cloudless
  evening is a clean dark blue with one band of colour low down. Haze washes everything toward
  grey.
- A soft sun sits on the horizon with a glow around it, as strong as "sun in view" and the colour
  score allow. Rain, fog and solid overcast have no sun.
- Clouds are long, soft bands, as many as the cloud cover says, dusky on top and lit along their
  undersides when light can reach them. They drift slowly (not at all when the reader has asked
  for reduced motion). A bank of low cloud sits on the horizon when there is one; rain and snow
  fall across a wet evening.
- Each place has its own sky, and it fades into the next as you swipe.
- Everything above the lowest fifth of the screen is kept dark enough for white text; the
  brightest colour is at the horizon, where only cards pass over it. The tests draw the sky to a
  canvas and measure the contrast of every piece of text against the brightest pixel behind it.

**Icons** are filled and in colour, after the weather symbols on Apple's platforms: a sun on the
horizon with rays for Go, the sun behind a cloud for Maybe, and for Skip the reason (a cloud, a
rain cloud, or a pale sun on an empty horizon). The five moments of the evening each have their
own: a full sun, a low sun, the sun setting under an arrow, the afterglow, and a crescent moon
with stars.

The owner's brief is a beautiful interface that starts from Two Degrees and goes further. The first
step of Release 1 is a design pass: the mock-ups listed in acceptance criterion 1.0, approved by
the owner before the interface is built. The rules below are
fixed; the mock-ups decide everything else.

- Base: the Two Degrees web app (`two-degrees/web/app.html`): each place on its own sky gradient,
  frosted cards, white text, Inter. The warm near-black of the native apps (`#1A1816`) is the page
  background behind the sky.
- The sky gradient is drawn from that evening's forecast (cloud, colour score, clarity), so a
  five-star evening looks like one.
- Type: hero numeral 72 px on phones and 96 px on desktop, weight 500; titles 20 px; body 16 px;
  captions 13 px. Nothing smaller than 13 px.
- Verdicts: Go is amber `#F4B860` with a sun icon; Maybe is cream `#FFF1E5` with a half-sun icon;
  Skip is muted `#B0A898` with a cloud icon. Each always carries its word.
- Accessibility: WCAG 2.2 level AA. Text over the sky meets 4.5:1 at the gradient's lightest point
  by means of a minimum dark scrim on cards. Outlined stars, icons and the greyed score meet 3:1.
  Tap targets 44 px. Layout reflows at 200% text size. Reduced-motion turns off sky animation.
  Focus order follows reading order. Colour is never the only signal.
- Score for screen readers: "Tonight. 3.6 out of 5 stars, likely 3.1 to 4.1. Go, could slip to
  Maybe. High cloud should catch the colour." The star glyphs are hidden from assistive technology.
- Dual units: first unit at full size, second at 70% on the same line ("68°F · 20°C"). In rows
  narrower than 320 px the second unit moves behind a tap. Screen readers get one sentence.

## 11. Architecture

### 11.1 Shape

The same pattern as Two Degrees and Bearings: `web/app.html` (interface) and `web/core.js` (pure
functions, no network or DOM), built into `docs/` by a script. Inter, MapLibre and opening_hours.js
are self-hosted. Map tiles come from OpenFreeMap, as in Bearings.

`core.js` modules: `sky` (sun and moon, from Bearings), `geo` (bearing, distance, destination
point), `score` (section 4), `times` (section 5), `plan` (section 6), `spots` (ranking and view
check), `horizon` (section 9), `ics`, `share`, `units`.

### 11.2 Data model

IndexedDB database `golden-hour`, schema version 1. Each release that changes a store raises the
version and ships a migration; unknown fields are preserved.

```
places    key id        { id, name, lat, lon, tz, normals? }
evenings  key [placeId, date]
                        { placeId, date, sunsetUtc, azimuth, inputs{...raw values used},
                          parts{c,s,a,k}, gate, score, range, tier, verdict, reason, warnings[],
                          fetchedAt }
spots     key id        { id, source: "osm"|"user", name, type, lat, lon, tags, travelMin,
                          viewCheck, hours }
plans     key id        { id, v, placeId, spot, date, who, walkIn, travel, buffer,
                          times{leaveBy, meetAt, sunset, stayUntil, headBackBy},
                          items[{name, why, done, who?, custom?}], scoreAtSave, mapImage,
                          createdAt }
ratings   key [placeId, date]
                        { placeId, date, predicted, parts, observed(1-5), note?, photo? }
snapshots key [placeId, date]
                        { placeId, date, fetchedAt, score, parts }
cache     key url       { url, body, fetchedAt }
```

Settings and the unit order stay in `localStorage`.

### 11.3 Network, cache and budget

Open-Meteo counts a request as locations × (days / 14) × (variables / 10), and short requests may
not earn less than 1 per location **(verify)**. The budget below assumes they do not.

| Request | Cached for | Cost (call-weights) |
| --- | --- | --- |
| Forecast at P0 | 30 minutes | About 1 |
| Forecast at P50 to P300 | 30 minutes | About 4 |
| Air quality at P0 | 1 hour | About 1 |
| Archive normals | Permanent | About 160, once per new place |
| Elevation profile or view check | Permanent | 1 per call |
| Overpass | 14 days | One to three queries per place |

- About 6 call-weights per place per refresh.
- The place on screen refreshes while the app is open, every 30 minutes, and on return to the tab
  (`visibilitychange`) when its cache is older than 30 minutes. Other saved places refresh when
  selected, or for Compare when older than 3 hours. Weather models update hourly at best, so faster
  polling returns the same numbers. There is no background refresh on the web.
- Per-device ceiling: 300 call-weights a day, not counting normals. Normals are fetched one place
  at a time, at most one a minute.
- "Since this morning": the first fetch after 04:00 local time stores a snapshot. Tonight shows
  "Up 0.6 since this morning" only when one exists; otherwise "since you last looked at [time]".
- Cache keys use coordinates rounded to 0.01°.

### 11.4 Offline

A service worker: cache-first for the app shell only. API responses are cached by the app in the
`cache` store under the rules in 11.3; the service worker does not intercept them, so the request
budget holds. The app calls `navigator.storage.persist()`. When a plan is saved, the map is exported
to an image (MapLibre with `preserveDrawingBuffer: true`), with the OpenStreetMap and OpenFreeMap
credit drawn on it, and stored with the plan, so the plan shows a map offline.

When a new version of the app is available the service worker waits, and the app shows "Update
ready. Reload." The page ships a content security policy that allows scripts and styles from its
own origin only, and connections only to the data hosts named in this document. Known limit, stated in the app's help: iOS can
clear data for sites that are not added to the Home Screen.

### 11.5 Tests

- `node --test` on `core.js` with fixtures, as both existing apps do: the golden vectors in 4.3;
  each part at each threshold; the gate; every cap rule; the interpolation rules for categorical
  and summed inputs; every row of the reason table; times at several latitudes, including a polar
  day and a "twilight all night" date; plan times; bring-list rules and the seven-item limit; the
  share-link round trip, including a hostile spot name; `.ics` output checked line by line.
- Horizon: open sea within one minute of `sunTimes`; one fixture with a known ridge.
- Playwright: every state in 10.3, each plan flow in its stated taps, an offline run, phone, tablet
  and desktop widths, and an automated contrast check on the lightest sky.
- The fixtures are shared with the later Swift and Kotlin ports, as Bearings does.

### 11.6 Credits page

Open-Meteo (CC BY 4.0), CAMS for air quality, Copernicus for elevation, "© OpenStreetMap
contributors" (ODbL), GeoNames (CC BY 4.0), OpenFreeMap, Inter (OFL), SunCalc (BSD), and the MIT
notices for the code reused from Two Degrees and Bearings.

## 12. Measures and learning, with no tracking

| Release | Exit measure |
| --- | --- |
| R1, part 1 | **Hindcast.** Logging starts the day feature 1.2 works, and the rest of R1 is built while it runs. At least 20 evenings across at least two places, each with a photo and a 1 to 5 rating, from two raters where possible. Pass: predicted and observed within ± 1.0 on at least 70%, and no Go evening observed below 2.5. Weights are tuned once, the ranges in 4.4 are replaced with measured ones, then both are frozen for R1 |
| R1, part 2 | Five task tests with target users. Pass: at least four of five decide go or skip within 10 seconds and share a plan within 60 seconds, unaided |
| R2 | In five test cities: at least three real spots returned per city, and no spot that fails the view check ranked above one that passes. And one question, shown as a card after a user's third "How was it?" rating and answered by opt-in email: "How would you feel if you could no longer use Golden Hour?" Pass: 30 replies, 40% or more "very disappointed". If 30 replies have not arrived eight weeks after R2 ships, the owner decides on the replies in hand plus five interviews |
| R3 | Terrain sunset within 5 minutes of observed at three hilly test spots |
| R4 | The calendar event is updated within 2 hours of a verdict change on 9 of 10 test days |

"How was it?" ratings stay on the device. "Send feedback" opens a pre-filled email that the user
chooses to send.

## 13. Risks

| Risk | Type | Mitigation |
| --- | --- | --- |
| The score does not match real evenings | Value | The hindcast gate; parts on tap; honest ranges; nothing rated after day 5 |
| Open-Meteo's free API is for non-commercial use, under 10,000 calls a day from one app | Viability | Golden Hour is free, ad-free and open source, as Two Degrees is, and Two Degrees already uses this API on the same terms. If the app ever carries ads or a price, or nears the daily limit, this must be revisited (decision 1) |
| Overpass quotas are counted per app, and the service often returns 429 or 504 | Feasibility | 14-day cache, on-demand queries only, failover, pinned spots always available. Later: a prebuilt regional extract |
| Too much on one screen | Usability | One verdict above the fold; everything else behind a tap; the task tests |
| Venue data is thin outside big cities | Value | Stated in the empty state; pinned spots; nature spots are well mapped |
| iPhone background refresh is best-effort, so the "living" calendar may lag by hours | Feasibility | Prototype before committing Release 4; show "updated at" in each event |
| A shared link reveals where a group will be | Safety | Fragment-only state, no start point or leave-by time, the pre-share notice |
| Coastal and mountain cloud is poorly forecast | Value | Wider range and a note on those spots |
| Nobody finds it, so there are too few users to learn from | Value | The owner names three launch channels before R1 ships; the eight-week fallback on the survey |
| Terrain data ignores trees and buildings | Value | Said in the copy; the user can nudge the time |

## 14. Acceptance criteria for Release 1

- **1.0** Given mock-ups of Tonight, Week (list and Compare grid), Plans, Plan, the parts sheet, the
  shared-plan view and three states (first run, offline, out of date), at 360 px and 1280 px, on the
  lightest and darkest sky, then every rule in 10.4 passes on each and the owner has approved them.
- **1.1** Given a first visit, when the page loads, then the bundled sample city's evening is shown
  within 3 seconds on a mid-range phone, and search and "Use my location" are both offered. Given
  location is refused, then search still works and no error blocks the screen. Up to 20 saved
  places.
- **1.2** Given a fixture forecast, then the score, parts, gate, verdict, reason and warnings equal
  the golden vectors. Given any evening, when the score is tapped, then the four parts are shown
  with their inputs in both units.
- **1.3** Given the time is after last light, then "How was it?" is offered once for that evening
  and stores a rating beside the predicted score and parts. Nothing is sent anywhere unless the
  user chooses Send feedback.
- **1.4** Given a place and date, then the five times match `sunPosition` and `sunTimes` to the
  minute; a polar date shows the no-sunset state; a midsummer date at 64° N shows "Twilight all
  night".
- **1.5** Given ten evenings, then each rated row shows stars, numeral, verdict, sunset and reason;
  Outlook rows show half stars and a range; unrated rows show the sunset time and "Too early to
  call"; at most one evening carries a best badge.
- **1.6** Given two or more saved places, when Compare is switched on, then each place shows its six
  rated evenings in a grid, and tapping a cell opens that place and evening.
- **1.7** Given a pinned spot and an evening, then the plan times follow section 6.1 and Directions
  opens Apple Maps or Google Maps at the spot.
- **1.8** Given the evening's weather, then the list follows the table in 6.2, shows seven rule
  items or fewer, accepts a custom item, and ticks persist after a reload.
- **1.9** Given a saved plan and no network, when the app is opened, then the plan shows in full
  with its map image and the forecast shows its age.
- **1.10** Given a plan, when Share is tapped, then the notice appears; the link is under 2,000
  characters; decoding it yields no leave-by time, travel time or start point; and it opens to the
  same plan in a private window.
- **1.11** Given a plan, when Add to calendar is tapped on iOS Safari, Android Chrome and a desktop
  browser, then an event appears with the right start, end, alert and description.

## 15. Decisions needed

| # | Decision | Owner | Needed by |
| --- | --- | --- | --- |
| 1 | Keep Golden Hour free with no ads, so that it stays within Open-Meteo's non-commercial terms. Any plan to charge or advertise needs their commercial service first | Bradley | Assumed yes; confirm before R1 launch |
| 2 | Create the public repository `bradleycowdrey/golden-hour` and attach it to the build session | Bradley | Before R1 build starts |
| 3 | Add a Golden Hour page to bradcowdrey.com and a line to the profile's list of free apps | Bradley | Before R1 launch; does not block the build |
| 4 | Confirm "relative to the location" means the sky at that place and direction, and temperature against the local normal | Owner | Assumed; revisit at the hindcast |
| 5 | Weights are 70/10/10/10, colour first | Owner | Decided; fine-tuned at the hindcast |
| 6 | A cloudless evening is not a Go: it scores 1.4 | Owner | Decided |

## 16. Release 1 as built: where it differs from this document

Found while building; each is small, and the tests cover the behaviour as built.

- **Upstream points use tonight's sunset direction for all six evenings** (4.1 says each evening's own).
  The direction moves by under a degree a day, which is a few kilometres at 300 km.
- **The second reason row needs C of 0.6, not 0.8** (4.6). With the formulas in 4.2, C can never reach
  0.8 while S is under 0.6, so the row as first written could not appear.
- **"Send feedback" opens a pre-filled GitHub issue**, not an email (section 12). No address is
  published for the app; the user still reviews and chooses to send.
- **"How was it?" has no photo** (11.2 lists one as optional). Ratings and the forecast they answer
  are kept; photos can follow.
- **The spot's kind is chosen by the user** when pinning (open ground, waterside, summit or venue),
  since Release 1 has no map data to read it from. It drives the bring list and the wider range.
- **A place found through offline search has no time zone in the bundled list**, so its times use a
  fixed offset from its longitude until it is found online.
- **Design pass (1.0).** The interface was built directly and its screenshots serve as the mock-ups
  for the owner's review. Layout changes from that review are expected.
