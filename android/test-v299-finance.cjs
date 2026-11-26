const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./verify-harness.cjs');

const month = '2026-11';
const dailyTotal = total => ({ wechat: null, alipay: null, bank: null, total });
const allocation = (id, name, amount, kind, more = {}) => ({ id, name, amount, kind, ...more });
const receipt = (id, date, allocations, received = true) => ({
  id, date, name: '测试收入', amount: 1500, received, allocations,
});
const deposit = (id, amount, more = {}) => ({
  id, name: '测试账户 ' + id, amount, balanceStartDate: month + '-01', ...more,
});

function fixture() {
  return {
    schemaVersion: 5, base: month, balance: 0,
    incomes: [], monthBudgets: [], subsidies: [],
    budgets: [allocation('preset', '预设归属', 200, 'repayment', { holdingAccountId: 'B' })],
    deposits: [
      deposit('A', 1000), deposit('B', 500),
      deposit('C', 900, { repaymentOnly: true }), deposit('D', 99.99), deposit('E', 100),
      deposit('F', 110, { repaymentOnly: false, status: '还款专用' }),
      deposit('G', 300, { status: '还款专用' }),
    ],
    debts: [
      { id: 'debt-b', name: '测试扣款 B', date: month + '-12', amount: 150, paid: false },
      { id: 'debt-a', name: '测试扣款 A', date: month + '-13', amount: 50, paid: false },
    ],
    depositEntries: [], transfers: [],
    incomeReceipts: [
      receipt('previous', '2026-10-31', [allocation('prior-pocket', '耍朋友荷包', 60, 'expense', { pocketDate: month + '-03' })]),
      receipt('early', month + '-05', [
        allocation('daily', '日常消费', 400, 'expense', { holdingAccountId: 'A' }),
        allocation('late-pocket', '恋爱荷包', 200, 'expense', { pocketDate: month + '-20' }),
        allocation('pending-pocket', '恋爱小金库', 77, 'expense', { pocketDate: null }),
        allocation('reserved-a', '测试还款预留 A', 500, 'repayment', { holdingAccountId: 'A' }),
        allocation('reserved-c', '测试还款预留 C', 200, 'repayment', { holdingAccountId: 'C' }),
        allocation('deposit', '测试存入', 100, 'saving', { accountId: 'A' }),
      ]),
      receipt('pending', month + '-08', [
        allocation('pending-daily', '日常预算', 90, 'expense'),
        allocation('pending-repayment', '未收还款预留', 300, 'repayment', { holdingAccountId: 'E' }),
      ], false),
      receipt('late', month + '-22', [
        allocation('late-daily', '日常预算', 50, 'expense'),
        allocation('default-pocket', '恋爱荷包', 100, 'expense'),
      ]),
    ],
    expenseEntries: [{ id:'legacy-expense', date:month+'-02', category:'food', amount:18.50, tag:'necessary', note:'保留的旧逐笔记录' }],
    spendingSummaries: [
      { month, kind:'mid', from:month+'-01', through:month+'-15', items:[
        { channel:'wechat', wechatAccount:'wechat1', source:'餐饮', category:'food', amount:178.55 },
        { channel:'wechat', wechatAccount:'wechat1', source:'生活缴费', category:'bills', amount:31.20 },
        { channel:'wechat', wechatAccount:'wechat2', source:'购物', category:'shopping', amount:3 },
        { channel:'alipay', source:'休闲玩乐', category:'entertainment', amount:277.07 },
        { channel:'alipay', source:'转账', category:'transfer', amount:150 },
        { channel:'bank', source:'交通', category:'travel', amount:98.31 }
      ] },
      { month, kind:'end', from:month+'-16', through:month+'-30', items:[
        { channel:'wechat', wechatAccount:'wechat2', source:'餐饮', category:'food', amount:20 },
        { channel:'alipay', source:'转账', category:'transfer', amount:80 }
      ] }
    ],
    consumptionMonths: [
      { month: '2026-10', opening: dailyTotal(1500), end: { date: '2026-10-31', balances: dailyTotal(1000), outgoing: 0, sinceMid: false } },
      { month, mid: { date: month + '-15', balances: { wechat: 200, alipay: 400, bank: 300 }, outgoing: 50 },
        end: { date: month + '-30', balances: dailyTotal(500), outgoing: 60, sinceMid: true } },
      { month: '2026-12', mid: { date: '2026-12-15', balances: dailyTotal(400), outgoing: 0 } },
    ],
    pocketMonths: [{
      month, opening: { wallet: 200 },
      mid: { date: month + '-15', balances: { wallet: 280 }, outgoing: 10, extraIn: 20 },
      end: { date: month + '-30', balances: { wallet: 400 }, outgoing: 50, extraIn: 40, sinceMid: true },
    }],
    pocketTransfers: [
      { id: 'into-pocket', date: month + '-07', to: 'pocket', amount: 100 },
      { id: 'into-daily', date: month + '-20', to: 'daily', amount: 30 },
    ],
  };
}

function initialize(runtime) {
  runtime.ctx.fixtureLedger = fixture();
  runtime.run(`
    for(const receipt of fixtureLedger.incomeReceipts)rebuildReceiptEntries(fixtureLedger,receipt);
    data=validateLedger(fixtureLedger);
    localStorage.setItem(KEY,JSON.stringify(data));
    month.value='2026-11';
  `);
  assert.equal(runtime.run("saveAccountTransfer({fromAccountId:'A',toAccountId:'B',amount:700,date:'2026-11-08',purpose:'测试预留资金划转'})"), true, runtime.ctx.messages.join(' / '));
  assert.equal(runtime.run("saveDebtPayment(0,'B','2026-11-12')"), true, runtime.ctx.messages.join(' / '));
  assert.equal(runtime.run("saveDebtPayment(1,'A','2026-11-13')"), true, runtime.ctx.messages.join(' / '));
  return runtime;
}

function readDesktopSource() {
  const file = path.join(path.resolve(process.argv[2] || path.join(__dirname, '../../Windows-v3.1.13/yuliang-source-v3.1.13-public/build')), '余量.html');
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert(scripts.length, 'desktop script missing');
  const code = scripts.at(-1)[1]
    .replace(/^const (TRIP_BATCH|HISTORY_BATCH|ACCOUNT_BATCH)=.*;$/gm, 'const $1=[];');
  const start = code.indexOf('const initial=');
  const end = code.indexOf('function normalizeLedger', start);
  assert(start >= 0 && end > start, 'desktop seed block missing');
  return code.slice(0, start) +
    "const initial={schemaVersion:5,base:'2026-11',balance:0,incomes:[],budgets:[],debts:[],subsidies:[],deposits:[],incomeReceipts:[],monthBudgets:[],depositEntries:[],transfers:[]};\n" +
    code.slice(end);
}

function json(runtime, expression) {
  return JSON.parse(runtime.run(`JSON.stringify(${expression})`));
}

function compareFinancialResults(android, desktop) {
  const read = expression => {
    const mobile = json(android, expression);
    assert.deepEqual(mobile, json(desktop, expression), 'desktop parity: ' + expression);
    return mobile;
  };
  const daily = read("consumptionMonthStats('2026-11',data,'daily')");
  const pocket = read("consumptionMonthStats('2026-11',data,'pocket')");
  assert.equal(daily.opening.carried, true);
  assert.equal(daily.openingTotal, 100000);
  assert.equal(daily.first.spent, 50000);
  assert.equal(daily.first.outgoing, 15000);
  assert.equal(daily.second.spent, 48000);
  assert.equal(daily.second.outgoing, 6000);
  assert.equal(daily.full.spent, 98000);
  assert.equal(daily.full.funded, 48000);
  assert.equal(daily.full.outgoing, 21000);
  assert.equal(pocket.first.funded, 18000);
  assert.equal(pocket.first.spent, 9000);
  assert.equal(pocket.second.funded, 34000);
  assert.equal(pocket.second.spent, 14000);
  assert.equal(pocket.full.spent, 23000);
  assert.equal(pocket.full.outgoing, 9000);
  assert.equal(pocket.full.funded, 52000);
  const dailyYear = read("consumptionYearStats('2026',data,'daily')");
  assert.equal(dailyYear.closed, 2);
  assert.equal(dailyYear.spent, 148000);
  assert.equal(dailyYear.average, 74000);
  assert.equal(dailyYear.rows[10].change, 48000);
  assert.equal(dailyYear.rows[11].full, null);
  assert.equal(dailyYear.rows[11].latest.spent, 10000);
  const pocketYear = read("consumptionYearStats('2026',data,'pocket')");
  assert.equal(pocketYear.closed, 1);
  assert.equal(pocketYear.spent, 23000);
  console.log('PASS desktop parity: daily and pocket month/half-month/year totals, carried opening, daily total and account modes, dated/pending funding and bidirectional pocket transfers.');

  const savings = read('[...savingsSnapshot()].map(([account,state])=>[account.id,state.balance,state.reserved,state.repaymentOnly,accountNetSavings(state)])');
  for (const expression of ["depositTotalOn('2026-11-05')", "depositTotalOn('2026-11-08')", "depositTotalOn('2026-11-13')", 'depositTotal()', "monthlyDepositFlow('2026-11')"]) read(expression);  console.log('PASS desktop parity: full repayment-only exclusion, explicit false override, legacy status fallback, reserve carry across transfers, linked repayment offset, threshold and history.');
}

function testCategories(android,desktop){
  const read=expression=>{
    const mobile=json(android,expression);
    assert.deepEqual(mobile,json(desktop,expression),'category desktop parity: '+expression);
    return mobile;
  };
  assert.deepEqual(read("['生活缴费','休闲玩乐','交通','转账','陌生分类'].map(spendingMappedCategory)"),['bills','entertainment','travel','transfer','other']);
  assert.deepEqual(read("['-277.07','−150.00','￥1,234.50','0',''].map(spendingEnteredAmount)"),[277.07,150,1234.5,0,null]);
  const half=read("spendingTableData([spendingSummaryFor('2026-11','mid')])");
  assert.equal(half.total,73813);
  assert.deepEqual(half.transfers,[null,15000,null]);
  assert.equal(half.values.food.wechat,17855);
  assert.equal(half.values.shopping.wechat,300);
  const all=read('spendingTableData(data.spendingSummaries)');
  assert.equal(all.total,83813);
  assert.equal(all.values.food.wechat,19855);
  assert.equal(all.values.transfer.alipay,23000);
  const interval=read("spendingTransferForInterval(consumptionMonthStats('2026-11').first,data.spendingSummaries)");
  assert.equal(interval,15000);
  assert.match(read('spendingSharePlot([{key:"transfer",label:"非消费转出",amount:15000}],15000,"消费合计","暂无消费")'),/非消费转出/);
  for(const runtime of [android,desktop]){
    const before=json(runtime,'({consumptionMonths:data.consumptionMonths,pocketMonths:data.pocketMonths,expenseEntries:data.expenseEntries,depositEntries:data.depositEntries})');
    const spent=runtime.run("consumptionMonthStats('2026-11').full.spent");
    runtime.run("{const next=structuredClone(data);next.spendingSummaries[0].items[0].amount=180.01;if(!commitFinance(next))throw Error('category save rejected')} ");
    assert.deepEqual(json(runtime,'({consumptionMonths:data.consumptionMonths,pocketMonths:data.pocketMonths,expenseEntries:data.expenseEntries,depositEntries:data.depositEntries})'),before);
    assert.equal(runtime.run("consumptionMonthStats('2026-11').full.spent"),spent);
    runtime.run("{const next=structuredClone(data);next.spendingSummaries[0].items[0].amount=178.55;if(!commitFinance(next))throw Error('category reset rejected')} ");
  }
  console.log('PASS categories: desktop parity, source category aliases, transfer included in totals/ring, distinct WeChat accounts, signed amounts and independent category save preserves balances/legacy entries.');
}

async function testFormat5(android, desktop) {
  const mobile = fs.readFileSync(path.join(__dirname, 'android/www/mobile.js'), 'utf8');
  const start = mobile.indexOf('async function ledgerHash');
  const end = mobile.indexOf('const desktopNativeCall', start);
  assert(start >= 0 && end > start, 'Android sync implementation missing');
  vm.runInContext(mobile.slice(start, end), android.ctx);
  android.run('ensureFolder=async()=>{}');
  const desktopData = desktop.run('JSON.stringify(data)');
  const localData = JSON.stringify({ ...JSON.parse(desktopData), balance: 11 });
  let cloud = { format: 5, revision: 'desktop-5', device: '测试 Windows', data: desktopData };
  let baseline = {};
  const backups = [];
  const puts = [];
  android.ctx.androidCall = async (route, body) => {
    if (route === '/baseline') return baseline;
    if (route === '/ack') { baseline = { ...body }; return { status: 'ok' }; }
    if (route === '/backup') { backups.push({ ...body }); return { status: 'ok' }; }
    if (route === '/request') {
      assert.equal(body.suffix, 'YuliangFinance/state.json');
      if (body.method === 'GET') return { code: 200, body: JSON.stringify(cloud), etag: '"desktop-5"' };
      if (body.method === 'PUT') {
        assert.equal(body.condition, '"desktop-5"');
        const envelope = JSON.parse(body.body);
        puts.push(envelope);
        cloud = envelope;
        return { code: 201 };
      }
    }
    throw Error('unexpected Android route ' + route);
  };
  const sync = (data, mode = '', expected = '') => {
    android.ctx.request = { data, mode, expected };
    return android.run('mobileSync(request)');
  };
  const initial = await sync(localData);
  assert.equal(initial.status, 'conflict');
  assert.equal(puts.length, 0);
  const downloaded = await sync(localData, 'cloud', 'desktop-5');
  assert.equal(downloaded.data, desktopData);
  assert.equal(backups.at(-1).tag, 'before-download');
  assert.equal(backups.at(-1).data, localData);
  android.ctx.download = JSON.parse(downloaded.data);
  assert.deepEqual(json(android, 'validateLedger(download)'), JSON.parse(desktopData));

  const equal = await sync(desktopData);
  assert.equal(equal.status, 'ok');
  assert.equal(puts.length, 0);
  assert.equal(baseline.revision, 'desktop-5');
  android.run("data=validateLedger(download);localStorage.setItem(KEY,JSON.stringify(data));{const next=structuredClone(data);next.spendingSummaries.find(x=>x.kind==='mid').items.find(x=>x.wechatAccount==='wechat2').amount=25.25;if(!commitFinance(next))throw Error('phone classification edit rejected')}");
  const phoneData=android.run('JSON.stringify(data)');
  const uploaded = await sync(phoneData);
  assert.equal(uploaded.status, 'ok');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].format, 5);
  assert.equal(puts[0].data, phoneData);
  desktop.ctx.download = JSON.parse(puts[0].data);
  const desktopReturned=json(desktop,'validateLedger(download)');
  assert.deepEqual(desktopReturned,JSON.parse(phoneData));
  assert.equal(desktopReturned.spendingSummaries.find(s=>s.kind==='mid').items.find(i=>i.wechatAccount==='wechat2').amount,25.25);
  assert.deepEqual(desktopReturned.expenseEntries,JSON.parse(desktopData).expenseEntries);
  assert(backups.some(backup => backup.tag === 'cloud-before-overwrite' && backup.data === desktopData));

  for (const [invalidate, expected] of [
    [data => data.consumptionMonths[1].end.balances.bank = 1, /总额模式/],
    [data => data.spendingSummaries[0].items[0].wechatAccount='wechat3', /原条目/],
    [data => data.spendingSummaries[0].items[0].category='wrong', /原条目/],
    [data => data.spendingSummaries[0].items[0].amount=-1, /原条目/],
    [data => data.spendingSummaries[0].items[3].wechatAccount='wechat1', /原条目/],
    [data => data.spendingSummaries[1].from='2026-11-15', /日期重叠/],
    [data => data.spendingSummaries.push(structuredClone(data.spendingSummaries[0])), /重复的分类/],
    [data => data.expenseEntries[0].amount=0, /逐笔消费/],
    [data => data.pocketTransfers.push({ ...data.pocketTransfers[0] }), /划转编号/],
    [data => data.incomeReceipts[1].allocations[0].holdingAccountId = 123, /归属账户/],
    [data => data.incomeReceipts[1].allocations[1].pocketDate = '2026-11-31', /荷包存入日期/],
    [data => data.deposits[2].repaymentOnly = 'true', /还款专用账户/],
  ]) {
    const broken = JSON.parse(desktopData);
    invalidate(broken);
    cloud = { format: 5, revision: 'bad', data: JSON.stringify(broken) };
    await assert.rejects(sync(localData), expected);
    assert.equal(puts.length, 1);
  }
  console.log('PASS format 5: simulated desktop-to-phone download and conditional phone upload preserve all finance fields with both real validators; invalid new fields reject before upload.');
}

async function main() {
  const android = initialize(boot());
  const desktop = initialize(boot({}, readDesktopSource()));
  compareFinancialResults(android, desktop);
  testCategories(android, desktop);
  await testFormat5(android, desktop);
}

module.exports = { fixture, initialize };
if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
