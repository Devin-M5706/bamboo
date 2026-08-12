import test from 'node:test';
import assert from 'node:assert/strict';
import { banner, sprite, wordmark } from '../src/banner.js';

const ANSI = /\[[0-9;]*m/;
const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, '');

test('wordmark renders 7 rows for any name', () => {
  for (const name of ['shoot', 'wah', 'jobapplr', 'pounce']) {
    assert.equal(wordmark(name).length, 7, `${name} should render 7 rows`);
  }
});

test('wordmark covers the whole alphabet without falling back to blanks', () => {
  const rows = wordmark('abcdefghijklmnopqrstuvwxyz', { plain: true });
  // A blank glyph would leave a run of spaces the width of a character cell.
  const solid = rows.join('').replace(/[\s]/g, '');
  assert.ok(solid.length > 300, 'every letter should contribute pixels');
});

test('plain mode emits no escape codes', () => {
  const out = banner({ name: 'shoot', version: '1.0.0', plain: true, info: ['hello'] });
  assert.ok(!ANSI.test(out), 'plain banner must be pipe-safe');
  assert.ok(out.includes('shoot v1.0.0'));
  assert.ok(out.includes('hello'));
});

test('colour mode emits 24-bit colour and always resets', () => {
  const out = banner({ name: 'shoot', version: '1.0.0' });
  assert.ok(ANSI.test(out));
  assert.ok(out.includes('[38;2;'), 'should use truecolor foreground');
  const opens = (out.match(/\[[34]8;2;/g) ?? []).length;
  const resets = (out.match(/\[0m/g) ?? []).length;
  assert.ok(resets >= opens / 2, 'every styled run should be reset');
  assert.ok(out.trimEnd().endsWith('[0m') || !ANSI.test(out.slice(-8)), 'must not leak style past the banner');
});

test('sprite is 8 rows of half-blocks from a 16-row pixel grid', () => {
  const rows = sprite();
  assert.equal(rows.length, 8);
  const plainRows = sprite({ plain: true });
  assert.equal(plainRows.length, 16);
  const widths = new Set(plainRows.map((r) => r.length));
  assert.equal(widths.size, 1, 'every sprite row must be the same width');
});

test('sprite uses only half-block glyphs and spaces', () => {
  for (const row of sprite()) {
    const glyphs = new Set(stripAnsi(row).split(''));
    for (const g of glyphs) {
      assert.ok(['▀', '▄', ' '].includes(g), `unexpected glyph ${JSON.stringify(g)}`);
    }
  }
});

test('banner right column does not overlap the wordmark', () => {
  const out = banner({ name: 'wah', version: '0.1.0', plain: true, info: ['INFO-MARKER'] });
  const line = out.split('\n').find((l) => l.includes('INFO-MARKER'));
  assert.ok(line, 'info line should render');
  // The marker must start after the wordmark block, not inside it.
  assert.ok(line.indexOf('INFO-MARKER') > line.lastIndexOf('#'), 'info must sit right of the wordmark');
});

test('no trailing whitespace on any line', () => {
  const out = banner({ name: 'shoot', version: '1.0.0', plain: true, info: ['x'] });
  for (const line of out.split('\n')) {
    assert.equal(line, line.trimEnd(), `trailing whitespace: ${JSON.stringify(line)}`);
  }
});
