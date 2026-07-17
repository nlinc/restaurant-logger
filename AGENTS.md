# AGENTS.md — Lincoln Eats (restaurant-logger)

> ⚙️ **Self-maintenance rule — do this automatically, every time.** If a change you make alters this repo's **shape** (files, entry points, structure), its **stack/dependencies**, the **build/test loop**, or a **guardrail**, you MUST update the matching section of THIS file in the *same commit* — before the task counts as done. This is not optional cleanup or a follow-up task.

A decision-first AI dining concierge with a lightweight restaurant memory. The
primary experience helps someone choose where to eat now; logging, receipt scan,
maps, taste history, and Dining Circles support that decision loop. Keep changes
conservative and preserve the existing structure.

## Product direction (authoritative)

- **Primary moment:** before the user chooses a restaurant, especially when they
  are indecisive and want a nearby answer quickly.
- **Promise:** deliver useful, real, nearby choices in under 30 seconds. The home
  experience produces three intentional lanes: a reliable match, something new,
  and a smart wildcard.
- **Core loop:** get value first → choose a place → give a one-tap check-in later.
  Logging is secondary; never make historical data entry the admission price for
  a first recommendation.
- **Cold start:** explicit cuisines, typical budget, distance, current mood, and
  location are enough to make starter picks. Taste preferences and the pending
  check-in are currently versioned, per-user `localStorage` data on that device;
  no Firestore profile collection exists.
- **Beta success metric:** weekly sessions where a user taps **Let's go** on a
  recommendation, with one-tap check-in completion as the supporting measure.
- Map, profile charts, receipt scan, and Dining Circles remain useful supporting
  features, but do not move them ahead of the decision flow without an explicit
  product reason.

## Stack (authoritative)

**Vanilla path:** Static HTML/CSS/ES modules served by Firebase Hosting. No build
step. This is NOT a React/Vite/Next/bundler project — do not add a build system,
bundler, or framework unless explicitly asked. `chart.js` is loaded via a plain
`<script>` CDN tag in `index.html`, not an npm dependency.

- Firebase project: `lincoln-eats-77229` (see `.firebaserc`)
- Firebase services in use: Hosting, Firestore, Cloud Functions (2nd gen, `nodejs20`), Auth (Google sign-in)
- Firebase Storage is NOT configured — there is no `storage.rules` and no Storage bucket usage in the app. Don't assume Storage exists.
- Cloud Functions: `functions/index.js` — two `onCall` v2 functions, `recommend` and `scanReceipt`, both call Gemini (`@google/genai`, model `gemini-2.5-flash`) via secrets (`GEMINI_API_KEY`, `MAPS_API_KEY` defined with `defineSecret`). `recommend` supports `chat` and `three_lanes` modes, accepts bounded device-local taste preferences, and validates immediate-decision suggestions against the Google Places API (Find Place + Place Details), distance, price, business status, and duplicate place IDs.
- Browser Google Maps/Places: loaded dynamically in `public/js/app.js` via a `<script>` tag pointed at `maps.googleapis.com/maps/api/js`, using the same key exported as `mapsApiKey` from `firebase-config.js` (that key doubles as the Firebase Web API key — it's a public, referrer-restricted browser key, not a secret). Used for the Feed's address Autocomplete and the Map view's markers.

## Project shape

- App entry: `public/index.html` — 4 views swapped by `data-view` (Tonight, Map, Saved, Profile), plus the Auth screen, the AI concierge modal, and a toast. `data-view="feed"` remains the internal key for Tonight.
- Main client logic: `public/js/app.js` (~2,300 lines) — auth, the decision-first recommendation flow, per-user device-local taste preferences and pending check-in, Firestore CRUD for `saved_places`, Places Autocomplete, receipt scan flow, AI concierge chat, map rendering, profile dashboard/charts, Dining Circles (create/join/leave), and the `escapeHtml()` helper.
- Firebase client config + re-exported Firestore/Auth/Functions helpers: `public/js/firebase-config.js`
- Styles: `public/css/styles.css` (plain CSS, no preprocessor)
- Service worker: `public/sw.js` — network-first for app-shell files, cache name `lincoln-eats-v<N>`
- PWA manifest: `public/manifest.json`, icons in `public/icons/`
- Cloud Functions: `functions/index.js` (the two callables above). `functions/check.js`, `functions/migrate_ratings.js`, `functions/output.txt`, and `scratch/check_data.js` are one-off local admin/debug scripts (direct `firebase-admin` access to inspect/migrate Firestore data) — not part of the app and not part of the routine loop. `functions/output.txt` is gitignored scratch output.
- Security rules: `firestore.rules` (two collections: `saved_places`, `circles`) and `firestore.indexes.json` — no Storage rules.
- Tests: none. No root `package.json`; `functions/package.json`'s `test` script is a stub that always exits 1 — don't treat it as a real check.

## The loop (run before declaring done)

There is no build step and no automated test suite. Before declaring done:

```sh
node --check public/js/app.js       # syntax-check the client bundle
node --check functions/index.js     # syntax-check the Cloud Functions
```

Then verify manually and state exactly what you exercised:
- For any UI change: use the `run` skill (or open `public/index.html` via a local
  static server / `firebase emulators:start --only hosting`) and click through the
  affected view(s) — Feed (log + Activity Feed), Map, Wishlist, or Profile (dashboard
  + Dining Circles) — plus the AI concierge modal and receipt-scan flow if touched.
  Check mobile width.
- For signed-in shell QA without touching Firebase data, serve `public/` locally
  and open `http://127.0.0.1:<port>/?ui-preview=1`. This localhost-only preview
  bypasses Auth, uses an empty in-memory history, and renders sample recommendation
  cards when **Find tonight's picks** is tapped. It must never enable Firebase
  writes or run on a non-local hostname; versioned preview preferences/check-ins
  may still use the browser's localStorage.
- For any Cloud Function change: re-read the affected function end-to-end for the
  auth check, the Firestore query, and the Gemini prompt/JSON-parsing contract —
  there's no emulator-backed test for these. Do not deploy to test; that's a
  production action (see Guardrails).
- If you touch `public/css/styles.css` or `public/js/app.js`, bump the cache-buster:
  the `?v=N` query params in `public/index.html` (`css/styles.css?v=16`,
  `js/app.js?v=16`) AND `CACHE_NAME` in `public/sw.js` (`lincoln-eats-v16`) must move
  together, or phones will keep serving the stale cached version.

Never claim the work is complete without doing this loop and reporting what you
actually checked.

## Guardrails

- **Human owns the push.** Never run `git push` and never run `firebase deploy`.
  A push to `main` auto-triggers the production Firebase deploy, so a push (or a
  manual deploy) IS a production release. Approval of the *work* ("looks good",
  "ship it") is NOT permission to push. Push only on an explicit, literal
  instruction ("push to main", "deploy this"). When done, commit locally, report
  the commit SHA(s), and stop.
- **Surgical changes only.** Keep edits focused on the request. No unrelated
  refactoring, reformatting, or drive-by dependency bumps.
- **Mobile first.** This is a phone-first PWA (`manifest.json` is `standalone`,
  portrait-locked). Verify mobile layout after any UI change.
- **No unescaped `innerHTML` for user data.** This codebase renders cards via
  `innerHTML` template literals (not `textContent`) — that's the established
  pattern, don't rewrite it wholesale. But every interpolated piece of
  user-entered or AI-returned data (restaurant name, tags, notes, order items,
  circle member names, AI reply text) MUST go through `escapeHtml()` (defined near
  the bottom of `public/js/app.js`) before landing in a template string. If you add
  a new field to any card, escape it the same way — an unescaped interpolation is
  a real XSS hole here, not a style nit.
- **Secrets stay out of the repo.** `GEMINI_API_KEY` and `MAPS_API_KEY` are Firebase
  Secret Manager secrets (`defineSecret`), referenced only by name in
  `functions/index.js` — never hardcode a key value there. The Maps/Firebase key in
  `public/js/firebase-config.js` is a public, referrer-restricted browser key by
  design; that one being visible client-side is normal and not a leak.
- **Firestore rules discipline.** `saved_places` docs are owner-scoped by `uid`
  (with a Dining Circle read exception); `circles` updates are restricted to the
  `members`/`membersInfo`/`owner` fields only. If you change either collection's
  document shape, update `firestore.rules` (and `firestore.indexes.json` if you
  add a new compound query) in the same change, and re-read the rule logic
  carefully — there's no rules emulator test harness here to catch a mistake.
- **Prefer non-destructive over destructive.** The app currently has no delete UI
  for logged visits or wishlist items. If you add one, archive rather than hard
  delete and confirm before removing real user content — matches the Lincoln
  Micro-Apps default. (The existing hard `deleteDoc` on `status: 'dismissed'` rows
  in `app.js` is fine as-is; those are disposable AI-recommendation bookkeeping
  rows, not logged visits.)

## Conventions

- Ratings are a 1–3 scale end to end (Love=3 / Will go back=2 / Skip it=1), not
  1–5 — the UI, `scanReceipt`'s inferred rating, and `recommend`'s taste-profile
  math all assume this. Don't "fix" it to a 5-star scale.
- `saved_places.status` is one of `visited` (default/absent), `wishlist`,
  `dismissed`, or `recommended` — status transitions (e.g. wishlist → visited)
  are handled in `app.js` via `findExistingPlace()`; read that function before
  changing how a place moves between states.
- Home recommendations call `recommend` with `mode: 'three_lanes'` and expect at
  most one `reliable`, `new`, and `wildcard` result. Immediate-decision results
  must be Places-verified; it is acceptable to show fewer than three rather than
  pad the response with an unverified or out-of-range restaurant.
- **Let's go** opens Google Maps immediately, saves the place for later, and stores
  a device-local pending check-in. Keep the Maps open synchronous with the tap so
  mobile browsers do not block it as a popup.
- Cloud Functions parse Gemini's response by stripping code fences and slicing
  from the first `{` to the last `}` before `JSON.parse` — both `recommend` and
  `scanReceipt` do this defensively because the model doesn't always honor
  "no markdown." Keep that guard if you touch either prompt.

## Maintaining this file

Update this AGENTS.md in the SAME commit whenever you change the project's shape,
stack, the loop, or a guardrail — e.g. adding a build step, adding Storage usage,
adding a delete feature, or changing the rating scale. A stale AGENTS.md is worse
than none — it makes the agents confidently wrong.
