/**
 * api/analyze.js - Vercel サーバーレス関数
 *
 * Cloud Run バックエンドにリクエストをプロキシする。
 * maxDuration: 60 により最大60秒待機できる。
 *
 * 環境変数（Vercel ダッシュボードで設定）:
 *   CLOUD_RUN_URL : Cloud Run サービスの URL（例: https://flyer-api-xxx-an.a.run.app）
 *   API_SECRET    : Cloud Run 側と揃えた API キー（省略可）
 */

const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL + '/analyze';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.API_SECRET) {
    headers['x-api-key'] = process.env.API_SECRET;
  }

  try {
    const backendRes = await fetch(CLOUD_RUN_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const data = await backendRes.json();
    return res.status(backendRes.status).json(data);
  } catch (e) {
    console.error('[analyze] Cloud Run proxy error:', e);
    return res.status(502).json({ status: 'error', message: e.message });
  }
}
