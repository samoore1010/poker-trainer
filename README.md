# Hand Walkthrough Table

A poker hand trainer. Deal against 1–8 opponents (or set up any hand by picking, typing or saying the cards), step through flop, turn, river and showdown, and read your hand strength, improvement odds, and what beats you.

Voice runs through OpenAI: your browser records you, the server sends the audio to OpenAI for transcription, and the cards are read from the text. The app can also read your hand aloud with OpenAI text-to-speech.

## Deploy to Railway

1. **New Project → Deploy from GitHub repo** → pick this repository. Railway reads `railway.json` (Railpack build, `node server/index.js`, health check on `/health`).
2. **Variables**: add `OPENAI_API_KEY`. Everything else is optional; see `.env.example`.
3. **Settings → Networking → Generate Domain**, then open the `https://…up.railway.app` URL.
4. Check the key and models: in the service, open a shell (or run `railway run npm run check:openai` locally) and run `npm run check:openai`.

Without `OPENAI_API_KEY` the app still runs; the mic falls back to the browser's own speech recognition (Chrome, Edge or Safari).

**Cost control:** set `ACCESS_CODE` so only people you give the code to can use the voice features, and tune `RATE_LIMIT_PER_MIN` (default 30 OpenAI calls per minute per visitor).

## Using voice

Open **Pick cards**, click 🎙 and talk:

> "ace king of spades, flop ten nine two of clubs, turn eight of diamonds, river three of hearts"

- A level meter next to the mic shows the microphone is hearing you. Recording stops on its own after a short pause, or when you click 🎙 again. Escape cancels.
- Plain card names are read instantly. Anything else ("pocket rockets, the black ones", "bullets in the hole") is sent to an OpenAI model that returns exact cards; it never guesses suits you didn't say.
- If something's wrong the app says what: microphone blocked, no microphone, mic busy, mic sending silence, no speech, bad API key, out of OpenAI credit, rate limited.
- 🔊 in the "Your hand" panel reads the hand and win chance aloud.

## Run locally

```
npm start                                  # http://localhost:3000, no voice API
OPENAI_API_KEY=sk-... npm start            # with OpenAI voice
npm run dev                                # restarts on server changes
npm test                                   # server tests against a fake OpenAI
```

Opening `public/index.html` straight from disk also works, with browser speech recognition only.

## Project layout

```
public/              everything the browser loads
  index.html         the app (table, odds engine, advisor, card picker)
  voice.js           window.HandVoice: mic recorder + level meter + silence detection, API client, speak()
server/
  index.js           entry point
  config.js          every environment variable, with defaults
  app.js             security headers, HTTPS redirect, router, access code + rate limit, static files, JSON errors
  openai.js          OpenAI REST client (timeouts, one retry, clear error codes): transcribe(), json(), speak()
  rateLimit.js       per-IP limiter
  http.js            HttpError, JSON/body helpers
  lib/cards.js       card codes, JSON schema for a deal, validation
  routes/            one file per feature, registered in routes/index.js
    system.js        GET /health, GET /api/status
    voice.js         POST /api/transcribe, POST /api/speak
    cards.js         POST /api/cards/parse
scripts/check-openai.js   verifies the key and that each configured model exists
test/                node:test suite
```

## API

| Route | Body | Returns |
|---|---|---|
| `GET /api/status` | | `{features: {transcribe, parseCards, speak}, accessCodeRequired, models, limits}` |
| `POST /api/transcribe?context=cards\|none&lang=en` | raw audio, `Content-Type: audio/webm` (or mp4, ogg, wav, mp3) | `{text, model, ms}` |
| `POST /api/cards/parse` | `{"text": "..."}` | `{hero: ["As","Kd"], flop: [...], turn, river, unclear}` |
| `POST /api/speak` | `{"text": "...", "voice"?: "alloy"}` | `audio/mpeg` stream |

Errors are `{"error": {"code", "message"}}` with codes like `openai_not_configured`, `openai_auth`, `openai_quota`, `openai_model`, `rate_limited`, `access_code_required`. With `ACCESS_CODE` set, send it as `X-Access-Code`.

## Adding a feature

1. Server: create `server/routes/<feature>.js`:
   ```js
   const { readJson } = require('../http');
   module.exports = (router, { openai, config }) => {
     router.post('/api/coach', { metered: true }, async (req, res, { send }) => {
       const { question } = await readJson(req);
       const answer = await openai.json({ system: '...', user: question, schema: {...} });
       send.json(200, answer);
     });
   };
   ```
   `metered: true` applies the access code and rate limit. Add the file to `server/routes/index.js`, then add a test in `test/`.
2. Browser: call it with `HandVoice.api.request('/api/coach', {body: JSON.stringify({...}), headers: {'Content-Type': 'application/json'}})`, record speech with `new HandVoice.Recorder()` plus `HandVoice.api.transcribe(blob, {context: 'none'})`, and talk back with `HandVoice.speak(text)`.
