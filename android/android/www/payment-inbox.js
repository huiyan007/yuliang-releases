(function () {
  'use strict';
  const rules = window.PaymentRules;
  const review = document.createElement('dialog');
  review.id = 'paymentReview';
  review.className = 'payment-inbox-dialog';
  review.setAttribute('aria-labelledby', 'paymentReviewTitle');
  const inbox = document.createElement('dialog');
  inbox.id = 'paymentInbox';
  inbox.className = 'payment-inbox-dialog';
  inbox.setAttribute('aria-labelledby', 'paymentInboxTitle');
  document.body.append(inbox, review);
  let pickerRequest = '';

  function savedRecord(id) {
    return (data.expenseEntries || []).find(item => item.id === id) || data.incomeReceipts.find(item => item.id === id);
  }

  function commitPayment(id, values) {
    if (storageLoadFailed || syncBusy) throw Error('请先恢复账本或等待同步完成，再保存这笔记录。');
    if (savedRecord(id)) return true;
    if (!validDate(values.date) || !validConsumptionAmount(values.amount) || values.amount <= 0 ||
        !Object.hasOwn(expenseCategories, values.category) || !['expense', 'income'].includes(values.direction)) {
      throw Error('请选择收支方向并填写有效的日期和金额。');
    }
    const next = structuredClone(data);
    const source = '截图';
    const name = values.merchant.trim().slice(0, 80);
    const note = name || source;
    const paymentCapture = { source };
    if (values.direction === 'income') {
      next.incomeReceipts.push({ id, date: values.date, name: note, amount: values.amount,
        expectedAmount: values.amount, received: true, allocations: [], note: '', paymentCapture });
    } else {
      (next.expenseEntries ||= []).push({ id, date: values.date, category: values.category,
        amount: values.amount, tag: '', note, paymentCapture });
    }
    return commitFinance(next);
  }

  function showError(dialog, message) {
    const status = dialog.querySelector('[role="status"]');
    if (status) status.textContent = message;
    else alert(message);
  }

  function receiptOptions(initial) {
    return Object.entries(expenseCategories).map(([key, value]) =>
      '<option value="' + key + '"' + (key === initial ? ' selected' : '') + '>' + esc(value.label) + '</option>').join('');
  }

  function openReview(id, parsed, preview) {
    if (review.open) return;
    if (savedRecord(id)) return alert('这笔记录已保存。');
    review.innerHTML = '<header><h3 id="paymentReviewTitle">截图补记</h3></header>' +
      '<form><p class="payment-inbox-note">' + esc(parsed.reason || '核对付款截图后保存。未识别的字段可手填。') + '</p>' +
      '<label>商户／项目<input name="merchant" maxlength="80" value="' + esc(parsed.merchant || '') + '" placeholder="可补充商户名称"></label>' +
      '<div class="payment-form-grid"><label>金额（元）<input name="amount" type="number" min="0.01" step="0.01" required value="' +
      (parsed.minor ? (parsed.minor / 100).toFixed(2) : '') + '"></label><label>日期<input name="date" type="date" required value="' +
      esc(localDay()) + '"></label></div>' +
      '<div class="payment-form-grid"><label>收支<select name="direction" required><option value="">请选择</option>' +
      '<option value="expense">支出</option><option value="income">收入</option></select></label>' +
      '<label>消费分类<select name="category">' + receiptOptions('other') + '</select></label></div>' +
      (preview ? '<details><summary>查看原截图</summary><img alt="付款截图"></details>' : '') +
      '<p role="status" class="payment-error"></p><div class="payment-actions">' +
      '<button type="button" data-close>取消</button><button class="primary" type="submit">确认保存</button></div></form>';
    if (preview) review.querySelector('img').src = preview;
    review.querySelector('[data-close]').onclick = () => review.close();
    const form = review.querySelector('form');
    const updateCategory = () => { form.elements.category.closest('label').hidden = form.elements.direction.value === 'income'; };
    form.elements.direction.onchange = updateCategory;
    updateCategory();
    form.onsubmit = event => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(form));
        values.amount = Number(values.amount);
        const other = values.direction === 'expense' ? data.expenseEntries || [] : data.incomeReceipts;
        const crossSource = other.some(item => item.paymentCapture && item.id !== id &&
          item.date === values.date && item.amount === values.amount &&
          item.paymentCapture.source !== '截图');
        if (crossSource && !confirm('当天已有一笔同金额的逐笔记录。请核对账单，确认是另一笔再保存。')) return;
        if (commitPayment(id, values)) {
          review.close();
          if (inbox.open) renderInbox();
        } else showError(review, '账本没有保存，请核对后重试。');
      } catch (error) { showError(review, error.message); }
    };
    review.showModal();
    return true;
  }

  review.addEventListener('close', () => {
    // The shared image remains in memory only for the confirmation window.
    review.replaceChildren();
  });

  function renderInbox() {
    const chosenMonth = selectedMonth();
    const saved = [...(data.expenseEntries || []), ...data.incomeReceipts]
      .filter(item => item.paymentCapture && item.date.startsWith(chosenMonth))
      .sort((a, b) => b.date.localeCompare(a.date));
    inbox.innerHTML = '<header><h3 id="paymentInboxTitle">截图记账</h3><button type="button" data-close>关闭</button></header>' +
      '<section><p class="payment-inbox-note">选择付款截图，或从 Android 分享菜单把截图发给余量。</p>' +
      '<div class="payment-actions"><button type="button" data-pick>识别付款截图</button></div></section>' +
      '<section><h4>' + esc(chosenMonth) + ' · 已补记（' + saved.length + '）</h4>' +
      '<p class="payment-inbox-note">逐笔支出单独留档，月度消费仍按余额盘点计算。退款和账户互转请先核对，再使用现有对应入口。</p>' +
      saved.map(item => '<article><div class="payment-line"><b>' + esc(item.name || item.note) + '</b><strong>' +
        money(item.amount) + '</strong></div><small>' + esc(item.date + ' · ' + item.paymentCapture.source +
        ' · ' + (item.id.startsWith('payment:') && item.category ? '支出' : '收入')) + '</small>' +
        '<button type="button" data-remove="' + esc(item.id) + '">删除</button></article>').join('') +
      '</section><p role="status" class="payment-error"></p>';
    inbox.querySelector('[data-close]').onclick = () => inbox.close();
    inbox.querySelector('[data-pick]').onclick = pickScreenshot;
    for (const button of inbox.querySelectorAll('[data-remove]')) {
      button.onclick = () => {
        if (!confirm('删除这条已补记记录？')) return;
        const id = button.dataset.remove;
        const item = data.incomeReceipts.findIndex(row => row.id === id);
        if (item >= 0) remove('incomeReceipts', item);
        else {
          const next = structuredClone(data);
          next.expenseEntries = next.expenseEntries.filter(row => row.id !== id);
          commitFinance(next);
        }
        renderInbox();
      };
    }
  }

  window.openPaymentInbox = () => {
    try {
      renderInbox();
      if (!inbox.open) inbox.showModal();
    } catch (error) { alert(error.message); }
  };

  function pickScreenshot() {
    if (!window.AndroidOcr) return alert('请在 Android App 中选择付款截图。');
    if (pickerRequest) return;
    pickerRequest = 'payment-' + id();
    try { AndroidOcr.pickImage(pickerRequest); }
    catch {
      pickerRequest = '';
      showError(inbox, '无法打开系统图片选择器。');
    }
  }

  window.reviewPaymentScreenshot = payload => {
    if (!payload?.ok || !/^[a-f0-9]{64}$/.test(payload.imageId || '')) return false;
    const preview = /^data:image\/jpeg;base64,/.test(payload.preview || '') ? payload.preview : '';
    const parsed = rules.parseScreenshot(payload);
    openReview('payment:screenshot:' + payload.imageId,
      { ...parsed, reason: parsed.minor ? '请核对识别的金额、商户、交易日期和收支方向。' :
        '没有读到唯一可靠的金额，请看原图手填，并核对交易日期。' }, preview);
    return true;
  };

  const categoryOcr = window.onAndroidOcrResult;
  window.onAndroidOcrResult = payload => {
    if (!pickerRequest || payload?.requestId !== pickerRequest) return categoryOcr(payload);
    pickerRequest = '';
    if (payload.ok) window.reviewPaymentScreenshot(payload);
    else if (!payload.cancelled) alert(payload.error || '无法读取截图。');
  };

})();
