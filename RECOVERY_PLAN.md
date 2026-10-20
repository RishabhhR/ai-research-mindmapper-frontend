# Research Mindmapper recovery plan

Updated 2026-10-20. The Go service is the active backend; the Python service is legacy.

## Scope reviewed

Go API entrypoints, configuration, authentication, rate limiting, Turso HTTP client/schema/storage, all HTTP handlers, TXT/PDF/web/YouTube ingestion, LLM provider/fallback paths, Vercel/Docker packaging; Vite classic view, canvas view, and frontend Vercel routing.

## Phase 1 — Restore the core research flow (implemented locally)

- Surface API/storage/provider failures instead of reporting a fake saved map.
- Validate session ownership before imports, save sources and chunks atomically, and delete a user's full history.
- Make PDF/TXT/web imports and authenticated YouTube jobs produce either usable chunks or a clear error.
- Keep topic-only output labelled as AI synthesis, ground imported-source citations in actual chunks, and preserve source/page information on reload.
- Save map edits/positions without overwriting the main map during expansion; accept cross-origin `PUT` preflights.
- Show Q&A answers in the classic view, clear data on account switch or deletion, and avoid unsafe source links.
- Package the transcript edge function at the Vercel project root.

## Phase 2 — Validate before release (implemented locally)

- Go unit suite, vet, and build pass.
- Frontend Vite build and syntax checks pass.
- Vercel preview builds of both projects pass.
- Disposable live Turso/Gemini flow passed: upload, generate, ask, save, reload, delete.
- Live Groq key in this local environment returns 401; Gemini is the working fallback. Production credentials need their own verification.

## Phase 3 — Release and product gaps

- Deployed the Go API and frontend to production on 2026-10-20. API health is 200 on version 1.2.0 with storage available; home and canvas pages are 200; anonymous sessions are 401; the frontend origin's `PUT` preflight is 200.
- The transcript edge route exists, but a valid sample YouTube video returned 404 because its caption tracks could not be fetched from Vercel. The backend may still succeed through Supadata; that path needs an authenticated production check.
- Verify logged-in topic, TXT/PDF/web/YouTube, Q&A, map edits, reload, and account separation on the production URLs. The available local stress-test key was not accepted by the production API, so these authenticated checks remain open.
- Source retrieval is lexical. It can miss paraphrases; add semantic retrieval if NotebookLM-level source Q&A is the target.
- Topic-only research has no live web search. Add a real search/retrieval provider before claiming researched web citations.
- YouTube remains environment-dependent. The Vercel Go runtime does not include `yt-dlp`; the Docker image does. Supadata or another reliable transcript service may be needed for serverless deployment.
- The extension bearer-key path can impersonate an installation if that key is distributed to clients. Replace it with server-verified identity before enabling it in production.

The Go directory currently has no Git metadata; preserve its changes and attach it to a repository before expecting a GitHub sync. The frontend has a Git remote but its changes are uncommitted.
