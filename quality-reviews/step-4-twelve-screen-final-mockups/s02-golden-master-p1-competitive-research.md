# S02 Golden Master P1 競合・公式資料調査

## 調査条件

- 調査日: 2026-09-02 UTC
- Research date: 2026-09-02
- 対象: Cat's Tower S02 通常戦闘画面の本番品質 Golden Master と、その後の資産制作・runtime 再構築に必要な設計判断
- 調査作品: 10作品。2026-09-02 時点で公式サイトまたは公式ストア掲載を確認できる作品に限定した。
- 優先証拠: 公式ゲームサイト、Apple App Store、Google Play。転載、ランキング、攻略まとめは独立証拠として数えていない。
- 調査限界: 地域・アカウント・A/B test で異なる live UI、全チュートリアル、全 viewport の実挙動は、公式掲載だけでは保証できない。採用判断は公式説明・掲載画像・公式映像から確認できる抽象原則に限定する。
- コピー境界: キャラクター、敵、背景、exact UI 配置、固有名称、アイコン、演出、商品、価格、確率、数式、画像素材は一切コピーしない。

## 結論

S02 の第一印象は「放置ゲームの機能一覧」ではなく「四体の猫が無制限塔で今まさに戦っている」でなければならない。競合から採用するのは、戦闘中心の焦点、個体を識別できる大きさ、撃破と報酬の近接、上方進行、商業詳細の画面分離、猫らしい仕草、素材と光の統一である。

固定する優先順は次の通り。

1. 猫4体と通常敵の接敵・攻撃
2. 現在階
3. 現在目標または敵脅威
4. 予備動作、攻撃、着弾、被弾、撃破、報酬の因果
5. 次の主要操作「編成を整える」
6. 恒常4枠の状態
7. 商会・店舗・配送の戦闘支援
8. 二次イベント・商業導線

### 横断比較: 戦闘と情報読解

| 作品 | 公式掲載資料から想定する3〜5秒の第一印象 | 戦闘・character占有 | threat / HP / progress | reward / AUTO / 編成 |
|---|---|---|---|---|
| 商人サーガ | 塔攻略と商売 | 多数進行が先、個体は小さめ | 階進行が主、個体threatは弱い | 商業支援が強く、S02では要約化が必要 |
| 魔王「世界の半分…」 | 上へ登り続ける | 群衆の進行が主 | 階更新が強い | 放置進行は明快、4体identityには変換が必要 |
| キノコ伝説 | 戦闘と成長reward | 主characterと強化導線が強い | 短い戦闘feedbackは強い | rewardは近いが通知・召喚密度を削る必要 |
| Cats & Soup | 猫の暮らしと仕草 | 猫の魅力が最優先 | combat threatは対象外 | ownership/役割の愛着形成を採用 |
| AFK Journey | 商用品質のparty戦闘 | characterとeffectが高品質 | 敵味方・threatを光で分離 | 手動skill/人型heroは不採用 |
| Shop Titans | 店舗・製作・支援 | 戦闘より管理責務が明瞭 | battle HPは主題外 | 商業を別画面へ分ける原則を採用 |
| Legend of Slime | 中央の短い戦闘 | 単独hero中心 | HP・damage・rewardが近い | 常設skill列は4体AUTOに不適合 |
| Fortress Saga | 移動と奥行き | 巨大fortressが中心 | 距離・敵・effectが読みやすい | UI/world統合を採用、巨大主役は不採用 |
| Seven Knights Idle Adventure | 多character auto battle | 複数体を常時表示 | progressとcombat feedbackが強い | 4体lane設計を採用、多人数/skill密度は削る |
| Cat Snack Bar | 猫と店舗作業 | 猫と設備を同時に見せる | combat threatは対象外 | 商業も猫世界へ統合する原則を採用 |

### 横断比較: モバイルUXと継続動機

| 作品 | UI密度・階層 | primary / bottom navigation | 商業導線 | 狭幅・縦長での示唆 | tutorial・魅力・継続 |
|---|---|---|---|---|---|
| 商人サーガ | 店と進行が近く高密度 | 強化・進行が前に出る | 主loop | S02では店舗説明を折畳む | 上方進行と商売の相互強化 |
| 魔王「世界の半分…」 | 階進行が最上位 | 進行操作が明快 | 従属 | 狭幅でも階を残す | 階更新を継続報酬にする |
| キノコ伝説 | 導線・通知が多い | 強化/召喚が強い | 強い | S02では二次導線を先に消す | 高頻度reward、ただし過密化注意 |
| Cats & Soup | 観察対象を中心に整理 | 施設/猫の選択 | 世界内へ統合 | 縦長は空間と猫の仕草に使う | 猫の個体愛着が継続動機 |
| AFK Journey | 焦点と余白の完成度が高い | 戦闘操作は明瞭 | 別層 | 高さをscene depthへ使う | character presentationの高級感 |
| Shop Titans | 責務別navigationが明瞭 | 店舗操作が主 | 主loop | 詳細を別screenへ分離 | 制作→販売→支援の循環 |
| Legend of Slime | 中央戦闘+下部能力が高密度 | skill/成長が近い | 別層 | S02では常設skillを削る | 短い撃破と数値成長 |
| Fortress Saga | sceneとUIの素材統一 | 進行/強化導線が明瞭 | 従属 | 縦長はparallax/depthへ | 世界が動き続ける期待 |
| Seven Knights Idle Adventure | 多人数・能力で高密度 | 編成/成長へ接続 | 別層 | 4体を縮めずlane再配置 | roster収集は採用せず個体識別だけ採用 |
| Cat Snack Bar | 明るい統一shape | 店舗作業が主 | 主loop | 補助設備を省き猫を残す | 猫の仕草と作業成果 |

公式掲載では全作品の320 CSS px、430×932、TEXT200、初回tutorial全手順を同条件で再生できない。そのため、上表を端末互換の証明には使わず、S02独自の7 viewport browser evidenceで検証する。

## 10作品比較

### 1. 商人サーガ「魔王城でお店開けって言われた」

- Source type: GOOGLE_PLAY
- Official URL: https://play.google.com/store/apps/details?hl=ja&id=com.cyberxgames.akindosaga
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [Google Play](https://play.google.com/store/apps/details?hl=ja&id=com.cyberxgames.akindosaga)
- 公式掲載資料から想定する3〜5秒の強み: 商人、店舗、塔攻略が同じループに属し、商業が進行を助ける意味を短く伝える。
- 弱点として扱う点: 戦闘と店舗情報を同格にすると、敵・HP・個体行動より管理 UI が先に読まれる。
- 採用する抽象原則: 商業を寄り道でなく「次の戦闘を強くする支援」として因果付ける。
- Cat's Tower への変換: 戦場下には「配送到着」「前衛防具支援中」等の実状態を一行だけ置き、商品、価格、購入は S05 等の専用責務へ送る。
- 採用しない点: 店舗詳細の常設、広告割込み、タップを直接 damage に変える操作。
- コピー禁止: 商人、魔王城、商品、画面配置、固有名称、価格、数式、画像。

### 2. 魔王「世界の半分あげるって言っちゃった」

- Source type: GOOGLE_PLAY
- Official URL: https://play.google.com/store/apps/details?hl=ja&id=com.cyberxgames.herotower2
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [App Store](https://apps.apple.com/jp/app/id1160690385)、[Google Play](https://play.google.com/store/apps/details?hl=ja&id=com.cyberxgames.herotower2)
- 公式掲載資料から想定する3〜5秒の強み: 上へ進み続ける塔と放置進行が明快で、階更新そのものが継続動機になる。
- 弱点として扱う点: 多数の小ユニットを並べる方式は、四体それぞれの顔・装備・被弾を読ませる S02 に合わない。
- 採用する抽象原則: 現在階と上方への継続を常に同じ視界へ置く。
- Cat's Tower への変換: 階数を戦場上端の塔標識へ統合し、撃破後は床・遠景・階表示を同期して上へ進める。
- 採用しない点: 群衆密度、識別不能な縮小、有限の終点に見える進捗率。
- コピー禁止: 魔王・勇者、階段構図、ユニット列、固有文言、数値、数式。

### 3. キノコ伝説：勇者と魔法のランプ

- Source type: OFFICIAL_SITE
- Official URL: https://kinoden.acenetgamejp.com/
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [公式サイト](https://kinoden.acenetgamejp.com/)、[Google Play](https://play.google.com/store/apps/details?hl=ja&id=com.mxdzz.jp.and)
- 公式掲載資料から想定する3〜5秒の強み: 戦闘、強化、報酬の更新が連続し、成果を大きく認識できる。
- 弱点として扱う点: 召喚、期間導線、通知、強化を同時に強調すると、初見の視線が戦闘から分散する。
- 採用する抽象原則: 撃破位置と報酬の発生・移動を近接させる。
- Cat's Tower への変換: damage、enemy reaction、HP低下、defeat、statusを明示したcoin feedbackを一つの短い連鎖にする。P1のGM06 captureは確定ではなく『見込み』を表示する。
- 採用しない点: 通知バッジの多用、大量召喚を主操作にすること、戦場下を強化ボタンで埋めること。
- コピー禁止: キノコ、ランプ、召喚、赤点、固有アイコン、価格、確率、報酬式。

### 4. Cats & Soup

- Source type: GOOGLE_PLAY
- Official URL: https://play.google.com/store/apps/details?hl=en&id=com.hidea.cat
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [Google Play](https://play.google.com/store/apps/details?hl=en&id=com.hidea.cat)
- 公式掲載資料から想定する3〜5秒の強み: 猫の仕草、職務、環境、小物が同じ世界観に属し、遠目でも猫が主役だと分かる。
- 弱点として扱う点: 観察主体の穏やかさをそのまま戦闘へ移すと、敵脅威と着弾因果が弱くなる。
- 採用する抽象原則: 猫の個性を能力アイコンではなく、輪郭、毛色、装備、姿勢、動作で伝える。
- Cat's Tower への変換: 前衛制御、遠隔対空、回復支援、後衛撹乱を、全必須viewportでvisible-alpha高60 CSS px以上、390×844では68 CSS px以上でも見分けられるsilhouetteにする。
- 採用しない点: 低緊張のままの戦闘、施設群の同格表示、敵の不在。
- コピー禁止: 猫の容姿、調理施設、背景、小物、アニメーション、UI。

### 5. AFK Journey

- Source type: OFFICIAL_SITE
- Official URL: https://afkjourney.farlightgames.com/official/
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [公式サイト](https://afkjourney.farlightgames.com/official/)、[Google Play](https://play.google.com/store/apps/details?hl=en&id=com.farlightgames.igame.gp)
- 公式掲載資料から想定する3〜5秒の強み: キャラクター仕上げ、敵味方分離、光と色による焦点、世界と戦闘の統合が高い。
- 弱点として扱う点: 人型英雄、盤面、手動 ultimate、カットインを採ると Cat's Tower の猫4体 auto battle が変質する。
- 採用する抽象原則: 味方と敵を向き・色温度・輪郭光で分け、重要な着弾だけ一時的に明度を上げる。
- Cat's Tower への変換: 味方側は琥珀、敵側は低彩度青紫、中央接触点は中立光。猫の毛色は状態色で塗り替えない。
- 採用しない点: 一般的人間主人公、手動 skill、盤面配置、通常戦闘を止める映画的カットイン。
- コピー禁止: 英雄、衣装、UI、スキル、背景、演出、名称、数式。

### 6. Shop Titans

- Source type: OFFICIAL_SITE
- Official URL: https://playshoptitans.com/
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [公式サイト](https://playshoptitans.com/)、[Google Play](https://play.google.com/store/apps/details?id=com.ripostegames.shopr)
- 公式掲載資料から想定する3〜5秒の強み: 店舗、製作、販売、英雄支援を別の画面責務として理解しやすく整理する。
- 弱点として扱う点: 店舗管理の密度を通常戦闘へ持ち込むと S02 の責務が崩れる。
- 採用する抽象原則: 商業の価値は戦場で短く再確認できるが、操作詳細は専用画面に分ける。
- Cat's Tower への変換: S02 は「適用中」「到着予定」「次回強化可能」の実状態と一つの導線だけを表示する。
- 採用しない点: 店舗フロア、顧客操作、製作 slot、価格・在庫の常設。
- コピー禁止: 店舗、商品、キャラクター、UI、アイコン、価格、数式。

### 7. Legend of Slime: Idle RPG War

- Source type: GOOGLE_PLAY
- Official URL: https://play.google.com/store/apps/details?hl=en&id=com.loadcomplete.slimeidle
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [Google Play](https://play.google.com/store/apps/details?hl=en&id=com.loadcomplete.slimeidle)
- 公式掲載資料から想定する3〜5秒の強み: 敵との距離、HP、攻撃数値、撃破報酬が中央の短い視線導線に集まる。
- 弱点として扱う点: 単独主人公と常設 skill 列は、四体の猫を脇役にし、存在しない active skill を暗示する。
- 採用する抽象原則: 一時数値は着弾点へ出し、必要な時間だけ残す。
- Cat's Tower への変換: 通常時は敵HPと目標を残し、damage、critical、heal、reward は実 event 時だけ表示する。
- 採用しない点: 単独 hero、常設 skill button、画面を覆う能力 icon、直接 tap damage。
- コピー禁止: slime、skill、敵、背景、effect、固有数値、商品。

### 8. Fortress Saga: AFK RPG

- Source type: OFFICIAL_SITE
- Official URL: https://fortress.cookapps.com/
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [公式サイト](https://fortress.cookapps.com/)、[Google Play](https://play.google.com/store/apps/details?hl=en&id=com.cookapps.bm.fortresssaga)
- 公式掲載資料から想定する3〜5秒の強み: 背景の奥行き、移動方向、敵との距離、effect、UI 質感が一つの商用画面として統合される。
- 弱点として扱う点: 巨大要塞を主役にすると、猫四体の輪郭と個体差が小さくなる。
- 採用する抽象原則: 前景、地面、中景、遠景を分け、戦闘体を最も強い contrast 帯へ置く。
- Cat's Tower への変換: 塔内部の床 lane、上方の昇降路、側面の配送機構で進行と支援を示す。巨大兵器は置かない。
- 採用しない点: 移動要塞、極小 hero、兵器操作、横長構図の単純移植。
- コピー禁止: 要塞、英雄、背景構造、UI、effect、数値、商品。

### 9. Seven Knights Idle Adventure

- Source type: OFFICIAL_SITE
- Official URL: https://skidle.netmarble.com/en
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [公式サイト](https://skidle.netmarble.com/en)、[Google Play](https://play.google.com/store/apps/details?hl=en&id=com.netmarble.skiagb)
- 公式掲載資料から想定する3〜5秒の強み: 複数キャラクターを常時見せながら、敵側・進行・戦闘 feedback を商用品質でまとめる。
- 弱点として扱う点: 多人数 roster、常設能力列、通知密度をそのまま使うと、四体の identity と通常戦闘の因果が薄まる。
- 採用する抽象原則: 4体前後の常時表示では、役割別の silhouette、前後 lane、選択状態を一貫させる。
- Cat's Tower への変換: 四体を同じ一列へ縮小せず、前衛・後衛・撹乱 lane へ分け、party card と battlefield の衣装・毛色を一致させる。
- 採用しない点: 多人数化、手動能力の常設、通知・成長導線の過密化。
- コピー禁止: キャラクター、陣形、UI、skill、icon、背景、商品、数値。

### 10. Cat Snack Bar

- Source type: GOOGLE_PLAY
- Official URL: https://play.google.com/store/apps/details?hl=en&id=com.tree.idle.catsnackbar
- Official source checked: 2026-09-02
- Hands-on/live UI verification: NOT PERFORMED
- 公式資料: [Google Play](https://play.google.com/store/apps/details?hl=en&id=com.tree.idle.catsnackbar)
- 公式掲載資料から想定する3〜5秒の強み: 猫、店舗、報酬を統一形状でまとめ、猫の役割と作業を短時間で読ませる。
- 弱点として扱う点: 店舗設備を戦場と同じ面積・密度で示すと通常戦闘が脇役になる。
- 採用する抽象原則: 商会・配送も猫の世界の出来事に見せ、別製品の dashboard にしない。
- Cat's Tower への変換: 配送箱、商会印、到着 cue を背景小物と従属支援帯へ統合し、管理詳細を分離する。
- 採用しない点: 店舗 layout、作業席の大量表示、全操作の経営化。
- コピー禁止: 制服、店舗設備、料理、看板、固有 UI、価格。

## 公式UI・Web資料から固定する数値

| 公式資料 | S02への拘束 |
|---|---|
| [Apple: Designing for games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games) | 装飾量より、ゲームの主役、入力の明瞭さ、継続的 feedback を優先する。 |
| [Apple: Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | 実寸と hierarchy を明示し、文字を装飾として極小化しない。 |
| [Apple: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | safe area、利用可能領域、content hierarchy を端末名でなく viewport で扱う。 |
| [Android: Accessibility in apps](https://developer.android.com/guide/topics/ui/accessibility/apps) | label、focus、十分な target、色だけに依存しない状態を実装 contract に含める。 |
| [Android: Window insets](https://developer.android.com/develop/ui/views/layout/insets) | system bar、cutout、gesture area を inset として扱い、下部 nav を重ねない。 |
| [WCAG 2.2: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | AAの最低条件を完成目標にせず、S02内部基準はprimary 48 CSS px以上、その他の重要操作44 CSS px以上とする。 |
| [WCAG 2.2: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | 通常文字4.5:1。3:1は最終computed sizeが通常weightで24px以上、またはweight 700以上で18.667px以上の文字だけに許し、他は4.5:1とする。 |
| [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) | 200% text、focus、reflow、非色依存の検査を browser acceptance に含める。 |
| [CSS Values and Units Level 4](https://www.w3.org/TR/css-values-4/) | `dvh` / `svh` を使い、browser bar 変化で戦場・nav・modal が隠れないようにする。 |

P1内部規格は次の通り。

- 意味のある本文、button、状態名、navigation label: 14 CSS px 以上。
- 補足 metadata、時刻、補助 badge: 12 CSS px 以上。metadata に重要な操作・状態を入れない。
- Primary操作: 48×48 CSS px 以上。その他の重要操作: 44×44 CSS px 以上。
- 320px幅でも文字・target・猫を縮小せず、短文化、reflow、collapse、scroll continuation で対応。
- 猫visible-alpha高は全必須viewportで60 CSS px以上、390×844で68以上。敵は全必須で80以上、390×844で96以上。
- 通常文字 contrast 4.5:1 以上。3:1は最終computed sizeが通常weightで24px以上、またはweight 700以上で18.667px以上の文字だけに許し、他は4.5:1。木目や金属 highlight を contrast の代用にしない。
- TEXT200はcomputed font-sizeを基準値の厳密2.0倍にし、transformやscreenshot zoomで代用しない。現在階、敵HP、目標、AUTO、四枠状態、主要操作、navigationを欠落させない。

## 調査をS02の設計へ接続する決定表

| 根拠 | 採用決定 | 検証 |
|---|---|---|
| 戦闘と商業を同格にすると主役が曖昧 | 戦場を最大領域、商会・配送は戦場可視面積の18%以下 | 5秒理解、面積計測 |
| 四体は個体差を読める大きさが必要 | 猫visible-alpha高は全必須viewportで60px以上、390×844で68px以上。顔・装備の65%以上可視 | 全7 viewport |
| 報酬導線は増えやすい | reward は実 event 時だけ、defeat anchor から一度だけ表示 | GM01/GM06比較、data binding |
| 上昇は階数だけでは弱い | 遠景・床・floor marker を一つの上昇文法にする | GM01/GM05/floor transition |
| 高級感は装飾量でなく一貫性 | 木、真鍮、鉄、石、布の役割・光源・角丸・線幅を token 化 | component audit |
| 狭幅で一律縮小すると破綻 | P2説明と装飾を先に削り、戦場・14/12px文字・primary 48px/重要44px targetを維持 | GM02/GM04/TEXT200 |
| 存在しない skill は虚偽 | AUTOは状態表示、主要tapは編成遷移、直接damage操作を置かない | action inventory |
| 猫ゲームは個体の愛着が継続動機 | battlefield と card の毛色・衣装・装備を同一 model sheet へ結ぶ | identity diff |

## 参考画像の扱い

- ユーザー提示の01〜10は構造・質感・密度・世界観の設計入力。11〜16は表示画面のスクリーンショットで、独立したデザイン証拠として数えない。
- 採用候補: 温かい木、真鍮、鉄、石、暗赤布、猫を中心にした高密度、中央戦闘、cardとbattleの一体感、奥行き。
- 不採用: 参考09の小さい戦場と大きい店舗領域、戦闘中の「出撃」、右側の任務列、参考02のboss scale・skill row、画像内に焼かれた日本語・数字。
- 参考画像、競合画像、Golden Master完成画像をそのまま runtime background に使わない。透明button重ね、単純crop、競合traceを禁止する。

## 本番品質基準

調査件数、資料量、build、CI、Vercel READYは視覚品質の代用にならない。合格候補となるには、独立したGM01〜GM08、全7 viewport、文字・target・safe area、戦闘因果、四状態、asset分解、実data接続、独立批評を同じexact commitへ結び、未解決P0/P1を0にする必要がある。ユーザー視覚承認前の最大判定は `READY_FOR_USER_VISUAL_REVIEW` であり、S02完成、Step 4 PASS、Step 5開始、Production Ready、physical iPhone確認済みを宣言しない。
