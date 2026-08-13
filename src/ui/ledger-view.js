/**
 * Screen 3 — evidence ledger (`bamboo ledger`).
 *
 * ID (3) · CLAIM (flex) · SOURCE · USED (right, 4). Header faint uppercase over a
 * faint rule. Verified sources are mint with a `✓ ` prefix; unverified are orange and
 * get a `└ ` note, because an unverified fact is the thing that blocks applications.
 */
import { PALETTE, columns, padEnd, padStart, paint, rule, width } from './theme.js';

export const COLS = { id: 3, used: 4, gap: 2 };

const g = ' '.repeat(COLS.gap);

/**
 * @param {{id: string, claim: string, source?: string, verified?: boolean,
 *          used?: number, blocked?: number}[]} entries
 */
export function ledgerTable(entries, total = columns()) {
  const sourceWidth = Math.min(
    34,
    Math.max(12, ...entries.map((e) => (e.source ?? 'no source').length + 2)),
  );
  const claimWidth = Math.max(20, total - COLS.id - COLS.gap * 3 - sourceWidth - COLS.used);

  const out = [];
  const header =
    paint(padEnd('ID', COLS.id), PALETTE.faint) +
    g +
    paint(padEnd('CLAIM', claimWidth), PALETTE.faint) +
    g +
    paint(padEnd('SOURCE', sourceWidth), PALETTE.faint) +
    g +
    paint(padStart('USED', COLS.used), PALETTE.faint);
  out.push(header);
  out.push(rule(Math.min(total, width(header))));

  for (const e of entries) {
    const claim = e.claim.length > claimWidth ? e.claim.slice(0, claimWidth - 1) + '…' : e.claim;
    const verified = e.verified !== false && Boolean(e.source);
    const sourceText = verified ? `✓ ${e.source}` : e.source || 'no source';
    const sourceTrimmed =
      sourceText.length > sourceWidth ? sourceText.slice(0, sourceWidth - 1) + '…' : sourceText;

    out.push(
      paint(padEnd(String(e.id), COLS.id), PALETTE.faint) +
        g +
        padEnd(paint(claim, PALETTE.text), claimWidth) +
        g +
        padEnd(paint(sourceTrimmed, verified ? PALETTE.mint : PALETTE.orange), sourceWidth) +
        g +
        paint(padStart(String(e.used ?? 0), COLS.used), PALETTE.textDim),
    );

    if (!verified) {
      const n = e.blocked ?? 0;
      const note = n
        ? `blocked ${n} application${n === 1 ? '' : 's'} this week. Add a source or drop it.`
        : 'add a source or drop it.';
      out.push(' '.repeat(COLS.id + COLS.gap) + paint(`└ ${note}`, PALETTE.faint));
    }
  }

  const verifiedCount = entries.filter((e) => e.verified !== false && e.source).length;
  const needs = entries.length - verifiedCount;
  out.push('');
  out.push(
    [
      paint(`${entries.length} entries`, PALETTE.muted),
      `${paint(String(verifiedCount), PALETTE.mint)} ${paint('verified', PALETTE.muted)}`,
      needs
        ? `${paint(String(needs), PALETTE.orange)} ${paint(
            `need${needs === 1 ? 's' : ''} a source`,
            PALETTE.muted,
          )}`
        : null,
    ]
      .filter(Boolean)
      .join(paint(' · ', PALETTE.faint)),
  );
  return out.join('\n');
}

/** Adapt ledger.json facts into the table's shape. */
export const factsToEntries = (facts) =>
  facts.map((f, i) => ({
    id: String(i + 1),
    claim: f.text,
    source: f.source ?? (f.verified ? 'self-reported' : ''),
    verified: f.verified !== false,
    used: f.used ?? 0,
    blocked: f.blocked ?? 0,
  }));
