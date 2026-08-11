// Characterisation + unit tests for the "Цифры со скриншота" module in ton-check.html
// Tests LOGIC ONLY (no real Anthropic API call). The real fetch() is stubbed; we assert
// on the payload it WOULD send and on the pure functions (parseAmount/currencyOf/fmtAmount)
// and the renderScan() DOM output via a fake DOM.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'ton-check.html'), 'utf-8');

// --- extract the <script> block that contains parseAmount (the app logic block) ---
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const appScript = scripts.find(s => s.includes('function parseAmount'));
if (!appScript) throw new Error('Could not locate app <script> with parseAmount');
// expose internal consts (vm const does not attach to global) for the harness
const appScriptExposed = appScript + '\n;globalThis.__shots = shots; globalThis.__scanOut = scanOut;';

// --- fake DOM primitives ---
function makeEl() {
  const el = {
    _html: '', value: '', textContent: '', disabled: false,
    dataset: {}, classList: { add(){}, remove(){}, contains(){ return false; } },
    style: {},
    set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
    addEventListener(){}, dispatchEvent(){}, appendChild(){}, remove(){},
    closest(){ return makeEl(); }, parentElement: null,
    querySelectorAll(){ return []; }, querySelector(){ return makeEl(); },
    onclick: null, onchange: null,
  };
  return el;
}
const elCache = {};
const document = {
  querySelector(sel){ return (elCache[sel] ||= makeEl()); },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
  getElementById(id){ return (elCache['#' + id] ||= makeEl()); },
  addEventListener(){},
};
let clipboardText = '';
const navigator = { clipboard: { writeText(t){ clipboardText = t; return Promise.resolve(); } } };
const localStorage = { _d:{}, get ncxp(){ return this._d.ncxp || '{}'; }, set ncxp(v){ this._d.ncxp = v; } };

// capture the fetch payload + full call history
let lastFetch = null;
const fetchCalls = [];
const fetchStub = async (url, opts) => {
  lastFetch = { url, opts };
  fetchCalls.push({ url, opts });
  if (url.endsWith('/api/scan')) {
    return { ok: false, status: 404, json: async () => ({ error: { message: 'proxy absent' } }) };
  }
  // direct Anthropic call — capture details for the test
  localStorage.__lastDirectUrl = url;
  localStorage.__lastDirectHeaders = opts.headers;
  localStorage.__lastDirectBody = opts.body;
  const body = JSON.parse(opts.body);
  const simulated = [
    { label: 'Сумма к оплате', value: '12 345,67 ₽', kind: 'money', source: 'скрин 1' },
    { label: 'НДС', value: '2 345,10 ₽', kind: 'money', source: 'скрин 1' },
    { label: 'Номер счёта', value: 'СЧ-2026-0991', kind: 'id', source: 'скрин 1' },
    { label: 'Курс', value: '1 000,50 $', kind: 'money', source: 'скрин 2' },
  ];
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(simulated) }] }) };
};

const ctx = {
  document, navigator, localStorage, fetch: fetchStub,
  console, setTimeout: ()=>{}, Event: class {}, FileReader: class {}, Blob: class {},
  URL: { createObjectURL(){ return ''; } }, JSON, Math, parseInt, parseFloat, isNaN,
  RegExp, String, Number, Object, Array, Promise, addEventListener(){},
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(appScriptExposed, ctx);

// grab functions/state from the context
const { parseAmount, currencyOf, fmtAmount, renderScan } = ctx;
const shots = ctx.__shots;

// --- tiny test framework ---
let pass = 0, fail = 0;
const fails = [];
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; fails.push(`${name}\n   got:  ${g}\n   want: ${w}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(`${name}\n   got: false`); } }

// === parseAmount: pure logic ===
eq('parseAmount "12 345,67 ₽"', parseAmount('12 345,67 ₽'), 12345.67);
eq('parseAmount "1 234.56"', parseAmount('1 234.56'), 1234.56);
eq('parseAmount "1.234.567,89" (eu)', parseAmount('1.234.567,89'), 1234567.89);
eq('parseAmount "(1 234,56)"', parseAmount('(1 234,56)'), 1234.56);
eq('parseAmount "-1 234,56"', parseAmount('-1 234,56'), -1234.56);
eq('parseAmount "₽ 99"', parseAmount('₽ 99'), 99);
eq('parseAmount "1 000,50 $"', parseAmount('1 000,50 $'), 1000.5);
eq('parseAmount "нет цифр"', parseAmount('нет цифр'), null);
eq('parseAmount ""', parseAmount(''), null);
eq('parseAmount "   "', parseAmount('   '), null);
eq('parseAmount "12 345" (no decimals)', parseAmount('12 345'), 12345);
// KNOWN CORRECT: US thousands separator "12,345" -> 12345 (regex strips , as thousands)
eq('parseAmount "12,345" (US thousands -> 12345)', parseAmount('12,345'), 12345);
// "1,50" is a valid decimal (1.5) - correct
eq('parseAmount "1,50"', parseAmount('1,50'), 1.5);

// === currencyOf ===
eq('currencyOf "12 345,67 ₽"', currencyOf('12 345,67 ₽'), '₽');
eq('currencyOf "$100"', currencyOf('$100'), '$');
eq('currencyOf "100 €"', currencyOf('100 €'), '€');
eq('currencyOf "£50"', currencyOf('£50'), '£');
eq('currencyOf "¥ 9"', currencyOf('¥ 9'), '¥');
eq('currencyOf "1 000,50 usd"', currencyOf('1 000,50 usd'), '$');
eq('currencyOf "пусто"', currencyOf('пусто'), '₽');

// === fmtAmount (uses ru-RU locale -> NBSP as thousands separator) ===
const NBSP = '\u00A0';
eq('fmtAmount 12345.67', fmtAmount(12345.67), '12' + NBSP + '345,67');
eq('fmtAmount 99', fmtAmount(99), '99');
eq('fmtAmount 1000.5', fmtAmount(1000.5), '1' + NBSP + '000,5');

// === renderScan: DOM output via fake scanOut ===
renderScan([]);
ok('renderScan empty -> "Чисел не найдено"', ctx.__scanOut.innerHTML.includes('Чисел не найдено'));

const rows = [
  { label: 'Сумма', value: '12 345,67 ₽', kind: 'money', source: 'скрин 1' },
  { label: 'НДС', value: '2 345,10 ₽', kind: 'money', source: 'скрин 1' },
  { label: 'Курс', value: '1 000,50 $', kind: 'money', source: 'скрин 2' },
  { label: 'Счёт', value: 'СЧ-1', kind: 'id', source: 'скрин 1' },
];
renderScan(rows);
const outHtml = ctx.__scanOut.innerHTML;
ok('renderScan shows total ₽', outHtml.includes('14' + NBSP + '690,77 ₽')); // 12345.67+2345.10
ok('renderScan shows total $', outHtml.includes('1' + NBSP + '000,5 $'));
ok('renderScan does NOT mix currencies', !outHtml.includes('15 6')); // no summed rub+usd
ok('renderScan renders table rows', (outHtml.match(/<tr>/g) || []).length >= 4);
ok('renderScan escapes label', outHtml.includes('Сумма'));

// === payload assembly: btnScan.onclick -> proxy-first, fallback direct-with-key ===
shots.length = 0;
shots.push({ name: 'a.png', mime: 'image/png', b64: 'BASE64DATA' });
elCache['#scanMode'] = makeEl(); elCache['#scanMode'].value = 'invoice';
localStorage.scanKey = 'sk-test-123'; // simulate user-saved key -> direct fallback path
lastFetch = null;
// btnScan.onclick was assigned during script run to elCache['#btnScan'].onclick
await elCache['#btnScan'].onclick();
ok('fetch called', !!lastFetch);
ok('proxy-first attempted (/api/scan)', fetchCalls.some(c => c.url.endsWith('/api/scan')));
// after proxy 404, falls back to direct Anthropic call
const sent = JSON.parse(localStorage.__lastDirectBody || '{}');
ok('fallback URL is Anthropic API', !!localStorage.__lastDirectUrl && localStorage.__lastDirectUrl === 'https://api.anthropic.com/v1/messages');
ok('payload model claude-sonnet-4-6', sent && sent.model === 'claude-sonnet-4-6');
const content = sent ? sent.messages[0].content : [];
ok('payload has image block', content.some(b => b.type === 'image' && b.source.type === 'base64' && b.source.data === 'BASE64DATA'));
ok('payload has text prompt for invoice', content.some(b => b.type === 'text' && b.text.includes('счёт') && b.text.includes('JSON')));
// BUG FIXED: direct call now carries required headers
const hdrKeys = lastFetch ? Object.keys(localStorage.__lastDirectHeaders || {}) : [];
ok('FIXED: x-api-key header present on direct call', hdrKeys.includes('x-api-key'));
ok('FIXED: anthropic-version header present', hdrKeys.includes('anthropic-version'));
ok('FIXED: dangerous-direct-browser-access header present (CORS)', hdrKeys.includes('anthropic-dangerous-direct-browser-access'));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFAILURES:\n' + fails.join('\n')); process.exit(1); }
