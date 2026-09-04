- Representative proof before volume: 少数assetでengine proof後に量産。
- Shared source: runtime/simulationのformulaを一本化。
- State family first: normalだけでなくfailure/recoveryを先に設計。
- Data authority first: local/derived/server/pending/confirmedを値ごとに固定。
- Evidence before verdict: render、interaction、failure、comparison、criticなしにPASSを出さない。
- Audit existing before rebuilding: 既存を監査し、合格部分を再利用、不足だけ修正。
- Small task branch: 一つのplayer-visible outcome単位。
- AI critic before user: 欠陥探索をユーザーに押し付けない。

---

## 21. Status language

使用可能:

- `VERIFIED`: exact HEADで実行証拠あり
- `READY_FOR_REVIEW`: automationは通ったが人間確認待ち
- `IMPLEMENTED_NOT_VERIFIED`: 実装済み・検証未完
- `NOT_VERIFIED`: 未確認
- `BLOCKED`: hard blocker
- `REFERENCE_ONLY`: 参考のみ
- `STALE`: 現行authorityと衝突

禁止:

- build成功をproduction-readyと呼ぶ
- CI greenをfun/feel PASSと呼ぶ
- Vercel READYをvisual approvalと呼ぶ
- browser emulatorをphysical iPhone PASSと呼ぶ
- model evidenceをruntime playtestと呼ぶ
- reference imageをruntime assetと呼ぶ

---

## 22. 自分の結論を否定してから決める

Claudeは各重要判断で、最初の案を一度反証する。

最低限の反証:

- 同じtest結果をfake fixtureだけで作れないか。
- rewardを二重付与できないか。
- unowned/locked catがfieldに出ないか。
- 320×568でbattle informationが失われないか。
- shop UIがbattleを主役から降ろしていないか。
- large numberがoverflowしないか。
- deployed pageがtested commitと違わないか。
- visual referenceを焼き込みruntimeにしていないか。
- competitorのexact UI/asset/textをコピーしていないか。

反証に失敗した案は修正してから採用する。

---

## 23. Claudeがユーザーへ質問してよい範囲

質問しない:

- library選定
- component設計
- file placement
- type/schema
- test strategy
- bug fix方針
- routine refactor
- build/deploy修正
- error handling

質問してよい:

- 同等に成立する完成候補の最終的な見た目の好み
- fun/feelの最終判断
- sealed product scopeを変える重大決定
- 課金価格、法務、契約、外部account
- Production・削除・公開等の不可逆操作
- 物理iPhoneでしか取れない証拠

---

## 24. 未決定・要確認

次は決まったふりをしない。

- 公開用final title。参考画像の「ネコ塔物語」はvisual reference内の仮表記。
- S02を含むfinal visual user approval。
- production assetの最終model sheetとanimation frame。
- 005以降のcharacter public name。
- exact runtime balance、first tower-return実測。
- final sound、music、voice、haptics。
- final backend provider、account provider、payment product、ad network。
- store submissionとJapan legal conclusion。
- Production alias/domain変更。
- physical iPhone performance・battery・heat・touch feel。

---

## 25. Claude開始時の正しい手順

1. repositoryが`2hg7trp7rv-design/cats_tower`か確認。
2. `task/v2-bootstrap`へいるか確認。
3. HEAD、status、working treeをread back。
4. `CURRENT_AUTHORITY_INDEX.json`とactive roundを読む。
5. root `CLAUDE.md`と`.claude/rules/cats-tower-handoff1.md`がcontextへ入っていることを確認。
6. 本書、`CATS_TOWER_SCREEN_VISUAL_BIBLE1.md`、`CATS_TOWER_VISUAL_REFERENCE_MANIFEST1.json`を読む。
7. `npm ci --no-audit --no-fund`。
8. `npm run verify:v2`。
9. PR #9 check、artifact、Vercel Preview、browser screenshot/traceを確認。
10. failureがあればV2-0許可scope内で最小修正。
11. current missionより先へ進まない。
12. merge、Production、main/kimi direct writeをしない。

開始用の全文promptは`docs/v2/CATS_TOWER_CLAUDE_START_PROMPT1.md`にある。

---

## 26. 完了報告形式

Claudeは毎作業後、最低限次を返す。

```text
目的:
Repository / branch / HEAD:
Authority / current mission:
変更ファイル:
Player-visible outcome:
実行したgate:
PASS:
FAIL:
Browser evidence:
Vercel Preview:
Production state:
Physical iPhone:
User visual approval:
P0 / P1 / P2:
未確認・blocker:
次に許可された一手:
```

`UNKNOWN`と`NOT_VERIFIED`を正直に使う。

---

## 27. 最終結論

Claudeへ渡すべき結論は「全仕様が決まり、あとは静止画を実装するだけ」ではない。

正しい結論は次である。

> Cat's Towerの製品意味、主要system、4体、無制限塔、1〜10F順序、trust boundary、visual working directionは十分に固定されている。一方、既存S02と今回の10枚はreference-onlyで、final visual approvalもproduction runtime authorizationもない。現在はV2-0 bootstrapを証拠付きで閉じる段階であり、その後に代表assetを使った3分First Playable、1〜10F Vertical Sliceへ進む。

Claudeはこの境界を守りつつ、技術判断と内部QAを自分で引き受け、Cat's Towerを「動く・分かる・気持ちいい」ゲームへ縦に完成させる。
