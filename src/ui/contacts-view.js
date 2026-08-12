/**
 * Screen — `bamboo contacts <company>`.
 *
 * Two halves, visually distinct on purpose:
 *   fetched   engineers from GitHub's public API (mint = verified, safe)
 *   to click  LinkedIn searches YOU open (orange = bamboo asking you to do something)
 *
 * The colour split is the handoff's rule doing real work here: mint means we verified
 * it, orange means bamboo needs you. Nothing on this screen was scraped.
 */
import { PALETTE, padEnd, paint, rule } from './theme.js';

export function contactsScreen({ company, engineers, org, searches, reason }, total = 80) {
  const out = [''];

  out.push(`  ${paint('contacts at', PALETTE.faint)} ${paint(company, PALETTE.text, { strong: true })}`);
  out.push('');

  // ── engineers, actually fetched ──────────────────────────────────────────
  if (engineers?.length) {
    out.push(`  ${paint('✓', PALETTE.mint)} ${paint(`engineers · github.com/${org}`, PALETTE.muted)}`);
    out.push('  ' + rule(Math.min(total - 4, 72)));
    for (const p of engineers) {
      const handle = paint(padEnd(`@${p.login}`, 20), PALETTE.mint);
      const name = paint(padEnd(p.name.slice(0, 24), 25), PALETTE.text);
      out.push(`  ${handle}${name}${paint(p.url, PALETTE.faint)}`);
      if (p.bio) out.push(`  ${' '.repeat(20)}${paint(p.bio.slice(0, 60), PALETTE.faint)}`);
    }
  } else {
    out.push(`  ${paint('·', PALETTE.faint)} ${paint(reason ?? 'no public GitHub org found', PALETTE.faint)}`);
  }

  out.push('');

  // ── LinkedIn, for the user to click ──────────────────────────────────────
  out.push(`  ${paint('→', PALETTE.orange)} ${paint('open these yourself, logged in', PALETTE.muted)}`);
  out.push(
    `  ${paint('bamboo does not fetch LinkedIn: automated access breaks their terms and', PALETTE.faint)}`,
  );
  out.push(`  ${paint('gets accounts restricted. One click each, no automation, no risk.', PALETTE.faint)}`);
  out.push('  ' + rule(Math.min(total - 4, 72)));

  let lastRole = null;
  for (const s of searches) {
    if (s.role !== lastRole) {
      out.push(`  ${paint(s.role.replace(/_/g, ' '), PALETTE.orange)}`);
      lastRole = s.role;
    }
    out.push(`    ${paint(padEnd(s.keyword, 26), PALETTE.textDim)}${paint(s.url, PALETTE.faint)}`);
  }

  out.push('');
  return out.join('\n');
}
