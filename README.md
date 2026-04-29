# AI Research Mindmapper Frontend

Standalone frontend inspired by the Stitch `AI Research Mindmapper` design.

## Open

Open `index.html` directly in a browser:

```text
/Users/rishabhraj/Antigravity Projects/ai-research-mindmapper-frontend/index.html
```

## Optional Local Server

```bash
python3 -m http.server 4173
```

Then visit:

```text
http://localhost:4173
```

## Backend

This frontend calls the local FastAPI backend at:

```text
http://127.0.0.1:8008
```

Set `GROQ_API_KEY` before starting the backend to enable live Groq Compound search and synthesis. Without it, the app returns local fallback responses so the UI remains testable.
