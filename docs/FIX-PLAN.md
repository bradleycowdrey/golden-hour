# Golden Hour: the fix plan

Version 6. Follows the functional review of 24 November 2026.

**Status (version 0.10.0):** releases A, B1, B2 and C are built in one build, as asked, and pass the
automated tests (35 rule tests, 210 browser checks, every failure state forced). Not yet done: the live
pass on a real phone ([PHONE-CHECKLIST.md](PHONE-CHECKLIST.md)), the week with three testers, and a
VoiceOver pass. The iPhone app's back swipe and calendar sheet are written and compile-checked by the
build, but have not been run on a phone.

**One change from the plan as written:** the row of places that scrolled sideways is gone. The page now
shows one place, then up to three more as a list, so nothing on the page scrolls sideways and a swipe
anywhere moves between locations.

## Who it is for

**First: a woman who wants to see the sunset**, tonight or this week. Three people we test against:

- going alone after work, who wants to be back at her car before dark;
- organising a picnic for four friends in a group chat;
- a mum with two children, who needs parking, toilets, an easy walk and to be home by bedtime.

She is not technical and gives the app about ten seconds.

**Second: people who plan sunsets for others** (event planners, photographers, resort staff). They need
exact times on a chosen date at a chosen venue, and something to hand to guests.

## The promise

Open the app and within ten seconds know: go or not, what time, and where. Within three taps, send a plan
to a friend.

## The QA gate (every release)

1. Automated tests pass, including replayed failures: forecast down, places empty, places answering after
   25 seconds, places answering "error" with an empty list, map down, location denied.
2. Live pass on a real iPhone, in the TestFlight build, by the owner, using a written checklist. Nothing is
   called verified that was not run on a phone with real data. (This build environment cannot reach the
   live services; if that is opened up, the live pass is also run here before you see it.)
3. A **Status** page in Settings shows what the app last asked for and what came back, so one screenshot
   tells us what failed on your phone.
4. Three journeys are timed on a phone: alone after work, four friends by group chat, mum with two
   children. Each reaches the answer in under 10 seconds and a sent plan in 3 taps or fewer.
5. Text at the largest phone size, VoiceOver labels and 44-point tap targets are checked.
6. Undo: every release is a numbered version; if it is worse, the previous version is republished and the
   previous TestFlight build stays installable.
7. Before B1 goes to anyone else, and again before B2: three women who match the three people above use
   the TestFlight build for a week. It passes when each sees tonight's answer, picks a place and sends a
   plan without asking anyone, in one try, and says she would use it again. If not, the cause is fixed
   first. (Yours to invite; the app collects no usage data, so this and "How was it?" are how we know it works.)

## Release A: it works (medium)

| Fix | Done when |
|---|---|
| A plan is kept as a draft from the first tap | Open a plan, type a name, go back: it is in Plans with the name |
| Places load even when the forecast fails; the wait is raised from 15 seconds per source to 45 seconds across both; "Looking for places…" shows meanwhile | Forecast blocked: places still appear. Places at 25 s: note shows, then the row fills |
| A failed places answer, including one that arrives marked as an error or with nothing in it, shows "Try again", is not remembered, and retries when the app next opens | Force each; reopen; places load |
| The Where to watch row keeps its place when data refreshes | Scroll it, wait two minutes: position unchanged |
| A failed forecast shows the last good one, marked "Updated 7h ago · Refresh" | Go offline, reopen: yesterday's page, marked |
| A plan is rated on the venue's own forecast | Organiser and guest see the same score for the same plan |
| Share is one tap; nothing waits between the tap and the share sheet (the picture is made beforehand) | One tap from a plan; sheet appears on iPhone |
| Every screen and sheet is a step you can go back from; the iPhone app turns on the back swipe | From each screen and sheet, back returns to the one before |
| Add to calendar works in the iPhone app through the share sheet; the event's reminder moves from 90 to 30 minutes before you leave | Event appears in Calendar with the alert set |
| Swiping between locations works from anywhere on the page; dots are tappable; "2 of 3" shows; with one location a line says "Add another place to swipe between them" | Swipe starting on the places row changes location |

Also in A, each with its own test: "Use my location" twice keeps its position in the list; Plans has a
"New plan" button; a denied location and a timed-out one say different things; the Plans and Places icons
match their meaning; a place added offline keeps correct summer time.

## Release B1: one answer, one tap, getting home (large)

| Change | Done when |
|---|---|
| **One answer at the top**, warm and plain: "Go tonight", "Maybe tonight", or "Not tonight" with the reason and the next good evening ("Not tonight, rain's coming. Try Wednesday."). Go is 3.5 or more, Maybe 2.5 to 3.4, Not tonight below 2.5. Evenings three to five days out add "could change". | Fresh install on a phone: answer, time and place read back in under 10 seconds without scrolling |
| **One time:** "Sunset 4:40 pm · be there by 4:10". Be there by is 20 minutes before best light and means at the spot. The walk in and the drive are counted once, in the plan's "leave by", never in be there by. "Updated 11:10" sits beside it. | Matches the plan's meet time to the minute, and still does after the plan is edited |
| **One place:** your own nearest spot if you have one, otherwise the top easy-to-reach place | Shown on Go and Maybe evenings |
| **Not tonight** shows the next good evening instead of a place, and the button becomes "Plan Wednesday" | No "Plan this evening" on a Not tonight |
| **Score, colour words and range move under "Why"**, one tap down. The number stays there; the stars go. | First screen has no number but the times |
| **One-tap plan** fills in that place and time. You can change the place from the list, the walk in, and an optional "home by" time; the plan says if home-by fits. | Plan made and shared in 3 taps |
| **Getting home:** "Start back by about 5:00 to reach your car before dark (estimate; check in Maps)". That is last light minus your walk; today the app gives last light itself, which is too late. Also whether the walk back is in daylight, twilight or dark, and two buttons: "Text a friend where I'll be" (place, time, leave-by) and, afterwards, "I'm home". We never call a place lit or safe; where the map data doesn't say, it says "Lighting not listed". | A 10-minute walk gives a start-back time 10 minutes before last light; both messages open pre-filled in Messages |
| **Three places to be:** Today, Plans, Places; the bar always visible; a place and a day open as sheets | No screen hides the bar |
| **Plain words everywhere.** No "Outlook", "Forecast", "(typical)" or compass degrees on the first screen. No card contradicts the answer. A note says times assume a flat horizon; hills and buildings can hide the sun sooner. | A reader new to the app explains each word on the first screen |
| **Settings** takes units, privacy, the sunset log, Status and "Send it to GitHub". Places becomes a list and Add. | Places screen fits one phone screen with three locations |
| **"How was it?"** asked once the next morning, dismissible, never shown to someone who only opened a shared plan | Seen once, gone after an answer or dismiss |

## Release B2: places you can trust, plans you can send (medium)

| Change | Done when |
|---|---|
| **Know before you go:** parking and toilets within a short walk (a second map lookup, new; how often the map has them is checked on real places before this is promised), step-free access and dogs, each shown only when the map data says so, "Not listed" otherwise | A place with tags shows them; one without says Not listed once, not four times |
| **Filters** on Places: Parking, Toilets, Short walk (under 10 minutes). Confirmed places come first; if none match it says "None listed with parking and toilets here" and shows the nearest places with those marked "Not listed". | Mum's journey finds a place with parking and toilets in 2 taps, or is told plainly there is none listed |
| **Dining** says "From open map data, not checked", shows hours when known, and the phone button says "Call" | No "Call to book" anywhere |
| **What to bring** on the plan, with a warm layer when the evening turns cold | Cold evening lists a layer |
| **Picture card** of the plan (place, time, be there by, tonight's sky) for any chat; no sign-up, no reply needed | Card sends to Messages and WhatsApp |
| **Send update:** change a shared plan and re-send the card with "Changed: now 5:05" on top | Friends' journey: time changed and re-sent in 3 taps |
| **The week at a glance:** next evenings, one line each, best one marked, shareable as a picture | Sent in 2 taps |
| **Decide-by** for a chosen evening: "Decide by 1:10 pm; forecast last changed 11:10", with wind shown. Decide-by is three hours before be there by: a starting rule, yours to change. | Reads correctly for tonight and tomorrow |

## Release C: a chosen date and venue (medium)

| Change | Done when |
|---|---|
| Any date, months ahead, with exact times; beyond five days: "Times are exact. Colour can't be forecast yet." | Pick a date next June: times shown, no rating |
| Find a venue by name or address | "The Boathouse, Rye" pins the venue |
| Golden hour (sun 6° above to 4° below the horizon) and blue hour as windows with one-line meanings; editable arrive-by and travel time; "Check in Maps"; a note; the direction the sun sets from that spot | Plan shows both windows and the direction |
| "Has it changed?" on every saved plan ("was 4.2, now 3.1"), with another evening suggested | Plans list shows today's answer beside each plan |

## Release D: for hosts (medium)

| Change | Done when |
|---|---|
| Save venues and compare them for one evening (replaces comparing cities) | Three venues side by side for one date |
| Your own venue pinned first, with phone, booking link and a note | It is the first place on Today |

Sunrise, tide and hills that hide the sun are not in this plan. You decide after Release D whether to
add them; until then the app says "Sunrise and tide not included".

## Release E: native iPhone (large)

Leave-by notification, a Home Screen widget with tonight's answer, a calendar that updates itself.

## What goes

The stars, the Compare toggle for cities, compass degrees on the first screen, the "Share Golden Hour"
card, and the moon tiles from the page (the moon stays in Getting home).

## What this app will not do, and says so

No accounts and no server, so: no RSVPs or "who's coming", no live location (it points to your phone's own
Share Location), no reviews or photos of places (it links to Google Maps), and no claim that a place is
lit, busy or safe.

## Order, and why

A, B1, B2, C, D, E. A, B1 and B2 come first because the first audience cannot use the app without them.
One reviewer argued any-date lookup and venue search should ship with A for planners; they lead Release C instead.
