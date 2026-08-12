// bamboo — terminal banner renderer (no dependencies, 24-bit color)
// Renders the wordmark and the sleeping red panda as Unicode half-blocks,
// so one text row = two sprite pixels and the art keeps its aspect ratio.
// Requires a truecolor terminal (iTerm2, Windows Terminal, VS Code, most modern shells).

const PALETTE = {
  bg:        '#1f212d',
  text:      '#d7dae5',
  textDim:   '#9a9eb0',
  muted:     '#7f8698',
  faint:     '#565b6e',
  orange:    '#e8783f',
  orangeLit: '#fbc79f',
  orangeDim: '#d55c17',
  extrude:   '#5d2309',
  mint:      '#4fc3a1',
};

const S = '######', H = '##..##', M = '##....##';
const GLYPHS = {
  B: ['######','######',H,H,'#####.','#####.',H,H,H,'######','######'],
  A: ['######','######',H,H,H,'######','######',H,H,H,H],
  M: ['##....##','###..###','########','########','##.##.##','##.##.##',M,M,M,M,M],
  O: ['######','######',H,H,H,H,H,H,H,'######','######'],
};

const PANDA_PALETTE = ["#f28c1e","#ffffff","#171717","#6b6b6b"];
const PANDA = [
  "....222................222.......222222222..............",
  "...22332..............23332...22200000000022............",
  "...233322.............23332...222000000000222...........",
  "..21333332..........22331112220000000000000002222.......",
  "..211133322222222222223311122000000000000000002002......",
  "..211133322222222222223311122000000000000000002002......",
  "..21111330000000000000311112200000000000000000200022....",
  "..21110000000000000000001122200000000000000000200022....",
  "...20000000000000000000000200000000000000000000220002...",
  "...20000000000000000000000200000000000000000000220002...",
  "..20000000000000000000000002200000000000000000022000022.",
  "..20000000000000000000000002200000000000000000022000022.",
  "..20000000000000000000000002200000000000000000022000023.",
  "..200000000000000000000000022000000000000000000220001112",
  "..200000000000000000000000022000000000000000000002111112",
  "..200022220001110002222000022000000022000000000003211112",
  "..200022220001110002222000022000000022200000000003221112",
  "2200000000011222100000000000020000000332000000033322222.",
  "22000000000111111000000000000200000033322222222222......",
  "22000000000111111000000000000200000033322222222222......",
  "..2222222222222222222222222222222222222................."
];

const hex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const fg = (h) => { const c = hex(h); return '\x1b[38;2;' + c[0] + ';' + c[1] + ';' + c[2] + 'm'; };
const bg = (h) => { const c = hex(h); return '\x1b[48;2;' + c[0] + ';' + c[1] + ';' + c[2] + 'm'; };
const RESET = '\x1b[0m';

// vertical gradient across the wordmark, light at the top
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function gradientAt(t) {
  const stops = [[0, hex(PALETTE.orangeLit)], [0.4, hex(PALETTE.orange)], [1, hex(PALETTE.orangeDim)]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i-1], [p1, c1] = stops[i];
      const k = (t - p0) / (p1 - p0 || 1);
      return '#' + [0,1,2].map(j => lerp(c0[j], c1[j], k).toString(16).padStart(2,'0')).join('');
    }
  }
  return PALETTE.orangeDim;
}

// --- pixel canvas -----------------------------------------------------------
function canvas(w, h) { return Array.from({ length: h }, () => new Array(w).fill(null)); }

function drawWordmark(word = 'BAMBOO', gap = 3, extrude = 2) {
  const rows = GLYPHS.B.length;
  let width = -gap;
  for (const ch of word) width += GLYPHS[ch][0].length + gap;
  const px = canvas(width + extrude, rows + extrude);
  const stamp = (dx, dy, colorFor) => {
    let ox = 0;
    for (const ch of word) {
      const g = GLYPHS[ch];
      g.forEach((row, y) => [...row].forEach((c, i) => {
        if (c === '#') px[y + dy][ox + i + dx] = colorFor(y, rows);
      }));
      ox += g[0].length + gap;
    }
  };
  stamp(extrude, extrude, () => PALETTE.extrude);
  stamp(0, 0, (y, n) => gradientAt(y / (n - 1)));
  return px;
}

function drawPanda() {
  return PANDA.map(row => [...row].map(c => (c === '.' ? null : PANDA_PALETTE[+c])));
}

// two pixel rows per text row: foreground = upper pixel, background = lower
function toLines(px, ground = PALETTE.bg) {
  const lines = [];
  for (let y = 0; y < px.length; y += 2) {
    let out = '';
    for (let x = 0; x < px[y].length; x++) {
      const top = px[y][x] || ground;
      const bot = (px[y + 1] && px[y + 1][x]) || ground;
      out += fg(top) + bg(bot) + '\u2580';
    }
    lines.push(out + RESET);
  }
  return lines;
}

function pad(px, width) {
  return px.map(row => { const r = row.slice(); while (r.length < width) r.push(null); return r; });
}

// side-by-side, bottom aligned, with a gap of transparent columns
function beside(a, b, gap = 3) {
  const h = Math.max(a.length, b.length);
  const top = (px) => Array.from({ length: h - px.length }, () => new Array(px[0].length).fill(null)).concat(px);
  const A = top(a), B = top(b);
  return A.map((row, y) => row.concat(new Array(gap).fill(null), B[y]));
}

// --- public API -------------------------------------------------------------
function wordmark() { return toLines(drawWordmark()).join('\n'); }
function panda() { return toLines(drawPanda()).join('\n'); }

function hero({ version = 'v0.2.0', columns = process.stdout.columns || 80 } = {}) {
  const w = drawWordmark(), p = drawPanda();
  const art = columns >= 112 ? beside(p, w, 3) : w;
  const lines = toLines(art);
  const blurb = [
    fg(PALETTE.orange) + '\x1b[1mbamboo' + RESET + ' ' + fg(PALETTE.faint) + version + RESET,
    '',
    fg(PALETTE.text) + 'Watching 65 job boards so you never have to hit refresh again.' + RESET,
    fg(PALETTE.text) + 'Applications are filled from your evidence ledger. Anything it' + RESET,
    fg(PALETTE.text) + "can't trace back to a verified fact, it won't claim." + RESET,
    '',
    fg(PALETTE.mint) + '\x1b[1mDRY RUN' + RESET + '  ' + fg(PALETTE.textDim) + 'nothing is submitted until you say so' + RESET,
  ];
  return ['', ...lines, '', ...blurb, ''].join('\n');
}

module.exports = { hero, wordmark, panda, PALETTE, fg, bg, RESET };

if (require.main === module) console.log(hero());
