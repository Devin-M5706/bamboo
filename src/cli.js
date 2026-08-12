#!/usr/bin/env node
import fs from 'node:fs/promises';
import { ANSWERS_FILE, DRY_RUN_DEFAULT, LEDGER_FILE, POLL_INTERVAL_MS, QUEUE_FILE } from './config.js';
import { mine } from './miner.js';
import { pollOnce } from './poll.js';
import { loadLedger } from './ledger.js';
import { loadAnswers } from './answers.js';
import { validateBank } from './validator.js';

const args = process.argv.slice(2);
const cmd = args[0];
const has = (flag) => args.includes(flag);

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

const COMMANDS = { mine: cmdMine, poll: cmdPoll, watch: cmdWatch, check: cmdCheck, queue: cmdQueue };

const run = COMMANDS[cmd];
if (!run) {
  console.log(`jobapplr -- autonomous internship applier

  mine     extract board tokens from the aggregator repo (run once, then occasionally)
  poll     one poll cycle across every board; queues new eligible postings
  watch    poll on an interval until stopped
  check    preflight: ledger valid? answers traceable? how much is queued?
  queue    show queued postings (--all to include handled)

Ledger:  ${LEDGER_FILE}
Answers: ${ANSWERS_FILE}`);
  process.exit(cmd ? 1 : 0);
}

run().catch((err) => {
  console.error(`${cmd} failed:`, err.message);
  process.exit(1);
});
