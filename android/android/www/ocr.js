(function () {
  'use strict';

  const categoryLabels = {
    food: '餐饮', shopping: '购物', travel: '出行', bills: '缴费',
    entertainment: '娱乐', services: '服务', other: '其他', transfer: '非消费转出'
  };
  const aliases = {
    餐饮: 'food', 饮食: 'food', 美食: 'food', 餐饮美食: 'food',
    购物: 'shopping', 交通: 'travel', 出行: 'travel', 交通出行: 'travel',
    缴费: 'bills', 生活缴费: 'bills', 居住缴费: 'bills',
    娱乐: 'entertainment', 休闲玩乐: 'entertainment', 休闲娱乐: 'entertainment',
    服务: 'services', 生活服务: 'services', 其他: 'other',
    转账: 'transfer', 划转: 'transfer', 非消费转出: 'transfer'
  };
  const totalPattern = /共支出|总支出|支出合计|合计支出|支出总额|总花费|总计/;
  const ignoredLabel = /账本|账单|统计|排行|构成|设置|明细|合计|总额|账户|余额|收入|日期|月份|返回|记一笔|点击|微信|支付宝|银行卡|总览|分类|支出|消费|完成|取消|保存|确认|提示|更新/;
  const amountPattern = /[¥￥]?\s*[+\-−]?\s*(?:(?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})(?![\d.,，])/g;

  function moneyValue(raw) {
    const text = String(raw).normalize('NFKC').trim().replace(/[¥￥,，\s]/g, '').replace(/−/g, '-');
    if (!/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
    const value = Math.abs(Number(text));
    return Number.isFinite(value) && value <= 999999999.99 ? Math.round(value * 100) / 100 : null;
  }

  function categoryFor(source) {
    if (typeof spendingMappedCategory === 'function') return spendingMappedCategory(source);
    return aliases[source.trim()] || 'other';
  }

  function cleanSource(text) {
    return String(text).replace(/\d+\s*笔/g, '').replace(/^\s*\d+[.、\s]*/, '')
      .replace(/[¥￥+\-−>›»：:|_—─·]/g, '').replace(/\s+/g, '').trim();
  }

  function possibleSource(text) {
    const name = cleanSource(text);
    if (!name || name.length > 16 || !/[\u3400-\u9fff]/.test(name) || /[\d%％]/.test(name)) return '';
    return aliases[name] || !ignoredLabel.test(name) ? name : '';
  }

  function amountsIn(text) {
    const original = String(text).normalize('NFKC').replace(/(\d)\s*\.\s*(?=\d)/g, '$1.');
    const withoutNoise = original.replace(/\d+(?:\.\d+)?\s*[%％]/g, '')
      .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, '')
      .replace(/\d{4}(?:年\d{1,2}月(?:\d{1,2}日?)?|[-/.]\d{1,2}[-/.]\d{1,2})/g, '')
      .replace(/\d+\s*笔/g, '');
    const matches = [];
    for (const match of withoutNoise.matchAll(amountPattern)) {
      const raw = match[0].trim();
      // List rank, battery percentage and transaction counts are not monetary values.
      if (/[\d.,，]/.test(withoutNoise.charAt(match.index - 1))
        || (!/[¥￥.+\-−]/.test(raw) && !/^\s*元/.test(withoutNoise.slice(match.index + match[0].length)))) continue;
      const value = moneyValue(raw);
      if (value !== null) matches.push({ raw, value, index: match.index, end: match.index + match[0].length });
    }
    return { text: withoutNoise, matches };
  }

  function parse(payload) {
    const warnings = Array.isArray(payload?.warnings) ? payload.warnings
      .filter(message => typeof message === 'string').slice(0, 12).map(message => message.slice(0, 240)) : [];
    const localSummary = ['offline-summary', 'category-template'].includes(payload?.engine);
    if (localSummary && Number(payload.width) > 0 && Number(payload.width) < 720) {
      warnings.push('截图分辨率较低，可能漏项，建议使用原图；请逐项核对并补录。');
    }
    const sourceLines = Array.isArray(payload?.lines) ? payload.lines.slice(0, 400) : [];
    const lines = sourceLines.map((line, index) => {
      const text = String(line?.text ?? '').normalize('NFKC').trim().slice(0, 512);
      const left = Number(line?.left) || 0, top = Number(line?.top) || 0;
      const right = Number.isFinite(Number(line?.right)) ? Number(line.right) : left + Math.max(20, text.length * 12);
      const bottom = Number.isFinite(Number(line?.bottom)) ? Number(line.bottom) : top + 24;
      const tokens = amountsIn(text);
      const nameOnly = !/[%％]/.test(text) && !tokens.matches.length ? possibleSource(text) : '';
      return { text, left, top, right, bottom, cy: (top + bottom) / 2, h: Math.max(12, bottom - top), index, tokens, nameOnly,
        unknownLabel: line?.unknownLabel === true };
    }).filter(line => line.text && line.h > 0).sort((a, b) => a.cy - b.cy || a.left - b.left);
    const amounts = lines.flatMap(line => line.tokens.matches.map(amount => ({ ...amount, line })));
    const totalLabels = lines.filter(line => totalPattern.test(line.text));
    const totalCandidates = [];
    for (const label of totalLabels) {
      const nearby = amounts.filter(({ line }) => line === label ||
        (line.cy > label.cy && line.cy - label.cy < Math.max(label.h * 5, (Number(payload.height) || 1600) * 0.07)
          && Math.abs(line.left - label.left) < Math.max(100, (Number(payload.width) || 800) * 0.15)))
        .sort((a, b) => Math.abs(a.line.cy - label.cy) - Math.abs(b.line.cy - label.cy));
      if (nearby[0]) totalCandidates.push(nearby[0]);
    }
    const totalIndices = new Set(totalCandidates.map(item => item.line.index));
    const paired = [];
    const usedNames = new Set();
    for (const amount of amounts) {
      const { line } = amount;
      if (totalIndices.has(line.index) || totalPattern.test(line.text)) continue;
      const pieces = line.tokens;
      // A complete OCR line may already contain both the original category and its amount.
      let name = possibleSource(pieces.text.slice(0, amount.index));
      let nameLine = name ? line : null;
      if (!name) {
        const candidates = lines.filter(other => other !== line && other.left < line.left && other.nameOnly
          && other.right < line.left + Math.max(other.h, line.h) * 0.6
          && Math.abs(other.cy - line.cy) <= Math.max(other.h, line.h) * 0.65
        ).sort((a, b) => Math.abs(a.cy - line.cy) - Math.abs(b.cy - line.cy) || b.left - a.left);
        if (candidates[0]) {
          nameLine = candidates[0];
          name = nameLine.nameOnly;
        }
      }
      if (!name) {
        // The finite offline recognizer may find an amount but fail to read its label.
        // Keep that amount visible and require the user to supply the original category.
        if (line.unknownLabel || (localSummary && line.left >= Number(payload.width) * .5 && line.cy > Number(payload.height) * .2)) {
          paired.push({ source: '', amount: amount.value.toFixed(2), category: 'other', selected: true,
            y: line.cy, lineIndex: line.index, warning: '未识别到分类名称，请对照原图补填或取消选择' });
        }
        continue;
      }
      if (usedNames.has(nameLine.index)) continue;
      usedNames.add(nameLine.index);
      paired.push({ source: name, amount: amount.value.toFixed(2), category: categoryFor(name), selected: true,
        y: line.cy, lineIndex: nameLine.index });
    }
    // Preserve a visibly missing amount in the list so the review cannot silently skip it.
    if (paired.length || localSummary) {
      const minY = paired.length ? Math.min(...paired.map(row => row.y)) : 0;
      const maxY = paired.length ? Math.max(...paired.map(row => row.y)) : Number(payload.height) || Infinity;
      const typicalHeight = lines.reduce((sum, line) => sum + line.h, 0) / Math.max(lines.length, 1);
      for (const line of lines) {
        if (usedNames.has(line.index)) continue;
        const source = line.nameOnly;
        if (!source || !(source in aliases) || line.cy < minY - typicalHeight * 2 || line.cy > maxY + typicalHeight * 5) continue;
        paired.push({ source, amount: '', category: categoryFor(source), selected: true, y: line.cy,
          lineIndex: line.index, warning: '未识别到金额，请补填或取消选择' });
      }
    }
    paired.sort((a, b) => a.y - b.y);
    const seen = new Set();
    for (const row of paired) {
      if (row.source && seen.has(row.source)) {
        row.selected = false;
        row.warning = '同名条目重复，已暂时取消选择，请核对';
      }
      if (row.source) seen.add(row.source);
      if (row.source && !(row.source in aliases)) row.warning = '分类名称未匹配，暂归其他，请核对名称和品类';
      if (row.category === 'transfer') row.warning = '已按桌面规则归为非消费转出，请核对';
    }
    const total = totalCandidates[0]?.value ?? null;
    const selectedTotal = paired.filter(row => row.selected && row.amount !== '').reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100;
    if (!paired.length) warnings.push('未找到可配对的分类金额，可重新选择清晰的分类列表截图。');
    if (total !== null && Math.round(total * 100) !== Math.round(selectedTotal * 100)) warnings.push('识别条目合计与截图总额不一致，请检查漏项或识别错误。');
    if (total === null) warnings.push('截图未识别到支出总额，请确认分类列表是否完整。');
    const dates = lines.flatMap(line => [...line.text.matchAll(/(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})日?/g)]
      .map(match => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`));
    return { rows: paired.map(({ y, lineIndex, ...row }) => row), total, warnings, dates: [...new Set(dates)] };
  }

  function groupMatches(item, selection) {
    return item.channel === selection.channel && (selection.channel !== 'wechat'
      || (item.wechatAccount || 'wechat1') === selection.wechatAccount);
  }

  function mergeLedger(ledger, selection, rows, baseline) {
    if (baseline !== undefined && JSON.stringify(ledger) !== baseline) throw Error('账本已更新，请重新打开识别导入并核对后保存。');
    if (!selection || !/^\d{4}-\d{2}$/.test(selection.month) || !['mid', 'end'].includes(selection.kind)
      || !['wechat', 'alipay', 'bank'].includes(selection.channel)
      || (selection.channel === 'wechat' && !['wechat1', 'wechat2'].includes(selection.wechatAccount))) throw Error('请确认月份、盘点区间和渠道账号。');
    const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
      && Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
    if (!validDay(selection.from) || !validDay(selection.through) || selection.from.slice(0, 7) !== selection.month
      || selection.through.slice(0, 7) !== selection.month || selection.from > selection.through) throw Error('请填写所选月份内有效的统计起止日期。');
    const last = new Date(Number(selection.month.slice(0, 4)), Number(selection.month.slice(5)), 0).getDate();
    if (selection.kind === 'mid' && (selection.from !== selection.month + '-01'
      || Number(selection.through.slice(-2)) === last)) throw Error('月中分类须从月初开始，截止日应早于月末。');
    const selected = rows.filter(row => row.selected !== false);
    if (!selected.length) throw Error('请至少保留一条分类记录。');
    const seen = new Set();
    const items = selected.map(row => {
      const source = String(row.source || '').trim();
      const raw = String(row.amount ?? '').normalize('NFKC');
      const amount = typeof spendingEnteredAmount === 'function' ? spendingEnteredAmount(raw) : moneyValue(raw);
      if (!source || amount === null || !Object.hasOwn(categoryLabels, row.category)) throw Error('请补全每条记录的原条目、有效金额和品类。');
      const identity = source.replace(/\s+/g, '');
      if (seen.has(identity)) throw Error('存在同名重复条目，请取消重复项或修改名称后保存。');
      seen.add(identity);
      return { channel: selection.channel, source, category: row.category, amount,
        ...(selection.channel === 'wechat' ? { wechatAccount: selection.wechatAccount } : {}) };
    });
    const current = (ledger.spendingSummaries || []).find(summary => summary.month === selection.month && summary.kind === selection.kind);
    const otherItems = (current?.items || []).filter(item => !groupMatches(item, selection));
    if (otherItems.length && (current.from !== selection.from || current.through !== selection.through)) {
      throw Error('此区间已录入其他渠道或微信账号。请使用相同的起止日期，避免把不同区间的金额合并。');
    }
    const opposite = (ledger.spendingSummaries || []).find(summary => summary.month === selection.month && summary.kind !== selection.kind);
    if (opposite && (selection.kind === 'end' ? selection.from <= opposite.through : selection.through >= opposite.from)) {
      throw Error('月中与月末分类区间重叠，请核对统计起止日期。');
    }
    const next = structuredClone(ledger);
    next.spendingSummaries = (next.spendingSummaries || []).filter(summary => summary.month !== selection.month || summary.kind !== selection.kind)
      .concat({ month: selection.month, kind: selection.kind, from: selection.from, through: selection.through, items: structuredClone(otherItems).concat(items) });
    return next;
  }

  window.YuliangOcrParser = Object.freeze({ parse, moneyValue, mergeLedger });
  let state = null;
  let sequence = 0;
  let pendingShared = null;
  const shareWaiters = new WeakSet();
  const byId = id => document.getElementById(id);
  const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const format = value => '¥ ' + Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function currentLedger() { if (typeof data === 'undefined') throw Error('账本尚未就绪，请稍后重试。'); return data; }
  function monthLast(month) { return `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()).padStart(2, '0')}`; }
  function following(day) { return new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); }

  function ensureDialog() {
    if (byId('ocrImportDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'ocrImportDialog';
    dialog.className = 'ocr-dialog';
    dialog.setAttribute('aria-labelledby', 'ocrImportTitle');
    dialog.innerHTML = `<div class="ocr-top"><div><span class="ocr-eyebrow">截图记账</span><h2 id="ocrImportTitle">识别分类花费</h2></div><button type="button" id="ocrClose" class="ocr-close" aria-label="关闭截图识别">×</button></div>
      <div class="ocr-body"><div class="ocr-source-bar"><button type="button" id="ocrPick" class="primary">选择账单截图</button><span id="ocrBusy" role="status" aria-live="polite">识别后核对，再保存</span></div>
      <p id="ocrEngineHint" class="ocr-hint">首版适配微信、支付宝浅色分类汇总截图，在手机本地识别。请核对每项金额和分类，原图不随账本同步。</p>
      <button type="button" id="ocrImageButton" class="ocr-image-button" hidden aria-label="放大原始截图"><img id="ocrPreview" alt="待核对的账单截图"><span>点击放大原图</span></button>
      <div class="ocr-context"><label>月份<input id="ocrMonth" type="month" required></label><label>盘点区间<select id="ocrKind"><option value="mid">月中分类</option><option value="end">月末分类</option></select></label><label>渠道<select id="ocrChannel"><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="bank">银行卡</option></select></label><label id="ocrAccountLabel">微信账号<select id="ocrAccount"><option value="wechat1">微信 1</option><option value="wechat2">微信 2</option></select></label><label>统计起始日<input id="ocrFrom" type="date" required></label><label>统计截止日<input id="ocrThrough" type="date" required></label></div>
      <p id="ocrDateHint" class="ocr-hint">请按原账单确认统计日期和渠道。截图时间不会作为账期。</p><p id="ocrReplacement" class="ocr-replacement"></p>
      <div id="ocrWarnings" class="ocr-warnings" role="status" aria-live="polite"></div>
      <div class="ocr-row-heading"><b>识别条目</b><button type="button" id="ocrAdd" class="ocr-text-button">＋ 补充一项</button></div><div id="ocrRows" class="ocr-rows"></div>
      <label class="ocr-verified"><input id="ocrVerified" type="checkbox"><span>我已核对区间、渠道、金额及条目完整性</span></label><p id="ocrError" class="ocr-error" role="alert"></p></div>
      <div class="ocr-footer"><div><span id="ocrCount">尚未识别</span><strong id="ocrTotal">¥ 0.00</strong><small id="ocrOriginalTotal"></small></div><button type="button" id="ocrSave" class="primary" disabled>确认保存</button></div>`;
    document.body.append(dialog);
    byId('ocrClose').onclick = () => closeImport();
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeImport(); });
    byId('ocrPick').onclick = pickImage;
    byId('ocrImageButton').onclick = showImage;
    for (const id of ['ocrChannel', 'ocrAccount', 'ocrFrom', 'ocrThrough']) byId(id).onchange = contextChanged;
    for (const id of ['ocrMonth', 'ocrKind']) byId(id).onchange = () => { setDefaultRange(); contextChanged(); };
    byId('ocrVerified').onchange = updateTotals;
    byId('ocrAdd').onclick = () => {
      if (!state) return;
      state.rows.push({ source: '', amount: '', category: 'other', selected: true });
      byId('ocrVerified').checked = false;
      drawRows();
      byId('ocrRows').lastElementChild?.querySelector('[data-ocr-source]')?.focus();
    };
    byId('ocrSave').onclick = saveImport;
  }

  function selection() {
    return { month: byId('ocrMonth').value, kind: byId('ocrKind').value, channel: byId('ocrChannel').value,
      wechatAccount: byId('ocrAccount').value, from: byId('ocrFrom').value, through: byId('ocrThrough').value };
  }

  function setDefaultRange(options = {}) {
    const month = byId('ocrMonth').value, kind = byId('ocrKind').value;
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const ledger = currentLedger();
    const saved = (ledger.spendingSummaries || []).find(summary => summary.month === month && summary.kind === kind);
    const mid = (ledger.spendingSummaries || []).find(summary => summary.month === month && summary.kind === 'mid');
    const balance = (ledger.consumptionMonths || []).find(record => record.month === month);
    const prior = mid?.through || balance?.mid?.date;
    byId('ocrFrom').value = options.from || saved?.from || (kind === 'end' && prior ? following(prior) : month + '-01');
    byId('ocrThrough').value = options.through || saved?.through || balance?.[kind]?.date || (kind === 'mid' ? month + '-15' : monthLast(month));
    byId('ocrFrom').readOnly = kind === 'mid';
    for (const id of ['ocrFrom', 'ocrThrough']) { byId(id).min = month + '-01'; byId(id).max = monthLast(month); }
    if (kind === 'mid') byId('ocrThrough').max = new Date(Date.parse(monthLast(month) + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  }

  function contextChanged() {
    if (!state) return;
    byId('ocrAccountLabel').hidden = byId('ocrChannel').value !== 'wechat';
    byId('ocrVerified').checked = false;
    byId('ocrError').textContent = '';
    const selected = selection(), ledger = currentLedger();
    const summary = (ledger.spendingSummaries || []).find(record => record.month === selected.month && record.kind === selected.kind);
    const existing = (summary?.items || []).filter(item => groupMatches(item, selected));
    byId('ocrReplacement').textContent = existing.length ? `保存将替换此渠道${selected.channel === 'wechat' ? '账号' : ''}已录入的 ${existing.length} 条分类。请确认截图包含该区间完整列表。` : '确认后写入当前渠道，其他渠道和账户余额按原记录保留。';
    updateTotals();
  }

  function drawRows() {
    const host = byId('ocrRows');
    host.innerHTML = !state.rows.length ? '<p class="ocr-empty">选择分类汇总截图，自动提取原条目和金额。</p>' : state.rows.map((row, index) => `<div class="ocr-item${row.selected === false ? ' is-unselected' : ''}" data-ocr-index="${index}"><label class="ocr-select"><input data-ocr-selected type="checkbox" ${row.selected === false ? '' : 'checked'} aria-label="保留第 ${index + 1} 项"></label><div class="ocr-item-fields"><label><span>原条目</span><input data-ocr-source value="${html(row.source)}" maxlength="64" aria-label="第 ${index + 1} 项原条目"></label><label><span>金额</span><input data-ocr-amount value="${html(row.amount)}" inputmode="decimal" placeholder="待核对" aria-label="第 ${index + 1} 项金额"></label><label class="ocr-category"><span>归入品类</span><select data-ocr-category aria-label="第 ${index + 1} 项归入品类">${Object.entries(categoryLabels).map(([key, label]) => `<option value="${key}" ${row.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${row.warning ? `<small class="ocr-item-warning">${html(row.warning)}</small>` : ''}</div></div>`).join('');
    for (const element of host.querySelectorAll('[data-ocr-index]')) {
      const row = state.rows[Number(element.dataset.ocrIndex)];
      element.querySelector('[data-ocr-selected]').onchange = event => {
        row.selected = event.target.checked;
        element.classList.toggle('is-unselected', !row.selected);
        byId('ocrVerified').checked = false;
        updateTotals();
      };
      element.querySelector('[data-ocr-source]').oninput = event => {
        row.source = event.target.value;
        row.category = categoryFor(row.source);
        element.querySelector('[data-ocr-category]').value = row.category;
        byId('ocrVerified').checked = false;
        updateTotals();
      };
      element.querySelector('[data-ocr-amount]').oninput = event => {
        row.amount = event.target.value;
        byId('ocrVerified').checked = false;
        updateTotals();
      };
      element.querySelector('[data-ocr-category]').onchange = event => {
        row.category = event.target.value;
        byId('ocrVerified').checked = false;
        updateTotals();
      };
    }
    updateTotals();
  }

  function updateTotals() {
    if (!state) return;
    const selected = state.rows.filter(row => row.selected !== false);
    const values = selected.map(row => moneyValue(row.amount));
    const totalCents = values.reduce((sum, value) => sum + Math.round((value || 0) * 100), 0);
    byId('ocrCount').textContent = `${selected.length} 项 · 含非消费转出`;
    byId('ocrTotal').textContent = format(totalCents / 100);
    byId('ocrOriginalTotal').textContent = state.total !== null ? `截图总额 ${format(state.total)}` : '';
    const warnings = [...state.warnings.filter(message => !message.includes('合计与截图总额'))];
    if (state.total !== null && Math.round(state.total * 100) !== totalCents) warnings.push('所选条目合计与截图总额不一致，请核对漏项、重复项和金额。');
    if (selected.some(row => !row.source.trim() || moneyValue(row.amount) === null)) warnings.push('选中条目有信息未补全，请编辑金额或取消选择。');
    byId('ocrWarnings').innerHTML = [...new Set(warnings)].map(message => `<p>${html(message)}</p>`).join('');
    byId('ocrSave').disabled = state.busy || !selected.length || selected.some(row => !row.source.trim() || moneyValue(row.amount) === null) || !byId('ocrVerified').checked;
  }

  function pickImage() {
    if (!state) return;
    if (!window.AndroidOcr || typeof window.AndroidOcr.pickImage !== 'function') {
      byId('ocrError').textContent = '请在余量安卓 App 中选择截图，网页预览不提供手机本地识别。';
      return;
    }
    state.requestId = 'ocr-' + Date.now() + '-' + (++sequence);
    state.busy = true;
    byId('ocrBusy').textContent = '选择截图并在手机本地识别…';
    byId('ocrPick').disabled = true;
    byId('ocrError').textContent = '';
    updateTotals();
    try { window.AndroidOcr.pickImage(state.requestId); }
    catch (error) { state.busy = false; state.requestId = ''; byId('ocrPick').disabled = false; byId('ocrError').textContent = error.message || '无法打开截图选择器。'; updateTotals(); }
  }

  function receive(payload) {
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
    if (!state || !payload || !state.requestId || payload.requestId !== state.requestId) return;
    state.requestId = '';
    state.busy = false;
    byId('ocrPick').disabled = false;
    if (!payload.ok) {
      byId('ocrBusy').textContent = payload.cancelled ? '已取消选图' : '识别未完成';
      byId('ocrError').textContent = payload.cancelled ? '' : (payload.error || '识别失败，请更换清晰截图后重试。');
      updateTotals();
      return;
    }
    const result = parse(payload);
    state.rows = result.rows;
    state.total = result.total;
    state.warnings = result.warnings;
    byId('ocrEngineHint').textContent = typeof payload.notice === 'string'
      ? payload.notice.slice(0, 240) + ' 原图不随账本同步。'
      : '首版适配微信、支付宝浅色分类汇总截图，在手机本地识别。请核对每项金额和分类，原图不随账本同步。';
    byId('ocrDateHint').textContent = result.dates.length ? `截图检测到日期 ${result.dates.slice(0, 3).join('、')}，请核对实际统计区间。` : '截图未检测到完整账期，请按原账单确认统计日期和渠道。';
    byId('ocrVerified').checked = false;
    byId('ocrBusy').textContent = result.rows.length ? `已识别 ${result.rows.length} 项，请核对` : '请核对截图或补充条目';
    byId('ocrImageButton').hidden = !/^data:image\/(?:jpeg|png|webp);base64,/.test(payload.preview || '');
    if (!byId('ocrImageButton').hidden) byId('ocrPreview').src = payload.preview;
    else byId('ocrPreview').removeAttribute('src');
    drawRows();
  }

  function saveImport() {
    if (!state || !byId('ocrVerified').checked || state.busy) return;
    byId('ocrError').textContent = '';
    try {
      const selected = selection();
      const next = mergeLedger(currentLedger(), selected, state.rows, state.baseline);
      if (typeof validateSpendingSummaries === 'function') validateSpendingSummaries(next);
      if (typeof commitFinance !== 'function') throw Error('账本保存功能尚未就绪。');
      if (!commitFinance(next)) return;
      closeImport(true);
      const monthInput = byId('month');
      if (monthInput && monthInput.value !== selected.month) {
        monthInput.value = selected.month;
        if (typeof render === 'function') render();
      }
      if (typeof openSpendingSummary === 'function') openSpendingSummary(selected.kind);
    } catch (error) { byId('ocrError').textContent = error.message || '保存失败，请核对后重试。'; }
  }

  function closeImport(saved = false) {
    if (!state) return;
    if (!saved && state.rows.length && !window.confirm('关闭后将清除本次未保存的识别结果。确定关闭？')) return;
    byId('ocrImportDialog').close();
    byId('ocrPreview').removeAttribute('src');
    state = null;
    const enlarged = byId('ocrImageDialog');
    if (enlarged) enlarged.remove();
  }

  function showImage() {
    if (!byId('ocrPreview').src) return;
    let dialog = byId('ocrImageDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ocrImageDialog';
      dialog.className = 'ocr-image-dialog';
      dialog.innerHTML = '<button type="button" aria-label="关闭截图大图">关闭</button><img alt="账单原始截图">';
      dialog.querySelector('button').onclick = () => dialog.close();
      document.body.append(dialog);
    }
    dialog.querySelector('img').src = byId('ocrPreview').src;
    dialog.showModal();
  }

  window.openOcrImport = function (kind = 'mid', options = {}) {
    try {
      ensureDialog();
      if (otherDialogs().length) { window.alert('请先保存或关闭当前窗口，再导入账单截图。'); return false; }
      if (state?.busy) { window.alert('当前截图正在处理，请等待完成，或关闭识别窗口后重试。'); return false; }
      if (state?.rows.length && !window.confirm('重新打开会清除本次未保存的识别结果。继续？')) return false;
      const ledger = currentLedger();
      state = { baseline: JSON.stringify(ledger), rows: [], total: null, warnings: [], busy: false, requestId: '' };
      byId('ocrMonth').value = options.month || (typeof selectedMonth === 'function' ? selectedMonth() : ledger.base);
      byId('ocrKind').value = kind === 'end' ? 'end' : 'mid';
      byId('ocrChannel').value = ['wechat', 'alipay', 'bank'].includes(options.channel) ? options.channel : 'wechat';
      byId('ocrAccount').value = options.wechatAccount === 'wechat2' ? 'wechat2' : 'wechat1';
      setDefaultRange(options);
      byId('ocrPreview').removeAttribute('src');
      byId('ocrImageDialog')?.remove();
      byId('ocrImageButton').hidden = true;
      byId('ocrDateHint').textContent = '请按原账单确认统计日期和渠道。截图时间不会作为账期。';
      byId('ocrBusy').textContent = '识别后核对，再保存';
      byId('ocrEngineHint').textContent = '首版适配微信、支付宝浅色分类汇总截图，在手机本地识别。请核对每项金额和分类，原图不随账本同步。';
      byId('ocrPick').disabled = false;
      contextChanged();
      drawRows();
      const dialog = byId('ocrImportDialog');
      if (!dialog.open) dialog.showModal();
      return true;
    } catch (error) { window.alert(error.message); return false; }
  };
  window.onAndroidOcrResult = receive;
  function otherDialogs() {
    return [...document.querySelectorAll('dialog[open]')].filter(dialog => !['ocrImportDialog', 'ocrImageDialog'].includes(dialog.id));
  }
  function drainShared() {
    if (!pendingShared || otherDialogs().length) return;
    const payload = pendingShared;
    pendingShared = null;
    byId('ocrShareNotice')?.remove();
    window.onAndroidOcrShared(payload);
  }
  window.onAndroidOcrShared = function (payload) {
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
    if (!payload || typeof payload.requestId !== 'string' || !payload.requestId) return;
    if (!payload.ok) { if (!payload.cancelled) window.alert(payload.error || '分享的截图未能识别，请稍后重新选择。'); return; }
    const blocking = otherDialogs();
    if (blocking.length) {
      if (pendingShared && !window.confirm('已有一张分享截图等待导入，改为这张截图？')) return;
      pendingShared = payload;
      let notice = byId('ocrShareNotice');
      if (!notice) { notice = document.createElement('p'); notice.id = 'ocrShareNotice'; notice.className = 'ocr-share-notice'; notice.setAttribute('role', 'status'); }
      notice.textContent = '截图已收到。先完成当前窗口，关闭后再核对导入。';
      blocking[blocking.length - 1].append(notice);
      for (const dialog of blocking) if (!shareWaiters.has(dialog)) {
        shareWaiters.add(dialog);
        dialog.addEventListener('close', () => queueMicrotask(drainShared));
      }
      return;
    }
    if (payload.imageId && typeof window.reviewPaymentScreenshot === 'function' && !parse(payload).rows.length) {
      if (window.reviewPaymentScreenshot(payload)) return;
    }
    if (!window.openOcrImport('mid')) return;
    state.requestId = payload.requestId;
    receive(payload);
  };
})();
