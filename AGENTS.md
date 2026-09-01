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
6. current mirrors

Do not infer current status from historical headers, chat history or old workflow files.

## Current boundary

- Repository Step: `4`
- Internal phase: `PHASE0-GOVERNANCE-RECOVERY`
- Active authority: `active-change-control-addendum-round-029.json`
- Planned Phase 0 closure: `round-030.json`
- Next product authority after closure: `round-026.json`
- Next product phase: `S02-P1-GOLDEN-MASTER`

Forbidden now:

- gameplay/runtime/economy/save mutation
- production asset generation
- backend/payment/ads
- sealed Step 1/2/3 mutation
- Production alias
- user approval or physical-iPhone inference

## Verification rule

Step 2 is `PASS_CONTRACT`, but its full source-bound verifier must run in an intact historical worktree because the Project instructions were intentionally replaced. At current HEAD verify the immutable seal and every seal binding. Do not modify the seal to make current instructions match.

## Truth labels

- Step 1: `PASS_CANONICAL`
- Step 2: `PASS_CONTRACT`
- Step 3: `PASS_MODEL`
- Step 4: `IN_PROGRESS`
- legacy root: `LEGACY_RUNTIME_NOT_CANONICAL`

Never write unscoped `PASS`. Files, code, images, build, tests, CI, screenshots and Vercel READY are insufficient alone.
