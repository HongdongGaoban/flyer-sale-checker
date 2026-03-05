/**
 * app.js - チラシ特売チェッカー メインロジック
 *
 * 【設定方法】
 *   GASをWebアプリとしてデプロイした後、下記のGAS_ENDPOINTに
 *   取得したURLを貼り付けてください。
 *
 *   例: https://script.google.com/macros/s/XXXXXXXXXX/exec
 */

'use strict';

// ============================================================
// 設定
// ============================================================

// Vercel rewrites (/api/analyze → GAS) 経由でCORSを回避
// vercel.json の rewrites 設定と対応
const GAS_ENDPOINT = '/api/analyze';

// 画像圧縮設定
const IMAGE_MAX_PX  = 1024;   // 長辺の最大ピクセル数（モバイル対応で縮小）
const IMAGE_QUALITY = 0.7;    // JPEG品質（0〜1）送信サイズ削減

// ============================================================
// DOM 要素の参照
// ============================================================

const $ = id => document.getElementById(id);

const cameraInput    = $('cameraInput');
const fileInput      = $('fileInput');
const previewSection = $('previewSection');
const previewImage   = $('previewImage');
const analyzeBtn     = $('analyzeBtn');
const resetBtn       = $('resetBtn');
const uploadSection  = $('uploadSection');
const loadingSection = $('loadingSection');
const loadingText    = $('loadingText');
const errorSection   = $('errorSection');
const errorMessage   = $('errorMessage');
const errorRetryBtn  = $('errorRetryBtn');
const resultsSection = $('resultsSection');
const summaryStats   = $('summaryStats');
const productsList   = $('productsList');
const newAnalysisBtn = $('newAnalysisBtn');

// 現在選択中の画像データ（Base64）
let currentBase64 = null;
let currentMimeType = null;

// ============================================================
// 初期化
// ============================================================

function init() {
  cameraInput.addEventListener('change', e => handleFileSelect(e.target.files[0]));
  fileInput.addEventListener('change',   e => handleFileSelect(e.target.files[0]));
  analyzeBtn.addEventListener('click',   handleAnalyze);
  resetBtn.addEventListener('click',     resetToUpload);
  errorRetryBtn.addEventListener('click', resetToUpload);
  newAnalysisBtn.addEventListener('click', resetToUpload);

  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
  }
}

// ============================================================
// ファイル選択・プレビュー
// ============================================================

async function handleFileSelect(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showError('画像ファイルを選択してください');
    return;
  }

  try {
    const { base64, mimeType } = await compressImage(file);
    currentBase64 = base64;
    currentMimeType = mimeType;

    previewImage.src = `data:${mimeType};base64,${base64}`;
    showSection('preview');
  } catch (e) {
    showError('画像の読み込みに失敗しました: ' + e.message);
  }

  // 同じファイルを再選択できるようにリセット
  cameraInput.value = '';
  fileInput.value   = '';
}

/**
 * 画像をCanvas経由でリサイズ＆Base64変換する
 * @param {File} file
 * @returns {Promise<{base64: string, mimeType: string}>}
 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // 長辺が IMAGE_MAX_PX を超える場合は縮小
        if (Math.max(width, height) > IMAGE_MAX_PX) {
          const ratio = IMAGE_MAX_PX / Math.max(width, height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, IMAGE_QUALITY);
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, mimeType });
      };
      img.onerror = () => reject(new Error('画像のデコードに失敗しました'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

// ============================================================
// AI解析
// ============================================================

async function handleAnalyze() {
  if (!currentBase64) {
    showError('画像が選択されていません');
    return;
  }

  if (GAS_ENDPOINT === 'YOUR_GAS_ENDPOINT_URL_HERE') {
    showError('app.js の GAS_ENDPOINT にGASのURLを設定してください');
    return;
  }

  showSection('loading');
  loadingText.textContent = 'AIが商品情報を解析中...';

  try {
    const results = await callGasApi(currentBase64, currentMimeType);
    renderResults(results);
    showSection('results');
  } catch (e) {
    console.error('API call failed:', e);
    showError(e.message || 'サーバーとの通信に失敗しました');
  }
}

/**
 * GASエンドポイントにBase64画像をPOSTし、判定結果を取得する
 * @param {string} base64
 * @param {string} mimeType
 * @returns {Promise<Array>}
 */
async function callGasApi(base64, mimeType) {
  const requestBody = JSON.stringify({ image: base64, mimeType: mimeType });
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[API] 試行 ${attempt}/${MAX_RETRIES}, payload=${(requestBody.length / 1024).toFixed(0)}KB`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000); // 55秒タイムアウト

      const response = await fetch(GAS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
        redirect: 'follow',
        mode: 'cors',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`サーバーエラー: HTTP ${response.status}`);
      }

      const json = await response.json();

      if (json.status !== 'ok') {
        const detail = json.detail ? `\n詳細: ${json.detail}` : '';
        throw new Error((json.message || '解析に失敗しました') + detail);
      }

      return json.data;

    } catch (e) {
      console.warn(`[API] 試行 ${attempt} 失敗:`, e.name, e.message);
      // ネットワークエラー（Load failed / Failed to fetch）でリトライ可能
      const isNetworkError = e.name === 'TypeError' || e.name === 'AbortError';
      if (isNetworkError && attempt < MAX_RETRIES) {
        loadingText.textContent = '通信エラー…再試行中...';
        await new Promise(r => setTimeout(r, 2000)); // 2秒待ってリトライ
        continue;
      }
      // リトライ不可またはサーバーエラー
      if (e.name === 'AbortError') {
        throw new Error('サーバーの応答がタイムアウトしました（55秒）');
      }
      // iOS Safari では "Load failed"、他ブラウザでは "Failed to fetch" になる
      if (e.name === 'TypeError') {
        throw new Error('通信に失敗しました。電波状況を確認してから再度お試しください。');
      }
      throw e;
    }
  }
}

// ============================================================
// 結果表示
// ============================================================

/**
 * 判定結果配列をUIに描画する
 * @param {Array<object>} products
 */
function renderResults(products) {
  // サマリー集計
  const counts = { excellent: 0, good: 0, normal: 0, skip: 0, new: 0 };
  products.forEach(p => {
    if      (p.judgment === '◎')    counts.excellent++;
    else if (p.judgment === '○')    counts.good++;
    else if (p.judgment === '△')    counts.normal++;
    else if (p.judgment === 'new')  counts.new++;
    else                            counts.skip++;
  });

  summaryStats.innerHTML = `
    <div class="stat-item stat-excellent">
      <div class="stat-count">${counts.excellent}</div>
      <div class="stat-label">◎ お買い得</div>
    </div>
    <div class="stat-item stat-good">
      <div class="stat-count">${counts.good}</div>
      <div class="stat-label">○ やや安め</div>
    </div>
    <div class="stat-item stat-normal">
      <div class="stat-count">${counts.normal}</div>
      <div class="stat-label">△ 相場並み</div>
    </div>
    <div class="stat-item stat-skip">
      <div class="stat-count">${counts.skip + counts.new}</div>
      <div class="stat-label">判定外</div>
    </div>
  `;

  // 商品カード（お買い得順にソート）
  const sorted = [...products].sort((a, b) => {
    const order = { '◎': 0, '○': 1, '△': 2, 'new': 3, 'unknown': 4, 'skip': 5, 'error': 6 };
    return (order[a.judgment] ?? 5) - (order[b.judgment] ?? 5);
  });

  productsList.innerHTML = sorted.map(p => buildProductCard(p)).join('');
}

/**
 * 商品カードのHTMLを生成する
 * @param {object} p - 判定結果オブジェクト
 * @returns {string} HTML文字列
 */
function buildProductCard(p) {
  const rankClass = {
    '◎': 'excellent', '○': 'good', '△': 'normal',
    'skip': 'skip', 'new': 'new', 'unknown': 'skip', 'error': 'skip',
  }[p.judgment] || 'skip';

  const badge = buildBadge(p.judgment);
  const priceHtml = p.price != null
    ? `<div class="product-price-row">
         <span class="product-price">${p.price.toLocaleString()}円</span>
         <span class="product-price-sub">${p.raw_name || ''}</span>
       </div>`
    : '';

  const discountHtml = buildDiscountHtml(p);
  const detailHtml   = buildDetailHtml(p);
  const skipHtml     = p.skip_reason
    ? `<p class="product-skip-reason">${escHtml(p.skip_reason)}</p>` : '';
  const newBadge     = p.is_new_record
    ? `<span class="product-new-badge">NEW 最安値更新!</span>` : '';

  return `
    <article class="product-card ${rankClass}">
      <div class="product-header">
        <div>
          <div class="product-name">${escHtml(p.normalized_name || p.raw_name || '不明')}</div>
          ${p.normalized_name && p.raw_name !== p.normalized_name
            ? `<div class="product-name-raw">${escHtml(p.raw_name)}</div>` : ''}
        </div>
        ${badge}
      </div>
      <div class="product-body">
        ${priceHtml}
        ${discountHtml}
        ${detailHtml}
        ${newBadge}
        ${skipHtml}
      </div>
    </article>
  `.trim();
}

function buildBadge(judgment) {
  const map = {
    '◎': ['badge-excellent', '◎'],
    '○': ['badge-good',      '○'],
    '△': ['badge-normal',    '△'],
    'new': ['badge-new',     'NEW'],
    'skip': ['badge-skip',   '−'],
    'unknown': ['badge-skip', '?'],
    'error': ['badge-skip',  '!'],
  };
  const [cls, label] = map[judgment] || ['badge-skip', '?'];
  return `<span class="badge ${cls}" aria-label="${label}">${label}</span>`;
}

function buildDiscountHtml(p) {
  if (p.discount_rate == null) return '';
  const rate = p.discount_rate;
  const cls = rate <= 0 ? 'discount-positive' : 'discount-negative';
  const sign = rate <= 0 ? '' : '+';
  return `<span class="product-discount ${cls}">${sign}${rate}%</span>`;
}

function buildDetailHtml(p) {
  const lines = [];

  if (p.track === 'A') {
    if (p.market_unit_price != null && p.current_unit_price != null) {
      lines.push(`単位価格: ${p.current_unit_price}円/${p.market_unit} （相場: ${p.market_unit_price}円/${p.market_unit}）`);
    }
    if (p.market_updated_at) {
      lines.push(`相場データ: ${p.market_updated_at} 時点（e-Stat）`);
    }
  } else if (p.track === 'B') {
    if (p.lowest_price != null) {
      lines.push(`底値: ${p.lowest_price.toLocaleString()}円`);
    }
    if (p.previous_lowest != null && p.is_new_record) {
      lines.push(`前回底値: ${p.previous_lowest.toLocaleString()}円`);
    }
  }

  if (p.target_date) {
    lines.push(`期間: ${p.target_date}`);
  }

  return lines.length > 0
    ? `<div class="product-detail">${lines.map(l => escHtml(l)).join('<br>')}</div>`
    : '';
}

/** XSS防止用エスケープ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// セクション切り替え
// ============================================================

const SECTIONS = ['upload', 'preview', 'loading', 'error', 'results'];

function showSection(name) {
  uploadSection.hidden  = name !== 'upload';
  previewSection.hidden = name !== 'preview';
  loadingSection.hidden = name !== 'loading';
  errorSection.hidden   = name !== 'error';
  resultsSection.hidden = name !== 'results';

  // スクロールを先頭に戻す
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(message) {
  errorMessage.textContent = message;
  showSection('error');
}

function resetToUpload() {
  currentBase64   = null;
  currentMimeType = null;
  previewImage.src = '';
  productsList.innerHTML = '';
  summaryStats.innerHTML = '';
  showSection('upload');
}

// ============================================================
// 起動
// ============================================================
document.addEventListener('DOMContentLoaded', init);
