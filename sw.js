/**
 * sw.js - Service Worker
 * キャッシュファースト戦略でオフライン時もUIを提供する
 */

'use strict';

const CACHE_NAME = 'flyer-checker-v6';  // バージョン変更で古いキャッシュを強制削除

// キャッシュ対象のリソース（アプリシェル）
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ============================================================
// インストール: アプリシェルをキャッシュ
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] App shell をキャッシュ中');
      return cache.addAll(APP_SHELL);
    }).then(() => {
      // 待機中のSWをすぐに有効化
      return self.skipWaiting();
    })
  );
});

// ============================================================
// アクティベート: 古いキャッシュを削除
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] 古いキャッシュを削除:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ============================================================
// フェッチ: キャッシュファーストでリクエストを処理
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Vercelプロキシ経由のAPIリクエストはキャッシュしない（POSTなので元々キャッシュ対象外だが明示）
  // iOS Safari では fetch(event.request) をそのまま渡すとリクエストボディが失われる
  // バグがあるため、ボディを明示的に読み取り新しいリクエストとして再送する
  //
  // さらに iOS Safari では req.headers をそのまま渡すと Content-Length などの
  // 禁止ヘッダー（forbidden headers）が含まれ "Load failed" エラーになるため、
  // Content-Type のみ手動で引き継ぎ、mode: 'same-origin' を明示する
  if (url.pathname.startsWith('/api/')) {
    const req = event.request;
    event.respondWith(
      req.text().then(body => {
        const headers = new Headers();
        const ct = req.headers.get('Content-Type');
        if (ct) headers.set('Content-Type', ct);

        return fetch(req.url, {
          method: req.method,
          headers: headers,
          body: body || undefined,
          mode: 'same-origin',
          credentials: req.credentials,
          redirect: 'follow',
        });
      })
    );
    return;
  }

  // GASエンドポイントへの直接リクエストはキャッシュしない（フォールバック用）
  if (url.hostname.includes('script.google.com')) {
    return;  // SW をバイパス（fetch を SW が呼ぶと CORS エラーになるため）
  }

  // e-Stat APIはキャッシュしない
  if (url.hostname.includes('api.e-stat.go.jp')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Gemini APIはキャッシュしない
  if (url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // アプリシェルはキャッシュファースト
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }
      // キャッシュになければネットワークから取得してキャッシュに追加
      return fetch(event.request).then(response => {
        // 正常なレスポンスのみキャッシュ
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // オフラインかつキャッシュなし → index.htmlにフォールバック
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
