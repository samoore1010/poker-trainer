# Hand Walkthrough Table

A Texas Hold'em trainer. Set up any spot by talking to the coach, picking cards, or dealing at random, then step through flop, turn, river and showdown while the stats panel shows your win chance, how your hand can improve, what beats you, and pot odds.

## How it works

```
 you (text or 🎙) ──► coach agent (OpenAI or Claude) ──► tools ──► scenario ──► table + stats
                                     ▲                                   │
                                     └──── numbers from the engine ◄─────┘
```

- **Scenario** (`public/scenario.js`): one JSON record for the hand: seats, positions, stacks, your cards, the board, each opponent's known cards / range / style, and every action on every street in turn order (`replay()` turns it into pots, whose turn it is and who is still in). The table, the stats and the agent all read and write it.
- **Engine** (`public/engine.js`): exact 7-card evaluator, range parsing, and equity. Opponents are drawn from their ranges with card removal; with one opponent left on the turn or river every outcome is enumerated (exact), otherwise it simulates 6,000–14,000 deals. Runs in a Web Worker in the browser and in Node on the server.
- **What you should do** (`strategy.js` preflop, `recommend` in `engine.js` after the flop): a rule-of-thumb gauge at the top of the Read tab, aimed at a disciplined long-run player who folds most hands. It is not a solver.
  - **Preflop:** standard 100-big-blind charts. Raise first in by seat (about 16% of hands under the gun six-handed, 46% on the button; nobody limps), 3-bet / call / fold against a raise by your seat and the raiser's, tighter with callers in, 4-bet / call / fold against a 3-bet, premiums only against a 4-bet. Limped pots: raise the limpers, overlimp a few suited hands late, complete the small blind, check the big blind.
  - **After the flop:** your win chance against the price, discounted out of position (you won't see every card or get paid every time you hit): about 80% of it on the flop and 90% on the turn. Draws call only when they're close to the price. Value bets depend on win chance, board texture, number of opponents and calling stations.
  - **Opponents' hands:** the odds and the advice use your read on each player (below), or their cards if you set them.
  - **Before your turn** it previews your decision: *If it folds to you: Raise to $5*, *If UTG raises to $5: Fold*.
- **Your read on a player** (`ranges.js`, `readOf` in `scenario.js`): click any opponent and a *range* tab opens in the panel with every exact hand you should put them on, grouped by what it makes on the board (sets, top pair, flush draws, nothing…), how likely each is, how the range narrowed step by step, and how your hand does against it. It's built only from what you can see: their seat, the style you gave them, their bets, the board and your own cards (card removal). Their hidden cards are never used.
  - Preflop it starts from the chart range for what they did (opened, called, 3-bet, limped), wider or tighter for their style.
  - After the flop every possible hand is weighted by how likely it is to have taken each action: big bets are polarized (strong hands, draws, some bluffs), small bets wide, calls condensed (pairs and draws; monsters would raise), checks capped (strong hands usually bet). Styles shift it: stations call with weak pairs, nits rarely bluff, maniacs bluff a lot.
  - The computer players act after the flop with the same frequencies using their real cards, so the read matches how they play. A range you type for a player is used as it is.
- **Coach agent** (`server/agent/`): an LLM that turns what you say into one `update_table` call (every change at once; it returns fresh stats and the recommendation), plus `calculate` (another street) and `what_if` (compare without changing the table). Each message already carries the current stats, so a plain question needs no tool call. A setup is two model calls; progress streams to the page so the table updates before the written answer arrives. It never invents numbers.

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

## Setting up a hand

Everything is edited right on the table, at any point, without re-dealing; the stats update as soon as a card changes.

- **Cards:** tap any card spot (your two cards, the five board spots, an opponent's cards). A small picker opens there: tap a rank, then a suit, or just type it (`a` `h`). It moves to the next spot by itself. *Random* puts a spot back to a random card; Backspace does the same, Esc closes.
- **Street by street:** on preflop, fill the three flop spots and the table moves to the flop (any open preflop betting is finished with checks and calls); then the turn, then the river. Change an earlier card at any time; you stay on the street you're on.
- **Players:** tap a player's badge or name to set how they play (Nit, Tight, Regular, Loose, Station, Maniac), a range (`Top 15%` or `TT+, AQs+, AKo`), their exact cards, their stack, *Sit here* to take their seat, *Dealer here*, or *Action to them*. Tap your own name for *Dealer here*, *Action to me* and your stack.
- **Blinds and display:** type the blinds in the top bar (`1/2`, `2/5`, or just `10` for 5/10; presets in the list). The **$ / BB** switch shows every amount in dollars or big blinds (remembered on your device; stacks you type follow it).
- **Dealer and whose turn:** click the **D** chip to move the dealer button one seat on (positions follow and the betting starts over). *Action to…* puts the action on any player: anyone before them folds (or checks when it's free); if they've already acted, it goes back to their turn. **To me ⏭** in the action bar does that for you.
- **Say or type it:** the bar at the top understands setups on your device, instantly: *"ace king suited on the button, six handed, flop queen seven deuce rainbow, turn the nine of hearts"*, *"pocket nines in the big blind"*, *"AhKd flop Qs7h2c"*. 🎙 uses the browser's own speech recognition (Chrome, Edge, Safari), so cards land on the table while you're still talking; with no browser speech it records and transcribes on the server. Anything it can't turn into an edit ("make him tighter", "should I call?") goes to the coach.

## Using the coach

Type or 🎙 in the bar at the top:

> "Six-handed, I'm on the button with ace-queen of hearts. A tight player raises to 6 from UTG and the big blind calls."
>
> "Flop comes king of hearts, seven of hearts, two of clubs. The big blind bets 8."
>
> "Make the big blind a calling station." · "What if UTG only has QQ+?" · "Should I call?"

The coach sets up the table (positions, ranges on the seats, folds, bets, board), then answers with numbers from the engine. **Undo** (or Ctrl+Z) reverses any change; the **Coach** tab keeps the conversation. Your scenario and conversation are remembered on your device.

Ranges use standard notation: `QQ+`, `22-55`, `AKs`, `AQo+`, `A5s-A2s`, `KT+`, `AhKh`, `top 15%`. Styles: nit, tight, tag, solid, regular, lag, loose, fish, calling station, maniac, random.

## Playing a hand

Betting is played turn by turn in real table order (preflop from under the gun to the big blind, after the flop from the small blind to the button). Each player sits around the rail with a name plate (name and stack) and a speech bubble with their latest action; whoever's turn it is glows, with a moving bar under their plate. The buttons under the table are for that player:

| Button | No bet yet | Facing a bet |
|---|---|---|
| **Fold** | give up the hand | give up the hand |
| **Check / Call** | check | call the bet (or all-in if it's more than the stack) |
| **Bet / Raise** | opens the sizing: ⅓, ½, ¾ pot, Pot, All-in | opens the sizing: 2.5×, 3×, 4×, Pot, All-in |

In the sizing, pick a preset or use the slider and − / +, then **Confirm**; **‹ Back** closes it. On your turn it starts at the suggested size. The **Felt** option switches the cloth between brown, green and blue.

Chips slide in front of each player as they bet and sweep into the pot when the street ends. **Auto ▸** lets the opponents play until it's your turn: preflop they play the same charts (raise or fold), loosened or tightened by style (stations and fish call more, maniacs and LAGs raise more); after the flop they play their actual cards with their style. **Play to the flop/turn/river** finishes the betting round (you check/call) and deals the next card. On your turn the button the "What you should do" gauge recommends is starred, and the suggestion is shown above the buttons. Folding ends the hand for you; Undo takes back any action. The stats, the gauge and the coach all use the actual action: who is still in, the pot, what you have to call, who raised and who called.

## Camera (experimental)

📷 **Camera** follows the cards on another table through your phone's camera and puts them on this one, as if you'd tapped them in. Today it's tested by pointing a phone at another screen running this app.

- **Fast first.** The phone reads every frame itself (`public/vision.js`); a reading that holds for a few frames (about half a second) goes straight onto the table and locks (🔒). Your cards show up about a second after they're dealt, each street about half a second after it lands.
- **AI check in the background.** A vision model then looks at the same picture (`POST /api/cards/vision`: Claude when `ANTHROPIC_API_KEY` is set, `claude-haiku-5-5` unless `VISION_MODEL` says otherwise; else OpenAI). ⋯ means the check is pending, ✓ that it agreed. If it disagrees with a card the fast reading put there, it reads again and, only if both readings agree, corrects that card. It reads any deck or table style, so when the phone can't read the cards at all (a different design) the AI's reading goes on the table directly, a second or two later.
- **Locked in.** Within a hand your two cards never change and the board only grows, so later frames can't swap a locked card. Cards the AI confirmed or that you picked are never changed automatically: if the AI disagrees with one it asks (**Use the camera's** / **Keep**). A new hand (the board cleared, or two new cards) unlocks everything; **Re-read** does it by hand.
- **Read the betting (beta, needs the AI).** The AI also reports who folded, the chips in front of each seat and whose turn it is. The phone plays the missing actions in turn order and keeps them only if the result matches the picture: each seat's latest action and whose turn it is. If it doesn't add up (or the camera shows a different table size or seat), the betting is left for you to enter with the action buttons, and the panel says why. At the start of a hand it matches this table to the one on camera (players and your seat).
- **Cost:** the AI is only asked when something changes: about 5–10 calls a hand for cards, roughly one per action with the betting on (the panel counts them).
- **No vision model** (no keys, or it's failing): the phone's reading alone is used, with the same locking.
- **Best results:** fill most of the picture with the table and hold steady. The **4-color deck** setting (top bar) on the filmed screen makes the phone's own suit reading much more reliable.
- **Needs** a secure (https) page, which Railway provides, and camera permission.

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
  strategy.js        preflop charts: advice, computer players, opponents' likely ranges (shared)
  ranges.js          hand reading after the flop: how each kind of hand acts, by style (shared)
  scenario.js        the scenario record and the edit operations (shared)
  stats-worker.js    runs the engine off the main thread
  voice.js           HandVoice: recorder + level meter, API client, speak()
  vision.js          CardVision: finds and reads cards in a camera frame (browser only)
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
| `POST /api/agent` | `{message, scenario, history?}` | `{reply, scenario, changes, stats, provider, model}`; with `Accept: application/x-ndjson`, a stream of `status` / `scenario` events then `done` |
| `POST /api/transcribe?context=cards\|none` | raw audio (`audio/webm`, mp4, ogg, wav, mp3) | `{text}` |
| `POST /api/cards/parse` | `{text}` | `{hero, flop, turn, river, unclear}` |
| `POST /api/cards/vision` | `{image: "data:image/jpeg;base64,…", player?, betting?}` | `{board, hero, betting, unsure, provider, model}` (`board` null = unreadable, `hero` null = not seen; `betting` only when asked and readable) |
| `POST /api/speak` | `{text, voice?}` | `audio/mpeg` |

Errors are `{"error": {"code", "message"}}`. With `ACCESS_CODE` set, send it as `X-Access-Code`.

## Extending

- **New agent ability:** add an operation to `ops` in `public/scenario.js` (the UI can use it too), then a schema entry in `server/agent/tools.js`. For a new analysis, add a function to `engine.js` and expose it as a tool like `calculate`.
- **New stat in the panel:** compute it in `engine.js` (add a job kind in `stats-worker.js` if it's heavy) and render it in `renderPane()` in `index.html`.
- **New server feature:** a file in `server/routes/` registered in `server/routes/index.js`; `metered: true` applies the access code and rate limit.
