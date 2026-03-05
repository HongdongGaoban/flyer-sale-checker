/**
 * config.js
 * 環境変数から設定を取得する（GAS の Config.gs / PropertiesService 相当）
 *
 * 必須環境変数:
 *   GEMINI_API_KEY   : Google AI Studio で取得した API キー
 *   ESTAT_APP_ID     : e-Stat API アプリケーション ID
 *   GCP_PROJECT_ID   : Firestore を持つ GCP プロジェクト ID
 *
 * オプション環境変数:
 *   PORT             : サーバーポート（デフォルト: 8080）
 *   API_SECRET       : 簡易認証キー（未設定時は認証スキップ）
 */

// ローカル開発時のみ .env を読み込む（本番 Cloud Run では環境変数として注入）
if (process.env.NODE_ENV !== 'production') {
  const { default: dotenv } = await import('dotenv');
  dotenv.config();
}

export function getConfig() {
  return {
    geminiApiKey:  process.env.GEMINI_API_KEY  ?? '',
    eStatAppId:    process.env.ESTAT_APP_ID    ?? '',
    gcpProjectId:  process.env.GCP_PROJECT_ID  ?? '',
    port:          parseInt(process.env.PORT ?? '8080', 10),
    apiSecret:     process.env.API_SECRET      ?? '',
  };
}

// ============================================================
// 判定閾値（Config.gs の JUDGMENT 定数相当）
// ============================================================
export const JUDGMENT = {
  EXCELLENT_THRESHOLD: -0.15,  // -15% 以下 → ◎ お買い得
  GOOD_THRESHOLD:      -0.05,  // -15%〜-5% → ○ やや安め
};

// ============================================================
// 生鮮カテゴリ判定キーワード（Config.gs の FRESH_FOOD_KEYWORDS 相当）
// ============================================================
export const FRESH_FOOD_KEYWORDS = [
  'キャベツ', 'レタス', 'ほうれん草', 'にんじん', 'たまねぎ', '大根',
  'じゃがいも', 'さつまいも', 'トマト', 'きゅうり', 'なす', 'ピーマン',
  'ねぎ', 'もやし', 'えのき', 'しいたけ', 'ごぼう', 'れんこん',
  '豚肉', '鶏肉', '牛肉', 'ひき肉', 'こま切れ', 'もも肉', '胸肉',
  'むね肉', 'バラ肉', '豚ロース', '牛ロース',
  '鮭', 'サーモン', 'さば', 'まぐろ', 'アジ', 'いわし', 'えび', 'いか',
  '牛乳', '卵', 'たまご',
];

// ============================================================
// Gemini API 設定（Config.gs 相当）
// ============================================================
export const GEMINI_MODEL    = 'gemini-2.5-flash';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// ============================================================
// e-Stat API 設定（Config.gs 相当）
// ============================================================
export const ESTAT_API_BASE      = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData';
export const ESTAT_STATS_DATA_ID = '0003421913';
export const ESTAT_AREA_CODE     = '04100';  // 仙台市
