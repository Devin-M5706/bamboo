/**
 * Glue between the pipeline's data and the handoff's screens.
 *
 * The view modules stay pure and data-shaped; this file is where real postings, real
 * ledger facts and real validator refusals get mapped onto them.
 */
import { PALETTE, paint } from './theme.js';
import { feedRow, reasonLine, statusBar, timestamp } from './feed.js';
import { factsToEntries, ledgerTable } from './ledger-view.js';

/**
 * Turn a queue item into a feed row.
 *
 * The score is a match heuristic, not a promise; where we have nothing to score on we
 * print `—` rather than inventing a number, which is the same discipline the validator
 * applies to text.
 */
export function postingToRow(item, { verdict, score = null } = {}) {
  const [company, ...rest] = String(item.board ?? '').split('-');
  return {
    time: timestamp(new Date(item.queuedAt ?? Date.now())),
    board: item.vendor ?? 'unknown',
    company: item.company ?? item.board ?? company ?? 'unknown',
    role: item.title ?? '',
    location: item.location || '',
    score,
    verdict: verdict ?? statusToVerdict(item),
  };
}

export function statusToVerdict(item) {
  if (item.dropReason) return 'skipped';
  if (item.deadline && item.deadline < Date.now()) return 'expired';
  if (item.status === 'drafted') return 'drafted';
  return 'needs you';
}

/** Render queued postings as the live-feed screen. */
export function queueScreen(items, { boards = 0, seen = 0 } = {}, total) {
  const out = [];
  for (const item of items) {
    const row = postingToRow(item);
    out.push(feedRow(row, total));
    if (item.dropReason) out.push(reasonLine(item.dropReason));
    else if (item.eligibilityVerified === false) {
      out.push(reasonLine('eligibility not verified — no description available'));
    }
  }
  if (!items.length) {
    out.push(paint('  nothing queued yet. the panda is still watching.', PALETTE.faint));
  }
  out.push('');
  out.push(
    statusBar(
      { boards, drafts: items.filter((i) => i.status === 'pending').length, seen },
      total,
    ),
  );
  return out.join('\n');
}

/** Render the evidence ledger from data/ledger.json facts. */
export function ledgerScreen(facts, total) {
  if (!facts.length) {
    return [
      '',
      paint('  Your ledger is empty.', PALETTE.text),
      paint('  Nothing can be claimed on your behalf until you write it.', PALETTE.faint),
      '',
      `  ${paint('cp data/ledger.example.json data/ledger.json', PALETTE.orange)}`,
      '',
    ].join('\n');
  }
  return ['', ledgerTable(factsToEntries(facts), total), ''].join('\n');
}
