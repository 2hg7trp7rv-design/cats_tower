- reduced motion

---

# 14. S02 Final Composition Target

390×844 reference:

1. compact top resource/floor header
2. encounter/objective strip
3. battlefield 45〜52%
4. enemy HP and threat in battlefield edge
5. one primary intervention
6. four-slot party dock
7. compact shop/delivery support summary
8. safe-bottom navigation

Battlefield placement:

- Mugi: lower/front contact point
- Luna: upper/back line of sight
- Toto: ally-facing middle/back support
- Kohaku: low forward dash route and return path
- enemy: opposing side with cold/violet separation

Effects:

- anticipation: readable direction
- impact: 0.2〜0.8s concentrated contrast
- hit reaction: synchronized with HP change
- defeat: silhouette collapse/soot/contact-shadow loss
- reward: one source trail to bound resource
- floor transition: ground/far structure/floor marker rise coherently

---

# 15. Responsive Visual Contract

| Viewport | Priority |
|---|---|
| 320×568 | hardest compact proof; decor/support explanation collapses first |
| 320×667 | narrow standard |
| 375×667 | wider but short |
| 360×800 | mid Android portrait |
| 390×844 | primary reference |
| 412×915 | tall reference |
| 430×932 | widest/tall proof |

Minimum working targets:

- battlefield short: 300px
- battlefield standard: 352px
- battlefield tall: 404px
- cat visible-alpha height: 60px minimum、390×844で68px target
- enemy visible-alpha height: 80px minimum、390×844で96px target
- primary touch: 48px
- important touch: 44px
- meaningful text: 14px
- metadata: 12px

320版を390版の縮小コピーにしない。

---

# 16. Asset Production Order

Full castや全screenを先に作らない。次のrepresentative proofをengineで通す。

1. Mugi field model
2. Luna field model
3. Toto field model
4. Kohaku field model
5. one normal enemy family
6. one boss
7. one layered corridor background
8. one reusable wood/brass/parchment frame family
9. one original icon family
10. hit/heal/reward VFX
11. independent text/HP/resource layers
12. required viewportsでfull causal loop
13. real browser outputのuser visual review

失敗条件:

- identity mutation
- unreadable silhouette
- wrong crop/anchor
- effects obscuring faces/HP
- shop dominance
- baked text
- no provenance
- no animation contract
- fake state

---

# 17. Image-to-runtime conversion rule

参考画像をそのまま貼らない。各画面を次へ分解する。

- `ART_STATIC_LAYER`
- `ART_ANIMATED_ENTITY`
- `VFX`
- `UI_COMPONENT`
- `RUNTIME_TEXT`
- `RUNTIME_NUMBER`
- `STATE_INDICATOR`
- `INTERACTION_TARGET`
- `DECORATION`

各要素へstable ID、z-order、anchor、data source、responsive rule、visibility condition、accessible nameを付ける。分類できない要素は実装方法がないためGolden Masterから除く。

---

# 18. Final Visual Acceptance

`PASS_VISUAL`またはuser visual review候補にするには最低限:

- battle protagonist is four cats
- floor/objective/enemy/reward causality understood in five seconds
- 7 required viewports
- normal plus high-risk states
- no baked runtime text
- no fake active/owned/reward state
- 4-slot truth
- unbounded tower expression
- no mandatory commerce chores
- contrast/touch/text minimums
- performance budget
- independent critic P0/P1=0
- browser render evidence tied to exact commit
- user final taste review

参考画像の美しさだけでは合格にならない。

---

# 19. Claudeへの最終指示

10枚の良さを捨てる必要はない。しかし「良さを全部採用する」と「画像の中身を全部正しい仕様として実装する」は別である。

Claudeは次を行う。

1. material、pixel density、card quality、boss spectacle、vertical map、forge moodを継承する。
2. product canonと衝突する5体、有限塔、manual chores、battle pass等を修正する。
3. complete-screen rasterではなくcomponent/entity/stateへ分解する。
4. V2-0を閉じるまではproduction visual実装へ拡張しない。
5. V2-1で代表assetを実browserへ入れ、userが触れる形でvisual方向を最終評価できるようにする。

この方針が、10枚の魅力を残しながら、実際にゲームとして動くCat's Towerへ最短で到達する方法である。
