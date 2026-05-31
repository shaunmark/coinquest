# CoinQuest

Pixel-art high-fantasy expense tracker. Log spending, earn XP and loot,
and slay the Savings Dragon by ending days under budget.

## Run locally
```
npm install
npm run dev
```

## Deploy to GitHub Pages

### One-time setup
1. Create a GitHub repo (e.g. `coinquest`) and push this folder to the `main` branch.
2. Open `vite.config.js` and set `base` to match your repo:
   - Project page `USER.github.io/coinquest` -> `base: "/coinquest/"`
   - User page `USER.github.io` -> `base: "/"`
3. On GitHub: **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.

### Deploy
Just push to `main`. The included GitHub Actions workflow builds and publishes
automatically. Your site appears at `https://USER.github.io/coinquest/`.

### Manual alternative (no Actions)
```
npm install
npm run build
npm run deploy   # pushes dist/ to a gh-pages branch via gh-pages package
```
Then set Pages source to the `gh-pages` branch.

## Known gaps (prototype)
- Emoji placeholder art (swap for real sprites later)
- No persistence yet — refresh resets progress (add localStorage / IndexedDB)
- Day advances via the END DAY button, not a real calendar
