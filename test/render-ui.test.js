import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromeCandidates, clipFromBoxModel, findChrome } from '../scripts/render-ui.js';

/**
 * These cover the parts that decide what an image looks like, without launching a
 * browser -- CI has no Chrome, and a test that needs one would be skipped everywhere
 * and therefore protect nothing.
 */

test('CHROME_PATH wins over every guess', () => {
  const candidates = chromeCandidates('linux', { CHROME_PATH: '/opt/pinned/chrome' });
  assert.deepEqual(candidates, ['/opt/pinned/chrome']);
});

test('every platform offers somewhere to look', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const candidates = chromeCandidates(platform, {});
    assert.ok(candidates.length > 0, `${platform} has no candidates`);
    assert.ok(
      candidates.every((c) => typeof c === 'string' && c.length),
      `${platform} produced an empty candidate`,
    );
  }
});

test('windows candidates honour relocated Program Files', () => {
  const candidates = chromeCandidates('win32', {
    ProgramFiles: 'D:\\Apps',
    'ProgramFiles(x86)': 'D:\\Apps (x86)',
    LOCALAPPDATA: 'D:\\Users\\me\\AppData\\Local',
  });
  assert.ok(
    candidates.some((c) => c.startsWith('D:\\Apps')),
    'a machine with Windows installed on D: finds nothing at C:\\Program Files',
  );
  assert.ok(candidates.some((c) => c.includes('msedge')), 'Edge is the reliable fallback on Windows');
});

test('findChrome returns null rather than a path that does not exist', async () => {
  const missing = path.join(path.sep, 'nope', 'not-a-browser');
  assert.equal(await findChrome([missing]), null);
});

test('findChrome picks the first candidate that is actually there', async () => {
  // This file exists; the point is that it takes the first hit, not the first entry.
  const real = new URL('./render-ui.test.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  assert.equal(await findChrome(['/nope/first', real]), real);
});

test('clip covers the whole element, rounding outward', () => {
  // Quad from CDP: clockwise from top-left, with sub-pixel bounds.
  const model = { border: [10.4, 20.6, 110.2, 20.6, 110.2, 70.9, 10.4, 70.9] };
  const clip = clipFromBoxModel(model);

  assert.equal(clip.x, 10, 'origin rounds down');
  assert.equal(clip.y, 20);
  assert.ok(clip.x + clip.width >= 110.2, 'right edge must not be cropped');
  assert.ok(clip.y + clip.height >= 70.9, 'bottom edge must not be cropped');
  assert.equal(clip.scale, 1, 'the committed PNGs are 1x; changing this rescales every image');
});

test('clip handles an element that is not at the origin', () => {
  const model = { border: [0, 0, 200, 0, 200, 100, 0, 100] };
  assert.deepEqual(clipFromBoxModel(model), { x: 0, y: 0, width: 200, height: 100, scale: 1 });
});
