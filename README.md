# Cat's Tower

Cat's Towerは、猫を呼んで100Fの塔を奪還し、制圧した部屋の店舗と配送が前線を支える、スマートフォン縦画面専用の放置インクリメンタルRPGです。

## 現在地

- 正本・変更対象ブランチ: `kimi`
- 修正版の正本仕様固定: `PASS`
- 次の工程: 全100Fシミュレーション `NOT_STARTED`
- ゲーム本体の新版実装: `NOT_STARTED`
- 1〜10F Preview Ready: `false`
- 100F Product Production Ready: `false`
- 物理iPhone: `NOT_VERIFIED`

現在のHTML / JavaScript / CSSはV0.8.2から派生したlegacy / prototype runtimeです。現在動く画面、数式、保存キー、店舗数、ボス配置を新製品の正本仕様とは扱いません。正本は単純な一列順位ではなく、`MASTER_SPEC.md`のscope別権威表に従います。下記は参照案内であり、後の項目が前の項目へ仕様を追加する順序ではありません。

`CLONE_DESIGN.md`、`IDLE_DESIGN.md`、`PROTOTYPE_SPEC.md`は過去判断の履歴として残す`LEGACY_SUPERSEDED`文書です。本文に旧「実装正本」表記や旧数値が残っていても、新規実装へ使用しません。

## 正本文書

1. [`MASTER_SPEC.md`](./MASTER_SPEC.md) — 100F製品仕様
2. [`QUALITY_GATE.md`](./QUALITY_GATE.md) — 受入・完成判定
3. [`AGENTS.md`](./AGENTS.md) — 作業制約と順序
4. [`PROJECT_STATUS.json`](./PROJECT_STATUS.json) — 機械可読の進捗と固定値
5. [`PROJECT_HANDOVER.md`](./PROJECT_HANDOVER.md) — 根拠と引き継ぎ
6. [`FLOORS_1_10_DESIGN.md`](./FLOORS_1_10_DESIGN.md) — 最初の商品スライス
7. [`simulation/INPUT_CONTRACT.md`](./simulation/INPUT_CONTRACT.md) / [`simulation/candidate-v1.json`](./simulation/candidate-v1.json) — 次工程で反証する機械可読の候補入力

現行の受入条件は[`quality-reviews/step-1-canonical-design/acceptance-round-003.json`](./quality-reviews/step-1-canonical-design/acceptance-round-003.json)、3者独立反証と是正再封印の完成証跡は[`acceptance-round-005.json`](./quality-reviews/step-1-canonical-design/acceptance-round-005.json)です。Round 1・2の不合格記録と、状態表記・holdout封印範囲を見直したRound 4も同じディレクトリに履歴として残しています。

工程3のholdout seed群は一回限りです。結果を見てcandidateを調整した場合、または部分出力後に有効判定を作れなかった場合は、同じまたは重複するseed範囲をbank名だけ変えて再利用せず、Step 1へ戻って未観測bankを再封印し、Step 2からやり直します。工程2合格時のcandidate・完全なsimulator file closure・run plan・result schema/validator・出力digestはstrict schemaの一方向sealへ固定し、工程3前にraw bytesと全file集合を再検査します。

## 承認済み実行順序

1. 修正版を正本仕様へ固定
2. 全100Fの購入・戦闘・夜明け・24時間放置シミュレーション
3. 戦闘・増援・商業の3ビルドを各1,000パターン検証
4. 合格仕様を9画面の完成見本へ反映
5. 1〜10Fだけ実装
6. 物理iPhoneで3分ボス戦と10分連続試験

前工程の合格前に後工程を開始しません。この6工程での実装範囲は1〜10Fのみで、11F以降は実装しません。Step 5は非物理端末の実装Acceptance、Step 6は同一commit・対象Vercel URLで行う3分（180秒）ボス戦と10分（600秒）連続試験です。物理試験前にGate CまたはPreview Readyを合格扱いにしません。

## 固定された9画面

以下は画面責務の要約です。各画面へ含めるrequired stateの完全かつ順序付きの集合は`PROJECT_STATUS.json.canonicalScreens`を参照し、この一覧だけから状態を省略しません。

1. `S01` title / resume
2. `S02` battle / follow
3. `S03` tower browse
4. `S04` floor clear / shop slot
5. `S05` shop reconfigure
6. `S06` cat roster
7. `S07` upgrades / build / armament（敗北診断sheetを含む）
8. `S08` F10 boss variant
9. `S09` district result / Dawn（100F完了状態を含む）

## legacy / prototype runtimeの起動

現状比較と復旧確認のためにだけ使用します。外部CDNは不要です。

```bash
python3 -m http.server 8000
```

縦画面のブラウザで`http://localhost:8000/`を開きます。このruntimeでの動作成功は、新版1〜10Fの実装済み・Preview Ready・Production Readyを意味しません。

## 主なlegacyファイル

| ファイル | 現在の扱い |
|---|---|
| `game-data.js` | legacy数値・店舗・武器データ。正本バランスではない |
| `game-core.js` | legacy simulation。新版実装のたたき台候補 |
| `app.js` | legacy Canvas / UI / audio |
| `index.html` / `styles.css` | legacy画面構成 |
| `sw.js` / `manifest.webmanifest` | legacy PWA構成 |

## 開発・反映ルール

- 変更するのは既存の`kimi`だけです。
- 他のブランチを作成・切替・書込みしません。
- PRや別ブランチへのmergeは使いません。
- deployment成功と、ブラウザ検証、物理iPhone検証、Preview Ready、Product Readyを分離して報告します。
