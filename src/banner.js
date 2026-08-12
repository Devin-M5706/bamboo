/**
 * Startup banner: pixel wordmark + red panda mascot + session info.
 *
 * Colour is opt-out. NO_COLOR, a non-TTY stdout, or --no-banner all degrade to plain
 * text, because a banner that corrupts piped output is worse than no banner.
 */

const ESC = '';
const RESET = `${ESC}[0m`;
const fg = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return `${ESC}[38;2;${r};${g};${b}m`;
};
const bg = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return `${ESC}[48;2;${r};${g};${b}m`;
};
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const THEME = {
  panda: '#E8763A',
  pandaDark: '#A8471C',
  pandaBody: '#5A3524',
  cream: '#F7EFE6',
  ink: '#241610',
  wordmark: '#E8763A',
  dim: '#8A8A8A',
  accent: '#4FC3A1',
};

// 5x7 pixel font. Chunky on purpose -- rendered two columns wide per pixel.
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

export function wordmark(text, { color = THEME.wordmark, plain = false } = {}) {
  const glyphs = [...text.toUpperCase()].map((c) => FONT[c] ?? FONT[' ']);
  const rows = [];
  for (let r = 0; r < 7; r++) {
    let line = '';
    for (const g of glyphs) {
      line += [...g[r]].map((p) => (p === '1' ? '██' : '  ')).join('') + '  ';
    }
    rows.push(plain ? line.replace(/█/g, '#').trimEnd() : `${fg(color)}${line.trimEnd()}${RESET}`);
  }
  return rows;
}

/**
 * Red panda, 14x16 pixels. Rendered with the half-block trick: each character cell is
 * two vertical pixels -- foreground on ▀, background underneath -- so the sprite stays
 * square instead of stretched to terminal cell aspect.
 */
const PANDA = [
  '..oo......oo..',
  '.owwo....owwo.',
  '..oooooooooo..',
  '.oooooooooooo.',
  'oooooooooooooo',
  'ookooooooookoo',
  'oooooooooooooo',
  '..oowwwwwwoo..',
  '..owwwkkwwwo..',
  '..owwwwwwwwo..',
  '...oooooooo...',
  '..dddddddddd..',
  '.dddddddddddd.',
  'rdddddddddddd.',
  'orddddddddddd.',
  'rr..dd....dd..',
];

const PIXELS = {
  o: THEME.panda,
  r: THEME.pandaDark,
  d: THEME.pandaBody,
  w: THEME.cream,
  k: THEME.ink,
};

export function sprite({ plain = false } = {}) {
  if (plain) return PANDA.map((row) => row.replace(/\./g, ' '));
  const rows = [];
  for (let y = 0; y < PANDA.length; y += 2) {
    const top = PANDA[y];
    const bottomRow = PANDA[y + 1] ?? '.'.repeat(top.length);
    let line = '';
    for (let x = 0; x < top.length; x++) {
      const t = PIXELS[top[x]];
      const b = PIXELS[bottomRow[x]];
      if (!t && !b) line += ' ';
      else if (t && b) line += `${fg(t)}${bg(b)}▀${RESET}`;
      else if (t) line += `${fg(t)}▀${RESET}`;
      else line += `${fg(b)}▄${RESET}`;
    }
    rows.push(line);
  }
  return rows;
}

const visibleLength = (s) => s.replace(/\[[0-9;]*m/g, '').length;

/**
 * Compose the full banner. `info` lines render to the right of the wordmark.
 */
export function banner({
  name = 'bamboo',
  version = '0.0.0',
  info = [],
  plain = false,
  color = THEME.wordmark,
} = {}) {
  const mark = wordmark(name, { color, plain });
  const markWidth = Math.max(...mark.map(visibleLength));
  const gap = '   ';

  const out = [];
  const headline = plain
    ? `${name} v${version}`
    : `${fg(color)}${name}${RESET} ${fg(THEME.dim)}v${version}${RESET}`;
  const right = [headline, '', ...info];

  for (let i = 0; i < Math.max(mark.length, right.length); i++) {
    const left = mark[i] ?? '';
    const pad = ' '.repeat(Math.max(0, markWidth - visibleLength(left)));
    const r = right[i] ?? '';
    out.push((left + pad + (r ? gap + r : '')).trimEnd());
  }

  out.push('');
  const paws = sprite({ plain });
  const label = [
    plain ? name : `${fg(THEME.cream)}${name}${RESET}`,
    plain ? 'red panda on shift' : `${fg(THEME.dim)}red panda on shift${RESET}`,
    '',
    '',
  ];
  for (let i = 0; i < paws.length; i++) {
    const l = label[i] ?? '';
    out.push((paws[i] + (l ? '   ' + l : '')).trimEnd());
  }
  return out.join('\n');
}

export function shouldUseColor(stream = process.stdout) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}
