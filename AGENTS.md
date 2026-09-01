# Cat's Tower — Repository Agent Rules

Updated: **2026-09-02**

## Hard lock

- Repository: `2hg7trp7rv-design/cats_tower`
- Write branch: existing `kimi` only
- Always pass `branch=kimi`
- No branch creation/switch/write/delete
- No PR, merge, rebase, cherry-pick or force-push
- No Production/public/provider/destructive operation without explicit user approval

## Start here

1. `CURRENT_AUTHORITY_INDEX.json`
2. its `activeChangeControl`
3. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
4. `DEVELOPMENT_PLAYBOOK.md`
5. task-specific canonical and Acceptance
6. current status mirrors

Do not infer current status from a sealed document's historical header or from chat history.

## Current boundary

Current repository Step: **4**  
Current internal phase: **Phase 0 governance recovery**  
Active Phase 0 authority: `active-change-control-addendum-round-028.json`  
Next product authority after recovery: `active-change-control-addendum-round-026.json`  
Next product phase after recovery: **S02-P1 Golden Master**

During Phase 0 follow round 028. During S02-P1 follow round 026 and its Acceptance.

Forbidden now:

- gameplay/runtime/economy/save mutation
- production asset generation
- backend/payment/ads
- sealed Step 1/2/3 mutation
- Production alias
- user approval or physical-iPhone inference

## Truth labels

- Step 1: `PASS_CANONICAL`
- Step 2: `PASS_CONTRACT`
- Step 3: `PASS_MODEL`
- Step 4: `IN_PROGRESS`
- legacy root: `LEGACY_RUNTIME_NOT_CANONICAL`

Never write unscoped `PASS`.

## Completion

Files, code, images, build, tests, CI, screenshots and Vercel READY are insufficient alone. Require actual artifact inspection, downstream usability, state/failure coverage, independent criticism, P0/P1=0, and commit/tree/evidence binding.
