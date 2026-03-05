/**
 * judgmentLogic.js
 * 判定ロジック（JudgmentLogic.gs の Node.js 移植）
 * A系統: 生鮮食品 × e-Stat 相場比較
 * B系統: 加工食品 × 自己学習底値 DB
 */

import { resolveFreshCategory, calcDiscountRate, getRank, log } from './utils.js';
import { convertUnit, getMarketPrice, findLowestRecord, insertLowestRecord, updateLowestRecord } from './dataService.js';

/**
 * AI 抽出結果の商品配列を受け取り、判定結果を付与して返す
 * @param {Array<object>} products
 * @returns {Promise<Array<object>>}
 */
export async function judgeAll(products) {
  return Promise.all(products.map(product => judgeOne(product)));
}

/**
 * 商品 1 件を判定する
 * @param {object} product
 * @returns {Promise<object>}
 */
async function judgeOne(product) {
  const result = { ...product };

  // ① 条件付き除外チェック
  if (product.is_multi_buy) {
    return { ...result, judgment: 'skip', skip_reason: 'まとめ買い条件あり（価格比較対象外）' };
  }
  if (product.is_conditional) {
    return { ...result, judgment: 'skip', skip_reason: '条件付き価格（会員限定・タイムセール等）' };
  }

  // ② 価格・容量の欠落チェック
  if (product.price === null || product.price === undefined) {
    return { ...result, judgment: 'skip', skip_reason: '価格が読み取れませんでした' };
  }
  if (product.amount_val === null || product.amount_val === undefined) {
    return { ...result, judgment: 'skip', skip_reason: '容量が不明なため計算できません（1パック・1袋等）' };
  }

  // ③ カテゴリで処理を分岐（正規カテゴリ名に解決できればA系統）
  const resolvedCategory = resolveFreshCategory(product.category);
  if (resolvedCategory) {
    return judgeTrackA(result, resolvedCategory);
  } else {
    return judgeTrackB(result);
  }
}

// ============================================================
// A系統: 生鮮食品 × e-Stat 相場比較
// ============================================================

async function judgeTrackA(product, resolvedCategory) {
  try {
    // resolvedCategory（正規名）で Firestore を検索することで表記ゆれを吸収
    const converted = await convertUnit(resolvedCategory, product.base_unit, product.amount_val);

    if (!converted) {
      return {
        ...product,
        judgment: 'unknown',
        track: 'A',
        skip_reason: `単位換算マスターに "${resolvedCategory} / ${product.base_unit}" が未登録`,
      };
    }

    const market = await getMarketPrice(resolvedCategory);
    if (!market || !market.avgPrice) {
      return {
        ...product,
        judgment: 'unknown',
        track: 'A',
        skip_reason: `相場データマスターに "${resolvedCategory}" の価格データがありません。e-Stat バッチを実行してください`,
      };
    }

    const currentUnitPrice = product.price / converted.convertedAmount;
    const marketUnitPrice  = market.avgPrice;
    const discountRate     = calcDiscountRate(currentUnitPrice, marketUnitPrice);
    const rank             = getRank(discountRate);

    return {
      ...product,
      track: 'A',
      judgment: rank,
      discount_rate:      discountRate !== null ? Math.round(discountRate * 100) : null,
      current_unit_price: Math.round(currentUnitPrice * 100) / 100,
      market_unit_price:  Math.round(marketUnitPrice * 100) / 100,
      market_unit:        converted.baseUnit,
      market_updated_at:  market.updatedAt,
      converted_amount:   converted.convertedAmount,
    };

  } catch (e) {
    log('judgeTrackA error', e.message);
    return { ...product, judgment: 'error', track: 'A', skip_reason: `判定エラー: ${e.message}` };
  }
}

// ============================================================
// B系統: 加工食品 × 自己学習底値 DB
// ============================================================

async function judgeTrackB(product) {
  try {
    const existing = await findLowestRecord(product.normalized_name, product.amount_val, product.base_unit);

    if (!existing) {
      await insertLowestRecord(product.normalized_name, product.amount_val, product.base_unit, product.price);
      return {
        ...product,
        track: 'B',
        judgment: 'new',
        skip_reason: '初めて記録した価格です。次回比較できます',
        lowest_price: product.price,
        is_new_record: true,
      };
    }

    const discountRate = calcDiscountRate(product.price, existing.lowestPrice);
    const rank         = getRank(discountRate);
    const isNewLowest  = product.price < existing.lowestPrice;

    if (isNewLowest) {
      await updateLowestRecord(existing.docId, product.price);
    }

    return {
      ...product,
      track: 'B',
      judgment: rank,
      discount_rate:    discountRate !== null ? Math.round(discountRate * 100) : null,
      lowest_price:     isNewLowest ? product.price : existing.lowestPrice,
      previous_lowest:  existing.lowestPrice,
      is_new_record:    isNewLowest,
    };

  } catch (e) {
    log('judgeTrackB error', e.message);
    return { ...product, judgment: 'error', track: 'B', skip_reason: `判定エラー: ${e.message}` };
  }
}
