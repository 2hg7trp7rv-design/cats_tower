# Cat's Tower — Agent Map

Current authority: `CURRENT_AUTHORITY_INDEX.json`  
Active control: `quality-reviews/step-1-canonical-design/active-change-control-addendum-round-035.json`

```text
PIPELINE: AI_NATIVE_V2
STAGE: V2-0-BOOTSTRAP
INTEGRATION_BRANCH: kimi
TASK_BRANCH_PATTERN: task/*
PULL_REQUEST_BASE: kimi
PRODUCTION_ALLOWED: false
PHYSICAL_IPHONE_VERIFIED: false
EXISTING_S02_VISUAL_APPROVAL: false
```

## Execution rule

After the round-035 transition bridge, do not write directly to `kimi`. Work on one small `task/*` branch, open a Pull Request to `kimi`, run the V2 quality gate, inspect the browser result and Preview, then recommend merge only when the scoped outcome is real.

## Read only as history or reference

- legacy root runtime
- existing S02 Golden Masters
- historical addenda and evidence
- PR 8 framing

## Never infer

- CI green is not gameplay quality
- Vercel READY is not user approval
- model PASS is not runtime playtest
- emulator PASS is not physical-iPhone PASS
