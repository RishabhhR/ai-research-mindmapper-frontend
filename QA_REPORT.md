# QA Report — June 2026 overhaul

## Bugs found & fixed (QA → Dev loop)

| # | Severity | Where | Bug | Fix |
|---|----------|-------|-----|-----|
| 1 | Critical | backend `groq_client.py` | `duckduckgo_search` imported outside try-block and missing from requirements → guaranteed 500 when all LLM providers fail | Removed dead DDG stage; chain is Groq → Gemini → OpenRouter → extractive |
| 2 | Critical | canvas beta | `/api/research` returns session id as `id`, canvas read `session_id` → topic research never created a card, Q&A never activated | Rebuilt flow reads `id`; regression-noted in code comment |
| 3 | High | backend `main.py` | Internal job worker endpoint accepted unauthenticated calls when `INTERNAL_SECRET` unset (the default) | Endpoint refuses without secret; jobs run inline instead |
| 4 | High | backend `groq_client.py` | `parse_json_or_fallback` bypassed `required_keys` when plain `json.loads` succeeded (caught by new unit test) | All parse paths now enforce required keys |
| 5 | High | backend | No rate limiting — one user could exhaust Groq quota for everyone | DB-backed per-user limits: 6/min, 120/day LLM; 12/min, 200/day ingest (env-tunable), 429 + Retry-After |
| 6 | High | backend `ingest.py` | SSRF: any URL fetched server-side incl. private IPs / cloud metadata; unbounded download size | Public-IP guard, content-type check, 3 MB cap |
| 7 | Medium | backend `storage.py` | Chunk inserts one HTTP roundtrip per chunk (100+ for long transcripts) | Single batched multi-row insert |
| 8 | Medium | backend | No indexes on session_id/user_id lookups | 5 indexes added in init_db |
| 9 | Medium | backend `main.py` | Cold start crashed entirely if Turso was momentarily unreachable (`init_db` at import) | Best-effort init with warning |
| 10 | Medium | backend `auth.py` | Debug prints leaked unverified JWT claims (PII) to logs | Proper logging, no token contents |
| 11 | Medium | backend `main.py` | CORS `allow_origins=["*"]`; carefully-built origin list was dead code | Locked to known origins + preview-deploy regex + env extension |
| 12 | Medium | classic app | Saved/LLM node positions discarded — every map re-laid out in a circle; drags lost on reload | Stored x/y honored, circle only as fallback |
| 13 | Medium | classic app | localStorage "migration" re-ran topics through the LLM on every sign-in, didn't preserve content | Removed; stale key cleaned up |
| 14 | Low | classic app | Fake "quality score" (86) implied measurement that didn't exist | Real insight count with tooltip |
| 15 | Low | classic app | "Clear history" only hid rows, toast admitted DB kept everything | Real DELETE endpoint + per-item delete + confirm |
| 16 | Low | classic app | Reloaded sessions lost web citations (not merged into sources) | Citations merged on session load |
| 17 | Low | canvas | Clerk loaded from `@latest` CDN tag (breaking-change risk) | Pinned to `@6` |
| 18 | Low | both repos | Stale READMEs/.env.example (sqlite fallback that no longer exists, wrong model names, wrong run instructions) | Rewritten |

## Test results

- **Backend:** 43/43 pytest green (fallback chain, rate limiter, chunking,
  multipart, SSRF guard, JSON repair, provenance normalization). Full
  `app.main` import verified — 9 API routes registered.
- **Frontend:** `app.js` ESM syntax verified; canvas inline JS (804 lines)
  syntax verified; all referenced element IDs present; fake-content sweep
  clean. `vite build` could not run in the QA sandbox (esbuild native binary
  crashes there) — **verify the Vercel build on first deploy.**

## Not yet verified (needs deployed environment)

1. End-to-end research flow (Groq/Gemini live) after backend deploy.
2. Rate-limit 429 UX in both UIs under real burst.
3. YouTube job pipeline with `INTERNAL_SECRET` set in Vercel env (**set it —
   currently jobs will run inline and slow down `/api/sources`**).
4. Canvas sign-in modal on the deployed domain (Clerk allowed origins must
   include it).
5. First deploy runs `init_db` against prod Turso → new `rate_limits` table +
   5 indexes created automatically; confirm in Turso dashboard.

Deploy both repos, then I can drive a live browser pass (sign-in → research →
canvas → delete) via Claude in Chrome and feed findings back into the loop.
