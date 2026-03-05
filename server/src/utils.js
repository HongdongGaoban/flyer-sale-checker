/**
 * utils.js
 * 共通ユーティリティ（Utils.gs の Node.js 移植）
 */

import { JUDGMENT, FRESH_FOOD_KEYWORDS } from './config.js';

/**
 * 商品カテゴリが生鮮食品かどうかを判定する
 * @param {string} category
 * @returns {boolean}
 */
export function isFreshFood(category) {
  if (!category) return false;
  return FRESH_FOOD_KEYWORDS.some(keyword => category.includes(keyword));
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
