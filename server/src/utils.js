/**
 * utils.js
 * 共通ユーティリティ（Utils.gs の Node.js 移植）
 */

import { JUDGMENT, FRESH_FOOD_ALIASES } from './config.js';

// 起動時にフラットマップを構築（alias → canonical）
const ALIAS_TO_CANONICAL = {};
for (const [canonical, aliases] of Object.entries(FRESH_FOOD_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL[alias] = canonical;
  }
}

/**
 * Gemini が返した category から A系統の正規カテゴリ名を解決する
 * @param {string} category - Gemini の出力 category
 * @returns {string|null} 正規カテゴリ名（getEStatTargets().category と一致）。A系統対象外なら null
 */
export function resolveFreshCategory(category) {
  if (!category) return null;

  // 1. 完全一致（最も高速・確実）
  if (ALIAS_TO_CANONICAL[category]) return ALIAS_TO_CANONICAL[category];

  // 2. 部分一致（category にエイリアスが含まれる場合、最長一致を採用）
  let bestMatch = null;
  let bestLen = 0;
  for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
    if (category.includes(alias) && alias.length > bestLen) {
      bestMatch = canonical;
      bestLen = alias.length;
    }
  }
  return bestMatch;
}

/**
 * 割引率を計算する（小数: -0.20 なら -20%）
 * @param {number} currentPrice
 * @param {number} referencePrice
 * @returns {number|null}
 */
export function calcDiscountRate(currentPrice, referencePrice) {
  if (!referencePrice || referencePrice === 0) return null;
  return (currentPrice - referencePrice) / referencePrice;
}

/**
 * 割引率から判定ランクを返す
 * @param {number|null} rate
 * @returns {string}
 */
export function getRank(rate) {
  if (rate === null || rate === undefined) return '-';
  if (rate <= JUDGMENT.EXCELLENT_THRESHOLD) return '◎';
  if (rate <= JUDGMENT.GOOD_THRESHOLD)      return '○';
  return '△';
}

/**
 * 今日の日付を YYYY-MM-DD 形式（JST）で返す
 * @returns {string}
 */
export function todayString() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/**
 * 指定ミリ秒待機する
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ログ出力
 * @param {string} label
 * @param {*} value
 */
export function log(label, value) {
  console.log(`[${label}]`, typeof value === 'string' ? value : JSON.stringify(value));
}
