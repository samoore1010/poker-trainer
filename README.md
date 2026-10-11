# Hand Walkthrough Table

A Texas Hold'em trainer. Set up any spot by talking to the coach, picking cards, or dealing at random, then step through flop, turn, river and showdown while the stats panel shows your win chance, how your hand can improve, what beats you, and pot odds.

## How it works

```
 you (text or 🎙) ──► coach agent (OpenAI or Claude) ──► tools ──► scenario ──► table + stats
                                     ▲                                   │
                                     └──── numbers from the engine ◄─────┘
```

- **Scenario** (`public/scenario.js`): one JSON record for the hand: seats, positions, stacks, your cards, the board, each opponent's known cards / range / style, and the action on every street. The table, the stats and the agent all read and write it.
- **Engine** (`public/engine.js`): exact 7-card evaluator, range parsing, and equity. Opponents are drawn from their ranges with card removal; with one opponent left on the turn or river every outcome is enumerated (exact), otherwise it simulates 6,000–14,000 deals. Runs in a Web Worker in the browser and in Node on the server.
- **Coach agent** (`server/agent/`): an LLM that turns what you say into tool calls (`setup_table`, `set_hero_cards`, `set_board`, `set_opponent`, `set_action`, `show_street`, `new_hand`, `get_table`, `calculate`, `what_if`). It never invents numbers: `calculate` and `what_if` run the engine and the reply quotes those results.

The LLM is the interface, not the calculator. Poker probabilities need exact arithmetic that a model can't do reliably; the engine is exact, fast and free, and the model handles language, setup and explanation.

## Deploy to Railway

1. **New Project → Deploy from GitHub repo** → pick this repository. Railway reads `railway.json` (Railpack build, `node server/index.js`, health check on `/health`) and installs dependencies from `package.json`.
2. **Variables**:
   - `OPENAI_API_KEY`: voice (transcription, read-aloud) and the coach.
   - optional `ANTHROPIC_API_KEY`: run the coach on Claude (`claude-opus-5-5`) instead. With both keys, Claude runs the coach and OpenAI handles voice; force one with `AGENT_PROVIDER=openai|anthropic`.
   - recommended `ACCESS_CODE`: visitors must enter it before the app spends API credit.
   - everything else is optional; see `.env.example`.
3. **Settings → Networking → Generate Domain**, then open the `https://…up.railway.app` URL.
4. In the service shell run `npm run check:openai`: it checks each key and that every configured model exists.

Without keys the app still runs: stats, card picker and browser speech recognition work; the coach bar is hidden.

## Using the coach

Type or 🎙 in the bar at the top:

> "Six-handed, I'm on the button with ace-queen of hearts. A tight player raises to 6 from UTG and the big blind calls."
>
> "Flop comes king of hearts, seven of hearts, two of clubs. The big blind bets 8."
>
> "Make the big blind a calling station." · "What if UTG only has QQ+?" · "Should I call?"

The coach sets up the table (positions, ranges on the seats, folds, bets, board), then answers with numbers from the engine. **Undo** (or Ctrl+Z) reverses any change; the **Coach** tab keeps the conversation. Your scenario and conversation are remembered on your device.

Ranges use standard notation: `QQ+`, `22-55`, `AKs`, `AQo+`, `A5s-A2s`, `KT+`, `AhKh`, `top 15%`. Styles: nit, tight, tag, solid, regular, lag, loose, fish, calling station, maniac, random.

The betting model is deliberately simple: each street has one bettor (or raiser) and a size; everyone who doesn't fold calls; you call what you face.

## Voice

- 🎙 records in the page with a level meter, stops after a pause, and transcribes with OpenAI. In the card picker plain card names are parsed instantly; anything else goes to an AI card parser. In the coach bar the transcript goes to the agent.
- 🔊 reads your hand and win chance aloud (OpenAI text-to-speech).
- Microphone problems get specific messages (blocked, no device, busy, sending silence, offline).

## Run locally

```
npm install
npm start                                       # http://localhost:3000
OPENAI_API_KEY=sk-... npm start                 # with voice + coach
ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... npm start   # coach on Claude
npm test                                        # engine, scenario, server and agent tests (fake APIs)
```

Opening `public/index.html` straight from disk also works (no coach or server voice).

## Project layout

```
public/
  index.html         table, card picker, stats panel, coach bar
  engine.js          poker math (shared by browser, worker and server)
  scenario.js        the scenario record and the edit operations (shared)
  stats-worker.js    runs the engine off the main thread
  voice.js           HandVoice: recorder + level meter, API client, speak()
server/
  index.js · config.js · app.js · http.js · rateLimit.js · openai.js
  agent/
    index.js         picks the provider, runs one request
    tools.js         tool schemas + execution (edits via scenario.js, numbers via engine.js)
    prompt.js        system prompt
    openai-agent.js  Responses API function-calling loop
    anthropic-agent.js  Claude via the official SDK tool runner (server-side fallbacks on)
  lib/cards.js       card codes + JSON schema for the AI card parser
  routes/            system, voice, cards, agent: one file per feature
scripts/check-openai.js   verifies keys and models
test/                node:test suites
```

## API

| Route | Body | Returns |
|---|---|---|
| `GET /api/status` | | features, models, agent provider, limits |
| `POST /api/agent` | `{message, scenario, history?}` | `{reply, scenario, changes, stats, provider, model}` |
| `POST /api/transcribe?context=cards\|none` | raw audio (`audio/webm`, mp4, ogg, wav, mp3) | `{text}` |
| `POST /api/cards/parse` | `{text}` | `{hero, flop, turn, river, unclear}` |
| `POST /api/speak` | `{text, voice?}` | `audio/mpeg` |

Errors are `{"error": {"code", "message"}}`. With `ACCESS_CODE` set, send it as `X-Access-Code`.

## Extending

- **New agent ability:** add an operation to `ops` in `public/scenario.js` (the UI can use it too), then a schema entry in `server/agent/tools.js`. For a new analysis, add a function to `engine.js` and expose it as a tool like `calculate`.
- **New stat in the panel:** compute it in `engine.js` (add a job kind in `stats-worker.js` if it's heavy) and render it in `renderPane()` in `index.html`.
- **New server feature:** a file in `server/routes/` registered in `server/routes/index.js`; `metered: true` applies the access code and rate limit.
