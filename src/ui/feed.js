/**
 * Screen 2 — live feed (`bamboo watch`).
 *
 * Five aligned columns, two spaces minimum between them. Widths and colours are from
 * design_handoff_bamboo_cli/README.md, which calls them final.
 *
 *   timestamp   8   faint
 *   board      11   muted
 *   what     flex   text, location faint, whole row muted when skipped/expired
 *   score       3   right, mint >=70, orange 60-69, muted below or "—"
 *   verdict     9   same colour as the score
 */
import { PALETTE, columns, padEnd, padStart, paint, rule, width } from './theme.js';

export const COLS = { time: 8, board: 11, score: 3, verdict: 9, gap: 2 };

/** Column where the description starts -- reason lines indent to here. */
export const DESC_COL = COLS.time + COLS.gap + COLS.board + COLS.gap;

export const VERDICTS = ['drafted', 'skipped', 'needs you', 'expired'];

export function scoreColor(score) {
  if (score === null || score === undefined) return PALETTE.muted;
  if (score >= 70) return PALETTE.mint;
  if (score >= 60) return PALETTE.orange;
  return PALETTE.muted;
}

export const timestamp = (d = new Date()) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

/**
 * One posting row.
 * @param {{time?: string, board: string, company: string, role: string,
 *          location?: string, score?: number|null, verdict: string}} row
 */
export function feedRow(row, total = columns()) {
  const dimmed = row.verdict === 'skipped' || row.verdict === 'expired';
  const bodyColor = dimmed ? PALETTE.muted : PALETTE.text;
  const color = scoreColor(row.score);

  const time = paint(padEnd(row.time ?? timestamp(), COLS.time), PALETTE.faint);
  const board = paint(padEnd(row.board, COLS.board), PALETTE.muted);

  const descWidth = Math.max(
    20,
    total - DESC_COL - COLS.score - COLS.gap - COLS.verdict - COLS.gap,
  );
  const head = `${row.company} · ${row.role}`;
  const loc = row.location ? ` (${row.location})` : '';
  // Trim before painting so the ellipsis never lands inside an escape sequence.
  const room = descWidth - loc.length;
  const headTrimmed = head.length > room ? head.slice(0, Math.max(1, room - 1)) + '…' : head;
  const desc =
    paint(headTrimmed, bodyColor) + (loc ? paint(loc, dimmed ? PALETTE.muted : PALETTE.faint) : '');

  const scoreText = row.score === null || row.score === undefined ? '—' : String(row.score);
  const score = paint(padStart(scoreText, COLS.score), color);
  // Last column: pad OUTSIDE the paint, or the trailing spaces sit before the reset
  // escape and trimEnd() cannot reach them -- coloured rows would then be wider than
  // plain ones and every alignment assertion would drift.
  const verdict = padEnd(paint(row.verdict, color), COLS.verdict);

  const g = ' '.repeat(COLS.gap);
  return `${time}${g}${board}${g}${padEnd(desc, descWidth)}${g}${score}${g}${verdict}`.trimEnd();
}

/**
 * The `└ ` explanation under a row. Any `bamboo ...` command inside it is orange,
 * because the handoff's rule is that orange means bamboo speaking or asking.
 */
export function reasonLine(text) {
  const painted = String(text).replace(/(bamboo [\w -]+)/g, (m) => paint(m, PALETTE.orange));
  return ' '.repeat(DESC_COL) + paint('└ ', PALETTE.faint) + paint(painted, PALETTE.faint);
}

/**
 * Status bar under a full-width rule. Redrawn in place while watching.
 */
export function statusBar({ boards = 0, drafts = 0, seen = 0 } = {}, total = columns()) {
  const left = [
    `${paint('●', PALETTE.mint)} ${paint(`${boards} boards`, PALETTE.muted)}`,
    `${paint(String(drafts), PALETTE.orange)} ${paint('drafts waiting', PALETTE.muted)}`,
    paint(`${seen} seen today`, PALETTE.muted),
  ].join(paint(' · ', PALETTE.faint));

  const hints = [
    ['d', 'review drafts'],
    ['f', 'filter'],
    ['q', 'let the panda nap'],
  ]
    .map(([k, label]) => `${paint(k, PALETTE.textDim)} ${paint(label, PALETTE.faint)}`)
    .join('  ');

  const pad = Math.max(1, total - width(left) - width(hints));
  return `${rule(total)}\n${left}${' '.repeat(pad)}${hints}`;
}

/** Render a whole static feed. `watch` appends rows one at a time instead. */
export function feed(rows, status, total = columns()) {
  const out = [];
  for (const r of rows) {
    out.push(feedRow(r, total));
    if (r.reason) out.push(reasonLine(r.reason));
  }
  out.push('');
  out.push(statusBar(status, total));
  return out.join('\n');
}
