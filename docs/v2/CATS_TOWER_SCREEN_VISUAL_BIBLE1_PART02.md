- S01としてtitle、resume、account link、migration、deletion、guest/account状態を扱う。
- daily/login情報はS12へdeep linkし、S01をreward dashboardにしない。
- current run snapshot、last floor、offline pending等を真実に基づき表示する。

## 4.4 REJECT

- merchant chairman portraitがplayer avatarとして主役になる
- 5-member permanent partyの示唆
- company management gameに見えるcopy
- fake mail、mission、campaign badge
- image-baked titleをそのままruntime UIとする

## 4.5 Runtime decomposition

- layered tower key-art background
- four-cat cast layer
- runtime title/logo layer
- `ResumeCard`
- `AccountStatus`
- `MigrationRecovery`
- `OfflineSummaryPreview`
- `LoginInboxShortcut`

---

# 5. Reference 03 — 地区ボス戦

![地区ボス戦](visual-reference1/03_boss_battle_reference.webp)

## 5.1 Intended contribution

normal battleとは異なるboss scale、HP、timer、phase spectacle、4体partyの同時戦闘を示す。

## 5.2 KEEP

- normal enemyより明確に大きいboss
- violet threatとwarm party lightの対比
- full-width boss HP
- timer/phase urgency
- impact eventへcontrastを集中する
- party4体がそれぞれ攻撃している密度
- boss専用support deck/panelという情報のまとまり

## 5.3 CORRECT

- bossはS08責務としてphase、telegraph、break、failure、retryを持つ。
- canonical four catsへ置換し、各役のsource/path/targetを読めるようにする。
- manual skill rowは実canonical active inputが存在する場合だけ表示する。
- AUTO modeで動くskillをfake tappableにしない。
- boss attack telegraphは最低限の予告時間と形状を持つ。
- hit stopはlocal poseだけにし、domain/UI全体を止めない。
- failure後はsurvival/damage/counter/economy診断を表示する。
- timerとHPはruntime text。

## 5.4 REJECT

- 4個の派手なskill buttonを見栄えのためだけに置く
- shop itemをtap連打してdamageを出す
- boss HP、combo、damage、timerを画像に焼く
- bossが常に画面を占有し、catsが判別不能になる
- S02 normal battleを毎回このscaleにする

## 5.5 Runtime decomposition

- boss entity with phase states
- telegraph layer
- break gauge/status
- four-cat entities
- boss HP/phase/timer components
- support status, not fabricated deck
- failure diagnosis/retry overlay

---

# 6. Reference 04 — 塔マップ

![塔マップ](visual-reference1/04_unbounded_tower_map_reference.webp)

## 6.1 Intended contribution

vertical ascent、current floor、cleared/next/boss/shop nodes、rewardsを一画面で見せるS03の方向。

## 6.2 KEEP

- 下から上へ進むvertical composition
- current floorの強いanchor
- normal/elite/treasure/shop/bossのnode differentiation
- cleared、current、lockedを位置・形・labelで区別する考え方
- next floor preview
- tower wallの深い縦空間

## 6.3 CORRECT

- 「100階の塔」をunbounded towerへ変更する。
- 100Fはcycle milestoneとして表示し、終端capにしない。
- current district、100F cycle、best floor、next milestoneを表示する。
- scroll/virtualizationで非常に大きいfloorを扱う。
- current vicinityを中心にし、全floorをDOMへ展開しない。
- generated district/cycle IDsとlarge number formatterを使う。
- floor node stateをcanonical registryへbindingする。
- next milestoneの先にも続くshaftを見せる。

## 6.4 REJECT

- 100Fでmapが終わる
- floor capをprogress bar 100%として扱う
- fake reward node
- exact competitor tower-map layoutのcopy
- locked/ownedを色だけで区別する

## 6.5 Runtime decomposition

- virtualized vertical node route
- current floor anchor
- district/cycle header
- best floor and next milestone
- node state component family
- layered shaft background with repeat/extension

---

# 7. Reference 05 — 店舗・配送・商会支援

![店舗・配送](visual-reference1/05_shop_and_delivery_reference.webp)

## 7.1 Intended contribution

制圧階に存在するshop、production/delivery、income、automation、chain effectを温かいworkshop cardで見せるS05の方向。

## 7.2 KEEP

- floorごとに異なるshop roomが存在する感覚
- shop identityをvisualで区別する
- delivery ETAとforecastを読めるcard
- upgrade effectを事前表示する
- chain/synergy summary
- wood/brass workshop material
- automation statusの可視化

## 7.3 CORRECT

- production queueはcombat supportのforecastとして簡潔化。
- collect actionを主loopにしない。
- deliveryはautomatic。
- shop incomeは自動反映またはserver reconciliation。
- individual floor collectionを要求しない。
- stock countを日常補充作業にしない。
- 4つのlaunch shop roleはDPS、生存、coin flow、reclear speedに結びつける。
- placement/reconfigureのcostとcombat lockを事前表示する。
- failed communicationはpending/retry/recoveryを持つ。
- S02ではsummaryのみ、詳細はS05へ移す。

## 7.4 REJECT

- mandatory collect-all
- individual collection chores
- manual restocking
- timerごとのclaim spam
- shop level連打が唯一のplay
- merchant/chairman identityの復活
- floorごとの毎回配置強制

## 7.5 Runtime decomposition

- shop card family
- delivery route/ETA/forecast
- effect-to-combat explanation
- automation status
- placement/reconfigure
- pending/retry/reconciled states
- no fake claim button

---

# 8. Reference 06 — 編成

![編成](visual-reference1/06_four_cat_formation_reference.webp)

## 8.1 Intended contribution

character detail、combat stats、role、weapon、position、owned roster、formation saveを示すS06の方向。

## 8.2 KEEP

- selected characterを大きく見るdetail pane
- role icon/label
- equipment slotとの近接
- formation gridとroster cardの同時比較
- build axisやcommerce traitを補助情報として持つ考え方
- save/confirm actionの明確さ

## 8.3 CORRECT

- 常設formationはexactly 4 slots。
- 画像内の5体編成文言、6つの配置枠は不採用。
- `field / owned / available / locked / unknown`をtruthfulに表示する。
- unowned/locked characterをfieldへ出さない。
- stateはlabel＋frame/icon/position等、最低2つのnon-color channelで示す。
- primary 4 rolesを読みやすいpositionへ置く。
- temporary supportは別section。
- coin level、evolution、masteryを別軸で説明する。
- N/Rが弱いだけのcard presentationにしない。
- 200% textで2×2 reflowできる。

## 8.4 REJECT

- 5体または6体常設編成
- colorだけのlock/rarity/state
- unavailable characterのfield previewをactive stateとして表示
- party slot horizontal carousel
- exact statを画像に焼く

## 8.5 Runtime decomposition

- `CharacterDetail`
- `PartyGridFour`
- `RosterCard`
- `OwnershipState`
- `CoinLevel`
- `EvolutionTrack`
- `MasteryTrack`
- `TemporarySupportSeparate`

---

