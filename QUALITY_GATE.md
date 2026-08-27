# Cat's Tower — 完成判定と工程Gate

更新日: **2026-08-27**  
現在工程: **Step 1 Round 008 final preseal review — IN_PROGRESS**  
Step 2〜6: **BLOCKED UNTIL VALID LIVE SEAL**  
物理iPhone: **NOT_VERIFIED**

本書は有限100F・非ガチャ時代の旧Gateを現行製品へ流用しない。過去PASS、workflow成功、Vercel `READY`は履歴・build証拠に限り、無制限塔・ガチャ・収益化版を単独承認しない。

## G1 要求適合

- 最新ユーザー決定、Project source、active change-control、正本候補のcoverage matrixに未対応0。
- 塔上限なし、100F milestone、101F+、常設4体、一時増援別層、tap damage 0、single reset、uncapped level、ruby evolution、rarity、separate gacha、mastery、login/payment/rewarded ads、server authority、S01〜S12を満たす。

## G2 正本・repository整合

- repository-wide tracked pathと旧主張13familyを分類。
- current-authority superseded assertion=0、unclassified path=0、unclassified match=0。
- active entrypoint、status、handover、policy、simulation/workflow mirrorが同じ工程・next actionを示す。
- historical Acceptance/PASS/audit/deployment evidenceはbyte変更しない。

## G3 Contract closure

- `FLOORS_1_10_DESIGN.md`が10F後11Fへ接続し、N/Rだけで主要役を満たす。
- `canonical/STABLE_ID_REGISTRY.json`が24 characters、36 weapons、wallet、tickets、banner/pity/guarantee、exchange/overflow、product/entitlement/login/ad/reset/tower/transaction/audit、read-only aliasesを閉じる。
- `canonical/SCREEN_STATE_REGISTRY.json`がS01〜S12のauthority、normal/loading/pending/failure/retry/reload/multi-tab/refund/revocation/restoreを閉じる。
- `canonical/STATE_TRANSITION_CONTRACT.json`がdraw/payment/ad/login/reset/evolution/mastery/account link/deletionをidempotentに閉じる。
- `canonical/STEP2_DEPENDENCY_CLOSURE.json`がStep 2のfields/enums/units/invariants/fixtures/migrations/validator/result/evidenceを推測なしで固定する。

## G4 経済・確率・長期進行

Step 1では意味と検証条件を固定し、exact値の合否はStep 2/3へ送る。

- 3 builds × 5 personas × 1,000 seeds以上。
- 1〜10F、100F、1,000F、10,000F相当、repeated resets、30〜45日経済。
- first reset 20〜35分、repeat-best ruby 0、no-ad F2P evolution coverage。
- first-copy/practical/full mastery、N/R utility、UR non-dominance。
- gacha p50/p90/p99、100 hard pity、200 featured guarantee、carryover、exchange、overflow。
- monthly 1.5〜2x、高額stress 3〜5x候補、unbounded paid multiplier禁止。

## G5 Server・payment・ads・privacy

- permanent economyとentitlementはserver authority。
- transaction ID、idempotency、race、retry、multi-tab、partial completion、refund、revocation、restore、fraud/replay、guest link、account deletionを検証対象にする。
- `canonical/POLICY_RELEASE_GATES.json`のApple、Google、日本、privacy、minor-protection gateをreleaseまでfail-closedにする。
- submission直前policy refreshと専門家確認がない限りrelease PASS禁止。

## G6 製品・UX・mobile

Step 1では画面責務と検証要求を固定する。完成mockup・物理端末検証は後工程。

- 猫、戦闘、塔、育成が5秒で主役と分かる。
- battleへshop/gacha/store/login詳細を常設しない。
- 320×667、375×667、390×844、safe area、large text、reduced motionをStep 4受入対象にする。
- physical iPhone証拠なしに実tap、haptic、thermal、battery、PWA復帰をPASSにしない。

## G7 競合・独自性

- 公式/store/policy/regulator/review/inferenceを分離。
- 競合から採用するのは抽象構造のみ。
- UI、固有名称、character/weapon、画像、animation、exact式、確率、価格、広告文言をコピーしない。
- unsupported exact competitor valuesは`NOT_PUBLICLY_VERIFIED`。

## G8 独立批評

次の10criticとfinal judgeを分離する。

1. product/originality
2. merchant/combat
3. unbounded tower/big number/reset
4. economy/probability/monetization
5. duplicate mastery
6. server authority/fraud
7. Apple/Google/Japan
8. privacy/minors
9. S01〜S12/mobile density
10. repository/canonical consistency

未解決P0/P1が1件でもあればseal/PASS禁止。

## G9 Evidence binding

1. frozen content commit/tree
2. strict JSON/path/reference validation
3. exact changed paths・forbidden path 0
4. matching `kimi` Preview ID/URL/state/target/commit/branch
5. critic/judge evidence commit
6. seal commit
7. direct descendant activation/completion evidence
8. live HEAD/tree/status/seal read-back
9. Production alias unchanged

## 状態語

- `IN_PROGRESS`: 制作・監査中。完成報告禁止。
- `BLOCKED`: 制作側だけで解消不能。
- `PASS`: 適用Gate合格、P0/P1=0、exact evidence有効。
- `READY_TO_START`: 前工程PASS後の次工程開始許可。製品完成を意味しない。

現在Step 1はfinal mirror sync/critics/judge/seal中で`IN_PROGRESS`。Step 2開始は禁止。
