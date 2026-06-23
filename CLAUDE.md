# CLAUDE.md — Calor-IQ

Context for Claude Code working in this repo. Read `docs/OPTION-B-execution-plan.md`
before starting the native migration work.

## What this is
Calor-IQ (calor-iq.com) — an AI-powered calorie & macro tracking PWA. Solo founder
(Leandro). In Google Play closed testing, heading toward wider launch. Also packaged
as an Android app via Capacitor (package id `com.caloriq.mobile`).

## Stack
- Next.js (App Router) + TypeScript
- Supabase — auth (Google OAuth) + Postgres. NOTE: the client talks to Supabase
  DIRECTLY (auth + all DB reads/writes happen client-side, not through our server).
- Tailwind CSS (dark mode via `darkMode: "class"` — see gotchas)
- Anthropic Claude API for food analysis (server-side, via /api/analyze)
- Stripe subscriptions ($0.49/mo, $4.99/yr) + customer portal
- Vercel — hosting, auto-deploys on push to `main`
- Capacitor — Android packaging. Plugins: @capacitor/app, @capacitor/browser,
  @capacitor/preferences. (cap sync registers them; capacitor.build.gradle +
  capacitor.settings.gradle are generated — commit them.)
- PWA service worker at public/sw.js

## Key paths
- `src/app/[userId]/page.tsx` — main tracker UI (~2,788 lines, single large component).
  Edit surgically; ALWAYS verify line count + key functions before/after edits.
- `src/app/[userId]/BottomNav.tsx` — shared bottom nav for sub-pages
- `src/app/[userId]/NativeResumeHandler.tsx` — native resume handler (mounted in tracker)
- `src/app/[userId]/nutrition/page.tsx` — "Stats" / Nutrition Details page
- `src/app/page.tsx` — login page (Google OAuth; web + native split)
- `src/lib/supabase.ts` — Supabase client + storage adapter (native-durable session)
- `src/lib/db.ts` — typed DB helpers (Profile, Meal, MealType, etc.)
- `src/lib/utils.ts` — sumMacros, date helpers, calorie/protein goal calc
- `public/sw.js` — service worker
- `capacitor.config.ts` — Capacitor config (currently uses server.url — see migration)
- API routes: /api/analyze, /api/feedback, /api/promo, /api/stripe/{checkout,portal,webhook}

## Environment & workflow gotchas (Windows / PowerShell)
- OS is Windows, shell is PowerShell.
- `[userId]` folder brackets are PowerShell wildcards — use `-LiteralPath` with
  Get-ChildItem / file cmdlets, and quote paths in git: `git add "src/app/[userId]/page.tsx"`.
- PowerShell does NOT support `&&` — run commands on separate lines.
- Prefer .py scripts over inline python for patching (quote-escaping pain).
- Repo: GitHub `lkaspary/nutrisnap`. Local path `C:\Users\lkasp\nutrisnap`.
- `tsconfig.tsbuildinfo` is gitignored — never commit it.

## Build gate (ALWAYS before committing)
1. `npx tsc --noEmit`   (no output = clean)
2. `npm run build`      (must end with the route table printed = success)
Only commit if both pass. Commit in logical chunks (separate concerns).
Never run `npm audit fix` mid-change — the repo has long-standing transitive-dep
warnings that are noise; fixing them is a separate, deliberate task.

## Hard-won lessons (do not relearn these)
- SERVICE WORKER: navigations + `/_next/*` hashed assets MUST be network-first; only
  icons/manifest are cache-first. A cache-first navigation serves a stale HTML shell
  after deploy → references deleted JS bundles → blank screen. Bump CACHE_NAME when
  cached assets change. (Current: caloriq-v7.)
- TIMEZONE: never use `.toISOString().split("T")[0]` for LOCAL dates — it shifts
  entries to the wrong day across UTC offset. Use getFullYear()/getMonth()/getDate().
- DARK MODE: requires `darkMode: "class"` in tailwind.config.ts or all `dark:` variants
  are silently ignored.
- SSR localStorage: window is undefined during SSR. Use the lsGet/lsSet/lsRemove guards
  (typeof window) — direct localStorage access throws.
- NATIVE SESSION: localStorage can be evicted by the Android WebView. supabase.ts uses
  a storage adapter that writes through to @capacitor/preferences on native (durable),
  plain localStorage on web. Keep web reads synchronous (no async import on web path) —
  an earlier version made every read await import("@capacitor/preferences"), which
  slowed page load badly. Native detection is cached; plugin import is cached.
- LARGE FILE SAFETY: when handed page.tsx via chat, attach as a file (pasting truncates).
  After edits, confirm braces/parens balance and that the line delta is exactly expected.

## THE BIG ONE — native app freeze (why Option B exists)
Symptom: native Android app shows a dark, unresponsive screen every time you background
it and return; OAuth sometimes escapes into Chrome.
Root cause: `capacitor.config.ts` uses `server.url: 'https://calor-iq.com'` — the app
loads the REMOTE site in the WebView. Android kills a remote-URL WebView on backgrounding
and can't restore it → frozen dark screen. This is a documented limitation; server.url
is "not for production." NO JavaScript resume handler can fix a killed WebView (tried —
NativeResumeHandler helps only if the WebView is merely suspended, not killed).
Fix: migrate to a LOCAL bundled web build (https://localhost). See the execution plan.

## Option B migration — current task
Goal: stop loading the remote URL in the native WebView; ship a local static bundle that
calls the existing Vercel `/api/*` routes as absolute URLs. Supabase stays client-side
(no change). API routes STAY on Vercel (no new backend, no secrets migration).
Follow `docs/OPTION-B-execution-plan.md` phase by phase:
- Phase 0 (do first, safe, deployable today): add `src/lib/apiBase.ts` exporting
  API_BASE = native ? "https://calor-iq.com" : "" ; convert every `fetch("/api/...")`
  to `fetch(`${API_BASE}/api/...`)`. No behavior change on web.
- Phase 1: CORS on the /api/* routes for the Capacitor origin (https://localhost).
- Phase 2: static client build into webDir `out/`; make /[userId] + /[userId]/nutrition
  client-rendered.
- Phase 3: verify native OAuth deep-link return (consider native Google Sign-In plugin).
- Phase 4: remove server.url from capacitor.config.ts, set server.androidScheme:'https',
  build + `npx cap sync android`, rebuild APK.
- Phase 5: device test — the freeze should be gone after backgrounding repeatedly.
- Phase 6: bump versionCode/versionName, resubmit to Play Store. (Tradeoff: native
  frontend changes now need a resubmit; web/PWA still gets instant Vercel deploys.)

## Deploy notes
- Because the CURRENT build loads the remote URL, code changes reach the native app as
  soon as Vercel deploys (no APK rebuild) — until Phase 4 flips to local assets.
- After a service-worker change, first open post-deploy may still serve one stale shell,
  then sticks.

## Remaining product backlog (non-blocking)
- Portuguese language support (high priority, pre-launch).
- Bottom nav on /account page (same pattern as nutrition page).
- iOS via Capacitor once user base ~20+.
