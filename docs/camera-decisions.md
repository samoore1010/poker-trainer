# Camera decisions and source inputs

The action controls are an independent observation. Active Fold / Call N / Raise (or Check / Bet) plus the hero timer can trigger a decision before a full-table refresh finishes. The displayed call amount is additional chips owed, not the raise-to amount.

## Using a camera or screen

Start the camera, or use **Share screen** on browsers that support it. Screen sharing requires a user gesture and browser permission. The source screen must show the action controls as well as the table.

Select **Pure portrait (5 seats)** for the portrait layout in the example. This is an explicit profile, not universal poker-client recognition. It checks button text, enabled button colors and the hero timer; reads the call price; samples monetary/action-label regions; and reads the two colored hero-card rank patches. Badge/level numbers are excluded by the region definitions. A missing timer, uncertain glyph or unexpected layout yields no active-turn claim. No external OCR package or AI credentials are required for this local path.

If filming a screen at an angle, choose **Frame source screen**, then click top left, top right, bottom right and bottom left on the full source image. A projective transform rectifies those corners for local recognition. Reframe after moving the phone or changing the source layout; reset the frame to remove calibration. Automatic felt cropping is separate: the original upright source, including bottom controls, is retained for local detection and AI reads.

**Other / automatic AI** uses the provider's controls observation. Both the full and short schemas include visibility, enabled state, Call/Check, the printed call amount, units and hero timer. Advance-action selections, disabled buttons, time-bank buttons and phone clocks are explicitly distinguished. AI-backed table/card reconciliation still requires an existing provider key. The local button detector alone does not know unobserved betting history or all opponent stacks.

## What happens on your turn

1. Confirm local controls across distinct frames at least 70 ms apart. A new call price immediately invalidates the preceding decision. Control disappearance or uncertainty clears the urgent turn strip; dashboard advice remains labeled with its tracked state. local observations expire after 900 ms without a new frame.
2. Allow outstanding table requests to finish, then send an urgent read from the full source if reconciliation is still needed. Follow-up reads retain bounded concurrency and a minimum interval. Obsolete session, rotation, crop, source-profile and hand responses cannot update the current decision.
3. Cross-check the button price against highest contribution minus hero contribution, all contributions, folded players, known stacks, cards, pot and seat turn. Contradictions identify what is being reread. A missing folded player's name is not required for advice.
4. Use a dedicated advice worker. Preflop charts do not wait for an equity simulation; postflop equity and action-value evaluation run off the UI thread. New scenario jobs terminate obsolete advice jobs. Background equity charts use a different worker. A bounded cache reuses exact decision states, including work computed before controls are confirmed.
5. Display the current turn and call price immediately. Keep dashboard advice available from the tracked scenario while recognition updates automatically. The urgent turn strip requires coherent current observations; inferred earlier actions are warnings and never require manual confirmation. Uncertain dashboard advice is labeled as based on the last tracked table.

The decision tracker stores timestamped observations and events separately from scenario mutation. Events distinguish control changes, active turns, contribution increases (with optional stack-delta corroboration), folds, chip sweeps, board growth, seat-map changes and new-hand candidates. A candidate hand transition is not alone permission to award a pot or invent a showdown. Existing card/hand reconciliation continues to require its confirmation checks.

## Recorded video and metrics

**Replay video** accepts a local video file. Playback is local; AI frame uploads occur only when provider-backed camera features are enabled. Pause/resume and the position slider allow inspection. Seeking cancels pending reads and invalidates decision observations.

For labeled regression measurements, with Playwright and Chromium available:

```sh
CHROMIUM=/usr/bin/chromium node scripts/replay-camera.js clip.mp4 labels.json
```

The runner disables provider credentials by default. Add `--live-ai` explicitly to exercise configured providers (this makes normal billable API requests). Labels use source-video time:

```json
{
  "profile": "pure",
  "intervals": [
    {"fromMs": 0, "toMs": 2000, "active": true, "toCall": 3, "hero": ["9c", "4h"]},
    {"fromMs": 2000, "toMs": 4000, "active": false},
    {"fromMs": 4000, "toMs": 5800, "active": true, "toCall": 30}
  ]
}
```

Optional `corners` uses the four normalized source-screen corners. Intervals must be ordered and non-overlapping. The report separates false turns, missed turns, wrong call prices, card checks, missed decision intervals and median/p95 detection/advice observation latency. No advice samples is reported as zero samples, not a successful speed measurement. `window.cameraDiagnostics()` exposes bounded, pixel-free event/timing diagnostics; it does not persist video or credentials. Application paint timings use two animation frames after a validated recommendation is inserted. The replay runner samples at 100 ms, so its displayed-advice timings have that sampling resolution.

Run deterministic checks:

```sh
npm test
CHROMIUM=/usr/bin/chromium node scripts/camera-check.js
CHROMIUM=/usr/bin/chromium node scripts/decision-check.js
```

The decision browser test covers active versus disabled controls, Call/Check OCR, colored cards, advice, invalidation, urgent preemption and structured-source ordering. To generate synthetic PNG fixtures, set `CAMERA_FIXTURES_DIR=/tmp/poker-replay` when running it. Synthetic tests establish integration behavior; they do not establish accuracy on the user's actual filmed screen. Evaluate glare, overlays, tiny fonts, variable timers, occlusion, chip sweeps, fast actions, layout changes and phone movement using real labeled recordings before tuning thresholds.

## Structured input for applications you control

A same-page producer can bypass image inference:

```js
const source = await window.connectPokerSource();
const status = source.push({
  sequence: 1,
  scenario: actualScenario,
  observation: {
    unit: 'chips', hero: ['9c', '4h'], board: [], pot: 5.5, toAct: 0,
    controls: { active: true, enabled: true, action: 'call', toCall: 3 },
    seats: [
      { bet: 1, stack: 49, folded: false },
      { bet: 4, stack: 23, folded: false },
      { bet: 0, stack: 70, folded: true },
      { bet: 0, stack: 126.5, folded: true, dealer: true },
      { bet: 0.5, stack: 148, folded: true }
    ]
  }
});
// Send increasing sequence numbers on changes and a heartbeat at least once per second.
// source.close() ends this source session.
```

`actualScenario` is the existing PokerScenario format containing the source's actual action history, starting stacks, dealer, blinds and cards. Observation stacks are chips remaining behind; unknown stacks are `null`. Seats start with hero and proceed clockwise. The adapter validates amounts, unique cards, seat indices, scenario replay and monotonic sequence numbers. It does not accept unsolicited cross-origin window messages or add a network listener. It requires integration in the source application; it does not extract private game state from third-party clients.

## Limits

The Pure profile is intentionally narrow. Its OCR thresholds and rank-patch geometry are starting values tested with synthetic fixtures, not a trained general detector or a promise of live-video accuracy. Other card layouts use the existing recognizer or AI. Card/pot observations can remain unavailable under occlusion. Full AI reads now preserve controls at the cost of a larger image; real recordings and provider latency measurements should guide further crop packing and model selection. No runtime model defaults were changed based on unmeasured speed claims.

Automatic recovery: repeated unchanged scenario refreshes keep the advice worker running. Local control changes never cancel table requests. Urgent reads wait for an existing read to finish and retry no faster than every 1.5 seconds. If the advice worker fails or times out, a compatibility calculation runs on the main thread (which may briefly delay UI updates).
