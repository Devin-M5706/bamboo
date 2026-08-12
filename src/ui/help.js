/**
 * Screen 5 — help (`bamboo --help`).
 *
 * Two columns: command orange at width 7, description muted. Footer notes that dry run
 * is the default, with `--for-real` in mint -- the handoff is explicit that the DRY RUN
 * promise is product copy, not decoration.
 */
import { PALETTE, padEnd, paint } from './theme.js';

export const COMMAND_WIDTH = 7;

export const COMMANDS = [
  ['init', 'set up boards, cadence and where your ledger lives'],
  ['watch', 'follow new postings as they land, and draft for the good ones'],
  ['review', 'read what bamboo drafted before anything goes out'],
  ['apply', 'send the drafts you approved'],
  ['ledger', 'the facts bamboo is allowed to claim about you'],
  ['boards', 'which job boards are being watched'],
  ['status', 'what bamboo has been up to'],
  ['nap', 'stop watching'],
];

export function help() {
  const out = [''];
  for (const [cmd, desc] of COMMANDS) {
    out.push(`  ${paint(padEnd(cmd, COMMAND_WIDTH), PALETTE.orange)}  ${paint(desc, PALETTE.muted)}`);
  }
  out.push('');
  out.push(
    '  ' +
      paint('--dry-run is the default.', PALETTE.faint) +
      ' ' +
      paint('--for-real', PALETTE.mint) +
      paint(' is not.', PALETTE.faint),
  );
  out.push('');
  return out.join('\n');
}
