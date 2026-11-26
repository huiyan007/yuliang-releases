/* Mobile presentation only. Ledger storage key and financial operations stay unchanged. */
const mobileOriginalDownload=downloadJson;
downloadJson=function(value,name){if(window.AndroidBackup){AndroidBackup.save(JSON.stringify(value,null,2),name);return}mobileOriginalDownload(value,name)};
const svgPaths=['M3 10 12 3l9 7v10H3Z M9 20v-7h6v7','M12 3v18 M5 9l7-6 7 6 M5 16h14','M4 6h16v13H4Z M4 10h16 M7 15h5','M4 5h16v15H4Z M8 3v4 M16 3v4 M8 12h8 M8 16h5','M12 3 4 7v7c0 4 8 7 8 7s8-3 8-7V7Z M8 12l3 3 5-6','M3 7h18v13H3Z M3 7l3-4h12l3 4 M16 12h5v4h-5Z'];
window.mobileLayout=function(){
 const labels=Array.from(document.querySelectorAll('#nav button'),b=>b.getAttribute('aria-label')||b.textContent.trim());
 document.querySelectorAll('#nav button').forEach((b,i)=>{b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+svgPaths[[0,1,2,5][i]??i]+'"/></svg><span>'+labels[i]+'</span>';b.setAttribute('aria-label',labels[i]);b.setAttribute('aria-current',b.classList.contains('active')?'page':'false')});
 document.querySelectorAll('#content table').forEach(t=>{if(t.closest('.view-consumption .consumption-month-grid')){const wrap=t.closest('.table-scroll');wrap?.removeAttribute('tabindex');wrap?.setAttribute('aria-label','账户余额明细');return}if(t.closest('.view-consumption,#presetEditorRows,.spending-entry,.spending-review-table'))return;const heads=Array.from(t.querySelectorAll('thead th')).map(x=>x.textContent.trim());if(!heads.length)return;t.classList.add('mobile-records');t.querySelectorAll('tbody tr').forEach(r=>Array.from(r.children).forEach((c,i)=>{c.dataset.label=heads[i]||'';if(!c.textContent.trim()&&!c.querySelector('button,input'))c.classList.add('empty-cell')}))});
 document.querySelectorAll('.deposit-curve svg rect').forEach(r=>r.addEventListener('pointerdown',()=>r.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}))));
};
const toolbar=document.querySelector('header>.toolbar');
const version=document.createElement('p');version.className='mobile-version';version.textContent='余量 · '+APP_VERSION+'  手机与电脑，账本相连';document.querySelector('header h2').before(version);
const brand=document.createElement('div');brand.className='mobile-brand';brand.innerHTML='<span class="mobile-brand-mark" aria-hidden="true">余</span><span class="mobile-brand-copy"><b>余量</b><small>个人财务</small></span>';document.querySelector('header>div').prepend(brand);
const topActions=document.createElement('div');topActions.className='mobile-top-actions';
const monthPicker=document.getElementById('month');const monthWrap=document.createElement('div');monthWrap.className='month-picker-wrap';monthPicker.before(monthWrap);monthWrap.append(monthPicker);const monthFace=document.createElement('button');monthFace.type='button';monthFace.className='month-picker-face';monthFace.setAttribute('aria-label','选择月份');monthWrap.append(monthFace);function updateMonthFace(){const [year,monthNumber]=(monthPicker.value||'').split('-');monthFace.textContent=year+' 年 '+Number(monthNumber)+' 月';}monthFace.onclick=()=>{try{monthPicker.showPicker()}catch{monthPicker.focus();monthPicker.click()}};monthPicker.addEventListener('change',updateMonthFace);updateMonthFace();
const monthSteps = document.createElement('div');
monthSteps.className = 'mobile-month-step';
for (const [step, label, glyph] of [[-1, '上个月', '‹'], [1, '下个月', '›']]) {
 const button = document.createElement('button');
 button.type = 'button';
 button.textContent = glyph;
 button.setAttribute('aria-label', label);
 button.onclick = () => {
  const [year, month] = selectedMonth().split('-').map(Number);
  const offset = year * 12 + month - 1 + step;
  const next = String(Math.floor(offset / 12)).padStart(4, '0') + '-' + String(offset % 12 + 1).padStart(2, '0');
  if (validMonth(next)) {
   monthPicker.value = next;
   render();
  }
 };
 monthSteps.append(button);
}
toolbar.append(monthSteps);
toolbar.before(topActions);
const syncButton=document.getElementById('syncButton');syncButton.className='mobile-sync icon-button';syncButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5M4 4v5h5M4 13a8 8 0 0 0 14 5M20 20v-5h-5"/></svg><span>同步</span>';syncButton.setAttribute('aria-label','立即同步');syncButton.onclick=()=>syncNow();topActions.append(syncButton);
const themeButton = document.createElement('button');
themeButton.type = 'button';
themeButton.className = 'mobile-theme icon-button';
themeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z"/></svg>';
const themeKey = 'yuliang-android-theme-v1';
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let savedTheme = localStorage.getItem(themeKey);
function applyMobileTheme(dark) {
 document.body.classList.toggle('dark', dark);
 document.body.classList.toggle('light', !dark);
 themeButton.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
 window.AndroidAppearance?.setDark(dark);
}
applyMobileTheme(savedTheme === 'dark' || (!savedTheme && (window.AndroidAppearance?.isSystemDark() ?? systemTheme.matches)));
systemTheme.addEventListener('change', event => { if (!savedTheme) applyMobileTheme(event.matches); });
themeButton.onclick = () => {
 const dark = !document.body.classList.contains('dark');
 savedTheme = dark ? 'dark' : 'light';
 localStorage.setItem(themeKey, savedTheme);
 applyMobileTheme(dark);
};
topActions.prepend(themeButton);
const settingsButton=toolbar.querySelector('button[onclick*="page=6"]');settingsButton.className='mobile-settings icon-button';settingsButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>';settingsButton.setAttribute('aria-label','备份与设置');settingsButton.title='备份与设置';topActions.append(settingsButton);
const moreButton=toolbar.querySelector('button[onclick*="openHeaderMenu"]');moreButton.className='mobile-more icon-button';moreButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';moreButton.setAttribute('aria-label','更多');moreButton.title='更多';topActions.append(moreButton);
toolbar.classList.add('mobile-toolbar-source');
// Promise bridge: network and credential encryption run off the UI thread.
const bridgePending=new Map();let bridgeId=0;
window.mobileNativeResult=(id,value)=>{const p=bridgePending.get(id);if(!p)return;bridgePending.delete(id);clearTimeout(p.timer);value.status==='error'?p.reject(Error(value.message)):p.resolve(value)};
function androidCall(route,body={}){return new Promise((resolve,reject)=>{if(!window.AndroidSync)return reject(Error('同步功能需要安装安卓 APK 后使用。'));const id=String(++bridgeId);const timer=setTimeout(()=>{bridgePending.delete(id);reject(Error('操作超时，请检查网络后重试。'))},90000);bridgePending.set(id,{resolve,reject,timer});AndroidSync.call(id,route,JSON.stringify(body))})}
async function ledgerHash(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase()}
function requireDav(r,codes){if(!codes.includes(r.code))throw Error(({401:'账号或应用密码不正确',403:'云端拒绝访问',404:'目录不存在',409:'同步目录冲突',412:'云端刚被另一台设备更新，请重新同步',423:'云端文件被锁定',429:'请求过于频繁，请稍后重试'})[r.code]||'WebDAV 操作失败（HTTP '+r.code+'）')}
async function dav(method,suffix='',body='',condition=''){return androidCall('/request',{method,suffix,body,condition})}
function verifyFolder(r){requireDav(r,[200,207]);const doc=new DOMParser().parseFromString(r.body,'application/xml');if(doc.querySelector('parsererror')||!Array.from(doc.getElementsByTagNameNS('DAV:','propstat')).some(p=>/\s200\s/.test(p.getElementsByTagNameNS('DAV:','status')[0]?.textContent||'')&&p.getElementsByTagNameNS('DAV:','collection').length))throw Error('云端目标不是可读取的 WebDAV 文件夹，未上传数据。')}
async function ensureFolder(){let r=await dav('PROPFIND','YuliangFinance/');if(r.code!==404&&!(r.code===409&&r.body.includes('AncestorsNotFound'))){verifyFolder(r);return}verifyFolder(await dav('PROPFIND'));requireDav(await dav('MKCOL','YuliangFinance/'),[200,201,204,405]);verifyFolder(await dav('PROPFIND','YuliangFinance/'))}
async function mobileSync(d){
 validateLedger(JSON.parse(d.data));const hash=await ledgerHash(d.data);await ensureFolder();const r=await dav('GET','YuliangFinance/state.json');requireDav(r,[200,404]);let cloud=null,remote='',revision='missing',remoteHash='';
 if(r.code===200){
  try{cloud=JSON.parse(String(r.body).replace(/^\uFEFF/,''))}catch(e){throw Error('读取云端封装失败：响应不是有效 JSON。请确认 WebDAV 地址指向正确目录；云端未被修改。')}
  if(!cloud||typeof cloud!=='object'||![1,2,3,4,5].includes(Number(cloud.format))||typeof cloud.revision!=='string'||!cloud.revision||typeof cloud.data!=='string')throw Error('云端封装字段不兼容：format='+String(cloud?.format)+'，data 类型='+typeof cloud?.data+'。云端未被修改。');
  let parsed;try{parsed=JSON.parse(cloud.data.replace(/^\uFEFF/,''))}catch(e){throw Error('云端账本内容无法解析为 JSON，未覆盖数据。')}
  try{validateLedger(parsed)}catch(e){throw Error('云端账本校验未通过：'+e.message+' 未覆盖数据。')}
  remote=cloud.data.replace(/^\uFEFF/,'');revision=cloud.revision;
  try{remoteHash=await ledgerHash(remote)}catch(e){throw Error('云端账本摘要计算失败：'+e.message+' 未覆盖数据。')}
 }

 const baseline=await androidCall('/baseline');
 if(d.mode&&d.expected!==revision)throw Error('云端版本已变化，请重新同步后选择。');
 if(cloud&&hash===remoteHash){await androidCall('/ack',{revision,hash});return {status:'ok',message:'手机与云端一致'}}
 const localChanged=hash!==baseline.hash,remoteChanged=revision!==baseline.revision;
 if(!d.mode&&((cloud&&(!baseline.hash||(localChanged&&remoteChanged)))||(!cloud&&baseline.hash)))return {status:'conflict',revision,missing:!cloud,updated:cloud?.updatedUtc||'',message:cloud?'手机与云端有不同版本，请选择保留的账本。首次连接建议使用云端版本。':'云端文件已不存在，请确认是否重新上传手机账本。'};
 if(d.mode==='cloud'||(!d.mode&&cloud&&!localChanged)){if(!cloud)throw Error('云端没有账本');await androidCall('/backup',{data:d.data,tag:'before-download'});return {status:'ok',message:'已下载云端账本，原手机账本已备份',data:remote,revision}}
 if(cloud&&(!r.etag||r.etag.startsWith('W/')))throw Error('服务器未提供强版本标记，已阻止覆盖上传。');
 await androidCall('/backup',{data:d.data,tag:'before-upload'});if(cloud)await androidCall('/backup',{data:remote,tag:'cloud-before-overwrite'});
 const newRev=crypto.randomUUID().replaceAll('-','');const envelope={format:5,revision:newRev,updatedUtc:new Date().toISOString(),device:'余量 Android',data:d.data};requireDav(await dav('PUT','YuliangFinance/state.json',JSON.stringify(envelope),cloud?r.etag:'*'),[200,201,204]);await androidCall('/ack',{revision:newRev,hash});return {status:'ok',message:'手机账本已上传，电脑点击同步即可获取'};
}
const desktopNativeCall=nativeCall;
nativeCall=async function(route,body){
 if(route==='/sync')return mobileSync(body);
 if(route==='/ack'){validateLedger(JSON.parse(body.data));return androidCall('/ack',{revision:body.revision,hash:await ledgerHash(body.sourceData||body.data)})}
 if(route==='/test'){verifyFolder(await dav('PROPFIND'));return {status:'ok',message:'连接成功，可以读取 WebDAV 根目录。本次未上传账本。'}}
 return androidCall(route,body);
};
// A late local edit must not be replaced by a download or marked as uploaded.
const nativeWithSyncGuard=nativeCall;
nativeCall=async function(route,body){if(route!=='/sync')return nativeWithSyncGuard(route,body);const snapshot=localStorage.getItem(KEY);const result=await nativeWithSyncGuard(route,body);if(snapshot!==localStorage.getItem(KEY))syncChanged=true;return result};
window.mobileLayout();
if(window.AndroidSync)nativeCall('/config').then(c=>{window.syncReady=!!c.hasPassword;setSyncStatus(c.hasPassword?'已配置 · 点击同步':'尚未配置同步');if(c.hasPassword&&localStorage.getItem('yuliang-auto-sync')==='true')syncNow('','',true)}).catch(()=>setSyncStatus('请检查同步配置'));

const mobileStatus=document.createElement('div');mobileStatus.className='mobile-sync-status';document.querySelector('header').after(mobileStatus);const badge=document.getElementById('syncBadge');const updateStatus=()=>{mobileStatus.textContent=badge.textContent==='未连接同步服务'?'账本保存在手机 · 在设置中连接坚果云':badge.textContent};new MutationObserver(updateStatus).observe(badge,{childList:true,subtree:true,characterData:true});updateStatus();

const comfortableMobileLayout=window.mobileLayout;window.mobileLayout=function(){comfortableMobileLayout();document.querySelectorAll('#content .panel').forEach(panel=>{if(panel.querySelector('h3')?.textContent.includes('本月资金时间线'))panel.querySelector('table')?.classList.add('timeline-compact')})};window.mobileLayout();
// Presentation adapter: actions delegate to the existing buttons and financial handlers.
const actionSheet=document.createElement('dialog');actionSheet.id='mobileActionSheet';actionSheet.innerHTML='<div class="sheet-grip"></div><h3></h3><div class="sheet-options"></div><button class="sheet-cancel" type="button">取消</button>';document.body.append(actionSheet);actionSheet.querySelector('.sheet-cancel').onclick=()=>actionSheet.close();actionSheet.addEventListener('click',e=>{if(e.target===actionSheet)actionSheet.close()});
function showMobileActions(title,buttons){const box=actionSheet.querySelector('.sheet-options');box.replaceChildren();actionSheet.querySelector('h3').textContent=title;for(const original of buttons){const b=document.createElement('button');b.type='button';let label=original.textContent.trim();if(original.classList.contains('status-toggle')||original.classList.contains('plan-received'))label=original.getAttribute('title')||('切换状态 · '+label);b.textContent=label;b.disabled=original.disabled;if(original.classList.contains('danger-button')||label.includes('删除'))b.classList.add('danger-button');b.onclick=()=>{actionSheet.close();original.click()};box.append(b)}actionSheet.showModal()}
const listMobileLayout=window.mobileLayout;
window.mobileLayout=function(){
 if(actionSheet.open)actionSheet.close();listMobileLayout();
 document.querySelectorAll('#content table.mobile-records tbody tr, #content .income-plan').forEach(record=>{
  if(record.querySelector('.record-more'))return;
  const sourceButtons=Array.from(record.querySelectorAll('button'));if(!sourceButtons.length)return;const buttons=mobileRecordActions(sourceButtons);for(const proxy of buttons)if(proxy.classList.contains('mobile-proxy'))record.append(proxy);
  const isPlan=record.classList.contains('income-plan');record.classList.add('touch-record');
  record.querySelectorAll('td').forEach(cell=>{const label=cell.dataset.label||'';if(/金额|余额|实收|应收/.test(label))cell.classList.add('record-money');else if(/日期|时间|到账日/.test(label))cell.classList.add('record-date');else if(/状态/.test(label))cell.classList.add('record-state');else if(/操作/.test(label))cell.classList.add('record-operations');else if(/地点|说明/.test(label))cell.classList.add('record-description')});
  for (const button of sourceButtons) {
   if (button.classList.contains('status-toggle') && (page === 1 || page === 3)) {
    button.classList.add('record-status', 'record-status-control',
     button.classList.contains('is-received') ? 'complete' : 'pending');
    continue;
   }
   if (button.classList.contains('status-toggle')) {
    const badge = document.createElement('span');
    badge.className = 'record-status ' + (button.classList.contains('is-received') ? 'complete' : 'pending');
    badge.textContent = button.textContent.trim();
    button.after(badge);
   }
   button.classList.add('action-source');
  }
  const more=document.createElement('button');more.type='button';more.className='record-more';more.innerHTML='<svg width="22" height="16" viewBox="0 0 22 16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="8" r="1.8"/><circle cx="11" cy="8" r="1.8"/><circle cx="18" cy="8" r="1.8"/></svg>';more.setAttribute('aria-label','更多操作');more.onclick=()=>showMobileActions((isPlan?record.querySelector('b')?.textContent:record.querySelector('.record-description')?.textContent||record.querySelector('td')?.textContent)||'记录操作',buttons);const planHeading=isPlan?record.querySelector('.plan-heading'):null;
  if(record.querySelector('.receipt-ratio'))record.classList.add('receipt-record');
  (planHeading||record).append(more);
 });
 fitSummaryAmounts();
};
function fitSummaryAmounts(){document.querySelectorAll('.cards .card strong,.income-summary-bar strong,.plan-heading strong').forEach(el=>{el.style.fontSize='';const available=el.parentElement.clientWidth;if(!available)return;let size=parseFloat(getComputedStyle(el).fontSize);while(el.scrollWidth>el.clientWidth+1&&size>12){size--;el.style.fontSize=size+'px'}})}
window.addEventListener('resize',fitSummaryAmounts);window.mobileLayout();

function openMobileReceiptStatus(index) {
 const receipt = data.incomeReceipts[index];
 if (!receipt) return;
 openReceiptEditor(index, { received: !receiptIsReceived(receipt) });
 document.getElementById('receiptReceived').focus();
}
// Shared mobile typography, help and direct editing; no ledger mutations during layout.
const infoDialog=document.createElement('dialog');infoDialog.id='mobileInfoDialog';infoDialog.innerHTML='<h3>存款合计说明</h3><p>净存款按普通账户余额减去尚未使用的还款预留计算。单账户净额满 100 元才计入合计和曲线。还款专用账户的余额与预留在明细中单列。</p><button type="button">知道了</button>';document.body.append(infoDialog);infoDialog.querySelector('button').onclick=()=>infoDialog.close();infoDialog.addEventListener('click',e=>{if(e.target===infoDialog)infoDialog.close()});
function helpButton(){const b=document.createElement('button');b.type='button';b.className='metric-help';b.textContent='?';b.setAttribute('aria-label','查看存款合计统计规则');b.onclick=()=>infoDialog.showModal();return b}
function bindAmountEdit(target,original){if(!target||!original||target.querySelector('.amount-edit-target'))return;const button=document.createElement('button');button.type='button';button.className='amount-edit-target';button.setAttribute('aria-label','点击编辑金额');while(target.firstChild)button.append(target.firstChild);const hint=document.createElement('span');hint.className='amount-edit-hint';hint.textContent='!';hint.setAttribute('aria-hidden','true');button.append(hint);button.onclick=()=>original.click();target.append(button)}
const coordinatedMobileLayout=window.mobileLayout;
window.mobileLayout=function(){
 coordinatedMobileLayout();
 document.querySelectorAll('#content>.muted').forEach(p=>{if(p.textContent.includes('单账户余额')){if(page===0)p.textContent='月初预留整月预算，同日按收入先于还款估算；已还金额不重复扣除。';else if(page===5)p.textContent='加减款保留用途与日期；点击记录右侧“•••”查看编辑、流水与排序。'}});
 document.querySelectorAll('#content .card').forEach(card=>{const caption=card.querySelector('.metric-caption');if(caption?.textContent.includes('单账户净额'))caption.remove();const label=Array.from(card.children).find(x=>x.tagName==='SPAN');if(label?.textContent.includes('存款合计')){label.textContent='净存款合计';label.classList.add('help-label');label.append(helpButton())}});
 document.querySelectorAll('.touch-record').forEach(record=>{const edit=Array.from(record.querySelectorAll('button.action-source')).find(b=>/编辑/.test(b.textContent));const money=record.querySelector('td.record-money')||record.querySelector('.plan-heading strong');bindAmountEdit(money,edit)});
 document.querySelectorAll('.timeline-compact td:first-child').forEach(td=>{const value=td.textContent.trim();if(/^\d{4}-\d{2}-\d{2}$/.test(value)){td.textContent=value.slice(5).replace('-',' / ');td.setAttribute('aria-label',value);td.title=value}});
 document.querySelectorAll('.deposit-accounts .touch-record').forEach(record=>{const name=Array.from(record.querySelectorAll('td')).find(td=>td.dataset.label?.includes('开户行'));if(name)name.classList.add('account-name');const number=record.querySelector('td:first-child');if(number)number.classList.add('account-number')});
 fitSummaryAmounts();
};window.mobileLayout();
// Month selection remains native while the visible face stays compact.
const alignedMobileLayout=window.mobileLayout;
window.mobileLayout=function(){
 alignedMobileLayout();updateMonthFace();
 const active=navigation[page];document.querySelectorAll('#nav button').forEach(button=>{const label=button.querySelector('span')?.textContent.trim();button.classList.toggle('active',label===active?.label);button.setAttribute('aria-current',label===active?.label?'page':'false')});
 // Keep the title selected by the shared renderer, including custom labels.
 document.body.dataset.page=String(page);
 document.querySelectorAll('.progress-card .metric-heading').forEach(heading=>{const state=heading.querySelector('.metric-state');if(state){heading.after(state);state.classList.add('metric-second-line')}});
 document.querySelectorAll('.progress-card .ratio-divider').forEach(x=>x.remove());
 document.querySelectorAll('.touch-record:has(.record-more) .amount-edit-hint').forEach(x=>x.remove());
 const bar=document.querySelector('.income-summary-bar');if(bar&&!bar.querySelector('.preset-help')){const original=Array.from(bar.querySelectorAll('button')).find(b=>b.textContent.includes('分配项目预设'));if(original){original.classList.add('preset-source');const info=document.createElement('button');info.type='button';info.className='preset-help';info.textContent='!';info.setAttribute('aria-label','编辑分配项目预设');info.title='分配项目预设';info.onclick=()=>original.click();bar.querySelector('strong').after(info)}}
};window.mobileLayout();

const refinedMobileLayout=window.mobileLayout;window.mobileLayout=function(){refinedMobileLayout();document.querySelectorAll('.progress-card .metric-second-line').forEach(el=>{if(el.textContent.startsWith('固定待收'))el.classList.add('pending-summary')});document.querySelectorAll('.progress-card .ratio-total').forEach(el=>{el.setAttribute('aria-label','应收金额 '+el.textContent)})};window.mobileLayout();

// Mobile menus bind record IDs so opening/scrolling a sheet cannot lose context.
function mobileRecordActions(originals){
 return originals.flatMap(original=>{
  const match=(original.getAttribute('onclick')||'').match(/openRowMenu\(event,'(deposits|debts|subsidies)',(\d+)\)/);
  if(!match)return [original];
  const kind=match[1],record=data[kind][Number(match[2])];if(!record)return [];
  const key=record.id;
  const actions=kind==='deposits'?[['incoming','加款'],['outgoing','取用'],['transfer','账户互转'],['edit','编辑账户'],['remove','删除账户']]:kind==='subsidies'?[['subsidyState',record.received?'改为待到账':'标记已到账'],['remove','删除补贴']]:[['payment',record.paymentAccountId?'修改关联扣款':'关联账户扣款'],['remove','删除还款']];
  return actions.map(([action,label])=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.className='action-source mobile-proxy'+(action==='remove'?' danger-button':'');button.onclick=()=>{
   const index=data[kind].findIndex(x=>x.id===key);if(index<0)return alert('记录已更新，请重新打开操作。');
   if(action==='incoming')openAccountMovement(index,1);else if(action==='outgoing')openAccountMovement(index,-1);else if(action==='transfer')openAccountTransfer('',key);else if(action==='edit')edit(kind,index);else if(action==='remove')remove(kind,index);else if(action==='payment')openDebtPayment(index);else if(action==='subsidyState')toggleSubsidy(index);
  };return button});
 });
}
showFloatingMenu=function(event,html){
 const host=document.getElementById('actionMenu');host.innerHTML=html;host.hidden=true;
 const saved=rowMenuContext?{...rowMenuContext}:null;
 const buttons=Array.from(host.querySelectorAll('button')).map(original=>{const proxy=document.createElement('button');proxy.textContent=original.textContent;proxy.className=original.className;proxy.onclick=()=>{rowMenuContext=saved;original.click()};return proxy});
 showMobileActions('记录操作',buttons);
};

const compactAmountSelectors = [
 '.cards>.card strong', '.overview-cards .metric-ratio b', '.income-integrated-metrics strong',
 '.compact-main-grid strong', '.plan-heading strong', '.receipt-amount b', '.receipt-ratio b',
 '.record-money .amount-edit-target', '.deposit-account-balance', '.todo-value',
 '.analysis-category-rank b', '.analysis-total', '.repayment-composition-totals b',
].map(selector => '#content ' + selector).join(',');

function fitCompactAmounts() {
 document.querySelectorAll(compactAmountSelectors).forEach(element => {
  if (!element.textContent.includes('¥') || !element.clientWidth) return;
  element.classList.remove('preview-money', 'preview-money-wrap');
  element.style.removeProperty('--preview-fitted');
  const size = parseFloat(getComputedStyle(element).fontSize);
  element.style.setProperty('--preview-amount-size', size + 'px');
  element.classList.add('preview-money');
  if (element.scrollWidth <= element.clientWidth + 1) return;
  const fitted = Math.max(12, Math.floor(size * element.clientWidth / element.scrollWidth));
  element.style.setProperty('--preview-fitted', fitted + 'px');
  if (element.scrollWidth > element.clientWidth + 1) element.classList.add('preview-money-wrap');
 });
}

function arrangeCompactRecords() {
 for (const cell of document.querySelectorAll('#content .receipt-amount')) {
  const row = cell.closest('tr');
  if (!row || row.cells.length < 4) continue;
  row.classList.add('preview-receipt-row');
  const allocation = row.cells[2];
  if (allocation.querySelector('.preview-allocation-label')) continue;
  const label = document.createElement('span');
  label.className = 'preview-allocation-label';
  label.textContent = '已分配';
  allocation.prepend(label);
 }
 for (const row of document.querySelectorAll('#content .numbered-subsidies tr.touch-record')) {
  const [number, category, name, dates] = row.cells;
  if (!dates) continue;
  row.classList.add('preview-subsidy-row');
  number.classList.add('preview-subsidy-index');
  category.classList.add('preview-subsidy-kind');
  name.classList.add('preview-subsidy-name');
  dates.classList.toggle('preview-missing-date', dates.textContent.trim() === '—');
 }
 for (const row of document.querySelectorAll('#content .deposit-accounts tr.touch-record')) {
  for (const cell of row.cells) cell.classList.toggle('preview-placeholder', cell.textContent.trim() === '—');
 }
 const repaymentHeading = document.querySelector('#content .overview-cards .debt-pending .metric-heading > span, #content .overview-cards .debt-complete .metric-heading > span');
 if (repaymentHeading?.textContent.trim() === '本月待还') repaymentHeading.textContent = '本月还款';
}

function arrangeCompactRecordDetails() {
  for (const amount of document.querySelectorAll('.preview-receipt-row .receipt-amount')) {
    const expected = amount.firstElementChild;
    if (expected?.tagName !== 'SPAN' || !expected.textContent.startsWith('应收 ')) continue;
    const value = document.createElement('b');
    value.className = 'compact-expected-amount';
    value.textContent = expected.textContent.slice(3);
    amount.lastElementChild.textContent = '应收 · 到账后计入';
    expected.replaceWith(value);
  }
  if (page === 4) {
    const sortNote = document.querySelector('#content .panel-heading-note');
    if (sortNote?.textContent === '按当前排序编号') {
      sortNote.textContent = '按时间或金额排序';
      sortNote.title = sortNote.textContent;
    }
  }
  if (page === 5) {
    const panel = document.querySelector('.deposit-accounts');
    const header = panel?.querySelector(':scope > .toolbar');
    const add = header?.querySelector('.panel-tools button.primary');
    if (add) header.querySelector('.panel-tools').before(add);
    for (const row of panel?.querySelectorAll('tr.touch-record') || []) {
      if (row.classList.contains('compact-account-row')) continue;
      const name = row.querySelector('.account-name');
      const tail = row.querySelector('[data-label="卡号尾号"]')?.textContent.trim();
      const reserve = row.querySelector('.savings-reserve');
      if (!name) continue;
      row.classList.add('compact-account-row');
      const caption = document.createElement('span');
      caption.className = 'compact-account-caption';
      caption.textContent = name.textContent;
      caption.title = caption.textContent;
      name.replaceChildren(caption);
      const icon = document.createElement('td');
      icon.className = 'compact-account-icon';
      icon.setAttribute('aria-hidden', 'true');
      if (/现金/.test(caption.textContent)) {
        icon.dataset.kind = 'cash';
        icon.innerHTML = '<span><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h1m10 0h1"/></svg></span>';
      } else if (/钱包|微信零钱|支付宝|余额宝/.test(caption.textContent)) {
        icon.dataset.kind = 'wallet';
        icon.innerHTML = '<span><svg viewBox="0 0 24 24"><path d="M4 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2l12-2"/><path d="M21 11h-5a2 2 0 0 0 0 4h5m-5-2h.1"/></svg></span>';
      } else {
        icon.dataset.kind = 'bank';
        icon.innerHTML = '<span></span>';
      }
      row.prepend(icon);
      if (tail && tail !== '—') {
        const suffix = document.createElement('span');
        suffix.className = 'compact-account-tail';
        suffix.textContent = ' · ' + tail;
        name.append(suffix);
      }
      if (reserve) {
        const detail = document.createElement('button');
        detail.type = 'button';
        detail.className = 'compact-account-detail';
        const fullDetails = reserve.textContent.trim();
        detail.textContent = fullDetails.startsWith('还款专用') ? '还款专用' : '有预留';
        detail.title = fullDetails;
        detail.onclick = () => alert(fullDetails);
        name.append(detail);
        reserve.remove();
        row.classList.add('has-account-details');
      }
      const transfer = [...row.querySelectorAll('.mobile-proxy')].find(button => button.textContent === '账户互转');
      if (transfer) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'compact-account-transfer';
        button.textContent = '互转';
        button.onclick = () => transfer.click();
        row.append(button);
      }
    }
  }
  for (const cell of document.querySelectorAll('.preview-subsidy-row .record-date')) {
    const date = cell.dataset.fullDate || cell.textContent.trim();
    if (!date || date === '—') continue;
    cell.dataset.fullDate = date;
    cell.title = date;
    const months = date.match(/\d{4}-\d{2}/g) || [];
    if (months.every(value => value === selectedMonth())) {
      cell.textContent = date.replace(/\d{4}-(\d{2})-(\d{2})/g, '$1-$2').replace(' 至 ', ' – ');
    }
  }
}

const monthDialog = document.createElement('dialog');
monthDialog.id = 'previewMonthDialog';
monthDialog.setAttribute('aria-label', '选择月份');
monthDialog.innerHTML = '<div><button type="button" aria-label="上一年">‹</button><strong aria-live="polite"></strong><button type="button" aria-label="下一年">›</button></div><div class="preview-month-options"></div>';
document.body.append(monthDialog);
monthFace.setAttribute('aria-haspopup', 'dialog');
let pickerYear;
function renderPreviewMonths() {
  monthDialog.querySelector('strong').textContent = pickerYear + ' 年';
  monthDialog.querySelector('[aria-label="上一年"]').disabled = pickerYear <= 1;
  monthDialog.querySelector('[aria-label="下一年"]').disabled = pickerYear >= 9999;
  const options = monthDialog.querySelector('.preview-month-options');
  options.replaceChildren();
  for (let index = 1; index <= 12; index++) {
    const option = document.createElement('button');
    option.type = 'button';
    option.textContent = index + ' 月';
    const value = String(pickerYear).padStart(4, '0') + '-' + String(index).padStart(2, '0');
    option.setAttribute('aria-pressed', String(monthPicker.value === value));
    option.onclick = () => {
      monthPicker.value = value;
      monthDialog.close();
      monthPicker.dispatchEvent(new Event('change'));
    };
    options.append(option);
  }
}
monthDialog.querySelector('[aria-label="上一年"]').onclick = () => { pickerYear--; renderPreviewMonths(); };
monthDialog.querySelector('[aria-label="下一年"]').onclick = () => { pickerYear++; renderPreviewMonths(); };
monthFace.onclick = () => {
  pickerYear = Number(selectedMonth().slice(0, 4));
  renderPreviewMonths();
  monthDialog.showModal();
  monthDialog.querySelector('[aria-pressed="true"]')?.focus();
};
monthDialog.addEventListener('click', event => {
  if (event.target === monthDialog) monthDialog.close();
});

const baseMobileLayout = window.mobileLayout;
window.mobileLayout = () => {
 baseMobileLayout();
 arrangeCompactRecords();
 arrangeCompactRecordDetails();
 fitCompactAmounts();
};
window.addEventListener('resize', fitCompactAmounts);
document.fonts?.ready.then(fitCompactAmounts);
window.mobileLayout();

// Use the dialog's cancel handler so OCR and sync can finish their own cleanup.
window.mobileBack = function () {
 const dialog = document.activeElement?.closest('dialog:modal') || Array.from(document.querySelectorAll('dialog:modal')).at(-1);
 if (!dialog) return false;
 if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
 return true;
};

if (window.AndroidAppearance && !storageLoadFailed) {
 const viewKey = 'yuliang-android-view-v1';
 const [lastPage, lastMonth] = (localStorage.getItem(viewKey) || '').split('/');
 const rememberView = window.mobileLayout;
 window.mobileLayout = function () {
  rememberView();
  localStorage.setItem(viewKey, page + '/' + selectedMonth());
 };
 if (/^[0-6]$/.test(lastPage) && validMonth(lastMonth)) {
  page = Number(lastPage);
  monthPicker.value = lastMonth;
  render();
 }
}
