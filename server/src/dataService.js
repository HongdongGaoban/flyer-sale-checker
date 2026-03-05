/**
 * dataService.js
 * Firestore を使ったデータ読み書き（SpreadsheetService.gs の置き換え）
 *
 * コレクション構造:
 *   marketData/     : 相場データマスター（相場データマスターシート相当）
 *     {category}    : { category, itemName, unit, avgPrice, updatedAt, sourceCode }
 *
 *   unitConversion/ : 単位換算マスター（単位換算マスターシート相当）
 *     {category_flyerUnit} : { category, flyerUnit, convertToBase, baseUnit }
 *
 *   lowestPrice/    : 固定底値マスター（固定底値マスターシート相当）
 *     {auto-id}     : { normalizedName, amountVal, baseUnit, lowestPrice, lastUpdated }
 */

import { Firestore } from '@google-cloud/firestore';
import { getConfig } from './config.js';
import { todayString, log } from './utils.js';

let _db = null;

function getDb() {
  if (!_db) {
    const { gcpProjectId } = getConfig();
    // GCP_PROJECT_ID が設定されていれば明示指定、
    // Cloud Run 上では未設定でも SDK がメタデータサーバーから自動検出する
    _db = gcpProjectId ? new Firestore({ projectId: gcpProjectId }) : new Firestore();
  }
  return _db;
}

// ============================================================
// 単位換算マスター
// ============================================================

/**
 * チラシ単位から基準重量(g/ml)への換算値を取得する
 * @param {string} category
 * @param {string} flyerUnit - AI が返した base_unit
 * @param {number} amountVal - AI が返した amount_val
 * @returns {Promise<{ convertedAmount: number, baseUnit: string }|null>}
 */
export async function convertUnit(category, flyerUnit, amountVal) {
  const db = getDb();
  const col = db.collection('unitConversion');

  // カテゴリ前方一致 + チラシ単位完全一致
  const snapshot = await col
    .where('flyerUnit', '==', String(flyerUnit))
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs.find(d => {
    const cat = d.data().category;
    return String(cat).includes(category) || category.includes(String(cat));
  });

  if (!doc) return null;

  const data = doc.data();
  const baseVal = Number(data.convertToBase);
  if (isNaN(baseVal)) return null;

  return {
    convertedAmount: baseVal * (amountVal || 1),
    baseUnit: String(data.baseUnit),
  };
}

// ============================================================
// 相場データマスター
// ============================================================

/**
 * カテゴリに対応する相場データを取得する
 * @param {string} category
 * @returns {Promise<{ avgPrice: number, unit: string, updatedAt: string }|null>}
 */
export async function getMarketPrice(category) {
  const db = getDb();
  const col = db.collection('marketData');

  // ドキュメントIDをカテゴリにしているため全件スキャンなしで取得
  // まずカテゴリ名完全一致で試みる
  const exactDoc = await col.doc(category).get();
  if (exactDoc.exists) {
    const d = exactDoc.data();
    return { avgPrice: Number(d.avgPrice), unit: String(d.unit), updatedAt: String(d.updatedAt) };
  }

  // 前方一致フォールバック（全件取得 → JS でフィルタ）
  const snapshot = await col.get();
  const matched = snapshot.docs.find(doc => {
    const cat = doc.data().category;
    return String(cat).includes(category) || category.includes(String(cat));
  });

  if (!matched) return null;
  const d = matched.data();
  return { avgPrice: Number(d.avgPrice), unit: String(d.unit), updatedAt: String(d.updatedAt) };
}

/**
 * 相場データマスターを一括更新する（e-Stat バッチ用）
 * @param {Array<{ category, itemName, unit, avgPrice, sourceCode }>} items
 */
export async function upsertMarketData(items) {
  const db = getDb();
  const col = db.collection('marketData');
  const today = todayString();

  const batch = db.batch();
  for (const item of items) {
    // ドキュメント ID = カテゴリ名（上書き可能なキーとして利用）
    const ref = col.doc(item.category);
    batch.set(ref, {
      category:   item.category,
      itemName:   item.itemName,
      unit:       item.unit,
      avgPrice:   item.avgPrice,
      updatedAt:  today,
      sourceCode: item.sourceCode,
    });
  }
  await batch.commit();
  log('upsertMarketData', `${items.length}件 更新完了`);
}

// ============================================================
// 固定底値マスター（B系統 / 自己学習）
// ============================================================

/**
 * 正規化名 + 容量 + 単位をキーとして底値マスターを検索する
 * @param {string} normalizedName
 * @param {number} amountVal
 * @param {string} baseUnit
 * @returns {Promise<{ docId: string, lowestPrice: number }|null>}
 */
export async function findLowestRecord(normalizedName, amountVal, baseUnit) {
  const db = getDb();
  const snapshot = await db.collection('lowestPrice')
    .where('normalizedName', '==', String(normalizedName))
    .where('amountVal',      '==', Number(amountVal))
    .where('baseUnit',       '==', String(baseUnit))
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { docId: doc.id, lowestPrice: Number(doc.data().lowestPrice) };
}

/**
 * 底値マスターに新規レコードを追記する（INSERT）
 * @param {string} normalizedName
 * @param {number} amountVal
 * @param {string} baseUnit
 * @param {number} price
 */
export async function insertLowestRecord(normalizedName, amountVal, baseUnit, price) {
  const db = getDb();
  await db.collection('lowestPrice').add({
    normalizedName: String(normalizedName),
    amountVal:      Number(amountVal),
    baseUnit:       String(baseUnit),
    lowestPrice:    Number(price),
    lastUpdated:    todayString(),
  });
  log('insertLowest', `${normalizedName} ${amountVal}${baseUnit} @${price}円 を新規登録`);
}

/**
 * 底値マスターの価格を更新する（UPDATE）
 * @param {string} docId - Firestore ドキュメント ID
 * @param {number} newPrice
 */
export async function updateLowestRecord(docId, newPrice) {
  const db = getDb();
  await db.collection('lowestPrice').doc(docId).update({
    lowestPrice: Number(newPrice),
    lastUpdated: todayString(),
  });
  log('updateLowest', `doc=${docId} を ${newPrice}円 に更新`);
}

// ============================================================
// データ移行サポート（scripts/importSheets.js から呼ぶ）
// ============================================================

/**
 * 単位換算マスターを一括投入する
 * @param {Array<{ category, flyerUnit, convertToBase, baseUnit }>} items
 */
export async function bulkInsertUnitConversion(items) {
  const db = getDb();
  const col = db.collection('unitConversion');
  const batch = db.batch();
  for (const item of items) {
    const id = `${item.category}_${item.flyerUnit}`;
    batch.set(col.doc(id), item);
  }
  await batch.commit();
  log('bulkInsertUnitConversion', `${items.length}件`);
}
