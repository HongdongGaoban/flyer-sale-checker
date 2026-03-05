/**
 * index.js
 * Express エントリポイント（GAS の Code.gs 相当）
 *
 * エンドポイント:
 *   GET  /          - ヘルスチェック
 *   POST /analyze   - チラシ画像解析・判定（メイン）
 *   POST /batch/estat - e-Stat 相場データ更新（Cloud Scheduler から呼ぶ）
 */

import express from 'express';
import { getConfig } from './config.js';
import { analyzeFlyer } from './geminiService.js';
import { judgeAll } from './judgmentLogic.js';
import { fetchEStatAndUpdate } from './estatService.js';
import { log } from './utils.js';

const app = express();
app.use(express.json({ limit: '20mb' }));

// ============================================================
// 簡易 API キー認証ミドルウェア
// API_SECRET が設定されている場合のみ有効
// ============================================================
function apiKeyAuth(req, res, next) {
  const { apiSecret } = getConfig();
  if (!apiSecret) return next();  // 未設定時はスキップ

  const key = req.headers['x-api-key'] ?? req.query.key;
  if (key !== apiSecret) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }
  next();
}

// ============================================================
// GET / - ヘルスチェック（GAS の doGet 相当）
// ============================================================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'チラシ特売判定AIシステム API is running',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// POST /analyze - チラシ解析メインエンドポイント（GAS の doPost 相当）
// ============================================================
app.post('/analyze', apiKeyAuth, async (req, res) => {
  const body = req.body;

  if (!body || !body.image) {
    return res.status(400).json({ status: 'error', message: 'imageフィールドが必要です' });
  }

  const base64Image = body.image;
  const mimeType    = body.mimeType || 'image/jpeg';

  log('POST /analyze', `受信: mimeType=${mimeType}, imageLength=${base64Image.length}`);

  try {
    const products = await analyzeFlyer(base64Image, mimeType);

    if (!products || products.length === 0) {
      return res.json({ status: 'ok', data: [] });
    }

    const results = await judgeAll(products);
    log('POST /analyze', `完了: ${results.length}件処理`);

    return res.json({ status: 'ok', data: results });

  } catch (e) {
    log('POST /analyze fatal error', e.message);
    return res.status(500).json({ status: 'error', message: 'サーバーエラーが発生しました', detail: e.message });
  }
});

// ============================================================
// POST /batch/estat - e-Stat 相場データ更新（Cloud Scheduler から呼ぶ）
// ============================================================
app.post('/batch/estat', apiKeyAuth, async (req, res) => {
  log('POST /batch/estat', 'バッチ開始');
  try {
    const result = await fetchEStatAndUpdate();
    return res.json({ status: 'ok', ...result });
  } catch (e) {
    log('POST /batch/estat error', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ============================================================
// サーバー起動
// ============================================================
const { port } = getConfig();
app.listen(port, () => {
  console.log(`[server] listening on port ${port}`);
});
