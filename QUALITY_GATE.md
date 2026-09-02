# Cat's Tower — V2 Quality Gate

Authority: `CURRENT_AUTHORITY_INDEX.json`

```text
PIPELINE: AI_NATIVE_V2
STAGE: V2-0-BOOTSTRAP
PRODUCTION_ALLOWED: false
PRODUCTION_READY: false
PHYSICAL_IPHONE_VERIFIED: false
```

## Bootstrap gate

- task branch and Pull Request target `kimi`
- typed build succeeds
- unit smoke succeeds
- Playwright Chromium and WebKit smoke succeed
- 320×568, 390×844 and 430×932 render without losing primary information
- uncaught console errors are zero
- Vercel Preview is attached to the PR
- `main`, Production aliases and sealed historical evidence are unchanged

## First Playable gate

The game must visibly and causally execute:

`move → telegraph → attack → hit → damage → defeat → coin → level-up → next enemy`

The same seed must produce the same event sequence, a three-minute soak must pass, and final feel is judged on a physical iPhone. CI, build success or Vercel READY alone is never sufficient.
