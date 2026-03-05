/**
 * geminiService.js
 * Gemini API を使ったチラシ画像の解析（GeminiService.gs の Node.js 移植）
 */

import { getConfig, GEMINI_MODEL, GEMINI_API_BASE } from './config.js';
import { log } from './utils.js';

/**
 * チラシ画像を解析して商品配列を返す
 * @param {string} base64Image - Base64 エンコード済み画像（data URI プレフィックスなし）
 * @param {string} mimeType    - 画像 MIME タイプ（例: "image/jpeg"）
 * @returns {Promise<Array<object>>} AI 解析結果の商品配列
 */
export async function analyzeFlyer(base64Image, mimeType) {
  const { geminiApiKey } = getConfig();
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY が設定されていません');

  const url = `${GEMINI_API_BASE}${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: base64Image,
            },
          },
          { text: buildPrompt() },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    log('GeminiAPI Error', `HTTP ${response.status}: ${text}`);
    throw new Error(`Gemini API エラー: HTTP ${response.status}`);
  }

  const responseJson = await response.json();
  const rawText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    log('GeminiAPI', 'レスポンスが空または形式不正');
    throw new Error('Gemini API からの応答が空です');
  }

  // マークダウンコードブロックを除去
  let content = rawText.trim();
  const mdMatch = content.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (mdMatch) content = mdMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    log('GeminiAPI parse error', content.substring(0, 500));
    throw new Error('Gemini API の JSON パースに失敗しました');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini API の応答が配列形式ではありません');
  }

  log('GeminiAPI', `${parsed.length}件の商品を抽出`);
  return parsed;
}

/**
 * Gemini API に渡すプロンプトを生成する
 * @returns {string}
 */
function buildPrompt() {
  return `
あなたはスーパーマーケットのチラシ画像から商品情報を抽出する専門AIです。
添付のチラシ画像を解析し、記載されているすべての商品情報を以下のJSONスキーマに従って配列形式で出力してください。

【出力ルール】
1. 必ず JSON 配列のみを出力すること。説明文やマークダウンは一切含めないこと。
2. 画像に記載されている商品はすべて抽出すること（省略禁止）。
3. 各フィールドの解釈は以下の通り：

  - raw_name: チラシ上の商品名表記をそのまま記載（例: "キリン 午後の紅茶 おいしい無糖 1.5L"）
  - normalized_name: メーカー名・フレーバー名・容量を除いたブランド共通名（例: "午後の紅茶"）
                     生鮮食品の場合はカテゴリ名を記載（例: "キャベツ"、"豚肉こま切れ"）
  - category: 商品の大分類。
              【重要】以下の条件をすべて満たす場合のみ、指定の品目名を使用すること：
                ① 生の（未加工の）食材であること
                ② 味付け・タレ・塩こしょう・マリネ等の調味がされていないこと
                ③ 以下のリストに含まれる品目であること：
              キャベツ / レタス / にんじん / たまねぎ / ほうれん草 / トマト / きゅうり / なす / ピーマン / ねぎ / もやし / じゃがいも / 大根 / 牛肉 / 豚肉 / 豚肉こま切れ / 鶏肉 / 卵 / 牛乳
              上記に該当しない場合（味付け肉・加工肉・輸入表記があるだけで未加工の場合を除く・魚介類・加工食品等）は品目名を記載（例: "味付け牛カルビ"、"ねぎ塩豚タン"、"鮭"、"バナナ"、"飲料"、"カップ麺"）
              ※「旨だれ」「ねぎ塩」「タレ」「塩こしょう」「味付け」「漬け」等の語が商品名に含まれる肉類は、生鮮品目名ではなく具体的な品目名を記載すること
  - price: 税抜き価格（数値）。税込み表記のみの場合は1.08または1.1で割って算出。
           価格が記載されていない場合は null
  - base_unit: 商品の基準単位（例: "g"、"ml"、"個"、"玉"、"本"、"袋"）
  - amount_val: base_unit に対する量（数値）
                例: "1.5L" → base_unit="ml", amount_val=1500
                例: "1/2カット" → base_unit="カット", amount_val=0.5
                例: "500g" → base_unit="g", amount_val=500
                明確な数値が読み取れない場合は null
  - target_date: チラシの有効期間（例: "3月1日〜3月3日"）。記載がない場合は null
  - is_multi_buy: まとめ買い条件がある場合は true（例: "2個で○○円"）
  - is_conditional: 会員限定・タイムセール・個数制限など条件付きの場合は true

【出力JSONスキーマ例】
[
  {
    "raw_name": "キリン 午後の紅茶 おいしい無糖 1.5L",
    "normalized_name": "午後の紅茶",
    "category": "飲料",
    "price": 138,
    "base_unit": "ml",
    "amount_val": 1500,
    "target_date": "3月1日〜3月3日",
    "is_multi_buy": false,
    "is_conditional": false
  }
]

では、画像を解析してJSON配列を出力してください。
`.trim();
}
