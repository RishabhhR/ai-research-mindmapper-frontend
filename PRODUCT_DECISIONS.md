# Product Decisions — June 2026 overhaul

Role-played pass: PM → Developer → QA, covering both repos
(`ai-research-mindmapper-backend`, `ai-research-mindmapper-frontend`).

## Product calls (PM)

**1. No fake UI.** Everything visible must be real or clearly labeled. Removed
from Canvas beta: 4 hardcoded demo cards, prefab chat conversation, fake
collaborator avatars ("SM"), dead nav links (Threads / Library / Timeline),
dead Share button, fake reader toolbar, fake "65% READ" progress, fake
"Synthesize Cluster" button, canned fallback responses. Removed from classic:
the invented "quality score" (76 + 3×nodes formula) — now shows the real
insight count.

**2. Canvas beta becomes a real surface, not a mockup.** It now loads the same
sessions as the classic app (one backend, one auth), renders them as draggable
cards (positions persist per browser), lazy-loads session detail in the
reader, supports research / URL import / file upload / Q&A from the command
bar, and signs users in directly on the page instead of telling them to go
back to the classic app.

**3. Honest, reversible data actions.** "Clear history" previously only hid
the list and admitted the data stayed in the DB. There is now a real
`DELETE /api/sessions/{id}`; per-map delete buttons and clear-all both use it,
with confirmation.

**4. Kill the silent LLM-burning "migration".** Old localStorage maps were
being re-generated through the LLM on every sign-in (cost, latency) without
actually preserving content. Replaced with a cleanup of the stale key.

**5. Scale posture for 100s of users.** Per-user rate limits (burst + daily)
DB-backed so they hold across serverless instances; LLM endpoints budgeted to
finish inside Vercel's 60s window; batched DB writes; indexes; CORS locked to
known origins. Limits are env-tunable without redeploy logic changes.

**6. Repo hygiene.** ~20 scratch test scripts moved out of backend root
(`scratch/`, `scripts/`); legacy pre-Vite frontend moved to `legacy/`; READMEs
rewritten to match reality.

## Known debt (deliberately deferred)

- Canvas uses the Tailwind CDN (fine for beta; compile before GA).
- Canvas card positions are per-browser (localStorage), not synced.
- Chrome-extension auth bypass (`EXTENSION_PUBLIC_KEY` suffix match) is
  spoofable by design — acceptable while the extension is the YT fallback;
  revisit before scale marketing.
- Clerk publishable key is a `pk_test_` instance — switch to a production
  Clerk instance before launch.
- `vercel.json` rewrite for `/canvas` exists; canvas is reachable at
  `/canvas.html` either way.
