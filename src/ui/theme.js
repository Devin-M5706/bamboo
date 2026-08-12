/**
 * Design tokens from design_handoff_bamboo_cli/README.md.
 *
 * Rule of thumb from the handoff, and it is worth keeping:
 *   orange = bamboo speaking or asking
 *   mint   = something verified or safe
 *   faint  = metadata
 * Never colour body copy in anything else.
 *
 * Every screen writes through these helpers. No raw ANSI codes anywhere else, so
 * `--no-color` and NO_COLOR have exactly one place to switch off.
 */

export const PALETTE = {
  bg: '#1f212d',
  text: '#d7dae5',
  textDim: '#9a9eb0',
  muted: '#7f8698',
  faint: '#565b6e',
  orange: '#e8783f',
  orangeLit: '#fbc79f',
  orangeDim: '#d55c17',
  extrude: '#5d2309',
  mint: '#4fc3a1',
};

const ESC = '\x1b';
export const RESET = `${ESC}[0m`;
export const BOLD = `${ESC}[1m`;

export const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** Module-level switch. Set once at startup; every helper below respects it. */
let enabled = true;
export function setColor(on) {
  enabled = Boolean(on);
}
export function colorEnabled() {
  return enabled;
}

export const fg = (h) => (enabled ? `${ESC}[38;2;${hex(h).join(';')}m` : '');
export const bg = (h) => (enabled ? `${ESC}[48;2;${hex(h).join(';')}m` : '');
export const reset = () => (enabled ? RESET : '');
export const bold = () => (enabled ? BOLD : '');

/** Paint a string and close it. The only way any screen should colour text. */
export const paint = (text, color, { strong = false } = {}) =>
  enabled ? `${fg(color)}${strong ? BOLD : ''}${text}${RESET}` : String(text);

export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
export const width = (s) => stripAnsi(s).length;

/** Pad to a visible width, ignoring escape codes. */
export function padEnd(s, n) {
  const w = width(s);
  return w >= n ? s : s + ' '.repeat(n - w);
}
export function padStart(s, n) {
  const w = width(s);
  return w >= n ? s : ' '.repeat(n - w) + s;
}

/** Truncate to a visible width, appending an ellipsis when it actually cuts. */
export function truncate(s, n) {
  const plain = stripAnsi(s);
  if (plain.length <= n) return s;
  if (plain !== s) return s; // don't slice mid-escape; caller should trim before painting
  return n <= 1 ? plain.slice(0, n) : plain.slice(0, n - 1) + '…';
}

export const columns = () => process.stdout.columns || 80;

/**
 * Colour is opt-out: NO_COLOR, a non-TTY pipe, or --no-color all disable it.
 * FORCE_COLOR overrides, which is what makes the screens testable.
 */
export function shouldUseColor(argv = process.argv, stream = process.stdout) {
  if (argv.includes('--no-color')) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}

export const rule = (n = columns()) => paint('─'.repeat(Math.max(0, n)), PALETTE.faint);
