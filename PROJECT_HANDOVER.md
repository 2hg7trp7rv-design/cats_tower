# Cat's Tower — V2 Handover

Repository: `2hg7trp7rv-design/cats_tower`  
Release-history branch: `main`  
V2 integration branch: `kimi`  
Task branch pattern: `task/*`

## Current state

The user explicitly approved AI-native verified vertical-slice development and instructed execution. Round 035 transitions away from the governance-first S02 gate.

Preserved:

- product canon
- 1–10F design
- stable IDs and state contracts
- Step 2 executable contract
- Step 3 model evidence
- immutable quality history

Reference only:

- legacy root runtime
- existing S02 Golden Masters
- stale PR 8 framing

## Immediate route

1. close PR 8 without merge
2. create `task/v2-bootstrap` from the exact transition commit
3. add the V2 workspace, minimal game shell and `v2-quality-gate`
4. open a Pull Request to `kimi`
5. verify build, browsers, viewports and Vercel Preview
6. establish branch protection after the first check context exists
7. start `task/first-playable-combat`

Production, payment, ads, live gacha and physical-device PASS remain unauthorized.
