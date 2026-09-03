`simulation/candidate-v3.json`には、代表modelとしてshort/medium/long delivery route、offline cap等がある。Claudeはその数値をruntimeへ再実装せず、shared domain/dataから使用する。モデル値は`PASS_MODEL`であってhuman feelやruntime timingの最終承認ではない。

---

## 10. Growth

### 10.1 Coin level

- current-run coin levelは有限capなし。
- level up直後にdamage、speed、survival、撃破時間のどこが変わったか見える。
- large number contractを守る。

### 10.2 Evolution

- 100 levelごとにruby evolution資格。
- 未進化でも101、201、301以降へ進める。
- missed evolution stageは後から順番にcatch-upできる。
- 最初の意味ある塔還りのfree rubyで最初の進化を賄える設計。
- 100 levelごとに全身新規artを作らず、FX、UI、軽微な外見変化を中心にし、大型専用artは大節目だけ。

### 10.3 Rarity

`N < R < RR < SR < SSR < UR`

- base rarityとevolutionは別軸。
- N/Rは終盤も相性、低cost、塔還り直後、店舗・配送synergy、育成容易性で価値を持つ。
- URを全役割で常に一択にしない。
- 初期full-product目標は24 characters / 36 weapons。ただし代表proof前に量産しない。

---

## 11. 一つのreset「塔還り」

Canonical ID: `reset.tower_return`  
Display name candidate: `塔還り` — release前に名称・類似商標確認が必要。

- reset systemは一つだけ。
- Floor 1へ戻る。
- 保存編成、shop設定、automation、bulk purchase、known-floor acceleration等、canonicalで定義された加速を残す。
- 同じhighest floorを反復しただけでは新しいreset由来rubyを得ない。
- confirm前に`loss / keep / gain / reclear forecast`を表示する。
- server quote/commit、transaction ID、idempotencyで二重resetと二重rewardを防ぐ。
- 最初の有効tower return 20〜35分はsimulation target。実runtimeで確定していない。

旧Dawnとtower returnを二本立てにしない。

---

## 12. Gacha・重複熟練・公平性

### 12.1 Locked structure

- character gachaとweapon gachaは分離。
- card matching / comp gachaは禁止。
- first copyでcore roleが完成。
- full duplicate masteryを通常PvEの前提にしない。
- duplicate価値は後半ほど逓減。
- selector、exchange、universal fragment、rerun、overflowを持つ。
- 初日中にSSR character 1体とSR以上weapon 1本を、課金・広告なしで保証する。

### 12.2 Validation targets

- hard pity target: 100
- featured guarantee target: 200
- compatible banner-family carryover
- no-ad F2Pで30〜45日以内にfeatured UR guarantee 1回
- monthly acceleration: 約1.5〜2倍
- high-spend stress persona: 約3〜5倍上限target

これらはmodel/runtime検証対象であり、V2-0またはV2-1でlive wallet/gachaを実装してはならない。

### 12.3 Gacha screen truth

Draw前に次を表示する。

- odds
- current pity
- featured guarantee
- carryover family
- exchange
- duplicate conversion
- banner ending rule
- history

今回のcharacter gacha参考画像はvisual moodだけ。character/weapon分離と上記truth surfaceを追加しなければcanonical S10にならない。

---

## 13. Monetization・ads

- 初期広告はrewarded opt-inだけ。
- forced interstitialなし。
- permanent bannerなし。
- battle、boss、draw result、purchase、save recovery中に広告を出さない。
- offer ID/version、reward、eligibility、daily capはopt-in前に固定。
- retryで別offerへ黙って差し替えない。
- 初期版にPvP、guild competition、battle pass、競争報酬、密集limited eventsを入れない。

参考画像10のseason trackは、そのまま採用するとbattle-pass-likeであり初期scopeと衝突する。使えるのは情報整理、reward card、login calendarの見た目だけ。

---

## 14. S01〜S12 screen responsibilities

| ID | Responsibility | 今回のvisual reference |
|---|---|---|
| S01 | title、resume、account link、migration、deletion | 02 lobbyを修正利用 |
| S02 | battle follow、AUTO、support、offline reconciliation | 01 battle/supportを大幅修正 |
| S03 | unbounded tower、district、100F cycle、best floor、next milestone | 04 tower mapを無制限化 |
| S04 | floor clear、reward、choice | 専用完成見本なし。新規必要 |
| S05 | shop、income、delivery、automation、reconfigure | 05 commerceを低摩擦化 |
| S06 | character、rarity、coin level、evolution、mastery、party | 06 formationを4枠化 |
| S07 | weapon、equip、mastery、build、diagnosis | 08 forgeをsimplify |
| S08 | boss phase、telegraph、break、failure、retry | 03 bossをcanonical化 |
| S09 | tower return、loss/keep/gain、ruby、reclear forecast | 専用完成見本なし。新規必要 |
| S10 | character/weapon gacha、odds、pity、exchange、history | 07 gachaを二pool化 |
| S11 | wallet、store、payment、rewarded ads、entitlement | 一部10。Production transactionはlater |
| S12 | newcomer/monthly/returner login、inbox、history | 10をbattle passなしで再設計 |

1枚のnormal-state mockだけでscreen完成ではない。各screenは必要に応じてnormal、loading、empty、locked、pending、error、retry、recovery、reload、multi-tab、refund、revocation、restore、reduced motion、large textを持つ。

---

## 15. Visual production contract

### 15.1 Art direction

Working title: **塔内工房の四猫行軍**。

- premium pixel-art chibi
- logical pixel grid
- 約2.2〜2.7 heads tall
- crisp silhouette
- integer-scale export where applicable
- filtered high-resolution paintingをpixel artと呼ばない
- backgroundはstone、wood、brass、iron lift、chain、burgundy cloth、delivery shelf、crate、縦shaft
- 上方に続く空間でunbounded towerを示す
- clean palaceでもgeneric black dungeonでもない

### 15.2 Semantic palette

| Token | Value | Role |
|---|---:|---|
| ink primary | `#241711` | main text/line |
| ink secondary | `#5E493B` | secondary text |
| ink inverse | `#FFF7E8` | text on dark material |
| wood deep | `#2B1712` | deep frame/shadow |
| wood | `#4A2A1E` | main wood |
| wood light | `#714733` | raised wood |
| parchment | `#F4E5C5` | readable surface |
| parchment shadow | `#D8C29C` | depth |
| brass | `#C99A4A` | primary/current/selected trim |
| brass highlight | `#F3D58A` | restrained highlight |
| iron | `#56606A` | structural/locked |
| stone | `#59606A` | tower structure |
| velvet | `#6B2730` | burgundy cloth/accent |
| healthy | `#5C9762` | health/recovery |
| danger | `#B94E45` | danger/damage/error |
| information | `#4E7E9D` | information/ally utility |
| magic | `#8062A6` | enemy/magic separation |
| reward | `#DDAE43` | real reward event only |
| focus | `#F7E49C` | keyboard focus |

