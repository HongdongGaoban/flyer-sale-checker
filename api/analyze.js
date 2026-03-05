/**
 * api/analyze.js - Vercel サーバーレス関数
 *
 * Vercel rewrites（エッジプロキシ）のタイムアウト約30秒を回避するため、
 * サーバーレス関数として GAS エンドポイントにリクエストをプロキシする。
 * maxDuration: 60 により最大60秒待機できる。
 */

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbyt17ox8NZqb-dSbn0aU7xMyEqXRDr5k0VF3zezMdDa5AARnW3MYNikbdeAZx52B0uSvA/exec';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const gasRes = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      redirect: 'follow',
    });

    const data = await gasRes.json();
    return res.status(gasRes.status).json(data);
  } catch (e) {
    console.error('[analyze] GAS proxy error:', e);
    return res.status(502).json({ status: 'error', message: e.message });
  }
}
