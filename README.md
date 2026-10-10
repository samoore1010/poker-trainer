# Hand Walkthrough Table

A single-file poker hand trainer. Deal against 1–8 opponents (or set up any hand by picking or describing the cards), step through flop, turn, river and showdown, and read your hand strength, improvement odds, and what beats you.

- No build step, no dependencies: `index.html` is the whole app (fonts load from Google Fonts).
- Opens directly from disk, or serve it with any static host (GitHub Pages, Netlify, Vercel, Railway static).

## Run locally

Open `index.html` in Chrome. Opening it as a file also enables the microphone button in the card picker, which hosted viewers often block.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.
