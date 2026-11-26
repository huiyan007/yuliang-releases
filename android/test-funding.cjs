const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function verifyFunding() {
  const browser = await chromium.launch({ channel: process.env.YULIANG_BROWSER || 'chrome' });
  try {
    for (const width of [360, 393]) {
      const tab = await browser.newPage({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
      await tab.goto(pathToFileURL(path.join(__dirname, 'android/www/index.html')).href);
      await tab.evaluate(() => {
        const date = day => '2026-11-' + day;
        const receipt = (day, name, amount, coveredMonths) => ({
          date: date(day), name, amount, received: true, coveredMonths,
          allocations: [{ kind: 'expense', name: '日常消费', amount }],
        });
        data.consumptionMonths = [{
          month: '2026-11',
          mid: { date: date('15'), balances: { wechat: null, alipay: null, bank: null, total: 12345.67 }, outgoing: 0 },
        }];
        data.incomeReceipts = [
          receipt('10', '其他收入', 10),
          receipt('15', '盘点当日收入', 15),
          receipt('20', '测试低保', 1234.56, [
            { month: '2026-09', amountCents: 60000 },
            { month: '2026-10', amountCents: 63456 },
          ]),
        ];
        month.value = '2026-11';
        page = 2;
        render();
      });

      const after = tab.locator('[data-compact-action="after-funding"]');
      const balance = tab.locator('.compact-balance-card > strong');
      const [buttonBox, balanceBox, cardBox] = await Promise.all([
        after.boundingBox(), balance.boundingBox(), tab.locator('.compact-balance-card').boundingBox(),
      ]);
      assert(buttonBox.x >= balanceBox.x + balanceBox.width, 'Funding button must sit to the right of the balance');
      assert(buttonBox.x + buttonBox.width <= cardBox.x + cardBox.width, 'Funding button must fit inside the card');
      assert(buttonBox.height >= 44, 'Funding button must retain its touch target');
      await after.click();
      const detail = tab.locator('[data-compact-view="after-funding"]');
      assert.match(await detail.innerText(), /测试低保2609 \/ 2610/);
      assert.match(await detail.innerText(), /2026-11-20/);
      assert.doesNotMatch(await detail.innerText(), /盘点当日收入|其他收入/);
      await tab.evaluate(() => closeCompactDetails());

      await tab.locator('[data-compact-action="funding"]').click();
      const monthly = await tab.locator('[data-compact-view="funding"]').innerText();
      assert.match(monthly, /盘点当日收入/);
      assert.match(monthly, /其他收入/);
      await tab.evaluate(() => closeCompactDetails());

      await tab.locator('[data-compact-action="daily"]').click();
      assert.match(await tab.locator('.compact-funding-timeline').innerText(), /月中盘点当日 · 顺序未确认/);
      await tab.close();
      console.log('PASS funding detail, attribution months and balance card layout at ' + width + ' px');
    }
  } finally {
    await browser.close();
  }
}

verifyFunding().catch(error => { console.error(error); process.exitCode = 1; });
