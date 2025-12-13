Sign Language Web Prototype

This is a client-side prototype that runs hand detection in the browser using MediaPipe Hands (WASM/JS) and the Web Speech API for live speech-to-text and TTS.

Files:
- `index.html` — main page
- `app.js` — detection + speech integration
- `styles.css` — UI styling

Run locally (recommended):

1. Start a quick static server from the `web/` folder. From the repo root run:

```powershell
# from project root
cd web
python -m http.server 8000
```

2. Open http://localhost:8000 in Chrome/Edge (best support for Web Speech API and getUserMedia).

Notes:
- All detection runs locally in the browser; no server is required.
- For speech-to-text the browser must support the Web Speech API (Chrome/Edge). Mobile support varies.
- If you want me to deploy this publicly (e.g., GitHub Pages or Vercel), I can push these files to a new branch and deploy.
