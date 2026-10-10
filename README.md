# Hand Walkthrough Table

A single-file poker hand trainer. Deal against 1–8 opponents (or set up any hand by picking, typing or saying the cards), step through flop, turn, river and showdown, and read your hand strength, improvement odds, and what beats you.

- `index.html` is the whole app (fonts load from Google Fonts). It opens directly from disk.
- `server.js` is a dependency-free Node server for hosting it (Railway, Render, Fly, any VPS).

## Voice entry

Open **Pick cards** and click 🎙, then talk:

> "ace king of spades, flop ten nine two of clubs, turn eight of diamonds, river three of hearts"

- Slots fill as each phrase is recognized. Dictation keeps listening through pauses and stops when you click 🎙 again, press Escape, close the picker, or stay silent for 4 seconds.
- A suit applies to every rank said just before it ("ten nine two of clubs" is three clubs). Common mishearings ("for", "to", "ate", "harts") are understood when a suit follows.
- Words: `flop`, `turn` and `river` start those streets; otherwise cards fill in order (your two, flop, turn, river). Shorthand like `As Kd 7h` works when typed.

Requirements, set by the browsers themselves:

- **Chrome, Edge or Safari.** Firefox has no built-in speech recognition, so the mic button is hidden there. Use OS dictation (Win+H, or Fn twice on macOS) into the text box instead.
- **HTTPS** (or `localhost`, or opening the file directly). The server redirects HTTP to HTTPS behind Railway's proxy and sends `Permissions-Policy: microphone=(self)`.
- **Internet access.** Chrome and Edge send audio to their speech service.
- The page must be in its own tab. Viewers that embed it in a frame (like a claude.ai artifact) block the microphone.

If the browser blocks the mic, the app says why (permission denied, no microphone found, mic busy, offline) and how to fix it.

## Run locally

```
npm start            # http://localhost:3000  (PORT=8080 npm start to change)
```

Or just open `index.html` in Chrome.

## Deploy to Railway

1. In Railway: **New Project → Deploy from GitHub repo** and pick this repository.
2. Railway reads `railway.json`: it builds with Railpack, runs `node server.js`, and health-checks `/health`. No environment variables are needed (`PORT` is provided by Railway).
3. Open the service's **Settings → Networking → Generate Domain**. The `https://…up.railway.app` URL is ready to use, mic included.

Or with the CLI: `railway init && railway up`, then `railway domain`.
