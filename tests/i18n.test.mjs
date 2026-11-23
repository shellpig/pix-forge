import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const testDist = await mkdtemp(join(tmpdir(), 'pix-forge-i18n-'));
after(() => rm(testDist, { recursive: true, force: true }));
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  build: {
    outDir: testDist,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve('src/i18n/core.ts'),
      formats: ['es'],
      fileName: () => 'i18n.mjs',
    },
  },
});

const { DICTIONARIES, resolveLocaleFromLanguage, translate } = await import(
  pathToFileURL(join(testDist, 'i18n.mjs')).href
);

test('zh-TW, en, and ja dictionaries have identical keys and non-empty values', () => {
  const baseKeys = Object.keys(DICTIONARIES['zh-TW']).sort();
  for (const locale of ['en', 'ja']) {
    const keys = Object.keys(DICTIONARIES[locale]).sort();
    assert.deepEqual(keys, baseKeys, `Missing or extra keys in ${locale}`);
    for (const key of baseKeys) {
      assert.ok(DICTIONARIES[locale][key].trim().length > 0, `Empty translation for ${locale}.${key}`);
    }
  }
});

test('all placeholder tokens match across zh-TW, en, and ja', () => {
  const extractPlaceholders = (str) => [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(DICTIONARIES['zh-TW'])) {
    const baseTokens = extractPlaceholders(DICTIONARIES['zh-TW'][key]);
    for (const locale of ['en', 'ja']) {
      assert.deepEqual(
        extractPlaceholders(DICTIONARIES[locale][key]),
        baseTokens,
        `Placeholder mismatch in ${locale}.${key}`
      );
    }
  }
});

test('resolveLocaleFromLanguage maps browser languages to zh-TW, ja, or en', () => {
  assert.equal(resolveLocaleFromLanguage('zh-TW'), 'zh-TW');
  assert.equal(resolveLocaleFromLanguage('zh-Hant-HK'), 'zh-TW');
  assert.equal(resolveLocaleFromLanguage('zh-CN'), 'zh-TW');
  assert.equal(resolveLocaleFromLanguage('ja'), 'ja');
  assert.equal(resolveLocaleFromLanguage('ja-JP'), 'ja');
  assert.equal(resolveLocaleFromLanguage('en-US'), 'en');
  assert.equal(resolveLocaleFromLanguage('fr-FR'), 'en');
  assert.equal(resolveLocaleFromLanguage(null), 'en');
});

test('translate interpolates named parameters across locales', () => {
  assert.equal(translate('zh-TW', 'panel.downloadPng', { w: 512, h: 512 }), '下載 PNG (512×512)');
  assert.equal(translate('en', 'panel.downloadPng', { w: 512, h: 512 }), 'Download PNG (512×512)');
  assert.equal(translate('ja', 'panel.downloadPng', { w: 512, h: 512 }), 'PNG 保存 (512×512)');
});
