/**
 * estatService.js
 * e-Stat API から小売物価データを取得して Firestore を更新する
 * （EStatService.gs の Node.js 移植）
 *
 * Cloud Scheduler から POST /batch/estat に呼ばれる想定
 * スケジュール例: 毎週月曜 03:00 JST
 */

import { getConfig, ESTAT_API_BASE, ESTAT_STATS_DATA_ID, ESTAT_AREA_CODE } from './config.js';
import { upsertMarketData } from './dataService.js';
import { sleep, log } from './utils.js';
import { todayString } from './utils.js';

/**
 * e-Stat から相場データを取得して Firestore を更新するメイン関数
 * （GAS の fetchEStatAndUpdate 相当）
 */
export async function fetchEStatAndUpdate() {
  log('EStatService', 'バッチ開始');

  const items = await fetchRetailPrices();
  if (!items || items.length === 0) {
    log('EStatService', 'データ取得結果が空');
    return { updated: 0 };
  }

  await upsertMarketData(items);
  log('EStatService', `バッチ完了: ${items.length}件 更新`);
  return { updated: items.length };
}

/**
 * e-Stat API から生鮮食品の小売価格を取得する
 * @returns {Promise<Array<{ category, itemName, unit, avgPrice, sourceCode }>>}
 */
async function fetchRetailPrices() {
  const { eStatAppId } = getConfig();
  if (!eStatAppId) throw new Error('ESTAT_APP_ID が設定されていません');

  const targets = getEStatTargets();
  const results = [];

  for (const target of targets) {
    try {
      const price = await fetchSingleItem(eStatAppId, target.code);
      if (price !== null) {
        results.push({
          category:   target.category,
          itemName:   target.itemName,
          unit:       target.unit,
          avgPrice:   price * target.baseMultiplier,
          sourceCode: target.code,
        });
      }
      await sleep(200);
    } catch (e) {
      log('EStatService fetchSingleItem error', `${target.itemName}: ${e.message}`);
    }
  }

  return results;
}

/**
 * e-Stat API から特定品目の価格を取得する
 * @param {string} appId
 * @param {string} itemCode
 * @returns {Promise<number|null>}
 */
async function fetchSingleItem(appId, itemCode) {
  const params = new URLSearchParams({
    appId:          appId,
    statsDataId:    ESTAT_STATS_DATA_ID,
    cdCat02:        itemCode,
    cdArea:         ESTAT_AREA_CODE,
    metaGetFlg:     'N',
    cntGetFlg:      'N',
    sectionHeaderFlg: '1',
  });

  const url = `${ESTAT_API_BASE}?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();

  const status = json?.GET_STATS_DATA?.RESULT?.STATUS;
  if (status !== undefined && status !== 0) {
    const errMsg = json?.GET_STATS_DATA?.RESULT?.ERROR_MSG || '不明なエラー';
    log('EStatService API error', `code=${itemCode} status=${status} msg=${errMsg}`);
    return null;
  }

  const dataList = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
  if (!dataList) {
    log('EStatService empty data', `code=${itemCode}`);
    return null;
  }

  const latestData = Array.isArray(dataList) ? dataList[dataList.length - 1] : dataList;
  const price = parseFloat(latestData?.['$']);

  return isNaN(price) ? null : price;
}

/**
 * 取得対象品目の定義（EStatService.gs の getEStatTargets 相当）
 */
function getEStatTargets() {
  return [
    // ---- 野菜類 ----
    { code: '01401', category: 'キャベツ',    itemName: 'キャベツ',         unit: 'g',  baseMultiplier: 0.000833 },
    { code: '01406', category: 'レタス',      itemName: 'レタス',           unit: 'g',  baseMultiplier: 0.001    },
    { code: '01415', category: 'にんじん',    itemName: 'にんじん',         unit: 'g',  baseMultiplier: 0.001    },
    { code: '01417', category: 'たまねぎ',    itemName: 'たまねぎ',         unit: 'g',  baseMultiplier: 0.001    },
    { code: '01402', category: 'ほうれん草',  itemName: 'ほうれんそう',     unit: 'g',  baseMultiplier: 0.001    },
    { code: '01436', category: 'トマト',      itemName: 'トマト',           unit: 'g',  baseMultiplier: 0.001    },
    { code: '01434', category: 'きゅうり',    itemName: 'きゅうり',         unit: 'g',  baseMultiplier: 0.001    },
    { code: '01435', category: 'なす',        itemName: 'なす',             unit: 'g',  baseMultiplier: 0.001    },
    { code: '01437', category: 'ピーマン',    itemName: 'ピーマン',         unit: 'g',  baseMultiplier: 0.006667 },
    { code: '01405', category: 'ねぎ',        itemName: 'ねぎ',             unit: '本', baseMultiplier: 1        },
    { code: '01407', category: 'もやし',      itemName: 'もやし',           unit: 'g',  baseMultiplier: 0.005    },
    { code: '01412', category: 'じゃがいも',  itemName: 'じゃがいも',       unit: 'g',  baseMultiplier: 0.001    },
    { code: '01414', category: '大根',        itemName: 'だいこん',         unit: 'g',  baseMultiplier: 0.00125  },
    // ---- 肉類 ----
    { code: '01201', category: '牛肉',          itemName: '牛肉（国産品）',       unit: 'g', baseMultiplier: 0.01 },
    { code: '01211', category: '豚肉',          itemName: '豚肉（国産・バラ）',   unit: 'g', baseMultiplier: 0.01 },
    { code: '01211', category: '豚肉こま切れ',  itemName: '豚肉（国産・バラ）',   unit: 'g', baseMultiplier: 0.01 },
    { code: '01221', category: '鶏肉',          itemName: '鶏肉',                 unit: 'g', baseMultiplier: 0.01 },
    // ---- 卵・牛乳 ----
    { code: '01341', category: '卵',   itemName: '鶏卵',             unit: '個', baseMultiplier: 0.1   },
    { code: '01303', category: '牛乳', itemName: '牛乳（紙パック）', unit: 'ml', baseMultiplier: 0.001 },
    // ---- 追加野菜（Phase 1） ----
    { code: '01403', category: 'はくさい',     itemName: 'はくさい',     unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
    { code: '01409', category: 'ブロッコリー', itemName: 'ブロッコリー', unit: 'g', baseMultiplier: 0.003333 }, // ¥/個 確認済み（1個≈300g として ¥/g に換算）
    { code: '01411', category: 'さつまいも',   itemName: 'さつまいも',   unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
    // ---- 豆腐（Phase 1） ----
    { code: '01471', category: '豆腐',         itemName: '豆腐',         unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
    // ---- 果物（Phase 1） ----
    { code: '01581', category: 'バナナ',       itemName: 'バナナ',       unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
    // ---- 追加野菜（Phase 2） ----
    { code: '01433', category: 'かぼちゃ',     itemName: 'かぼちゃ',     unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
    { code: '01438', category: '生しいたけ',   itemName: '生しいたけ',   unit: 'g', baseMultiplier: 0.01     }, // ¥/100g 想定（要確認）
    { code: '01442', category: 'えのきたけ',   itemName: 'えのきたけ',   unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
    { code: '01443', category: 'しめじ',       itemName: 'しめじ',       unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
    // ---- 果物（Phase 2） ----
    { code: '01502', category: 'りんご',       itemName: 'りんご',       unit: 'g', baseMultiplier: 0.003333 }, // ¥/個 確認済み（1個≈300g として ¥/g に換算）
    { code: '01511', category: 'みかん',       itemName: 'みかん',       unit: 'g', baseMultiplier: 0.001    }, // ¥/kg 確認済み
  ];
}
