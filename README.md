# AI Research Mindmapper — Frontend

Two surfaces, one backend (`https://mindmapper-api-mu.vercel.app`):

```
research-mindmapper-vite/        ← the deployed app (Vite + vanilla JS + Clerk)
  index.html / app.js / styles.css   Classic view: mindmap, insights, sources, Q&A
  public/canvas.html                 Aletheia Canvas (beta): spatial cards + synthesis chat
  api/yt-transcript.js               Vercel edge function (YouTube transcript proxy)
  stitch-export/                     Stitch design references (v1 + v2)
stitch_screens/                  Original Stitch design exports (PNG + HTML)
legacy/                          Pre-Vite standalone prototype (kept for reference)
```

## Develop

```bash
cd research-mindmapper-vite
npm install
npm run dev        # http://localhost:5173  (canvas at /canvas.html)
```

`.env` needs `VITE_CLERK_PUBLISHABLE_KEY` (see Clerk dashboard).

## Build / deploy

```bash
npm run build      # outputs dist/ — deployed via Vercel
```

## Canvas beta notes

- Sessions are shared with the classic app (same backend + auth).
- Card positions persist per-browser in localStorage.
- Tailwind is loaded via CDN in `canvas.html` only — known beta debt,
  swap for a compiled build before calling Canvas stable.
