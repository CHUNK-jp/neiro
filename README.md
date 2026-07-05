# Neiro（音色）

10秒の音声を投稿・重ね合わせできるSNS型PWA。Part of **CHUNK-jp Wonder**.

> "wanting to share them with someone who would add to them, not just listen"

- ランディングページ: https://chunk-jp.github.io/neiro/
- アプリ本体: https://chunk-jp.github.io/neiro/app/

## 機能

1. **10秒録音** — MediaRecorder API。10秒で自動停止、途中タップで手動停止も可
2. **重ね再生（レイヤリング）** — Web Audio APIで既存投稿と自分の録音を同時再生・ミキシング。重ねた結果は元投稿への参照付きの新しい投稿として保存。録音中は元の音がモニター再生される（ヘッドホン推奨）
3. **フィード** — 投稿を新しい順に一覧表示。各投稿に再生・ループ・重ねるボタンとBPM/アンビエント表示
4. **ループ再生** — 投稿ごとにON/OFF切り替え
5. **言語切替** — 英語（デフォルト）/ 日本語。localStorageに保存
6. **ピッチシフト** — 投稿前に±12半音。再生速度を変えずにピッチのみ変更（リサンプル＋OLAタイムストレッチのオフラインバウンス。`detune`は速度も変わるため不使用）
7. **自動ミュージカライズ** — 重ねた音が音楽的にまとまるための3段構え:
   - **リズム音**（手拍子・タップ・鼻歌等）: オンセット検出＋BPM推定でテンポグリッドに整列。ループ長をビート単位にスナップし、短いフレーズはループを埋めるよう反復。**タイムストレッチはしない**（ノービルド素JSでの品質確保が困難なため、境界スナップ方式を採用）
   - **環境音**（雨・喧騒等）: グリッド無視。ループ繋ぎ目をイコールパワー・クロスフェードで自然に
   - **共通**: マスターバスに軽いコンプレッション＋生成IRのコンボリューションリバーブで「同じ空間」の質感
8. **MIX Studio** — アーカイブから複数の音を選び、質感（そのまま/残響/揺らぎ/包む）と「今日の心の天気」ムードを選んでオフラインレンダリングされた1本のMIX音源を生成。音楽的な土台（ドローン/パッド）の合成付き。結果はシェアまたはFeedへ投稿できる（`docs/app/mix.html`）

保存はすべてブラウザ内（IndexedDB）。サーバーサイドはありません。直近50件を超えた投稿は古い順に自動削除されます。各投稿は自分を構成する全レイヤーのBlobを保持するため、親投稿が削除されても子の再生は壊れません。

## 構成

```
neiro/
├── docs/                    ← GitHub Pages 公開ルート（main /docs）
│   ├── index.html           ← ランディングページ
│   ├── .nojekyll            ← Jekyllビルド回避（必須）
│   └── app/                 ← 本体PWA
│       ├── index.html
│       ├── mix.html
│       ├── manifest.json
│       ├── service-worker.js
│       ├── css/style.css
│       ├── css/mix.css
│       ├── js/
│       │   ├── app.js             ← エントリーポイント
│       │   ├── mix-app.js
│       │   ├── mix-engine.js
│       │   ├── recorder.js        ← MediaRecorder（10秒録音）
│       │   ├── audio-mixer.js     ← 再生計画・ミキシング・ループ・マスターFX
│       │   ├── audio-analysis.js  ← オンセット検出・BPM推定・分類
│       │   ├── audio-effects.js   ← ピッチシフト・リバーブIR生成
│       │   ├── feed.js            ← フィード表示
│       │   ├── i18n.js            ← EN/JA文言
│       │   └── storage.js         ← IndexedDB
│       └── icons/
├── tests/                   ← Node組み込みテストランナー
├── README.md
└── LICENSE
```

※ 仕様書では `app/` はリポジトリ直下だが、GitHub Pages（main /docs）で公開するため `docs/app/` に配置している。

## 開発

ビルドステップなしの素のHTML/CSS/JS。ローカル実行は任意の静的サーバーで:

```sh
python3 -m http.server 8000 --directory docs
# → http://localhost:8000/app/
```

Service Worker・マイクは secure context が必要（localhostはOK）。

## テスト

```sh
node --test "tests/*.test.mjs"
```

録音時間の上限・MIMEタイプ選択・ミキシングのゲイン/ループ長・フィードの整列/系譜表示・保存上限の刈り込みなど、純粋ロジックをテストしています。

## デプロイ

GitHub Pages（main branch /docs）。`docs/` 配下をpushすれば反映されます。`.nojekyll` を削除しないこと。

**重要**: Service Workerはcache-firstのため、`docs/app/` 内のファイルを変更したデプロイでは必ず `service-worker.js` の `CACHE_NAME` をbumpすること（例: `neiro-app-v3` → `neiro-app-v4`）。bumpしないと既存ユーザーに更新が届きません。
