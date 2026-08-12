/**
 * Screen 4 — setup (`bamboo init`).
 *
 * Sequential prompts. Answered questions collapse to a mint check, the active one is
 * an orange `?` with a faint hint, and everything still to come renders entirely faint
 * so the eye lands on the one question being asked.
 *
 * Rendering only -- no stdin here, so the whole screen is a pure function of state and
 * can be tested without a TTY. The driver lives in src/ui/init.js.
 */
import { PALETTE, bg, colorEnabled, columns, padEnd, paint, reset, width } from './theme.js';

export const HIGHLIGHT_BG = '#33262a'; // dim orange, the terminal stand-in for rgba(232,120,63,.13)

/**
 * @param {{question: string, hint?: string, choices?: {label: string, count?: string}[],
 *          selected?: number[], cursor?: number, answer?: string, state: 'done'|'active'|'future'}} q
 */
export function question(q, total = columns()) {
  const out = [];

  if (q.state === 'done') {
    out.push(
      `${paint('✓', PALETTE.mint)} ${paint(q.question, PALETTE.muted)}  ${paint(
        q.answer ?? '',
        PALETTE.text,
      )}`,
    );
    return out.join('\n');
  }

  if (q.state === 'future') {
    out.push(`${paint('?', PALETTE.faint)} ${paint(q.question, PALETTE.faint)}`);
    return out.join('\n');
  }

  // active
  const hint = q.hint ? `  ${paint(q.hint, PALETTE.faint)}` : '';
  out.push(`${paint('?', PALETTE.orange)} ${paint(q.question, PALETTE.text)}${hint}`);

  (q.choices ?? []).forEach((c, i) => {
    const on = (q.selected ?? []).includes(i);
    const marker = paint(on ? '◉' : '◯', on ? PALETTE.mint : PALETTE.faint);
    const label = paint(c.label, PALETTE.text);
    const count = c.count ? `  ${paint(c.count, PALETTE.faint)}` : '';
    const body = `${marker} ${label}${count}`;

    if (i === q.cursor) {
      // 2-col orange left bar + a dim orange background across the row
      const bar = paint('▌', PALETTE.orange);
      const line = ` ${bar} ${body}`;
      const filled = padEnd(line, Math.max(0, total - 1));
      out.push(colorEnabled() ? `${bg(HIGHLIGHT_BG)}${filled}${reset()}` : `> ${body}`);
    } else {
      out.push(`   ${body}`);
    }
  });

  return out.join('\n');
}

/** `━` bar, filled orange, unfilled #3a3e50, plus `step N of M` in muted. */
export function progress(step, total, barWidth = 32) {
  const filled = Math.max(0, Math.min(barWidth, Math.round((step / total) * barWidth)));
  return (
    paint('━'.repeat(filled), PALETTE.orange) +
    paint('━'.repeat(barWidth - filled), '#3a3e50') +
    '  ' +
    paint(`step ${step} of ${total}`, PALETTE.muted)
  );
}

/**
 * Right sidebar, only at >=120 columns, separated by a faint vertical rule.
 * Numbers in the estimate copy are picked out in orange, and anything mint-worthy
 * (safety, verification) stays mint.
 */
export function sidebar(lines, height) {
  const body = ['PREVIEW', '', ...lines];
  return Array.from({ length: Math.max(height, body.length) }, (_, i) => {
    const raw = body[i];
    if (raw === undefined) return paint('│', PALETTE.faint);
    if (raw === 'PREVIEW') return `${paint('│', PALETTE.faint)}  ${paint('PREVIEW', PALETTE.faint)}`;
    const painted = String(raw)
      .replace(/(\d[\d,]*)/g, (m) => paint(m, PALETTE.orange))
      .replace(/(verified|dry run|nothing)/gi, (m) => paint(m, PALETTE.mint));
    return `${paint('│', PALETTE.faint)}  ${paint(painted, PALETTE.muted)}`;
  });
}

/**
 * Compose the whole screen: questions, progress, and the sidebar when there is room.
 */
export function initScreen({ questions, step, steps, preview = [] }, total = columns()) {
  const left = questions.map((q) => question(q, Math.min(total, 78))).join('\n');
  const body = [...left.split('\n'), '', progress(step, steps)];

  if (total < 120 || !preview.length) return ['', ...body, ''].join('\n');

  const side = sidebar(preview, body.length);
  const leftWidth = Math.max(...body.map(width)) + 4;
  return [
    '',
    ...body.map((l, i) => `${padEnd(l, leftWidth)}${side[i] ?? ''}`.trimEnd()),
    '',
  ].join('\n');
}
