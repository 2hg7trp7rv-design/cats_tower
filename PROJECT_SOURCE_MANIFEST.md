# Cat's Tower — ChatGPT Project Source Manifest

更新日: **2026-09-02**

このmanifestは、ChatGPTの「Cat's Tower 開発本部」Projectへ入れる情報源を一意にする。古いファイルと新しいファイルを同時に有効化しない。

## 1. Projectへ追加するファイル

| 優先 | 配布ファイル | Repository canonical | 用途 |
|---|---|---|---|
| 1 | `CHATGPT_PROJECT_INSTRUCTIONS2.md` | `CHATGPT_PROJECT_INSTRUCTIONS1.md` | 権限、情報源順、現在工程、完成判定、禁止事項 |
| 2 | `CATS_TOWER_DEVELOPMENT_PLAYBOOK1.md` | `DEVELOPMENT_PLAYBOOK.md` | 作り直しを減らす制作順、Downstream Usability Contract、実装・QA方法 |
| 3 | `CATS_TOWER_PROJECT_SOURCE_MANIFEST1.md` | `PROJECT_SOURCE_MANIFEST.md` | Project sourceの入替手順と重複防止 |

## 2. Projectから削除する旧情報源

次の旧版または同内容の過去copyをProject sourceから削除する。

- 旧`CHATGPT_PROJECT_INSTRUCTIONS.md`
- 現在Projectへ入っている旧`CHATGPT_PROJECT_INSTRUCTIONS1.md`
- `CHATGPT_PROJECT_BOOTSTRAP.md`
- `CUSTOM_GPT_CONFIGURATION.md`
- `CLONE_DESIGN.md`
- `IDLE_DESIGN.md`
- `PROTOTYPE_SPEC.md`
- `BASELINE_V082.md`
- 「Step 4 READY_TO_START」「新Step 1 seal前」「candidate-v1を読む」「01_正本仕様が次」と書かれた旧source
- 旧S02 actual-root visual repairをcurrent workとするsource

GitHubのquality-review evidenceやsealed canonicalをProject sourceとして大量に重複追加する必要はない。ChatGPTはlive GitHubの`CURRENT_AUTHORITY_INDEX.json`から読む。

## 3. 入替手順

1. Project source内の旧instructionsと上記旧sourceを削除する
2. `CHATGPT_PROJECT_INSTRUCTIONS2.md`を追加する
3. `CATS_TOWER_DEVELOPMENT_PLAYBOOK1.md`を追加する
4. このmanifestを追加する
5. 新しいチャットでlive `kimi`のHEAD/treeと`CURRENT_AUTHORITY_INDEX.json`を読ませる
6. current phaseがPhase 0完了後のS02-P1であることを確認する

## 4. 重複・競合時の判定

Project source内の静的文書よりlive GitHubを優先する。順序は次。

1. 最新のユーザー決定
2. live `CURRENT_AUTHORITY_INDEX.json`
3. active change-control
4. Project instructions
5. Development Playbook
6. sealed canonical / executable contract / model evidence
7. current Acceptance/evidence
8. historical evidence

## 5. 正常に入替できた確認文

新しいチャットで以下を満たすこと。

- Repositoryが`2hg7trp7rv-design/cats_tower`
- branchが`kimi`
- Step 1=`PASS_CANONICAL`
- Step 2=`PASS_CONTRACT`
- Step 3=`PASS_MODEL`
- Step 4=`IN_PROGRESS`
- Step 5 allowed=`false`
- current product work=`S02-P1 Golden Master`
- legacy runtime=`LEGACY_RUNTIME_NOT_CANONICAL`
- Production alias changed=`false`
- physical iPhone=`NOT_VERIFIED`
- build/CI/Vercel READYだけでは品質PASSにならない

## 6. ファイル名について

Repositoryでは参照互換性のため`CHATGPT_PROJECT_INSTRUCTIONS1.md`を維持する。ユーザーへ返す完全置換版は、既存Project sourceと識別できるよう`CHATGPT_PROJECT_INSTRUCTIONS2.md`とする。内容は同じであり、両方をProjectへ入れない。
