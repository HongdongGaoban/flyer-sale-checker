# チラシ特売チェッカー 仕様書

## 概要

スーパーマーケットのチラシ画像をスマートフォンで撮影し、AIが商品を解析してお得度を判定するPWAアプリ。

---

## システム構成

```
[スマートフォン]
     |  チラシ画像（JPEG, Base64）
     v
[Vercel PWA]  ← index.html / app.js / manifest.json / sw.js
     |  POST /api/analyze（Vercel Rewrites でCORSを回避）
     v
[Vercel Serverless Function]  ← api/analyze.js
     |  POST /analyze（x-api-key ヘッダー付き）
     v
[Cloud Run バックエンド]  ← Node.js / Express
     |  画像解析リクエスト
     ├──> [Gemini API]  ← 商品情報抽出
     ├──> [Firestore]   ← 相場/単位換算/底値マスター
     └──> [e-Stat API]  ← 生鮮食品の小売価格（バッチ）
```

### インフラ一覧

| コンポーネント | 技術 | 備考 |
|---|---|---|
| フロントエンド | Vanilla JS / PWA | Vercel ホスティング |
| APIプロキシ | Vercel Serverless Function | CORSバイパス、タイムアウト60秒 |
| バックエンド | Node.js 22 / Express | Cloud Run |
| AI解析 | Gemini 2.5 Flash | 温度 0.1、Thinking無効 |
| データベース | Google Cloud Firestore | 3コレクション |
| 相場データ取得 | e-Stat API | Cloud Schedulerから週次バッチ |

---

## フロントエンド (pwa/)

### ファイル構成

```
pwa/
├── index.html         # メイン画面（SPA）
├── app.js             # メインロジック
├── manifest.json      # PWAマニフェスト
├── sw.js              # Service Worker
├── style.css          # スタイル
├── icons/             # アプリアイコン（192px, 512px）
└── api/
    └── analyze.js     # Vercel Serverless Function（プロキシ）
```

### 画面フロー

```
[アップロード画面]
  → 画像選択（カメラ撮影 or ファイル選択）
[プレビュー画面]
  → AI解析スタート / やり直す
[ローディング画面]
  → Gemini解析中
[結果画面]
  → 商品カード一覧（お買い得順ソート）/ 別のチラシを解析する
[エラー画面]
  → もう一度試す
```

### 画像前処理

- 長辺を最大 **1024px** にリサイズ（Canvas経由）
- **JPEG品質 0.7** に変換
- Base64エンコードしてPOST

### APIリクエスト

```
POST /api/analyze
Content-Type: application/json

{ "image": "<base64>", "mimeType": "image/jpeg" }
```

レスポンス（正常時）:
```json
{
  "status": "ok",
  "data": [ /* 商品判定結果配列 */ ]
}
```

---

## バックエンド (pwa/server/)

### ファイル構成

```
server/
├── src/
│   ├── index.js          # Expressエントリポイント
│   ├── geminiService.js  # Gemini API連携
│   ├── judgmentLogic.js  # 判定ロジック
│   ├── dataService.js    # Firestore CRUD
│   ├── estatService.js   # e-Stat API連携
│   ├── config.js         # 設定・定数
│   └── utils.js          # 共通ユーティリティ
├── scripts/
│   └── importSheets.js   # マスターデータ移行スクリプト
├── Dockerfile
├── package.json
└── .env.example
```

### エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/` | ヘルスチェック |
| POST | `/analyze` | チラシ解析・判定（メイン） |
| POST | `/batch/estat` | e-Stat相場データ更新バッチ |

### 認証

環境変数 `API_SECRET` が設定されている場合、全エンドポイントで `x-api-key` ヘッダーによる認証を要求。未設定時はスキップ。

### 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google AI Studio APIキー |
| `ESTAT_APP_ID` | ✅ | e-Stat APIアプリケーションID |
| `GCP_PROJECT_ID` | ✅ | FirestoreのGCPプロジェクトID |
| `PORT` | - | サーバーポート（デフォルト: 8080） |
| `API_SECRET` | - | 簡易API認証キー（未設定時は認証スキップ） |

Vercel側の環境変数:

| 変数名 | 説明 |
|---|---|
| `CLOUD_RUN_URL` | Cloud RunサービスのベースURL |
| `API_SECRET` | Cloud Run側と揃えたAPIキー |

---

## 判定ロジック

### 処理フロー

```
AIで商品情報抽出
       |
       v
[除外チェック]
 ├─ まとめ買い条件あり → skip
 ├─ 条件付き価格（会員限定等） → skip
 ├─ 価格がnull → skip
 └─ 容量がnull → skip
       |
       v
[カテゴリ判定]
 ├─ 生鮮食品 → A系統（e-Stat相場比較）
 └─ 加工食品 → B系統（自己学習底値DB）
```

### A系統: 生鮮食品 × e-Stat相場比較

1. Firestoreの `unitConversion` から単位換算係数を取得（例: 1玉→1200g）
2. Firestoreの `marketData` から相場単価を取得（例: キャベツ 1g あたり X円）
3. チラシ価格を単位当たりに換算して相場と比較
4. 割引率でランク判定

```
current_unit_price = price / converted_amount
discount_rate = (current_unit_price - market_unit_price) / market_unit_price
```

### B系統: 加工食品 × 自己学習底値DB

1. `normalized_name + amount_val + base_unit` をキーに `lowestPrice` を検索
2. 初回: DBに登録し `new` を返す（次回から比較可能）
3. 既存あり: 底値と比較してランク判定、最安値更新時はDBを更新

```
discount_rate = (price - lowest_price) / lowest_price
```

### 判定ランク

| ランク | 記号 | 条件 |
|---|---|---|
| お買い得 | ◎ | 割引率 ≤ -15% |
| やや安め | ○ | -15% < 割引率 ≤ -5% |
| 相場並み | △ | 割引率 > -5% |
| 初回登録 | new | 底値DB未登録（B系統のみ） |
| 判定外 | skip | 除外条件に該当、単位不明等 |
| 判定不能 | unknown | マスター未登録（A系統のみ） |

---

## Gemini API連携

### モデル

`gemini-2.5-flash`（Thinking機能無効、thinkingBudget: 0）

### 抽出フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `raw_name` | string | チラシ上の商品名そのまま |
| `normalized_name` | string | ブランド共通名（例: "午後の紅茶"）または生鮮カテゴリ名（例: "キャベツ"） |
| `category` | string | 商品大分類（生鮮: 品目名、加工: 品目名） |
| `price` | number\|null | 税抜き価格 |
| `base_unit` | string | 基準単位（g / ml / 個 / 玉 / 本 / 袋 等） |
| `amount_val` | number\|null | base_unit に対する量 |
| `target_date` | string\|null | チラシ有効期間 |
| `is_multi_buy` | boolean | まとめ買い条件あり |
| `is_conditional` | boolean | 条件付き価格（会員限定・タイムセール等） |

---

## Firestoreコレクション

### `marketData` - 相場データマスター（A系統用）

| フィールド | 型 | 説明 |
|---|---|---|
| `category` | string | カテゴリ名（ドキュメントIDと同じ） |
| `itemName` | string | 品目名 |
| `unit` | string | 基準単位 |
| `avgPrice` | number | 単位当たり平均価格（円） |
| `updatedAt` | string | 更新日（YYYY-MM-DD） |
| `sourceCode` | string | e-Stat品目コード |

### `unitConversion` - 単位換算マスター（A系統用）

| フィールド | 型 | 説明 |
|---|---|---|
| `category` | string | カテゴリ名 |
| `flyerUnit` | string | チラシ上の単位 |
| `convertToBase` | number | 1単位当たりの基準量 |
| `baseUnit` | string | 変換先の基準単位 |

ドキュメントID: `{category}_{flyerUnit}`

### `lowestPrice` - 底値マスター（B系統用、自己学習）

| フィールド | 型 | 説明 |
|---|---|---|
| `normalizedName` | string | 正規化商品名 |
| `amountVal` | number | 容量 |
| `baseUnit` | string | 単位 |
| `lowestPrice` | number | 過去最安値（円） |
| `lastUpdated` | string | 最終更新日（YYYY-MM-DD） |

検索キー: `normalizedName + amountVal + baseUnit`

---

## e-Stat連携

### バッチ処理

- トリガー: Cloud Scheduler → `POST /batch/estat`（推奨: 毎週月曜03:00 JST）
- データソース: 小売物価統計調査（品目別小売価格）
- 統計データID: `0003421913`
- エリアコード: `04100`（仙台市）

### 取得品目

**野菜類:** キャベツ, レタス, にんじん, たまねぎ, ほうれん草, トマト, きゅうり, なす, ピーマン, ねぎ, もやし, じゃがいも, 大根

**肉類:** 牛肉（国産品）, 豚肉（国産・バラ）, 豚肉こま切れ, 鶏肉

**その他生鮮:** 卵, 牛乳

---

## 生鮮食品判定（表記ゆれ吸収）

Gemini が返す `category` を、正規カテゴリ名（= `getEStatTargets().category` = Firestore `marketData` ドキュメントID）に解決する。解決できた場合は A系統（e-Stat相場比較）、解決できない場合は B系統（底値DB）で処理する。

`resolveFreshCategory(category)` は以下のエイリアスマップを用いて正規名に変換する（完全一致 → 部分最長一致の順で照合）。

| 正規カテゴリ名 | エイリアス（表記ゆれ） |
|---|---|
| キャベツ | キャベツ, きゃべつ |
| レタス | レタス, れたす |
| にんじん | にんじん, ニンジン, 人参 |
| たまねぎ | たまねぎ, タマネギ, 玉ねぎ, 玉葱, 玉ネギ |
| ほうれん草 | ほうれん草, ほうれんそう, ホウレンソウ, ホウレン草 |
| トマト | トマト, とまと |
| きゅうり | きゅうり, キュウリ, 胡瓜 |
| なす | なす, ナス, 茄子, なすび, ナスビ |
| ピーマン | ピーマン, ぴーまん |
| ねぎ | ねぎ, ネギ, 葱, 長ねぎ, 長ネギ |
| もやし | もやし, モヤシ |
| じゃがいも | じゃがいも, ジャガイモ, じゃが芋, ジャガ芋, 馬鈴薯 |
| 大根 | 大根, だいこん, ダイコン |
| 牛肉 | 牛肉, 牛ロース, 牛バラ, 牛もも |
| 豚肉 | 豚肉, 豚バラ, 豚ロース, 豚もも |
| 豚肉こま切れ | 豚肉こま切れ, 豚こま切れ, 豚こま, 豚コマ |
| 鶏肉 | 鶏肉, とり肉, 鶏もも, 鶏むね, 鶏胸, もも肉, むね肉, 胸肉 |
| 卵 | 卵, たまご, タマゴ, 玉子, 鶏卵 |
| 牛乳 | 牛乳 |

**備考**: e-Stat取得品目に対応しない生鮮食品（魚介類、さつまいも、えのき等）はエイリアスマップに含めず、B系統で処理する。

---

## デプロイ

### バックエンド（Cloud Run）

```bash
# Dockerイメージビルド＆プッシュ＆デプロイ
docker build -t gcr.io/<PROJECT_ID>/flyer-sale-checker-server .
docker push gcr.io/<PROJECT_ID>/flyer-sale-checker-server
gcloud run deploy flyer-sale-checker-server \
  --image gcr.io/<PROJECT_ID>/flyer-sale-checker-server \
  --set-env-vars GEMINI_API_KEY=...,ESTAT_APP_ID=...,GCP_PROJECT_ID=...,API_SECRET=...
```

### フロントエンド（Vercel）

Vercelダッシュボードで以下の環境変数を設定:
- `CLOUD_RUN_URL`: Cloud RunサービスのURL
- `API_SECRET`: Cloud Run側と同じキー

### マスターデータ初期投入

```bash
cd pwa/server
node scripts/importSheets.js
```

---

## 開発環境

```bash
# バックエンドローカル起動
cd pwa/server
cp .env.example .env  # 各値を設定
npm install
npm run dev           # --watch モードで起動

# フロントエンド（Vercelローカル）
cd pwa
vercel dev
```

---

## PWA設定

| 項目 | 値 |
|---|---|
| アプリ名 | チラシ特売チェッカー |
| ショートカット名 | チラシチェッカー |
| テーマカラー | #2e7d32（グリーン） |
| 表示モード | standalone |
| 向き | portrait |
| 言語 | ja |
