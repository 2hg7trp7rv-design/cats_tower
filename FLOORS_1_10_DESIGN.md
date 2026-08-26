# Cat's Tower 1〜10F設計 — 01再統合待ち

文書状態: **PENDING_REVALIDATION — NOT_AUTHORIZED_FOR_IMPLEMENTATION_OR_SIMULATION**  
更新日: **2026-08-26**  
作業branch: **既存の`kimi`のみ**  
上位正本: [`MASTER_SPEC.md`](./MASTER_SPEC.md)  
現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**  
次の担当: **`01_正本仕様・競合調査`**

このファイルの2026年8月25日版は、有限100F・公開条件のみの猫解放・Dawn・9画面・3,000scenarioを前提とした旧下位正本だった。現在の製品境界と競合するため、旧`PASS — STEP1_CANONICAL_FREEZE`を失効させる。

旧詳細はGit履歴のcommit `d3f617fcd9b992a83ec95214a93ad2ce1a2682af`以前から参照できる。履歴証拠は削除しないが、現行実装・simulation・画面制作の入力にしない。

## 1. この文書の現在の役割

01で次を再設計・再封印するためのscope guardである。

- 最初のproduction sliceを1F〜10Fに限定
- 無制限塔の第1地区としての役割
- 戦闘、店舗、配送、キャラ、武器、進化、reset、gacha、loginの初回導線
- S01〜S12との対応
- server-owned状態とlocal gameplay状態の境界
- 既存の敵、店舗、猫、boss、物語の再利用可否

具体的な階別配置、解放条件、報酬、数値、演出時間は、01のredlineとStep 2の検証前に確定扱いしない。

## 2. 現在固定されている上位境界

- 塔はプレイヤーから見て上限なし
- 100Fは最初の大型節目。101F以降も継続
- 1〜10Fは最初の実装sliceであり、塔全体の終点ではない
- プレイアブルは猫と猫人
- 常設編成は4体。一時増援は別layer
- tapによる直接damageは0
- auto battleとoffline progressを基礎にする
- resetは一つだけ。旧Dawnは統合・改名・廃止
- reset後は1Fから高速再攻略
- コインlevel無制限、100levelごとにruby進化資格
- character/weapon rarityは`N < R < RR < SR < SSR < UR`
- character gachaとweapon gachaを分離
- 初回入手で機能完成、20体分以上は任意の長期完全熟練
- S01〜S12を使用
- 恒久経済・抽選・権利はserver authority

## 3. 1〜10Fで保持する最低scope

次は上位正本から継承する最低境界であり、01で削除する場合は新しいユーザー決定が必要。

| 分類 | 最低境界 |
|---|---|
| core cats | ムギ、ルナ、トト、コハクに無料・確定経路を持たせる |
| active party | 4体 |
| temporary reinforcement | 3役割以上 |
| normal enemies | 6種を目標下限として再検証 |
| elite enemies | 2種を目標下限として再検証 |
| district wall | 1遭遇。追加の敵species水増しにしない |
| district boss | 3phase以上を候補として再検証 |
| selectable shops | 4種以上を候補として再検証 |
| support facilities | 2種以上を候補として再検証 |
| tower browse | 制圧済み・現在・次の節目を閲覧可能 |
| shop loop | 比較、配置、配送、再配置、自動復元 |
| first reset | 20〜35分目標の最初の有効resetを含める |
| first evolution | 最初のreset由来無料rubyで支払える |
| beginner acquisition | character/weapon gachaの初回状態を含める |
| first-day guarantee | SSR character 1体＋SR以上weapon 1本 |
| save/resume | 戦闘・選択・通信境界を復元可能にする |

上表の数値は最低scopeまたは再検証候補であり、旧階別表の復活を意味しない。

## 4. 01で必ず再設計する項目

- 1F〜10Fの各floor roleとtutorial順序
- 4体編成の加入・選択・gacha導線
- 無料core catsとRR〜UR取得の境界
- weapon初回取得、装備、duplicate mastery
- level 100到達、ruby表示、最初のevolution
- 最初のstrong new gameの提示、lose/keep/gain、1F再開
- newcomer loginと初日保証
- S10〜S12を含む画面遷移
- network failure、claim retry、draw retry、purchase pending、refund/restoreの状態
- 既存店舗・敵・boss・物語の採用、変換、不採用
- local saveとserver account/walletの分離
- 大数、seed、ID、analytics、support audit ID

## 5. 現在禁止する旧前提

- 10F後は100Fで終了すると教える
- 101F以降を禁止する
- 猫取得を公開条件だけに限定し、gachaを持たない
- 3択Dawnを独立resetとして維持する
- 9画面だけで完結させる
- 100F・3,000scenarioの旧candidateへ直結する
- 旧数値を実装定数として使用する
- localStorageだけでruby、draw、pity、entitlementを管理する

## 6. 完了条件

このファイルは、01で以下を満たした場合だけ再び正本へ昇格できる。

- repository-wide contradiction inventoryと対応
- `MASTER_SPEC.md`、`PROJECT_STATUS.json`、S01〜S12と一致
- floorごとの正常・異常stateを定義
- stable IDとmigration aliasを定義
- backend trust boundaryを定義
- Step 2 dependency closureを作成
- 独立批評の未解決P0/P1が0
- exact commit/tree-bound Step 1 seal

それまでは`PENDING_REVALIDATION`であり、実装・simulation・完成見本を許可しない。
