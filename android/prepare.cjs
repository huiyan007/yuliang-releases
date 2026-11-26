const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = __dirname;
const web = path.join(root, 'android/www');
const desktopRoot = path.resolve(process.argv[2] || path.join(root, '../../Windows-v3.1.13/yuliang-source-v3.1.13-public/build'));
const version = '3.3.6';
const read = file => fs.readFileSync(file, 'utf8');
const replace = (text, from, to) => {
  assert(text.includes(from), 'Missing integration point: ' + String(from).slice(0, 120));
  return text.replace(from, () => to);
};

const desktopHtml = read(path.join(desktopRoot, '余量.html'));
const scriptPattern = /<script>([\s\S]*?)<\/script>/;
const match = desktopHtml.match(scriptPattern);
assert(match, 'Windows v3.1.15 application script was not found.');
let app = match[1];
app = replace(app, 'const APP_VERSION="3.1.15"', 'const APP_VERSION=' + JSON.stringify(version));

// Android upgrades must keep the existing empty starter ledger and storage identity.
for (const batch of ['TRIP_BATCH', 'HISTORY_BATCH', 'ACCOUNT_BATCH']) {
  const pattern = new RegExp('^const ' + batch + '=.*?;\\r?$', 'm');

  app = app.replace(pattern, 'const ' + batch + '=[];');
}
const initialPattern = /const initial=[\s\S]*?(?=function normalizeLedger)/;
assert(initialPattern.test(app), 'Missing starter ledger.');
app = app.replace(initialPattern,
  "const initial={schemaVersion:4,base:new Date().toLocaleDateString('sv-SE').slice(0,7),balance:0,incomes:[],budgets:[],debts:[],subsidies:[],deposits:[],incomeReceipts:[],monthBudgets:[],depositEntries:[]};\n");
app = replace(app, "const KEY='yuliang-finance-v1'", "const KEY='yuliang-finance-android-test-v1'");

// Keep the native mobile layout pass after every shared render.
app = replace(app,
  'decorateInterface();hydrateDepositChart();hydrateOverviewChart();alignMoneyColumns();',
  'decorateInterface();hydrateDepositChart();hydrateOverviewChart();alignMoneyColumns();if(window.mobileLayout)window.mobileLayout();');

// Leave the twelve points and their hit targets intact. Only thin the income axis.
app = replace(app, 'function annualTrendSvg(plot,label,emptyText){',
  'function annualTrendSvg(plot,label,emptyText,metric){');
app = replace(app, 'annualTrendSvg(plot,label,empty)', 'annualTrendSvg(plot,label,empty,figure.dataset.metric)');
app = replace(app, '  const months=points.map((point,index)=>width>=414||index%2===0||index===11?',
  `  const lastMonth=points.length-1;
  const step=Math.max(1,Math.ceil(34/slot));
  const intervals=Math.max(1,Math.floor(lastMonth/step));
  const incomeMonths=new Set(Array.from({length:intervals+1},(_,i)=>Math.round(i*lastMonth/intervals)));
  const months=points.map((point,index)=>(metric==='income'?incomeMonths.has(index):width>=414||index%2===0||index===11)?`);
app = replace(app, '<text x="${point.x}" y="${height-7}" text-anchor="middle">${index+1}月</text>',
  '<text class="annual-month-label" x="${point.x}" y="${height-7}" text-anchor="middle">${index+1}月</text>');

// Touch interaction and OCR entry points are Android-specific presentation adapters.
app = replace(app,
  "<div class=\"muted\">${x.date}${receiptIsReceived(x)?'':' · 未收'}</div>${receiptCoveredMonthsNote(x)}",
  `<div class="muted receipt-row-meta"><span>\${x.date}</span>\${stateToggle(receiptIsReceived(x),'已收','未收','openMobileReceiptStatus('+i+')',receiptIsReceived(x)?'改为未收':'改为已收','receipt-status-toggle')}</div>\${receiptCoveredMonthsNote(x)}`);
for (const handler of ['trackDepositChart', 'trackOverviewMonth']) {
  app = app.replaceAll('onpointermove="' + handler + '(event)"',
    'onpointerdown="' + handler + '(event)" onpointermove="' + handler + '(event)"');
}
app = app.replaceAll('onpointerleave="hideOverviewMonth()"',
  'onpointerleave="if(event.pointerType===\'mouse\')hideOverviewMonth()"');
app = replace(app,
  '<button type="button" id="openEndSpending">录入月末</button></div>',
  '<button type="button" id="openEndSpending">录入月末</button><button type="button" class="primary" id="openSpendingOcr">识别截图</button></div>');
app = replace(app,
  "  for(const [id,slot] of [['openMidSpending','mid'],['openEndSpending','end']]){",
  "  document.getElementById('openSpendingOcr').onclick=()=>{modal.close();window.openOcrImport(kind==='end'?'end':kind==='mid'?'mid':summaries.some(s=>s.kind==='mid')?'end':'mid');};\n  for(const [id,slot] of [['openMidSpending','mid'],['openEndSpending','end']]){");
app = replace(app,
  '<button type="button" data-compact-action="categories" onclick="openSpendingAnalysisDetails()">分类详情</button>',
  '<button type="button" data-compact-action="categories" onclick="openSpendingAnalysisDetails()">分类详情</button><button type="button" onclick="openOcrImport()">识别截图</button>');

// Android has no tray/window-close setting and uses a native APK installer.
app = replace(app, '    ${updatePanel()}', `    \${updatePanel()}
    <section class="settings-section settings-row" aria-labelledby="settingsPayments">
      <div><h3 id="settingsPayments">付款截图</h3><p class="muted">本机识别付款截图，核对后记账。</p></div>
      <button type="button" data-payment-inbox onclick="openPaymentInbox()">截图记账</button>
    </section>`);
app = replace(app, 'onclick="openOcrImport()">识别截图</button>',
  'onclick="openOcrImport()">识别截图</button><button type="button" data-payment-inbox onclick="openPaymentInbox()">付款截图</button>');
const closeSettings = /\n    <section class="settings-section" aria-labelledby="settingsClose">[\s\S]*?<\/section>/;
assert(closeSettings.test(app), 'Missing Windows close setting.');
app = app.replace(closeSettings, '');
app = replace(app, "missing:`发现新版本 v${version}，但该版本缺少 Windows 安装包。`,",
  "missing:`发现新版本 v${version}，但该版本没有可用的 Android APK。`,\n    no_release:'GitHub 上暂无可用发布版。',\n    network_failed:`网络连接失败。${message}`,\n    rate_limited:`GitHub 请求已限流。${message}`,\n    invalid:`发布信息无效。${message}`,");
app = replace(app, "unverified:`发现新版本 v${version}，但安装包缺少有效的校验信息。`,",
  "unverified:`发现新版本 v${version}，但 Android APK 缺少有效的校验信息。`,");
app = replace(app, "document.getElementById('openReleaseButton').hidden=!window.NATIVE_SYNC||",
  "document.getElementById('openReleaseButton').hidden=(!window.NATIVE_SYNC&&!window.AndroidSync)||");
app = replace(app, "(!['failed','missing','unverified'].includes(status)&&pkg.status!=='failed');",
  "(!['failed','missing','unverified','no_release','network_failed','rate_limited','invalid'].includes(status)&&pkg.status!=='failed');");
app = replace(app, "if(!window.NATIVE_SYNC)throw Error('请从 Windows 桌面版打开余量。');",
  "if(!window.NATIVE_SYNC&&!window.AndroidSync)throw Error('请安装余量 Android 版后检查更新。');");
app = replace(app, 'id="installUpdateButton" onclick="installUpdate()" hidden>重启并安装</button>',
  'id="installUpdateButton" onclick="installUpdate()" hidden>打开系统安装器</button>');
app = replace(app, "    await nativeCall('/updates/install',{version:updateState.version});",
  "    const result=await nativeCall('/updates/install',{version:updateState.version});\n    if(result.package)updateState.package=result.package;\n    renderUpdateStatus();");
app = replace(app,
  '<button type="button" role="menuitem" onclick="closeRowMenu();openDisplayNames()">界面名称</button><button type="button" role="menuitem" onclick="closeRowMenu();fitWindow()">恢复16:9窗口</button><button type="button" role="menuitem" onclick="closeRowMenu();backup()">导出账本备份</button>',
  '<button type="button" role="menuitem" onclick="closeRowMenu();openDisplayNames()">界面名称</button><button type="button" role="menuitem" onclick="closeRowMenu();backup()">导出账本备份</button>');
app = app.replaceAll('每台电脑使用同一坚果云账号', '手机和电脑使用同一坚果云账号')
  .replaceAll('本机 YuliangFinance/Backups', '手机应用私有备份目录')
  .replaceAll('悬停查看', '轻触查看');

// Android owns these toolbar controls. The desktop renderer removes settings
// and overwrites the sync icon each time it renders.
app = replace(app,
  "  const sync=document.getElementById('syncButton');sync.classList.add('icon-button');sync.innerHTML=uiIcon('sync')+'立即同步';",
  '');
app = replace(app,
  `  const settings=document.querySelector('header button[onclick="page=6;render()"]');if(settings)settings.remove();`, '');

new vm.Script(app, { filename: `余量-Android-v${version}.js` });

let html = desktopHtml.replace(match[0], () => '<script>' + app + '</script>');
// The Windows v3 layout is scoped through this desktop-only id. Keeping it would
// outrank the established Android responsive stylesheet and retain the side rail.
html = replace(html, '<body id="yuliangApp">', '<body>');
html = replace(html, 'class="rail-version">v3.1.15', 'class="rail-version">v' + version);
html = replace(html, '</style>', '</style><link rel="stylesheet" href="mobile.css"><link rel="stylesheet" href="classification-mobile.css"><link rel="stylesheet" href="ocr.css"><link rel="stylesheet" href="mobile-design.css"><link rel="stylesheet" href="mobile-layout.css"><link rel="stylesheet" href="mobile-records.css"><link rel="stylesheet" href="payment-inbox.css"><link rel="stylesheet" href="mobile-refinement.css">');
html = replace(html, '</html>', '<script src="mobile.js"></script><script src="ocr.js"></script><script src="payment-rules.js"></script><script src="payment-inbox.js"></script></html>');
for (const [, asset] of html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([\w.-]+\.(?:css|js))"/g)) {
  assert(fs.existsSync(path.join(web, asset)), 'Missing Android web asset: ' + asset);
  if (asset.endsWith('.js')) new vm.Script(read(path.join(web, asset)), { filename: asset });
}
for (const value of [html, read(path.join(web, 'mobile.js'))]) {
  assert(!value.includes('previewStorage') && !value.includes('travel-demo'));
}
fs.writeFileSync(path.join(web, 'index.html'), html.trimEnd() + '\n');
console.log(`Prepared Android v${version} from the verified Windows v3.1.15 core.`);
