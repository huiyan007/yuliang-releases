(function (root) {
  'use strict';

  const amountPattern = '\\d{1,9}(?:,\\d{3})*(?:\\.\\d{1,2})?';
  const currencyPattern = new RegExp('[¥￥]\\s*(' + amountPattern + ')(?![\\d.,])|(?<![\\d.,])(' + amountPattern + ')(?![\\d.,])\\s*元', 'g');
  function normalize(text) {
    return String(text || '').normalize('NFKC').replace(/\u00a0/g, ' ');
  }

  function cents(text) {
    const raw = String(text || '').replaceAll(',', '');
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) return null;
    const [units, fraction = ''] = raw.split('.');
    const value = Number(units) * 100 + Number(fraction.padEnd(2, '0'));
    return value > 0 ? value : null;
  }

  function merchant(text) {
    const line = text.match(/(?:商户(?:名称)?|收款方|交易对方|付款给)\s*[:：]\s*([^\r\n。；;]{2,60})/);
    return line ? line[1].trim() : '';
  }

  function parseScreenshot(payload) {
    const tokens = (Array.isArray(payload?.paymentLines) ? payload.paymentLines : [])
      .map(line => normalize(line?.text)).filter(Boolean);
    const text = tokens.join('\n');
    const amounts = new Set([...text.matchAll(currencyPattern)].map(match => cents(match[1] || match[2])).filter(Boolean));
    return { minor: amounts.size === 1 ? amounts.values().next().value : null, merchant: merchant(text) };
  }

  const api = Object.freeze({ parseScreenshot });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaymentRules = api;
})(globalThis);
