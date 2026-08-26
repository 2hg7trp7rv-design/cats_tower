# Step 1 差分監査 Round 002 — ガチャ・ログインボーナス・課金・ゲーム内広告

文書状態: **IN_PROGRESS**

監査日: 2026-08-26  
Repository: `2hg7trp7rv-design/cats_tower`  
Branch: `kimi`  
開始HEAD: `e0c81edbb320dc65878d2ca9c83850aa7352145b`  
前Round: `round-001-diff-audit.md`  
追加Acceptance: `monetization-acceptance-round-002.json`

## 1. ユーザー指示

ユーザーは2026-08-26に、次をCat's Towerへ必要と明示した。

- ガチャ
- ログインボーナス
- 課金システム
- ゲーム内広告

したがって、Round 001で採用した「ガチャ、premium currency、広告、daily retentionを現行coreから除外する」という方針は失効する。旧記録は上書きせず、今回の指示で明示的にsupersedeする。

## 2. 再判定

### 2.1 否定側の検証

4機能を同時採用すると、次の重大な不利益が生じる。

1. 現在の2通貨・local save・決定論的解放契約が壊れる。
2. paid wallet、receipt、refund、ad callback、gacha結果をclientだけで安全に管理できない。
3. 9画面へ無理に押し込むと戦闘画面と猫の主役性が崩れる。
4. 3build×1,000だけでは、課金者・広告視聴者・無課金者の進行差とgacha裾確率を検証できない。
5. 猫ゲームとして未成年にも届きやすいため、年齢、購入保護、広告personalization、確率表示を後付けにできない。
6. character gachaを成立させるには、現在の12匹上限と第1地区4匹だけではpoolの厚みが不足し、アート・animation・balance工数が増える。

以上から、4機能を単純追加する案は不採用である。

### 2.2 再否定後の結論

それでも、ユーザーの事業要件として4機能は必要であり、Cat's Towerのhero×merchant構造とも両立できる。採用条件は、別ゲームとして足すのではなく、戦闘・商業・収集・復帰を一つのserver-authoritative economyへ統合することである。

**結論: 4機能を正式採用する。ただし現行正本を直接実装へ流さず、Step 1全体を再設計・再封印する。**

## 3. 採用する商品構造

### 3.1 無料で保証する中核

- ムギ、ルナ、トト、コハクは従来どおり公開条件で確実に加入する。
- 1F〜100Fの本編は無課金・広告非視聴でも完走可能にする。
- 前衛、対空、回復、後列妨害など、攻略必須roleは各1つ以上を無料入手できる。
- 呼び鈴、戦闘、保存、敗北診断、Dawnを課金や広告でロックしない。

### 3.2 ガチャ

仮称: **猫勇者スカウト**

ガチャ対象は次の二系統を候補とする。

1. 追加の冒険者猫
2. 既存猫の別style・別role

story進行そのものや、最初の4匹の基本形は有料ガチャへ閉じ込めない。character bannerに武器、coin、消耗品を混ぜて外れを水増ししない。固定価格packやcosmeticはガチャ外で販売する。

必須契約:

- 抽選はserverだけで行う。
- draw requestごとに一意IDを発行する。
- 同じrequestの再送は同じ結果を返し、二重消費しない。
- 各itemまたは曖昧さのない分類ごとの確率を購入直前に表示する。
- pity残数、carryover、banner終了時の扱いを表示する。
- draw履歴と消費履歴を閲覧できる。
- duplicate変換量を事前表示する。
- duplicateなしでも入手直後から通常使用できる。
- complete-gachaを禁止する。
- 期間限定終了後の再登場方針を表示する。

top rarity率、hard pity、10連保証、duplicate上限はsimulation前の確定値にしない。

### 3.3 通貨とentitlement

現行の2通貨制限は失効する。候補walletは次のとおり。

| 種別 | 用途 | 権威 |
|---|---|---|
| `currency.coin` | run内強化 | gameplay transaction |
| `currency.dawn-shard` | 恒久gameplay強化 | profile transaction |
| free premium currency | 配布・login・実績 | server wallet |
| paid premium currency | 購入対価 | server wallet + platform receipt |
| recruit ticket | 指定bannerのdraw権 | entitlement ledger |
| ad-removal | 広告除去 | non-consumable entitlement |
| monthly pass | 期間中の毎日grant | subscription/dated entitlement |

paid/free premium残高は分離する。購入通貨を失効させない。refund、revocation、restore、chargebackをwallet ledgerへ反映する。

### 3.4 課金商品

初期候補:

- premium currency pack
- 初回starter pack
- monthly pass
- cosmetic/style pack
- ad-removal

battle pass、season、ranking課金、guild課金は、現段階では追加しない。login bonusと課金基盤を作ることと、無制限なLiveOpsを同時に始めることは別である。

### 3.5 ログインボーナス

三系統を採用する。

1. 新規7日track
2. 月間28日track
3. 復帰player track

端末時刻を使わずserver日付で判定する。欠席一回で全streakを0へ戻さない。claimは一日一回、reload・複数tab・再送で二重取得しない。paid currencyをlogin bonusとして配らず、free premium、ticket、coin、cosmetic等を区別する。

### 3.6 ゲーム内広告

必須採用:

- 明示opt-inのrewarded ad
- ad-removal購入

条件付き候補:

- district result、offline return summary等の自然な区切りだけに置く低頻度interstitial

禁止:

- 戦闘中
- floor開始直前
- 選択した操作が実行される前
- gacha演出と結果の間
- 課金確認中
- save recovery中
- title起動直後

battle画面bannerは猫・敵・telegraphの可読性を壊すため不採用候補とする。

reward例は、offline収益の追加分、一定量のfree premium、補助item等を候補とする。ただし広告視聴だけで未見boss、猫解放、Dawn選択を自動突破させない。

## 4. 画面契約の変更

「9画面のまま全てをsheetへ押し込む」案を否定する。課金と確率表示を別責務へ分離しないと、誤購入、情報欠落、戦闘過密が起きる。

新候補は12画面。

| ID | 責務 |
|---|---|
| S01〜S09 | 既存gameplay責務 |
| S10 | Recruit / Gacha / odds / pity / history |
| S11 | Store / packs / monthly pass / ad settings |
| S12 | Login rewards / returner track / inbox / claim history |

S01〜S09を「core gameplay」、S10〜S12を「service economy」と分類してよいが、canonical registry上は12件を正直に登録する。暗黙screenや無関係なsheetへ隠さない。

## 5. Backendと保存への影響

現行localStorage中心のschemaでは、課金通貨とガチャを安全に扱えない。

必要なserver authority:

- account ID
- paid/free wallet
- immutable transaction ledger
- product catalog version
- receipt and webhook record
- draw request and result record
- pity state
- login claim ledger
- advertisement reward receipt
- entitlement and expiry
- refund/revocation
- customer-support lookup
- audit and reconciliation export

client saveは戦闘位置等の高速復元を担当し、paid stateの正本にはしない。guestからaccountへlinkする際の二重merge、rollback、別端末競合を検査する。

GitHub・Vercelのみという開発境界は維持できるが、Vercel FunctionsとVercel Marketplace経由のdatabase等、server-side resourceが新たに必要になる。provider選定と契約は別の明示承認対象であり、今回設定しない。

## 6. Simulationへの影響

現行3,000件では不足する。

最低run matrix候補:

- gameplay build: 戦闘 / 増援 / 商業
- monetization persona:
  1. F2P・広告非視聴
  2. F2P・rewarded ad視聴
  3. monthly pass
  4. 管理された課金persona

`3 builds × 4 personas × 1,000 seeds = 12,000 scenarios`

別に、gachaの確率、pity、duplicate、p90/p99取得cost、表示確率との一致を高sample Monte Carloで検査する。paid personaだけが100Fを完走できる結果は不合格とする。

## 7. Platform・法務境界

2026-08-26確認時点で、Appleはdigital contentやgame currency等のapp内unlockへIAPを要求し、購入を伴うrandom item mechanismでは購入前のodds表示を要求している。購入game currencyは失効させない契約が必要である。

Google Playもrandomized virtual itemの購入前かつ近接した位置でodds表示を要求し、予期しないfull-screen interstitialをgameplay開始や操作の途中へ出すことを禁止している。明示opt-inのrewarded adはこのunexpected-interstitial制限とは別に扱われる。

日本では、paid randomized collectionの組合せ報酬は「カード合わせ」規制に当たり得るためcomplete-gachaを禁止する。JOGAはrandom item salesの表示・運営guidelineを公開している。paid premium currencyは設計によって前払式支払手段の検討対象となるため、release前に専門家確認をGateへ含める。

この文書は法的助言ではなく、設計・監査上の停止条件を定める。

## 8. このRoundで変更しないもの

- runtime
- assets
- `simulation/candidate-v1.json`
- schema / validators
- Vercel configuration
- payment provider
- ad network
- Production alias
- physical iPhone status

## 9. 判定

`IN_PROGRESS`

4機能の採用方針は確定したが、正本文書、currency registry、screen registry、backend contract、candidate、schema、validator、simulation run planは未更新である。したがってStep 2以降へ進めない。
