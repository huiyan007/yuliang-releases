const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('./android/www/payment-rules.js');

assert.deepEqual(rules.parseScreenshot({ paymentLines: [{ text: '¥18.50' }, { text: '商户：瑞幸咖啡' }] }),
  { minor: 1850, merchant: '瑞幸咖啡' });
assert.equal(rules.parseScreenshot({ paymentLines: [{ text: '¥10.00' }, { text: '¥18.50' }] }).minor, null);
console.log('PASS payment screenshot rules: prefill only a unique amount.');

if (process.argv.includes('--ui')) {
  runUi().catch(error => { console.error(error); process.exitCode = 1; });
}

async function runUi() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
    const errors = [], alerts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
    const source = path.join(__dirname, 'android/www');
    await page.route('https://app.yuliang.local/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' }[path.extname(name)];
      return mime && /^[\w.-]+$/.test(name) ? route.fulfill({
        body: fs.readFileSync(path.join(source, name)), contentType: mime + '; charset=utf-8',
      }) : route.abort();
    });
    await page.addInitScript(() => {
      window.AndroidOcr = { pickImage(requestId) { window.mockPickerRequest = requestId; } };
    });
    await page.goto('https://app.yuliang.local/index.html');
    const ledger = () => page.evaluate(() => JSON.parse(localStorage.getItem('yuliang-finance-android-test-v1')));
    assert.equal((await ledger()).expenseEntries?.length || 0, 0);
    await page.locator('#nav button').nth(2).click();
    await page.locator('[data-payment-inbox]').click();
    const inbox = page.locator('#paymentInbox');
    const review = page.locator('#paymentReview');
    assert.equal(await inbox.getByText('通知调试').count(), 0);
    await inbox.getByRole('button', { name: '识别付款截图' }).click();
    const payload = {
      ok: true, imageId: 'b'.repeat(64), lines: [], paymentLines: [{ text: '¥26.10' }, { text: '商户：瑞幸咖啡' }],
      preview: 'data:image/jpeg;base64,AA==',
    };
    await page.evaluate(payload => window.onAndroidOcrResult({ requestId: window.mockPickerRequest, ...payload }), payload);
    assert.equal(await review.locator('[name=amount]').inputValue(), '26.10');
    assert.equal(await review.locator('[name=merchant]').inputValue(), '瑞幸咖啡');
    await review.locator('[name=direction]').selectOption('expense');
    await review.getByRole('button', { name: '确认保存' }).click();
    await review.waitFor({ state: 'hidden' });
    await inbox.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(payload => window.onAndroidOcrShared({ requestId: 'share-one', ...payload }), payload);
    assert.match(alerts.at(-1), /已保存/);
    await page.evaluate(payload => window.onAndroidOcrShared({ requestId: 'share-two', ...payload,
      imageId: 'c'.repeat(64), paymentLines: [] }), payload);
    assert(await review.isVisible());
    assert.equal(await review.locator('[name=amount]').inputValue(), '');
    await review.getByRole('button', { name: '取消' }).click();
    await page.reload();
    assert.equal((await ledger()).expenseEntries.length, 1);
    assert.deepEqual(errors, []);
    console.log('PASS payment screenshot UI: local recognition review, shared image fallback, duplicate protection and ledger persistence.');
  } finally { await browser.close(); }
}
