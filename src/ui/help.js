/**
 * Screen 5 — help (`bamboo help`).
 *
 * Two columns: command orange, description muted, per the design handoff.
 *
 * Two deliberate departures from that handoff, both because it described a surface that
 * was never built. It listed `review`, `apply`, `boards`, `status` and `nap` -- none of
 * which exist -- and omitted the fourteen commands that do, so `bamboo help` advertised
 * eight commands of which five failed. A help screen that lies is worse than no help
 * screen; you find out by typing one.
 *
 * COMMAND_WIDTH went from 7 to 12 for the same reason: `applications` is a real command
 * and did not fit the handoff's column.
 *
 * COMMANDS is pinned against the COMMANDS map in cli.js by test/cli-scripts.test.js, in
 * both directions, so this cannot drift again.
 */
import { DRY_RUN_DEFAULT } from '../config.js';
import { PALETTE, padEnd, paint } from './theme.js';

export const COMMAND_WIDTH = 12;

/**
 * Ordered by the workflow, not alphabetically: this is the order you actually run them
 * in, and the ordering is the only thing telling a first-time reader where to start.
 *
 * `install` is a deliberate omission -- it is an undocumented alias for `setup`, kept
 * only because it was published once, and advertising it invites the npm lifecycle
 * collision that broke global installs in 0.2.0.
 */
export const COMMANDS = [
  ['setup', 'create ~/.bamboo and seed the templates'],
  ['init', 'set up boards, cadence and where your ledger lives'],
  ['where', 'print every path on this machine'],
  ['ledger', 'the facts bamboo is allowed to claim about you'],
  ['check', 'preflight: ledger, answers, dropdowns, latency'],
  ['mine', 'find job board tokens from the aggregator'],
  ['poll', 'one pass over every board'],
  ['watch', 'follow new postings as they land'],
  ['queue', 'postings waiting on you, as a list'],
  ['feed', 'the same queue, as a live view'],
  ['survey', 'sample real application forms'],
  ['contacts', 'engineers at a company, and a LinkedIn search you click'],
  ['connect', 'one-time Google authorisation for your mailbox'],
  ['track', 'read the inbox for application receipts'],
  ['applications', 'what you have applied to, as a table'],
  ['banner', 'the startup banner'],
  ['help', 'this screen'],
];

export function help({ dryRun = DRY_RUN_DEFAULT } = {}) {
  const out = [''];
  for (const [cmd, desc] of COMMANDS) {
    out.push(`  ${paint(padEnd(cmd, COMMAND_WIDTH), PALETTE.orange)}  ${paint(desc, PALETTE.muted)}`);
  }
  out.push('');
  // Read from the same constant the applier reads, so this line cannot claim one thing
  // while the code does another. The handoff is explicit that the dry run promise is
  // product copy rather than decoration -- which makes it exactly the wrong thing to
  // hardcode in a second place.
  out.push(
    dryRun
      ? '  ' + paint('Dry run is the default.', PALETTE.faint) + ' ' + paint('Nothing is submitted until you say so.', PALETTE.mint)
      : '  ' + paint('LIVE.', PALETTE.orange) + ' ' + paint('Applications are submitted.', PALETTE.faint) + ' ' + paint('--dry-run', PALETTE.mint) + paint(' to fill without submitting.', PALETTE.faint),
  );
  out.push('');
  return out.join('\n');
}
