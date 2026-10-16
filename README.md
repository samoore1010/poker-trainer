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
- **What you should do** (`strategy.js` preflop, `ev.js` and `recommend` in `engine.js` after the flop): the advice at the top of the Read tab. It is not a solver.
  - **Preflop:** standard 100-big-blind charts. Raise first in by seat (about 16% of hands under the gun six-handed, 46% on the button; nobody limps), 3-bet / call / fold against a raise by your seat and the raiser's, tighter with callers in, 4-bet / call / fold against a 3-bet, premiums only against a 4-bet. Limped pots: raise the limpers, overlimp a few suited hands late, complete the small blind, check the big blind.
  - **After the flop: what each choice is worth** (`ev.js`). Every option you have (fold, check, call, bet a third / two thirds / the pot, an overbet heads-up on the turn and river, raise 3x or pot, all-in when stacks are short) gets a number: the chips you can expect to win or lose from here. Thousands of sampled deals draw each opponent's hand from your read on them, and they fold, call or raise with the frequencies their kind of hand has at that price, adjusted for their style (stations call light, nits fold, overcalls in multiway pots are tighter). Checking lets the players behind bet, and you then call or fold, whichever pays. The best option is the advice; the panel lists the top five with their values, how often they'd fold, and whether to call a re-raise. Out of position your share is discounted (about 80% on the flop, 90% on the turn), since you won't see every card or get paid every time you hit. Multiway, facing a bet, it only raises very strong hands.
  - **Limits:** it looks one street ahead (later streets only through that discount), plays one hand rather than a balanced range, and is only as good as the reads. Solvers bet small with strong hands on dry flops because of what that does for their whole range over later streets; this engine prefers bigger bets there.
  - **Opponents' hands:** the odds and the advice use your read on each player (below), or their cards if you set them.
  - **Before your turn** it previews your decision: *If it folds to you: Raise to $5*, *If UTG raises to $5: Fold*.
  - **Benchmark** (`npm run bench`, `test/bench/`): 149 standard spots with the answers good players broadly agree on (consensus picks, not solver output): opens, defending, 3-bets, value bets and sizing, folding air, raising the nuts, bluffing a nit, not bluffing a station, thin value, calling a maniac, folding to a nit. It prints the score by category and every miss (`-v` for the reasons). The tests keep the score from going down. Currently 142/149: the misses are small-sizing on dry flops (5) and two close bluffs against a station.
- **Player stats** (`handStats` / `styleFromStats` in `scenario.js`): every hand you play here is counted per player by name: how often they put money in before the flop, how often they raise, and how aggressive they are after it. Moves the computer made for them don't count, so this measures the real players you enter by hand or follow with the camera. After 12 hands a style follows from the numbers (nit, tight, regular, loose, calling station, maniac) and is applied at the next hand, unless you set their style yourself. The player's editor shows the stats with **Use stats** and **Clear**; their range tab shows them too.
- **Your read on a player** (`ranges.js`, `readOf` in `scenario.js`): click any opponent and a *range* tab opens in the panel with the hands you should put them on (A6, 66… with suits only where they matter for a flush), grouped by what they make on the board, likeliest group first (nothing last), how the range narrowed step by step, and how your hand does against it. It's built only from what you can see: their seat, the style you gave them, their bets, the board and your own cards (card removal). Their hidden cards are never used.
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

**Playing on at the same table.** **Next hand** finishes the hand (anything left is played out: you check/call unless you folded, the others play their cards), pays the pot to the winner (side pots included), carries every stack over, moves the dealer button one seat on and deals the next hand with the same players, styles and notes. Anyone who runs out of chips rebuys for 100 big blinds. Your new cards stay face down until the camera reads them, you tap them to pick them, or you press **🎲 Random**; until then there's no advice and nothing about them leaks into the numbers or the reads. The hint shows the hand number, and the panel shows how the last hand went. **Reset table** starts over (tap it twice): new players, fresh stacks, hand 1. Stacks can still be changed by clicking a player.

Chips slide in front of each player as they bet and sweep into the pot when the street ends. **Auto ▸** lets the opponents play until it's your turn: preflop they play the same charts (raise or fold), loosened or tightened by style (stations and fish call more, maniacs and LAGs raise more); after the flop they play their actual cards with their style. **Play to the flop/turn/river** finishes the betting round (you check/call) and deals the next card. On your turn the button the "What you should do" gauge recommends is starred, and the suggestion is shown above the buttons. Folding ends the hand for you; Undo takes back any action. The stats, the gauge and the coach all use the actual action: who is still in, the pot, what you have to call, who raised and who called.

## Camera (experimental)

📷 **Camera** follows the cards on another table through your phone's camera and puts them on this one, as if you'd tapped them in. Today it's tested by pointing a phone at another screen running this app. It lives in the left half of the panel under the table (the action buttons and hand controls are on the right): **📷 Start camera** turns it on, **▴ Hide view** folds the picture away while it keeps reading (the blinking **LIVE** dot, the cards it has locked, the AI checks and its notes stay in view), and **■ Stop** turns it off.

- **Fast first.** The phone reads fresh video frames in a worker (`public/vision.js`, `public/vision-worker.js`), with a main-thread fallback when workers are unavailable. Hero and board readings are confirmed independently over three frames, so an unclear board does not block a clear hand. Confirmed readings go straight onto the table and lock (🔒). Your cards show up about a second after they're dealt, each street about half a second after it lands.
- **AI check in the background.** A vision model then looks at the same picture (`POST /api/cards/vision`: Claude when `ANTHROPIC_API_KEY` is set, `claude-haiku-5-5` unless `VISION_MODEL` says otherwise; else OpenAI). ⋯ means the check is pending, ✓ that it agreed. If it disagrees with a card the fast reading put there, it reads again and, only if both readings agree, corrects that card. It reads any deck or table style, so when the phone can't read the cards at all (a different design) the AI's reading goes on the table directly, a second or two later.
- **Locked in.** Within a hand your two cards never change and the board only grows, so later frames can't swap a locked card. Cards the AI confirmed or that you picked are never changed automatically: if the AI disagrees with one it asks (**Use the camera's** / **Keep**). A new hand (the board cleared, or two new cards) unlocks everything; **Re-read** does it by hand.
- **Follow the table live (needs the AI, on by default).** The AI reads when the picture changes, takes follow-up readings to confirm changes, and checks periodically for missed changes. Only one live request is in flight; unchanged scenes get a recovery read after three seconds rather than continuous polling. Requests from an earlier camera session, crop, rotation or hand are discarded before they can change the table. Two kinds of reading (`POST /api/cards/table`):
  - **Short** (most of them, `live`): only what changes during a hand, as short arrays: each seat's chips in front, who folded, whose turn it is, the pot and the cards. The picture is cropped to the table and scaled down. A short answer is a fast answer: about 0.8 s per read with a fast model.
  - **Full** (`fast`; every 10 s, at the start of each hand, and whenever the seats stop matching): names, stacks, the dealer, the blinds, and where the table is in the picture (for the crop). Both use `VISION_LIVE_MODEL` (the fast model by default).
  - **Betting:** missing actions are inferred in turn order up to the player whose turn it is (`trackTable` in `scenario.js`), then committed together. The dashboard and advice update without waiting for a sequence of chip animations; changed seats are highlighted. Unreadable bets stay unknown, and impossible amounts are reread instead of automatically dividing them by 100. Both chip and big-blind display units are retained. A player the table had filled in as calling (a flop dealt before the camera saw their fold) becomes a fold.
  - **The camera wins:** when two readings in a row disagree with the table (a wrong click, a missed action), the street is rebuilt from the picture (`rebuildFrom`), or the whole hand when the pot confirms it.
  - **Seats:** names follow once two full readings agree; stacks while the betting matches; the dealer and the number of players between hands. Players whose names match keep their style, range and notes.
  - **Lag readout:** *lag 1.0 s (avg 1.0 s)*: from the moment the picture changed to the moment this table showed it, with how long a read takes, when the last one landed, and the read count. The panel also checks *Pot $24 ✓* and *To act: Ravi ✓* against the picture. Seats the camera just changed glow green.
- **⟳ Sync table.** One careful read of the whole table on request (VISION_SYNC_MODEL, a larger model by default), with a preview: the panel lists what would change (players, names, dealer, stacks), all ticked; untick anything and **Apply**. Anything the camera couldn't read clearly stays as you set it, and the panel says why ("the right side of the table is cut off"). Real tables usually give seats, dealer and folds but not names or exact stacks; a poker app on a screen usually gives everything.
- **Readiness row.** *Picture* (checked on the phone every second: too dark, washed out, blurry, cards too small) and, from the latest reading, *Cards · Seats · Names · Stacks · Betting*, each ✓ or ✗ with the reason.
- **Upright, and big.** Every frame is turned upright before anything reads it. The AI says when the picture is sideways or upside down (a phone filmed lying on its side) and, after two readings agree, the app turns it; **↻** turns it by hand (remembered on the device). The preview is as wide as the camera panel; tap it for full screen. **Hide view** folds it away while the reading carries on.
- **Cost:** live-read frequency depends on scene changes, confirmation needs and response time (the panel counts the reads); camera reads have their own rate limit (`CAMERA_RATE_LIMIT_PER_MIN`, 300 by default). With it off, the AI is only asked when something changes: about 5–10 calls a hand for the cards.
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
  ev.js              what each choice is worth after the flop (shared)
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
scripts/benchmark.js      scores the advice against test/bench/spots.js (npm run bench)
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
| `POST /api/cards/table` | `{image, player?, fast?, live?, seats?}` (live: the short reading for following a hand; `{rotate, live, readable, pot, toAct, seats: [{bet, folded}], board, hero}`) | the whole table for Sync table: `{readable: {cards, seats, names, stacks, betting}, problems, unit, blinds, seats: [{name, stack, dealer, folded, bet, last}] (from you, clockwise), toAct, board, hero, model}` |
| `POST /api/speak` | `{text, voice?}` | `audio/mpeg` |

Errors are `{"error": {"code", "message"}}`. With `ACCESS_CODE` set, send it as `X-Access-Code`.

## Extending

- **New agent ability:** add an operation to `ops` in `public/scenario.js` (the UI can use it too), then a schema entry in `server/agent/tools.js`. For a new analysis, add a function to `engine.js` and expose it as a tool like `calculate`.
- **New stat in the panel:** compute it in `engine.js` (add a job kind in `stats-worker.js` if it's heavy) and render it in `renderPane()` in `index.html`.
- **New server feature:** a file in `server/routes/` registered in `server/routes/index.js`; `metered: true` applies the access code and rate limit.

## Camera regression checks

`npm test` includes response ordering/cancellation, frame confirmation, scheduling, unreadable amounts and big-blind units, alongside the existing engine and mocked-provider tests.

With Playwright available and Chromium installed, run:

```sh
CHROMIUM=/usr/bin/chromium node scripts/camera-check.js
```

This starts its own local server and uses a synthetic canvas camera, without provider credentials. It checks card recognition in the worker, worker/fallback output equivalence, stop/restart, stale full-table response rejection, and immediate multi-action commits. Playwright is an optional development tool, not a runtime dependency.

These checks do not establish real-video accuracy or live-provider speed. Before tuning the new suit-confidence margin or changing recognition models, measure labeled recordings covering glare, blur, decimal bets, occlusion, fast actions and hand transitions. Track incorrect committed fields, missed events and median/p95 time from visible change to dashboard paint. The recognizer still targets this app's deck/layout; general-purpose OCR, perspective calibration and trained deck recognition remain future work.
