# Background location for Auto Break: current state and remaining native work

_Last checked against this repository: 14-10-2026. Nothing here has been built or run on a device._

## 1. What the app does today (verified in the code)

| Item | Finding |
|---|---|
| Location source | Browser geolocation (`navigator.geolocation.watchPosition`) in `src/services/location/locationService.ts`, started by `AppLayout` for the employee role only. |
| Android app | Capacitor 8 wrapper (`android/`, appId `com.workpulse.hr`, minSdk 24, target/compile SDK 36). Plugins: `@capacitor/push-notifications` only. |
| Manifest permissions | `INTERNET`, `CAMERA`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`. **No** `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`; no service declared. |
| Result | Location is read **only while WorkPulse is open on screen**. When the app is in the background, the screen is off or the app is closed, no readings arrive: exits and returns are not detected until the employee opens the app again. A normal browser cannot do better. |

GPS becoming unavailable is never treated as leaving the building. An open Auto Break stays open and the admin page shows the location as stale / unavailable.

## 2. What was added in the app code (works now, and ready for a native source)

* `locationService.ingestReading()` is the single entry for every position: duplicate and out-of-order readings are dropped (device timestamp), and readings taken while offline are queued (max 30) and replayed in order on reconnect. Readings older than 15 minutes are kept as history but never move the geofence.
* `locationService.handleResume()` runs when the app comes back to the foreground or the network returns. It replays the queue, takes one fresh reading at once and restarts the browser watcher if it had stopped (for example, permission granted again).
* `src/services/location/nativeBackgroundLocation.ts` switches on **only** if a native Capacitor plugin named `BackgroundGeolocation` is installed. Its readings pass exactly the same rules as browser readings: plausibility, accuracy, 15-minute time window, 2-reading jitter confirmation, WFH and attendance checks. Simulated (mock) locations are refused. Plugin errors become "permission denied" or "location unavailable" states and are never treated as exits.
* A return seen only after a tracking gap (no reading for more than 15 minutes) still ends the break at the first inside reading, the only known time. It is flagged in the `BREAK_END` event (`metadata.tracking_gap`) and on the admin page.

## 3. Remaining native work (not done; must be built and tested on devices)

Decisions needed first (business / legal):
1. Track in the background **only while clocked in**, or whenever the app runs? (Recommended: only while clocked in.)
2. Employee notice and consent text for background location (a privacy requirement and a Play policy requirement).
3. Who supports employees whose phones (OEM battery managers) kill the service.

Then, in this order:

| Step | File(s) | Change |
|---|---|---|
| 1 | `package.json` | `npm install @capacitor-community/background-geolocation` (or an equivalent plugin registered as `BackgroundGeolocation` with `addWatcher` / `removeWatcher`). **Check that the plugin release supports Capacitor 8 before installing**; if it does not, it must be forked and updated, or another plugin chosen and `nativeBackgroundLocation.ts` adapted. |
| 2 | `android/` (generated) | `npx cap sync android`. This regenerates `android/capacitor.settings.gradle` and `android/app/capacitor.build.gradle`; do not edit those by hand. |
| 3 | `android/app/src/main/AndroidManifest.xml` | Add `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (Android 14+) and `POST_NOTIFICATIONS` (Android 13+). Keep fine/coarse location. `ACCESS_BACKGROUND_LOCATION` is **not** needed when a location foreground service is used. Follow the plugin README for its service entry and notification resources. |
| 4 | `android/app/src/main/res/values/strings.xml` | Notification channel name / text required by the plugin (see its README). |
| 5 | `src/services/location/nativeBackgroundLocation.ts` | Confirm the plugin name and the `addWatcher` options and callback match the installed version. The notification text lives in `NATIVE_WATCHER_OPTIONS`. |
| 6 | `src/components/layout/AppLayout.tsx` | If decision 1 is "only while clocked in", start/stop tracking on clock-in/clock-out instead of on layout mount. |
| 7 | Play Console | Foreground-service "location" declaration, prominent disclosure, privacy policy update. |

## 4. Android limitations to document for HR and employees

* **Android 12+**: a foreground service cannot be started from the background. Tracking must start while WorkPulse is visible (clock-in screen).
* **Android 13+**: the notification permission can be refused. The service still runs, but its notification is hidden from the shade.
* **Android 14+**: the service must declare `foregroundServiceType="location"` and hold `FOREGROUND_SERVICE_LOCATION`.
* **App swiped away / force-stopped / phone restarted**: the plugin's callbacks run in the app's web view. If Android or the user kills the app, tracking stops until WorkPulse is opened again. Surviving that would need native code that sends readings straight to the server (with its own secure token handling), which is a separate design.
* **Battery optimisation and OEM task killers** (common on Xiaomi, Oppo, Vivo, Realme, OnePlus, Samsung): they can stop or slow the service. Employees may need to set WorkPulse to "unrestricted" battery use. This cannot be forced by the app.
* **Doze / Battery Saver**: updates can become less frequent. The 2-reading confirmation then takes longer, but the exit time is still the first outside reading.
* **Location switched off**: reported as "Location unavailable". It never starts a break and never ends an open one.

## 5. Security notes

* Readings are still written with the employee's own Supabase session and RLS, as today. A tampered client could still send invented positions. Only server-side evaluation (an Edge Function that receives readings and decides breaks with the service role) closes that gap. That is a larger, separate change.
* `docs/proposals/PROPOSED_break_integrity_guards.sql` (not applied) stops direct API edits from rewriting completed breaks, back-dating breaks or writing durations that do not match their timestamps.
* The persistent notification must state clearly that location is used during the shift.

## 6. Device test plan (staging project only, test accounts only)

On at least Android 10, 12, 13 and 14 (and one Xiaomi / Oppo / Samsung if employees use them):
1. Clock in inside, lock the phone, walk out 2–3× the radius, wait 2 minutes, walk back. Expected: one Auto Break, start ≈ first outside reading, end ≈ first inside reading.
2. Same, with location switched off while outside. Expected: break stays open; admin shows "Location unavailable"; turn location on inside → break ends.
3. Same, with flight mode while outside, then reconnect. Expected: queued readings replayed; start time is the real exit time.
4. Swipe the app away while outside. Expected: no updates (documented limitation); reopening inside ends the break, flagged "return seen after tracking gap".
5. Deny location permission. Expected: no break, "Location permission denied" on employee and admin screens.
