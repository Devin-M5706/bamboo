/**
 * Terminal banner: BAMBOO wordmark + sleeping red panda.
 *
 * Ported from design_handoff_bamboo_cli/banner.js to ESM. The glyph maps, the panda
 * grid, the gradient stops and the extrude offset are copied verbatim -- the handoff
 * calls those final, so this file adapts the plumbing and changes none of the art.
 *
 * Sprites are pixel grids rendered with Unicode upper-half-blocks: foreground colour is
 * the upper pixel, background the lower, so one text row carries two sprite rows and the
 * art keeps a square-pixel aspect ratio.
 *
 * Added here beyond the handoff: the plain-text fallback for NO_COLOR / non-TTY / pipes,
 * which the handoff specifies but leaves to the implementation.
 */
import { PALETTE, RESET, bg, colorEnabled, fg, hex, paint } from './theme.js';

const S = '######';
const H = '##..##';
const M = '##....##';

const GLYPHS = {
  B: ['######', '######', H, H, '#####.', '#####.', H, H, H, '######', '######'],
  A: ['######', '######', H, H, H, '######', '######', H, H, H, H],
  M: ['##....##', '###..###', '########', '########', '##.##.##', '##.##.##', M, M, M, M, M],
  O: ['######', '######', H, H, H, H, H, H, H, '######', '######'],
};

const PANDA_PALETTE = ['#f28c1e', '#ffffff', '#171717', '#6b6b6b'];
const PANDA = [
  '....222................222.......222222222..............',
  '...22332..............23332...22200000000022............',
  '...233322.............23332...222000000000222...........',
  '..21333332..........22331112220000000000000002222.......',
  '..211133322222222222223311122000000000000000002002......',
  '..211133322222222222223311122000000000000000002002......',
  '..21111330000000000000311112200000000000000000200022....',
  '..21110000000000000000001122200000000000000000200022....',
  '...20000000000000000000000200000000000000000000220002...',
  '...20000000000000000000000200000000000000000000220002...',
  '..20000000000000000000000002200000000000000000022000022.',
  '..20000000000000000000000002200000000000000000022000022.',
  '..20000000000000000000000002200000000000000000022000023.',
  '..200000000000000000000000022000000000000000000220001112',
  '..200000000000000000000000022000000000000000000002111112',
  '..200022220001110002222000022000000022000000000003211112',
  '..200022220001110002222000022000000022200000000003221112',
  '2200000000011222100000000000020000000332000000033322222.',
  '22000000000111111000000000000200000033322222222222......',
  '22000000000111111000000000000200000033322222222222......',
  '..2222222222222222222222222222222222222.................',
];

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** Vertical gradient across the wordmark, light at the top. */
function gradientAt(t) {
  const stops = [
    [0, hex(PALETTE.orangeLit)],
    [0.4, hex(PALETTE.orange)],
    [1, hex(PALETTE.orangeDim)],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const k = (t - p0) / (p1 - p0 || 1);
      return '#' + [0, 1, 2].map((j) => lerp(c0[j], c1[j], k).toString(16).padStart(2, '0')).join('');
    }
  }
  return PALETTE.orangeDim;
}

const canvas = (w, h) => Array.from({ length: h }, () => new Array(w).fill(null));

export function drawWordmark(word = 'BAMBOO', gap = 3, extrude = 2) {
  const rows = GLYPHS.B.length;
  let width = -gap;
  for (const ch of word) width += GLYPHS[ch][0].length + gap;
  const px = canvas(width + extrude, rows + extrude);
  const stamp = (dx, dy, colorFor) => {
    let ox = 0;
    for (const ch of word) {
      const g = GLYPHS[ch];
      g.forEach((row, y) =>
        [...row].forEach((c, i) => {
          if (c === '#') px[y + dy][ox + i + dx] = colorFor(y, rows);
        }),
      );
      ox += g[0].length + gap;
    }
  };
  stamp(extrude, extrude, () => PALETTE.extrude); // drop shadow, +2 down/right
  stamp(0, 0, (y, n) => gradientAt(y / (n - 1)));
  return px;
}

export const drawPanda = () =>
  PANDA.map((row) => [...row].map((c) => (c === '.' ? null : PANDA_PALETTE[+c])));

/** Two pixel rows per text row: foreground = upper pixel, background = lower. */
export function toLines(px, ground = PALETTE.bg) {
  const lines = [];
  for (let y = 0; y < px.length; y += 2) {
    let out = '';
    for (let x = 0; x < px[y].length; x++) {
      const top = px[y][x] || ground;
      const bot = (px[y + 1] && px[y + 1][x]) || ground;
      out += fg(top) + bg(bot) + '▀';
    }
    lines.push(out + RESET);
  }
  return lines;
}

/** Side by side, bottom aligned, separated by transparent columns. */
function beside(a, b, gap = 3) {
  const h = Math.max(a.length, b.length);
  const top = (px) =>
    Array.from({ length: h - px.length }, () => new Array(px[0].length).fill(null)).concat(px);
  const A = top(a);
  const B = top(b);
  return A.map((row, y) => row.concat(new Array(gap).fill(null), B[y]));
}

export const wordmark = () => toLines(drawWordmark()).join('\n');
export const panda = () => toLines(drawPanda()).join('\n');

export const BLURB = [
  'Watching 65 job boards so you never have to hit refresh again.',
  'Applications are filled from your evidence ledger. Anything it',
  "can't trace back to a verified fact, it won't claim.",
];

/**
 * Full startup block.
 *
 * Below 112 columns the panda is dropped and the wordmark prints alone, per the
 * handoff. With colour off, the art is skipped entirely and only the copy prints --
 * half-blocks without colour are meaningless noise in a pipe.
 */
export function hero({ version = 'v0.2.0', columns = process.stdout.columns || 80 } = {}) {
  const head = `${paint('bamboo', PALETTE.orange, { strong: true })} ${paint(version, PALETTE.faint)}`;
  const dryRun = `${paint('DRY RUN', PALETTE.mint, { strong: true })}  ${paint(
    'nothing is submitted until you say so',
    PALETTE.textDim,
  )}`;

  const blurb = [head, '', ...BLURB.map((l) => paint(l, PALETTE.text)), '', dryRun];

  if (!colorEnabled()) return ['', ...[head, '', ...BLURB, '', 'DRY RUN  nothing is submitted until you say so'], ''].join('\n');

  const art = columns >= 112 ? beside(drawPanda(), drawWordmark(), 3) : drawWordmark();
  return ['', ...toLines(art), '', ...blurb, ''].join('\n');
}
