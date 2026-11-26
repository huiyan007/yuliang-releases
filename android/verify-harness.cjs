const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'android/www/index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function boot(persisted = {}, script = code) {
  const store = { ...persisted };
  const elements = new Map();
  const el = (id = '') => ({
    id, nodeType: 1, value: '', innerHTML: '', textContent: '', files: [], className: '',
    open: false, hidden: false, style: {}, dataset: {}, childNodes: [], children: [],
    clientWidth: 360, clientHeight: 180, offsetHeight: 40, parentElement: null,
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    addEventListener() {}, removeEventListener() {}, append() {}, appendChild() {}, replaceChildren() {},
    insertAdjacentHTML(position, value) { this.innerHTML = value + this.innerHTML; },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return ''; },
    querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; },
    getBoundingClientRect() { return { left: 0, right: 360, top: 0, bottom: 40, width: 360, height: 180 }; },
    contains() { return false; }, focus() {}, remove() {},
    showModal() { this.open = true; }, close() { this.open = false; },
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, el(id));
    return elements.get(id);
  };
  const body = el('body');
  const document = {
    body, hidden: false, fonts: { ready: Promise.resolve() },
    getElementById: element, querySelector: selector => element('selector:' + selector), querySelectorAll: () => [],
    createElement: () => el(), addEventListener() {}, removeEventListener() {},
  };
  const ctx = {
    crypto: require('node:crypto').webcrypto, structuredClone, TextEncoder, TextDecoder,
    URL, Blob, document, location: { href: 'https://app.yuliang.local/index.html' },
    localStorage: {
      getItem: key => store[key] ?? null,
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: key => { delete store[key]; },
    },
    setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    AbortController, console, messages: [], confirm: () => true,
    getComputedStyle: () => ({ fontSize: '14px' }),
    addEventListener() {}, removeEventListener() {}, innerWidth: 393, innerHeight: 852,
    devicePixelRatio: 1,
  };
  ctx.window = ctx;
  ctx.alert = message => ctx.messages.push(message);
  ctx.FormData = class { *[Symbol.iterator]() { yield* Object.entries(ctx.formValues || {}); } };
  for (const key of ['month', 'restore', 'nav', 'title', 'content', 'form', 'formTitle', 'fields',
    'modal', 'syncModal', 'syncBadge', 'syncButton']) ctx[key] = element(key);
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return { ctx, store, run: source => vm.runInContext(source, ctx) };
}

module.exports = { boot, code };
if (require.main === module) {
  const app = boot();
  for (const page of [0, 1, 2, 3, 4, 5, 6]) {
    app.run('page=' + page + ';render()');
    console.log('render', page, app.ctx.content.innerHTML.length);
  }
  console.log(app.run('data.schemaVersion'), app.ctx.messages);
}
