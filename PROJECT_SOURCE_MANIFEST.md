# Cat's Tower — Current Source and Authority Manifest

Updated: 2026-09-03 JST  
Repository: `2hg7trp7rv-design/cats_tower`  
Pipeline: `AI_NATIVE_V2`  
Current stage: `V2-0 bootstrap`

## 1. Current branch map

| Role | Branch | Write rule |
|---|---|---|
| active task | `task/v2-bootstrap` | current handoff writes only |
| integration / PR base | `kimi` | no direct writes |
| release history | `main` | frozen; no direct writes or V2 merge |

Current Draft PR: #9, `task/v2-bootstrap` → `kimi`.

Old statements that make `kimi` the only writable branch are stale for the current V2 workflow.

## 2. Claude Code entry package

Claude must start from:

1. `CLAUDE.md`
2. `docs/v2/CLAUDE_HANDOFF.md`
3. `docs/v2/PRODUCT_AND_SYSTEM_SPEC.md`
4. `docs/v2/VISUAL_DIRECTION.md`
5. `docs/v2/DECISION_REGISTER.json`
6. `.claude/settings.json`
7. `.claude/hooks/enforce-handoff.mjs`

These files do not supersede higher authority; they resolve it into a current Claude-operational contract.

## 3. Authority precedence

1. latest explicit user decision
2. `CURRENT_AUTHORITY_INDEX.json`
3. `quality-reviews/step-1-canonical-design/active-change-control-addendum-round-035.json`
4. `AI_PROJECT_POLICY.json`
5. current Claude handoff package
6. `MASTER_SPEC.md`
7. `FLOORS_1_10_DESIGN.md`
8. sealed `canonical/**`
9. current V2 code, tests and docs
10. S02 design package as reference only
11. legacy runtime and historical review files

## 4. Preserved product truth

- `MASTER_SPEC.md`: sealed product meaning and S01–S12 responsibilities.
- `FLOORS_1_10_DESIGN.md`: canonical first slice, roster and teaching order.
- `canonical/**`: IDs, screen states, transitions, numeric and policy contracts.
- `simulation/**`: preserved model evidence; not a substitute for browser/gameplay proof.
- Step 1/2/3 evidence: preserved and immutable unless a later authority explicitly opens it.

## 5. Current V2 implementation

- `apps/game/**`: React HUD, Phaser renderer and browser adapter.
- `packages/domain/**`: deterministic battle state and events.
- `tests/v2/**`: unit/domain behavior.
- `tests/e2e/**`: browser, viewport, determinism and console checks.
- `docs/v2/**`: architecture, bootstrap plan and current handoff.
- `dist/v2`: generated Preview build; not a source-of-truth file set.

Current bootstrap visuals and values are provisional and explicitly not production.

## 6. Visual source classification

### Working direction, not final approval

- `docs/v2/VISUAL_DIRECTION.md`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-art-direction.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-ui-design-system.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-information-priority.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-player-experience.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json`

### Reference assets, runtime unauthorized

- `step4/s02/golden-master-p1/**`
- prior screenshots and flattened Golden Master images

No complete reference screenshot is a runtime asset. No final user visual approval has been recorded.

## 7. Legacy/runtime classification

The following root files are legacy reference, not the V2 implementation base:

- `index.html`
- `app.js`
- `game-core.js`
- `game-data.js`
- `styles.css`
- `sw.js`

Do not extend, polish or silently migrate them during V2-0.

## 8. Known stale documents

- `CHATGPT_PROJECT_INSTRUCTIONS1.md`: contains pre-V2 branch and Step 4 rules. Read only for historical context below current authority.
- older `PROJECT_STATUS.json`, Step 4 manifests and review PASS labels: do not infer current production status.
- legacy Mugi introduction: conflicts with canonical frontline role.

## 9. Current gate

V2-0 requires:

- typecheck;
- unit tests;
- production build;
- Chromium at 320x568, 390x844, 430x932;
- WebKit at 390x844;
- deterministic state proof;
- reward/wave progression;
- zero console error and horizontal overflow;
- Vercel Preview evidence tied to the candidate commit.

Physical iPhone, production readiness and user visual approval remain separate and currently unverified.

## 10. Delivery packaging

The V2 quality workflow creates `cats2.zip` from the tracked head of `task/v2-bootstrap`. The archive places the complete tracked repository contents directly at the ZIP root, matching the established `cats1.zip` delivery convention. It excludes `.git`, dependency caches and untracked build residue.
