/**
 * scripts/importSheets.js
 * Google スプレッドシートの既存データを Firestore に移行するスクリプト
 *
 * 使い方:
 *   1. .env に GCP_PROJECT_ID と GOOGLE_APPLICATION_CREDENTIALS を設定
 *   2. 以下の定数を実際のスプレッドシートデータで書き換える
 *   3. node scripts/importSheets.js
 *
 * ※ 単位換算マスター・相場データマスターは手動でここに記述する（ハードコード）
 * ※ 固定底値マスターは既存 Sheets から CSV エクスポートして読み込む（オプション）
 */

import { Firestore } from '@google-cloud/firestore';
import { readFileSync } from 'fs';
import { getConfig } from '../src/config.js';

const { gcpProjectId } = getConfig();
const db = new Firestore({ projectId: gcpProjectId });

// ============================================================
// 単位換算マスター（スプレッドシートの「単位換算マスター」シートを転記）
// フォーマット: { category, flyerUnit, convertToBase, baseUnit }
// ============================================================
const UNIT_CONVERSION_DATA = [
  // キャベツ
  { category: 'キャベツ', flyerUnit: '玉',    convertToBase: 1200, baseUnit: 'g' },
  { category: 'キャベツ', flyerUnit: 'カット', convertToBase: 600,  baseUnit: 'g' },
  { category: 'キャベツ', flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // レタス
  { category: 'レタス',   flyerUnit: '玉',    convertToBase: 300,  baseUnit: 'g' },
  { category: 'レタス',   flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // にんじん
  { category: 'にんじん', flyerUnit: '本',    convertToBase: 200,  baseUnit: 'g' },
  { category: 'にんじん', flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // たまねぎ
  { category: 'たまねぎ', flyerUnit: '個',    convertToBase: 200,  baseUnit: 'g' },
  { category: 'たまねぎ', flyerUnit: '袋',    convertToBase: 600,  baseUnit: 'g' },
  { category: 'たまねぎ', flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ほうれん草
  { category: 'ほうれん草', flyerUnit: '束',  convertToBase: 200,  baseUnit: 'g' },
  { category: 'ほうれん草', flyerUnit: 'g',   convertToBase: 1,    baseUnit: 'g' },
  // トマト
  { category: 'トマト',   flyerUnit: '個',    convertToBase: 200,  baseUnit: 'g' },
  { category: 'トマト',   flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // きゅうり
  { category: 'きゅうり', flyerUnit: '本',    convertToBase: 100,  baseUnit: 'g' },
  { category: 'きゅうり', flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // なす
  { category: 'なす',     flyerUnit: '個',    convertToBase: 100,  baseUnit: 'g' },
  { category: 'なす',     flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ピーマン
  { category: 'ピーマン', flyerUnit: '袋',    convertToBase: 150,  baseUnit: 'g' },
  { category: 'ピーマン', flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ねぎ
  { category: 'ねぎ',     flyerUnit: '本',    convertToBase: 1,    baseUnit: '本' },
  // もやし
  { category: 'もやし',   flyerUnit: '袋',    convertToBase: 200,  baseUnit: 'g' },
  { category: 'もやし',   flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // じゃがいも
  { category: 'じゃがいも', flyerUnit: '個',  convertToBase: 150,  baseUnit: 'g' },
  { category: 'じゃがいも', flyerUnit: '袋',  convertToBase: 900,  baseUnit: 'g' },
  { category: 'じゃがいも', flyerUnit: 'g',   convertToBase: 1,    baseUnit: 'g' },
  // 大根
  { category: '大根',     flyerUnit: '本',    convertToBase: 800,  baseUnit: 'g' },
  { category: '大根',     flyerUnit: 'カット', convertToBase: 400,  baseUnit: 'g' },
  { category: '大根',     flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // 肉類（共通）
  { category: '豚肉',       flyerUnit: 'g',   convertToBase: 1,    baseUnit: 'g' },
  { category: '豚肉こま切れ', flyerUnit: 'g', convertToBase: 1,    baseUnit: 'g' },
  { category: '鶏肉',       flyerUnit: 'g',   convertToBase: 1,    baseUnit: 'g' },
  { category: '牛肉',       flyerUnit: 'g',   convertToBase: 1,    baseUnit: 'g' },
  // 卵
  { category: '卵',         flyerUnit: '個',  convertToBase: 1,    baseUnit: '個' },
  { category: '卵',         flyerUnit: 'パック', convertToBase: 10, baseUnit: '個' },
  // 牛乳
  { category: '牛乳',       flyerUnit: 'ml',  convertToBase: 1,    baseUnit: 'ml' },
  { category: '牛乳',       flyerUnit: 'L',   convertToBase: 1000, baseUnit: 'ml' },
  // ---- 追加野菜（Phase 1） ----
  // はくさい（1玉 ≈ 1000g、1/4カット ≈ 250g が一般的）
  { category: 'はくさい',     flyerUnit: '玉',    convertToBase: 1000, baseUnit: 'g' },
  { category: 'はくさい',     flyerUnit: 'カット', convertToBase: 250,  baseUnit: 'g' },
  { category: 'はくさい',     flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ブロッコリー（1株 ≈ 300g）
  { category: 'ブロッコリー', flyerUnit: '個',    convertToBase: 300,  baseUnit: 'g' },
  { category: 'ブロッコリー', flyerUnit: '株',    convertToBase: 300,  baseUnit: 'g' },
  { category: 'ブロッコリー', flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // さつまいも（1個 ≈ 250g、袋売りは 500g が多い）
  { category: 'さつまいも',   flyerUnit: '個',    convertToBase: 250,  baseUnit: 'g' },
  { category: 'さつまいも',   flyerUnit: '袋',    convertToBase: 500,  baseUnit: 'g' },
  { category: 'さつまいも',   flyerUnit: 'kg',    convertToBase: 1000, baseUnit: 'g' },
  { category: 'さつまいも',   flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ---- 豆腐（Phase 1） ----
  // 豆腐（1丁 ≈ 300g が標準的な木綿/絹豆腐）
  { category: '豆腐',         flyerUnit: '丁',    convertToBase: 300,  baseUnit: 'g' },
  { category: '豆腐',         flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ---- 果物（Phase 1） ----
  // バナナ（1房 ≈ 5本 ≈ 500g、1本 ≈ 100g）
  { category: 'バナナ',       flyerUnit: '房',    convertToBase: 500,  baseUnit: 'g' },
  { category: 'バナナ',       flyerUnit: '本',    convertToBase: 100,  baseUnit: 'g' },
  { category: 'バナナ',       flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ---- 追加野菜（Phase 2） ----
  // かぼちゃ（1個 ≈ 1500g、1/4カット ≈ 375g）
  { category: 'かぼちゃ',     flyerUnit: '個',    convertToBase: 1500, baseUnit: 'g' },
  { category: 'かぼちゃ',     flyerUnit: 'カット', convertToBase: 375,  baseUnit: 'g' },
  { category: 'かぼちゃ',     flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // 生しいたけ（1パック ≈ 100g）
  { category: '生しいたけ',   flyerUnit: 'パック', convertToBase: 100,  baseUnit: 'g' },
  { category: '生しいたけ',   flyerUnit: '袋',    convertToBase: 100,  baseUnit: 'g' },
  { category: '生しいたけ',   flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // えのきたけ（1袋 ≈ 200g）
  { category: 'えのきたけ',   flyerUnit: '袋',    convertToBase: 200,  baseUnit: 'g' },
  { category: 'えのきたけ',   flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // しめじ（1袋 ≈ 100g）
  { category: 'しめじ',       flyerUnit: '袋',    convertToBase: 100,  baseUnit: 'g' },
  { category: 'しめじ',       flyerUnit: 'パック', convertToBase: 100,  baseUnit: 'g' },
  { category: 'しめじ',       flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // ---- 果物（Phase 2） ----
  // りんご（1個 ≈ 300g）
  { category: 'りんご',       flyerUnit: '個',    convertToBase: 300,  baseUnit: 'g' },
  { category: 'りんご',       flyerUnit: 'kg',    convertToBase: 1000, baseUnit: 'g' },
  { category: 'りんご',       flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
  // みかん（1個 ≈ 100g、袋売りは 1kg が多い）
  { category: 'みかん',       flyerUnit: '個',    convertToBase: 100,  baseUnit: 'g' },
  { category: 'みかん',       flyerUnit: '袋',    convertToBase: 1000, baseUnit: 'g' },
  { category: 'みかん',       flyerUnit: 'kg',    convertToBase: 1000, baseUnit: 'g' },
  { category: 'みかん',       flyerUnit: 'g',     convertToBase: 1,    baseUnit: 'g' },
];

// ============================================================
// Firestore へ書き込む
// ============================================================

async function importUnitConversion() {
  console.log('単位換算マスターを投入中...');
  const col = db.collection('unitConversion');
  const batch = db.batch();

  for (const item of UNIT_CONVERSION_DATA) {
    const id = `${item.category}_${item.flyerUnit}`;
    batch.set(col.doc(id), item);
  }
  await batch.commit();
  console.log(`  → ${UNIT_CONVERSION_DATA.length}件 完了`);
}

async function main() {
  try {
    await importUnitConversion();
    console.log('\n✓ 移行完了');
    console.log('相場データマスターは e-Stat バッチ（POST /batch/estat）を実行して自動投入してください。');
  } catch (e) {
    console.error('移行エラー:', e.message);
    process.exit(1);
  }
}

main();
