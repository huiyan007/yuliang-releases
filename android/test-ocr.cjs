const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const context = { window: {}, structuredClone };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'android/www/ocr.js'), 'utf8'), context);
const { parse, moneyValue, mergeLedger } = context.window.YuliangOcrParser;
const json = value => JSON.parse(JSON.stringify(value));
const line = (text, left, top, right = left + 95, bottom = top + 34) => ({ text, left, top, right, bottom });

// Different OCR boxes on the same visual line, plus header, percentages and status-bar noise.
const first = parse({ width: 1080, height: 2376, lines: [
  line('19:45:05', 40, 36), line('51%', 950, 36), line('50.0 KB/s', 630, 36),
  line('共支出', 60, 330), line('¥1,281.76', 62, 415, 340, 495),
  line('支出构成', 60, 800), line('餐饮 79.09%', 670, 1300),
  line('餐饮', 145, 1600), line('¥1,234.56 ›', 800, 1602, 1000),
  line('生活缴费', 145, 1730), line('¥31.20', 835, 1734),
  line('娱乐', 145, 1860), line('¥13.00', 835, 1860),
  line('购物', 145, 1990), line('¥3.00', 850, 1990), line('设置', 860, 2290)
] });
assert.equal(first.total, 1281.76);
assert.deepEqual(json(first.rows.map(row => [row.source, row.amount, row.category])), [
  ['餐饮', '1234.56', 'food'], ['生活缴费', '31.20', 'bills'], ['娱乐', '13.00', 'entertainment'], ['购物', '3.00', 'shopping']
]);
assert.equal(first.warnings.length, 0);

// One OCR line per row, signed amounts, transaction counts, transfer and no total.
const second = parse({ width: 1080, height: 2376, lines: [
  line('分类支出排行', 50, 420), line('休闲玩乐 35%', 790, 800),
  line('2026年11月1日 - 2026年11月15日', 50, 600, 500),
  line('1 休闲玩乐 4笔 −271.08', 85, 1350, 980),
  line('2 转账 10笔', 82, 1500, 355), line('-101.00', 830, 1497, 990),
  line('3 餐饮 9笔 -98.40', 82, 1660, 990),
  line('4 交通 8笔 -80.31', 82, 1810, 990),
  line('5 购物 3笔 -79.50', 82, 1960, 990), line('点击这里记一笔', 158, 2210, 462)
] });
assert.equal(second.total, null);
assert.deepEqual(json(second.rows.map(row => [row.source, row.amount, row.category])), [
  ['休闲玩乐', '271.08', 'entertainment'], ['转账', '101.00', 'transfer'], ['餐饮', '98.40', 'food'],
  ['交通', '80.31', 'travel'], ['购物', '79.50', 'shopping']
]);
assert.deepEqual(json(second.dates), ['2026-11-01', '2026-11-15']);
assert.match(second.rows[1].warning, /非消费转出/);
assert.match(second.warnings.join(''), /未识别到支出总额/);

const imperfect = parse({ width: 600, height: 900, lines: [
  line('共支出 ¥80.50', 50, 100, 300), line('餐饮 ¥30.50', 50, 350, 520),
  line('餐饮 ¥30.50', 50, 400, 520), line('生活缴费', 50, 460), line('购物 ¥7.00', 50, 520, 520),
  line('娱乐 ¥10.999', 50, 600, 520)
] });
assert.equal(imperfect.rows.find(row => row.source === '生活缴费').amount, '');
assert.equal(imperfect.rows.filter(row => row.source === '餐饮')[1].selected, false);
assert.equal(imperfect.rows.some(row => row.source === '娱乐' && row.amount), false);
assert.match(imperfect.warnings.join(''), /不一致/);
assert.equal(moneyValue('￥−1，234．56'), 1234.56);
assert.equal(moneyValue('0.001'), null);

const ledger = { schemaVersion: 5, consumptionMonths: [{ month: '2026-11', opening: { total: 1000 } }], spendingSummaries: [
  { month: '2026-11', kind: 'mid', from: '2026-11-01', through: '2026-11-15', items: [
    { channel: 'wechat', source: '娱乐', category: 'entertainment', amount: 10 },
    { channel: 'wechat', wechatAccount: 'wechat2', source: '餐饮', category: 'food', amount: 30 },
    { channel: 'alipay', source: '购物', category: 'shopping', amount: 5 }
  ] }
] };
const selection = { month: '2026-11', kind: 'mid', from: '2026-11-01', through: '2026-11-15', channel: 'wechat', wechatAccount: 'wechat1' };
const baseline = JSON.stringify(ledger);
const merged = mergeLedger(ledger, selection, first.rows, baseline);
assert.equal(JSON.stringify(ledger), baseline, 'draft merge must not mutate old ledger');
assert.deepEqual(merged.consumptionMonths, ledger.consumptionMonths);
const items = merged.spendingSummaries[0].items;
assert.equal(items.length, 6);
assert.equal(items.find(item => item.source === '娱乐').amount, 13);
assert.equal(items.find(item => item.wechatAccount === 'wechat2').amount, 30);
assert.equal(items.find(item => item.channel === 'alipay').amount, 5);
assert.equal(JSON.stringify(mergeLedger(merged, selection, first.rows)), JSON.stringify(merged), 'repeat should replace the same group, not accumulate');
assert.throws(() => mergeLedger(ledger, { ...selection, through: '2026-11-14' }, first.rows), /其他渠道/);
assert.throws(() => mergeLedger(ledger, { ...selection, kind: 'end', from: '2026-11-12', through: '2026-11-30' }, first.rows), /重叠/);
assert.throws(() => mergeLedger(ledger, { ...selection, through: '2026-11-31' }, first.rows), /有效/);
assert.throws(() => mergeLedger(ledger, selection, imperfect.rows), /补全/);
assert.throws(() => mergeLedger(ledger, selection, [first.rows[0], first.rows[0]]), /重复/);
assert.throws(() => mergeLedger(merged, selection, first.rows, baseline), /已更新/);
console.log('OCR parser and category import merge passed: split and combined lines, signed amounts, totals, missing rows, duplicate groups, dates and stale ledger.');
