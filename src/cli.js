#!/usr/bin/env node
import fs from 'node:fs/promises';
import { ANSWERS_FILE, DRY_RUN_DEFAULT, LEDGER_FILE, POLL_INTERVAL_MS, QUEUE_FILE, ROOT, STATE_FILE } from './config.js';
import { mine } from './miner.js';
import { pollOnce } from './poll.js';
import { loadLedger } from './ledger.js';
import { loadAnswers } from './answers.js';
import { validateBank } from './validator.js';
import { survey } from './survey.js';
import { RULES } from './selects.js';
import { bootstrap, ensureHome, homeStatus } from './home.js';
import { findEngineers, linkedinSearches } from './contacts.js';
import { hero } from './ui/banner.js';
import { help } from './ui/help.js';
import { ledgerScreen, queueScreen } from './ui/screens.js';
import { contactsScreen } from './ui/contacts-view.js';
import { runInit, saveInit } from './ui/init.js';
import { PALETTE, columns, paint, setColor, shouldUseColor } from './ui/theme.js';

// Rename here to rebrand the CLI; the wordmark font covers A-Z.
const APP_NAME = process.env.BAMBOO_NAME || 'bamboo';
const VERSION = '0.2.0';
const BOARD_COUNT = 65;

const args = process.argv.slice(2);
const cmd = args[0];
const has = (flag) => args.includes(flag);

// One switch for the whole UI layer. Everything downstream writes through theme.js.
setColor(shouldUseColor(args));

const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
const dur = (ms) => (ms == null ? 'unknown' : ms < 90_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60000).toFixed(1)}m`);

async function cmdMine() {
  console.log('Mining board tokens from the aggregator...');
  const r = await mine();
  console.log(`  read ${fmt(r.listings)} listings`);
  console.log(`  found ${r.total} boards:`, r.byVendor);
  console.log('  wrote data/boards.json');
}

async function cmdPoll() {
  const r = await pollOnce({ verbose: true });
  if (r.coldStart) {
    console.log(`Cold start: recorded ${fmt(r.seenTotal)} existing postings as already-seen.`);
    console.log('Nothing queued. The next poll will only surface genuinely new postings.');
  } else {
    console.log(`Polled ${r.boards} boards in ${dur(r.elapsedMs)}: ${r.fresh} new, ${r.queued} queued.`);
    for (const d of r.dropped) console.log(`  dropped: ${d.title} (${d.dropReason})`);
  }
  if (r.errors.length) console.log(`  ${r.errors.length} board(s) errored`);
}

async function cmdWatch() {
  console.log(`Watching. Interval ${POLL_INTERVAL_MS / 60000}m. Ctrl-C to stop.`);
  for (;;) {
    try {
      await cmdPoll();
    } catch (err) {
      console.error('poll failed:', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/** Preflight. Refuses to call anything ready until the ledger and bank actually hold up. */
async function cmdCheck() {
  let failed = false;

  const ledger = await loadLedger();
  if (ledger.empty) {
    console.log('LEDGER   empty -- write data/ledger.json before going live (see data/ledger.example.json)');
    failed = true;
  } else if (!ledger.ok) {
    console.log(`LEDGER   ${ledger.facts.length} facts, INVALID`);
    ledger.errors.forEach((e) => console.log(`         - ${e}`));
    failed = true;
  } else {
    console.log(`LEDGER   ${ledger.facts.length} facts, valid`);
  }

  const bank = await loadAnswers();
  if (!bank.ok) {
    console.log(`ANSWERS  missing -- ${bank.error}`);
    failed = true;
  } else {
    const v = validateBank(bank.answers, ledger.facts);
    console.log(`ANSWERS  ${v.total} entries, ${v.refused} refused`);
    for (const r of v.results.filter((x) => x.refused)) {
      console.log(`         REFUSED ${r.key}: ${r.reason}`);
      if (r.unsupported.length) console.log(`           untraceable: ${r.unsupported.join(', ')}`);
    }
    if (!v.ok) failed = true;
  }


  // Dropdowns are answered from typed profile fields. An unset field is not a bug, but
  // it does mean the tool will refuse that question on every form that asks it.
  const prof = ledger.profile ?? {};
  const missing = RULES.map((r) => r.from).filter((f) => prof[f] === undefined || prof[f] === null || prof[f] === '');
  console.log(`DROPDOWN ${RULES.length - missing.length}/${RULES.length} profile fields set`);
  if (missing.length) {
    console.log(`         unset (these questions will be refused): ${missing.join(', ')}`);
  }

  const queue = JSON.parse(await fs.readFile(QUEUE_FILE, 'utf8').catch(() => '{"items":[]}'));
  const pending = queue.items.filter((i) => i.status === 'pending');
  console.log(`QUEUE    ${pending.length} pending of ${queue.items.length}`);

  const lags = queue.items.map((i) => i.detectionLagMs).filter((x) => x != null);
  if (lags.length) {
    lags.sort((a, b) => a - b);
    console.log(`LATENCY  median detection lag ${dur(lags[Math.floor(lags.length / 2)])} (n=${lags.length})`);
  }

  console.log(`SUBMIT   ${DRY_RUN_DEFAULT ? 'DRY RUN (nothing will be submitted)' : 'LIVE'}`);
  console.log(failed ? '\nNOT READY. Fix the above before enabling live submit.' : '\nReady.');
  process.exitCode = failed ? 1 : 0;
}

async function cmdQueue() {
  const queue = JSON.parse(await fs.readFile(QUEUE_FILE, 'utf8').catch(() => '{"items":[]}'));
  const items = has('--all') ? queue.items : queue.items.filter((i) => i.status === 'pending');
  if (!items.length) return console.log('Queue is empty.');
  for (const i of items) {
    console.log(`${i.status.padEnd(8)} ${i.vendor.padEnd(11)} ${i.title}`);
    console.log(`         ${i.location || 'location unknown'}  lag ${dur(i.detectionLagMs)}`);
    console.log(`         ${i.url}`);
  }
  console.log(`\n${items.length} item(s).`);
}

async function cmdSurvey() {
  console.log('Sampling real internship application forms (Greenhouse only)...');
  const r = await survey({ verbose: true });
  console.log(`\nSampled ${r.jobsSampled} postings.\n`);
  if (r.eligibilityFlips.length) {
    console.log(`Eligibility changed on ${r.eligibilityFlips.length} posting(s) once the description was available:`);
    r.eligibilityFlips.forEach((f) => console.log(`  ${f.board}: ${f.title} -- ${f.reason}`));
    console.log('');
  }
  console.log('Free-text prompts, by how many postings ask them:');
  for (const p of r.prompts.slice(0, 25)) {
    console.log(`  ${String(p.jobs).padStart(3)}x  ${p.required}req  ${p.label.slice(0, 90)}`);
  }
  console.log(`\nFull results: data/questions-survey.json`);
  console.log('Write answer-bank entries for the prompts at the top of this list.');
}

function showBanner() {
  console.log(hero({ version: `v${VERSION}`, columns: columns() }));
}

/**
 * First-run setup for a machine. Creates ~/.bamboo, migrates anything from an old
 * in-package data/ directory, and seeds templates. Safe to run repeatedly -- it never
 * overwrites a file that already exists.
 */
async function cmdSetup() {
  const { home, moved, created, skipped } = await bootstrap();
  console.log('');
  console.log(`  ${paint('✓', PALETTE.mint)} ${paint('home', PALETTE.muted)}  ${paint(home, PALETTE.text)}`);
  for (const f of moved) {
    console.log(`  ${paint('→', PALETTE.mint)} ${paint('migrated', PALETTE.muted)}  ${paint(f, PALETTE.text)}`);
  }
  for (const f of skipped) {
    console.log(`  ${paint('·', PALETTE.faint)} ${paint('kept existing', PALETTE.faint)}  ${paint(f, PALETTE.faint)}`);
  }
  for (const f of created) {
    console.log(`  ${paint('+', PALETTE.mint)} ${paint('seeded', PALETTE.muted)}  ${paint(f, PALETTE.text)}`);
  }
  console.log('');
  console.log(
    `  ${paint('next', PALETTE.faint)}  ${paint('bamboo init', PALETTE.orange)} ${paint(
      'to answer the questions real forms ask',
      PALETTE.muted,
    )}`,
  );
  console.log('');
}

/** Where everything lives on this machine. */
async function cmdWhere() {
  const { home, files } = await homeStatus();
  console.log('');
  console.log(`  ${paint('home', PALETTE.faint)}  ${paint(home, PALETTE.text)}`);
  console.log(`  ${paint('code', PALETTE.faint)}  ${paint(ROOT, PALETTE.faint)}`);
  console.log('');
  for (const f of files) {
    const mark = f.exists ? paint('✓', PALETTE.mint) : paint('·', PALETTE.faint);
    const name = paint(f.name.padEnd(16), f.exists ? PALETTE.text : PALETTE.faint);
    console.log(`  ${mark} ${name}${paint(f.exists ? '' : 'not created yet', PALETTE.faint)}`);
  }
  console.log('');
  console.log(`  ${paint('override with BAMBOO_HOME', PALETTE.faint)}`);
  console.log('');
}

/** Screen 4 -- the setup wizard. */
async function cmdInit() {
  await ensureHome();
  const config = await runInit();
  if (!config) {
    console.log(paint('\n  cancelled. nothing was written.\n', PALETTE.faint));
    return;
  }
  const { configFile, ledgerFile } = await saveInit(config);
  console.log(
    `\n  ${paint('✓', PALETTE.mint)} ${paint('saved', PALETTE.muted)}  ${paint(configFile, PALETTE.faint)}`,
  );
  console.log(
    `  ${paint('✓', PALETTE.mint)} ${paint('profile merged into', PALETTE.muted)}  ${paint(ledgerFile, PALETTE.faint)}`,
  );
  console.log(
    `\n  ${paint('next', PALETTE.faint)}  ${paint('bamboo check', PALETTE.orange)} ${paint(
      'to see what is still blocking you',
      PALETTE.muted,
    )}\n`,
  );
}

/** Screen 3 -- the evidence ledger, rendered as the handoff's table. */
async function cmdLedger() {
  const ledger = await loadLedger();
  console.log(ledgerScreen(ledger.facts, columns()));
  if (!ledger.ok && ledger.facts.length) {
    for (const e of ledger.errors) console.log(`  ${paint(e, PALETTE.orange)}`);
    console.log('');
  }
}

/** Screen 2 -- the live feed, rendered from whatever is actually queued. */
async function cmdFeed() {
  const queue = JSON.parse(await fs.readFile(QUEUE_FILE, 'utf8').catch(() => '{"items":[]}'));
  const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8').catch(() => '{"seen":{}}'));
  const items = has('--all') ? queue.items : queue.items.filter((i) => i.status === 'pending');
  console.log('');
  console.log(
    queueScreen(items, { boards: BOARD_COUNT, seen: Object.keys(state.seen ?? {}).length }, columns()),
  );
  console.log('');
}

/** Who to talk to about a posting. GitHub is fetched; LinkedIn is yours to click. */
async function cmdContacts() {
  const company = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
  if (!company) {
    console.log(paint('\n  usage: bamboo contacts <company>\n', PALETTE.faint));
    process.exitCode = 1;
    return;
  }
  const found = await findEngineers(company);
  console.log(
    contactsScreen(
      { company, engineers: found.people, org: found.org, reason: found.reason, searches: linkedinSearches(company) },
      columns(),
    ),
  );
}

const COMMANDS = {
  setup: cmdSetup,
  install: cmdSetup,
  where: cmdWhere,
  contacts: cmdContacts,
  init: cmdInit,
  mine: cmdMine,
  poll: cmdPoll,
  watch: cmdWatch,
  feed: cmdFeed,
  ledger: cmdLedger,
  check: cmdCheck,
  queue: cmdQueue,
  survey: cmdSurvey,
  banner: () => Promise.resolve(showBanner()),
  help: () => Promise.resolve(console.log(help())),
};

const run = COMMANDS[cmd];
if (!run) {
  if (!cmd) showBanner();
  console.log(help());
  console.log(
    `  ${paint('ledger', PALETTE.faint)}   ${paint(LEDGER_FILE, PALETTE.faint)}\n` +
      `  ${paint('answers', PALETTE.faint)}  ${paint(ANSWERS_FILE, PALETTE.faint)}\n`,
  );
  process.exit(cmd ? 1 : 0);
}


run().catch((err) => {
  console.error(`${cmd} failed:`, err.message);
  process.exit(1);
});
