# Step 1 変更監査 Round 003 — 無制限塔・強くてニューゲーム・進化・重複スキル

文書状態: **IN_PROGRESS**

監査日: 2026-08-26  
Repository: `2hg7trp7rv-design/cats_tower`  
Branch: `kimi`  
開始HEAD: `2eeec8511d7cac7459af3672d04f101f23d4c8bd`  
上位変更管理: `quality-reviews/step-1-canonical-design/active-change-control.json`  
追加Acceptance: `progression-acceptance-round-003.json`

## 1. 今回の指示をそのまま整理した結果

今回の指示は、既存正本の細部変更ではない。少なくとも次の製品境界を再定義する。

1. 塔は100F完結ではなく、プレイヤーから見て上限なしとする。
2. 商人サーガや魔王「世界の半分あげるって言っちゃった」のように、進行を戻して恒久的に強くなる「強くてニューゲーム」機能を持つ。
3. 商人サーガ由来の店・収益・仲間・再投資・周回テンポは残すが、プレイヤーを商会会長として見せる大きな物語・管理要素は外す。
4. キャラクターはコインでレベルを上げ、レベル100ごとにルビー進化の資格を得る。
5. 進化しなくても101以上、201以上へレベルを上げられる。
6. ルビーは課金、強くてニューゲーム、リワード広告から入手する。
7. キャラクターの重複入手はキャラスキルレベルへ変換する。
8. 武器にもガチャ入手と重複による武器スキルレベルを設ける。
9. キャラクターと武器のレアリティは`N → R → RR → SR → SSR → UR`とする。
10. N・Rはガチャなしでも入手可能、RR〜URはガチャ経路で入手する。
11. キノコ伝説は、放置進行・ガチャ・技能・仲間・進化を結び付ける抽象構造の参考とする。
12. リセットは商人サーガと魔王「世界の半分あげるって言っちゃった」の抽象構造を参考にする。

## 2. 先に否定した案

### 2.1 「無制限」を無限個の手作り階として扱う案

不可能である。デジタル製品に文字通り無限の固有素材、敵、背景、物語を格納することはできない。

採用する意味は「プレイヤーに見えるハード上限を置かず、データ駆動の周期・modifier・boss・報酬曲線で継続生成できる」ことである。実装は10F地区、100Fサイクル、節目boss、modifier pool、反復抑制、任意精度のfloor IDを持つ。

### 2.2 既存Dawnと強くてニューゲームを両方残す案

不採用。二つの周回機能が並ぶと、何を失い、何を残し、どの通貨を得るかが重複する。UI、保存、simulation、課金経済も二重化する。

強くてニューゲームを唯一のprestige systemとし、Dawnは統合・改名・廃止のいずれかにする。Dawn shardもルビーと並立させる明確な理由がなければ廃止候補とする。

### 2.3 進化を100レベルごとのレベル上限解除にする案

ユーザー指示と矛盾するため不採用。レベルと進化を別軸にする。

```text
evolutionEligibleCount(level) = floor(level / 100)
evolutionStage <= evolutionEligibleCount(level)
```

レベル350、進化1のキャラクターは、そのままレベル350を維持し、後から進化2・3を順番に購入できる。

### 2.4 重複1体ごとに無制限で倍率を積む案

不採用。高レアを大量に重ねた課金者だけが無限に強くなり、無制限塔の難度曲線が検証不能になる。

重複はキャラ別・武器別のskill progressへ変換し、hard cap、必要数表示、上限後overflow変換を持たせる。初回入手だけでそのキャラ・武器の主な役割は完成していなければならない。

### 2.5 ルビーを一つの無区分残高にする案

不採用。購入、リセット報酬、広告報酬は出所が異なる。UI上は合計を見せても、サーバー台帳では`paidRuby`と`freeRuby`を分離し、消費順、返金、取消、監査を残す。

## 3. 現在の最有力製品構造

> 猫の冒険者たちを育て、店と配送の支援を受けながら上限のない塔を登り、行き詰まったら強くてニューゲームで恒久成長して、前回より高い階へ挑む放置インクリメンタルRPG。

- 主役は猫の冒険者。
- プレイヤーは猫たちを導く存在であり、商会会長を名乗る必要はない。
- 店舗、収益、配送、人材募集は戦闘支援の仕組みとして残す。
- 100Fは第一部の大きな節目であり、エンディングではない。
- 10F単位の地区と100F単位の大サイクルを組み、上階ほどmodifierと敵役割の組合せを変える。
- 強くてニューゲームでfloor、coin、run level等を戻し、ruby、取得キャラ・武器、skill、進化、課金権利等を保持する。

## 4. 強くてニューゲームの固定候補

### 失う候補

- 現在floor
- run coin
- run内のキャラクターレベル
- run内の店舗レベル
- 一時遺物
- 一時状態
- 現在戦闘・敵・配送draft

### 残す候補

- 取得済みキャラクター
- 取得済み武器
- レアリティ
- キャラskill level
- 武器skill level
- evolution stage
- paid/free ruby
- ガチャpity・履歴
- 購入権利
- 図鑑、実績、最高floor
- 恒久解放

### 得る候補

- 新しい最高floorと一度限りの節目に基づくfree ruby
- 既知floorの高速再攻略
- 前回構成の復元
- 周回回数と記録

同じ最高floorまでの反復だけでrubyを増殖させない。課金ruby、広告ruby、reset rubyはtransaction sourceを分ける。

## 5. キャラクター成長

### 5.1 コインレベル

- レベル上限は設けない。
- 100、200、300…を越える時に進化を強制しない。
- bulk、MAX、自動配分を前提にし、数千回の手動レベルアップを最適操作にしない。
- 保存とsimulationでは大数・丸め順を一元化する。

### 5.2 進化

- 100レベルごとに進化資格を1つ追加する。
- 進化にはルビーを使う。
- 未進化でもレベルを続けて上げられる。
- 後から未購入分を順番に追いつける。
- 進化の見た目、skill変化、倍率は候補値であり未確定。
- free no-ad personaが強くてニューゲーム由来rubyだけで標準進化 cadenceを維持できなければ不合格。

### 5.3 キャラスキル

- 重複キャラはキャラ固有skill progressへ変換する。
- 初回1体で役割が成立する。
- 重複でskill効果、cooldown、範囲、追加効果等を段階強化する。
- hard capと上限後overflow変換を持つ。
- exact cap、必要重複数、倍率は未確定。

## 6. 武器成長

- character gachaとweapon gachaを分ける。
- 武器も`N/R/RR/SR/SSR/UR`を使う。
- 初回武器で主効果が使える。
- 重複で武器skill progressを得る。
- skill cap後はoverflowを定義する。
- random statを無制限に付ける方式は、今回の指示には含まれないため採用しない。
- 既存の塔共通武装3系統は、weapon gachaと競合するため再設計対象。役割相性の思想は残せるが、1枠3系統だけという旧上限はそのままでは維持できない。

## 7. レアリティと無料経路

固定順:

```text
N < R < RR < SR < SSR < UR
```

- N/Rは物語、floor reward、shop、reset exchange、login reward等から確定入手可能にする。
- 正常攻略に必要な前衛、対空、回復、後列妨害等はN/Rで一通り揃える。
- RR〜URはcharacter/weapon gachaまたはそのpity・交換経路から入手する。
- 特定RR〜URを持たないとmain progressionが停止する設計は禁止。
- N/Rが序盤で完全に不要になる設計も不合格。進化、skill、相性、低cost育成等で長期用途を残す。

## 8. ルビーの経済上の最大リスク

ルビーは進化にもガチャにも使われ得る。これは選択性を作る一方、進化を人質にガチャ課金へ誘導する危険がある。

したがって、正本redlineでは次を必須にする。

1. 強くてニューゲームだけで標準進化に必要なfree rubyが得られる。
2. rewarded adは追加取得であり、進化の必須条件ではない。
3. paid rubyなしでも上限のない塔を継続できる。
4. ガチャticketとrubyの役割を分ける案もsimulationで比較する。
5. 進化costとガチャcostを同じ残高へ載せる場合、F2P no-adの機会損失を明示する。
6. paid/free rubyの消費順を公開する。

## 9. 画面責務

12画面案を維持し、追加の13画面は現時点で作らない。

- `S03`: 無制限tower、10F地区、100F cycle、過去最高floor、次の節目
- `S06`: キャラrarity、coin level、100level進化、進化待ち、キャラskill
- `S07`: weapon rarity、weapon skill、装備比較、build
- `S09`: 強くてニューゲームの失う/残る/得る、ruby予測、再攻略予測
- `S10`: character gacha / weapon gachaの分離、rate、pity、duplicate conversion
- `S11`: ruby、課金商品、rewarded ad、広告削除
- `S12`: login、復帰報酬、受取履歴

## 10. シミュレーションへの影響

旧100F全件だけでは不十分となる。新しい検査は少なくとも次を含む。

- 1〜10F初回
- 初回100F milestone
- 1,000F medium horizon
- 10,000Fまたは数学的に同等のlong horizon
- 複数回の強くてニューゲーム
- N/Rのみ
- RR/SR/SSR/URを含む各構成
- 進化遅延、進化追いつき
- キャラskill 0〜cap
- 武器skill 0〜cap
- free no-ad、ad利用、pass、payer
- rubyの購入/reset/ad source別ledger
- gacha tail、pity、duplicate、overflow
- BigInt/decimal serialization、NaN/Infinity/精度喪失0件

固定の最大floorを完走条件にせず、floor速度、reset cadence、ruby収支、停止率、成長率、相対build差、長期数値安定性を判定する。

## 11. 参考作品から採用する範囲

### キノコ伝説

Appleの公式商品説明は、放置でstageが進むこと、装備gacha、skillと進化、仲間募集を製品の中心として説明している。Cat's Towerではこの「放置進行＋収集＋skill＋進化」の抽象接続だけを参考にする。

今回の`N/R/RR/SR/SSR/UR`はユーザーがCat's Towerへ指定した独自registryであり、キノコ伝説の公式rarity表をそのまま転用したものとは扱わない。UI、rate、gacha level、live-ops、PvP、名称、artはコピーしない。

### 魔王「世界の半分あげるって言っちゃった」

Appleの公式商品説明に、Soul Reverseで勇者と仲間が強くなるprestigeが明記されている。進行を戻して恒久成長へ変換する抽象構造だけを参考にする。

### 商人サーガ

公式説明からは仲間雇用、店、武器・item仕入れでtower攻略を支える構造を参照する。App Storeレビューで語られる周回・ruby・高floor・広告過多・bulk不足は定性資料であり、正確な内部式の証拠ではない。広告割込みや大量手動level上げは失敗例として扱う。

## 12. 現在判定

- Product direction: 受領・変更管理へ追加
- Canonical redline: 未実施
- Candidate/schema/validator: 未変更
- Runtime/backend/assets: 未変更
- Vercel Production: 未変更
- Step 1: `IN_PROGRESS`
- Step 2〜6: BLOCKED by change control
- Physical iPhone: `NOT_VERIFIED`

このRoundは方向の受領とAcceptance追加であり、完成判定ではない。
