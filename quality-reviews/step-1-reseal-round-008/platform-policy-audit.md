# Cat's Tower Platform Policy / Japan / Privacy Audit — Route 01-2

調査cutoff: **2026-08-26 23:59:59 JST**  
観測日: **2026-08-27**  
状態: **COMPLETE_PRESEAL / NOT LEGAL ADVICE**

## 1. Apple

### Digital goods / IAP
App内digital goods、currency、機能解除はApp Review GuidelinesのIAP規則をrelease gateとする。IAPで購入したgame currencyを失効させない。restorable purchaseにはrestoreを用意する。

### Randomized items
購入によりrandomized virtual itemを得るmechanismは、購入前に各typeのoddsを開示する。Cat's Towerではdraw確認画面の直前かつ同一画面近接位置にrate table version、item/rank odds、pity、featured guarantee、carryover、exchange、終了規則を表示する。

### Account deletion
account creationを提供する場合、app内から全account削除を開始できるようにする。一時停止だけでは不足。法的保持が必要なpayment/fraud recordは、保持範囲・期間・理由を明示する。IAP継続課金と削除の関係を説明する。

### Privacy / tracking / SDK
privacy policyは収集data、目的、third party、retention/deletion、consent revokeを説明する。広告・analytics・SSO SDKを含む全codeのdata practiceをApp Store Connectへ申告する。trackingに該当する場合はATT前にtrackingを開始せず、拒否でcore gameplayをgateしない。

## 2. Google Play

### Payments / Play Billing
Play配布mobile appのdigital goodsは、適用される地域program・例外を除きPlay Billingをrelease gateとする。catalog versionと表示内容を固定し、価格・期間・受取条件を明示する。

### Purchase verification
purchase token/transactionをsecure backendで検証する。`PENDING`ではgrantしない。`PURCHASED`確認後にexactly-once grantし、acknowledge/consumeする。app起動・foreground・RTDNで未処理purchaseをreconcileする。

### Randomized items
購入でrandomized virtual itemsを受け取るmechanismは、購入前かつ近接位置にoddsを表示する。rubyやpaid ticketを介する間接購入も内部release gateの対象とする。

### Refund / revocation / restore
RTDN・Developer API・store truthをserverで処理し、duplicate/out-of-order notificationに耐える。refund/revocationで無関係なfree ledgerを黙って消さない。restorable entitlementは再構築可能にする。

### Ads
unexpected ad、誤tap誘導、normal use阻害を禁止する。Cat's Tower初期版はさらに厳しくrewarded opt-inのみ。battle、boss、draw result、purchase、save recovery中に出さない。

### User Data / Data Safety / deletion
appと全SDKのdata access、collection、use、sharingをData Safetyとprivacy policyへ一致させる。account creationを提供する場合はapp内削除導線とpublic web resourceを用意する。fraud/security/legal retentionは明示する。

## 3. Japan

### 景品表示法 / card matching
有料かつ偶然性で取得する異なる複数itemを揃えることを条件に、別の経済上の利益を与える構造を禁止する。確率、pity、pickup、交換、終了、重複変換、商品valueを実態と一致させ、優良誤認・有利誤認を避ける。

### 資金決済法 / 前払式支払手段
有償rubyがサーバ型前払式支払手段に該当する可能性を前提に、発行主体、表示、未使用残高、届出/登録・供託/保全、サービス終了時払戻しを日本の専門家と確認する。paid/free ledgerと消費順を監査可能にし、有償残高を期限失効させない。

### 未成年者保護
無断・高額課金相談が存在するため、年齢・保護者control、OS/store purchase controlへの案内、spend warning、月次利用履歴、cooling-offと誤認させないrefund support、明瞭な価格、繰返し購入確認をrelease gateにする。exact cap・age assurance方式はtarget ageと法務判断後に固定する。

### Privacy / cross-border
利用目的、data minimization、安全管理、委託先監督、第三者提供、国外移転、開示・訂正・削除、漏えい対応をdata mapへ結合する。cloud、analytics、ad、support SDKの法人・所在国・subprocessorを確定し、必要な同意・情報提供を実装する。

## 4. Cat's Tower implementation gates

- S10: odds、pity、pickup、exchange、history、banner end/carryoverをdraw前表示
- S11: paid/free ruby、catalog version、purchase pending、refund/revocation/restore、rewarded adの報酬・capを表示
- S12: server time、claim history、same-day duplicate防止、missed-day挙動
- S01/account: account link、conflict、in-app deletion、web deletion resource
- backend: transaction ID、idempotency、receipt verification、RTDN/webhook、audit ID
- privacy: SDK inventory、data map、consent/ATT、Data Safety、App Privacy label
- support: purchase/draw/ad/reset audit IDをユーザーが確認可能
- release: Apple/Google policyをsubmission直前に再取得、日本法専門家sign-off

## 5. Non-conclusions

本監査は法的意見、store approval保証、tax/accounting判断ではない。事業主体、販売地域、target age、provider、currency design、未使用残高、SDK、data flowが確定したrelease前に専門家確認する。
