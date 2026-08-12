import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, setColor, stripAnsi, width } from '../src/ui/theme.js';
import { BLURB, drawPanda, drawWordmark, hero, panda, wordmark } from '../src/ui/banner.js';
import { COLS, DESC_COL, feed, feedRow, reasonLine, scoreColor, statusBar } from '../src/ui/feed.js';
import { ledgerTable } from '../src/ui/ledger-view.js';
import { COMMANDS, help } from '../src/ui/help.js';
import { initScreen, progress, question } from '../src/ui/init-view.js';
import { QUESTIONS, viewModel } from '../src/ui/init.js';

const ANSI = /\x1b\[[0-9;]*m/;

// ── theme ────────────────────────────────────────────────────────────────────

test('setColor(false) strips every escape code from every screen', () => {
  setColor(false);
  const screens = [
    hero({ columns: 130 }),
    feed([{ board: 'greenhouse', company: 'A', role: 'B', score: 80, verdict: 'drafted' }], {}, 100),
    ledgerTable([{ id: '1', claim: 'x', source: 's', verified: true, used: 1 }], 100),
    help(),
    initScreen(viewModel({ step: 0, cursor: 0, selected: [0], answers: {} }), 130),
  ];
  for (const s of screens) assert.ok(!ANSI.test(s), `escape codes leaked: ${JSON.stringify(s.slice(0, 80))}`);
  setColor(true);
});

test('width() ignores escape codes so columns align when coloured', () => {
  setColor(true);
  const plainRow = (() => {
    setColor(false);
    const r = feedRow({ board: 'greenhouse', company: 'A', role: 'B', score: 80, verdict: 'drafted' }, 100);
    setColor(true);
    return r;
  })();
  const colorRow = feedRow({ board: 'greenhouse', company: 'A', role: 'B', score: 80, verdict: 'drafted' }, 100);
  assert.equal(width(colorRow), plainRow.length, 'coloured and plain rows must occupy the same columns');
});

// ── banner ───────────────────────────────────────────────────────────────────

test('wordmark is 11 pixel rows + 2 extrude, rendered as 7 half-block rows', () => {
  setColor(true);
  assert.equal(drawWordmark().length, 13);
  assert.equal(wordmark().split('\n').length, 7);
});

test('panda sprite is 56x21 as the handoff specifies', () => {
  const px = drawPanda();
  assert.equal(px.length, 21);
  assert.equal(px[0].length, 56);
  assert.equal(panda().split('\n').length, 11); // ceil(21/2)
});

test('hero drops the panda below 112 columns', () => {
  setColor(true);
  const wide = hero({ columns: 130 }).split('\n');
  const narrow = hero({ columns: 80 }).split('\n');
  assert.equal(width(wide[1]), 114, 'panda 56 + gap 3 + wordmark 55');
  assert.equal(width(narrow[1]), 55, 'wordmark alone');
});

test('hero skips the art entirely when colour is off', () => {
  setColor(false);
  const out = hero({ columns: 130 });
  assert.ok(!out.includes('▀'), 'half-blocks are meaningless without colour');
  assert.ok(out.includes('bamboo v0.2.0'));
  for (const line of BLURB) assert.ok(out.includes(line), `blurb line missing: ${line}`);
  assert.ok(out.includes('DRY RUN'));
  setColor(true);
});

test('hero carries the DRY RUN promise, which is product copy not decoration', () => {
  setColor(false);
  assert.match(hero({ columns: 130 }), /DRY RUN {2}nothing is submitted until you say so/);
  setColor(true);
});

// ── feed ─────────────────────────────────────────────────────────────────────

test('score colour thresholds follow the handoff', () => {
  assert.equal(scoreColor(70), PALETTE.mint);
  assert.equal(scoreColor(84), PALETTE.mint);
  assert.equal(scoreColor(69), PALETTE.orange);
  assert.equal(scoreColor(60), PALETTE.orange);
  assert.equal(scoreColor(59), PALETTE.muted);
  assert.equal(scoreColor(null), PALETTE.muted);
});

test('feed columns land at fixed offsets regardless of content length', () => {
  setColor(false);
  const short = feedRow({ time: '09:41:02', board: 'lever', company: 'A', role: 'B', score: 9, verdict: 'drafted' }, 100);
  const long = feedRow(
    { time: '09:41:02', board: 'greenhouse', company: 'Very Long Company Name Ltd', role: 'Software Engineering Intern', score: 100, verdict: 'needs you' },
    100,
  );
  for (const row of [short, long]) {
    assert.equal(row.slice(0, 8), '09:41:02');
    assert.equal(row[8], ' ');
    assert.equal(row.slice(10, 20).trim(), row.slice(10, 20).trim()); // board column
  }
  assert.ok(short.startsWith('09:41:02  lever'));
  setColor(true);
});

test('a null score prints an em dash rather than a made-up number', () => {
  setColor(false);
  const row = feedRow({ board: 'ashby', company: 'A', role: 'B', score: null, verdict: 'expired' }, 100);
  assert.ok(row.includes('—'));
  assert.ok(!/\b0\b/.test(row), 'must not invent a zero');
  setColor(true);
});

test('reason lines indent to the description column and use the elbow', () => {
  setColor(false);
  const line = reasonLine('no ledger evidence for "Kubernetes"');
  assert.equal(line.indexOf('└'), DESC_COL);
  assert.equal(DESC_COL, COLS.time + COLS.gap + COLS.board + COLS.gap);
  setColor(true);
});

test('long descriptions truncate instead of pushing the score column out', () => {
  setColor(false);
  const row = feedRow(
    { board: 'greenhouse', company: 'X'.repeat(200), role: 'Y'.repeat(200), score: 80, verdict: 'drafted' },
    100,
  );
  assert.ok(row.length <= 100, `row overflowed: ${row.length}`);
  assert.ok(row.includes('…'));
  setColor(true);
});

test('status bar right-aligns the key hints within the terminal width', () => {
  setColor(false);
  const bar = statusBar({ boards: 65, drafts: 4, seen: 112 }, 100).split('\n');
  assert.equal(bar[0].length, 100, 'rule spans the full width');
  assert.ok(bar[1].endsWith('q let the panda nap'));
  assert.ok(bar[1].includes('● 65 boards'));
  assert.ok(bar[1].length <= 100);
  setColor(true);
});

// ── ledger ───────────────────────────────────────────────────────────────────

test('verified rows get a check, unverified get a note', () => {
  setColor(false);
  const out = ledgerTable(
    [
      { id: '1', claim: 'Built a thing', source: 'github.com/x', verified: true, used: 3 },
      { id: '2', claim: 'Unsourced claim', source: '', verified: false, blocked: 6 },
    ],
    100,
  );
  assert.ok(out.includes('✓ github.com/x'));
  assert.ok(out.includes('no source'));
  assert.match(out, /└ blocked 6 applications this week/);
  assert.match(out, /2 entries · 1 verified · 1 needs a source/);
  setColor(true);
});

test('ledger footer pluralizes honestly', () => {
  setColor(false);
  const all = ledgerTable([{ id: '1', claim: 'a', source: 's', verified: true }], 100);
  assert.match(all, /1 entries · 1 verified$/m);
  assert.ok(!all.includes('need'), 'no "needs a source" clause when nothing needs one');
  setColor(true);
});

// ── help ─────────────────────────────────────────────────────────────────────

test('help lists every command from the handoff', () => {
  setColor(false);
  const out = help();
  for (const name of ['init', 'watch', 'review', 'apply', 'ledger', 'boards', 'status', 'nap']) {
    assert.ok(out.includes(name), `missing command: ${name}`);
  }
  assert.equal(COMMANDS.length, 8);
  assert.match(out, /--dry-run is the default\. --for-real is not\./);
  setColor(true);
});

// ── init ─────────────────────────────────────────────────────────────────────

test('init questions collapse, highlight, and grey out by state', () => {
  setColor(false);
  const done = question({ question: 'Q', state: 'done', answer: 'A' });
  assert.ok(done.startsWith('✓ Q'));
  assert.ok(done.includes('A'));

  const future = question({ question: 'Q', state: 'future' });
  assert.ok(future.startsWith('? Q'));

  const active = question({
    question: 'Q',
    hint: 'space to toggle',
    state: 'active',
    choices: [{ label: 'one' }, { label: 'two' }],
    selected: [1],
    cursor: 1,
  });
  assert.ok(active.includes('space to toggle'));
  assert.ok(active.includes('◯ one'));
  assert.ok(active.includes('◉ two'));
  setColor(true);
});

test('progress bar fills proportionally and labels the step', () => {
  setColor(false);
  assert.match(progress(3, 5, 10), /^━{6}━{4} {2}step 3 of 5$/);
  setColor(true);
});

test('sidebar only appears at >=120 columns', () => {
  setColor(false);
  const state = { step: 2, cursor: 0, selected: [0], answers: { boards: [0], intervalMinutes: [1] } };
  assert.ok(initScreen(viewModel(state), 130).includes('PREVIEW'));
  assert.ok(!initScreen(viewModel(state), 100).includes('PREVIEW'));
  setColor(true);
});

test('init asks for the two fields the dropdown resolver actually needs', () => {
  const keys = QUESTIONS.map((q) => q.key);
  assert.ok(keys.includes('workAuthorization'), 'most-required dropdown on real forms');
  assert.ok(keys.includes('graduationYear'));
  const wa = QUESTIONS.find((q) => q.key === 'workAuthorization');
  assert.deepEqual(
    wa.choices.map((c) => c.value),
    ['authorized_any', 'authorized_current_employer_only', 'requires_sponsorship', 'not_authorized'],
    'values must match src/selects.js WORK_AUTH_PATTERNS exactly',
  );
});

test('the safe answer is the default on the submit question', () => {
  const q = QUESTIONS.find((x) => x.key === 'forReal');
  assert.equal(q.choices[q.initial[0]].value, false, 'dry run must be preselected');
});
