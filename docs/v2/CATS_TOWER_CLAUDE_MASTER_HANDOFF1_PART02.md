- 人間勇者または商会会長が主人公になる。
- 猫が小さなマスコット扱いになる。
- 100Fでendingになる。
- 敵をtap連打してdamageを出す。
- collect-all、個別回収、在庫補充が日課の中心になる。
- 5体または6体を常設編成にする。
- 黒い半透明boxを重ねただけのgeneric UIになる。
- 生成画像を一枚貼っただけでゲーム画面と呼ぶ。
- 低rarityが数学的に死に、URだけが全役割で常に正解になる。

---

## 4. 想定プレイヤーと利用環境

- 主対象はスマートフォン縦画面のプレイヤー。
- 短時間の確認でも進行が分かり、長時間ではbuildと成長の判断がある。
- auto battleとoffline progressを基礎にする。
- ユーザーはPCなし・スマホ中心で開発管理するため、Claude側がcode、tests、GitHub、Preview、browser inspection、証拠を担当する。
- 技術判断をユーザーへ丸投げしない。
- ユーザーへ戻すのは、最終的な見た目の好み、fun/feel、重大product変更、課金・法務・Production・外部account、物理iPhoneだけ。

---

## 5. 中核game loop

### 5.1 Locked causal order

`movement → engagement/range → anticipation → release/contact → projectile arrival/impact → damage/HP change → hit reaction → defeat → reward → next encounter/floor`

この順序は見た目だけではなくdomain stateとeventで成立させる。

禁止例:

- 弓が着弾する前にHPが減る。
- 敵が生きているのに報酬が出る。
- 同一撃破で報酬が複数回出る。
- animation timerやCSS callbackが恒久報酬を発行する。
- screenshot用fixtureがownershipやwalletの真実になる。

### 5.2 Player input

- 敵へのdirect tap damageは`0`。
- battleはauto。
- active inputは、編成、coin level、装備、build、任意skill timing、shop/delivery最適化、tower return判断。
- AUTOはbattle modeの状態表示であり、active skill buttonではない。
- 実dataがないmanual skill rowをS02へ捏造しない。

### 5.3 Failure diagnosis

敗北時に「戦力不足」だけを出さない。最低限、次を識別する。

- 前衛崩壊・生存不足
- damage不足・時間切れ
- 対空不足
- 回復・状態解除不足
- backline disruption不足
- 配送未着またはshop支援不足
- 武器・build不一致

特定のSSR/URを唯一の解決策として提示しない。

---

## 6. 常設4体

常設battle slotは**4**。一時増援は別layerであり、曖昧な5枠目ではない。

| Stable ID | 名前 | 基礎rarity | 役割 | 確定加入 | 視覚識別 | 装備・色 |
|---|---|---:|---|---|---|---|
| `character.launch.001` | ムギ | N | frontline-control | 開始時 | 低い重心、brace、接触点 | クリーム〜生姜色、えんじscarf、丸盾、短剣 |
| `character.launch.002` | ルナ | R | ranged / anti-air | 3F救出 | 長弓、上向き照準、明確なrelease | 赤褐色、moss green hood、弓、矢筒 |
| `character.launch.003` | トト | N | healing-support | 5F救出 | 味方向きの予備動作、短いheal arc | 銀白色、teal coat、薬鞄、真鍮bell |
| `character.launch.004` | コハク | R | runner / backline disruption | 8F救出 | 前傾、dash path、return path | charcoal、plum mantle、軽いboots、hook blades、長いtail |

重要:

- 旧「ムギは戦わない商人」はstale。ムギは前衛combatant。
- N/Rだけで前衛、対空、回復、後衛妨害を満たす。
- higher rarityは速度と戦術を増やすが、本編、塔還り、進化、必須役割をgateしない。
- first copyで広告どおりのcore roleが機能する。
- sprite、portrait、animation間で毛柄、顔、体格、武器数、利き手を変えない。

### V2-1の4体と1〜10F加入順の関係

V2-1 First Playableは、combat architectureと四役の可読性を証明する代表proofとして4体を同時に出してよい。これはcanonical 1F onboardingそのものではない。V2-2の1〜10F sliceでは、ムギ開始、3Fルナ、5Fトト、8Fコハクの加入順を実装する。

---

## 7. 上限のない塔

- player-visible最大階は存在しない。
- districtは10F単位。
- 10Fは最初のdistrict boss。
- 100Fは最初の大型milestoneでありendingではない。
- 101F以降も通常進行する。
- district、100F cycle、modifier pool、milestone boss、背景変化をdata-drivenにする。
- floor、HP、ATK、coin、cost、reset count、offline rewardはJavaScript safe integerを超える。
- canonical valueはnormalized decimal stringまたはversioned arbitrary-precision型を使う。
- permanent valueをunsafe `Number`、`NaN`、`Infinity`、暗黙丸めへ落とさない。

参考画像にある「100階の塔」は**画面構図の参考**であり、製品名・終点仕様としては不採用。

---

## 8. 1〜10F canonical slice

| Floor | 教える価値 | Combat / unlock | 主screen |
|---:|---|---|---|
| 1F | 5秒でauto battleを理解 | ムギ、最初のweapon、coin level | S02、S06 |
| 2F | 強化→撃破速度の因果 | 近接＋小型遠距離、level改善 | S02、S06 |
| 3F | rangeとanti-air | 飛行敵、ルナ救出、最初のshop choice | S04、S05、S06 |
| 4F | shop→delivery→combat | 配送forecast、一時buff | S02、S05 |
| 5F | 最初のboss節目 | telegraph、break、トト救出 | S08、S04 |
| 6F | recruitmentは二次 | core価値を見せた後にgacha解放 | S10 |
| 7F | first copyとmasteryの分離 | mastery tutorial、universal fragment予告 | S06、S07 |
| 8F | runnerとdelivery統合 | wall/backline enemy、コハク救出 | S04、S05、S06 |
| 9F | build選択 | combat / reinforcement / commerce比較 | S07 |
| 10F | district bossと継続 | 3 phase boss、district clear、11F unlock | S08、S03、S09 forecast |

10F後は11Fへ進む。10F到達だけで意味のない塔還りを強制しない。

---

## 9. 店舗・配送・一時支援

### 9.1 役割

店舗と配送は次へ寄与する。

- DPS
- 生存
- coin flow
- known-floor reclear speed
- temporary support arrival

ただしbattle画面で猫・敵・階・目標より視覚的に強くしない。

### 9.2 操作負担

- deliveryはauto。
- collect-allを通常必須にしない。
- 個別売上回収を通常必須にしない。
- stock refillを通常必須にしない。
- 毎階の手動店配置を要求しない。
- offline中に未見story choice、gacha、evolution、tower return、purchaseを勝手に決めない。

### 9.3 Candidate model values — runtime finalではない

