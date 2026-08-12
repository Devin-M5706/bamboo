import fs from 'node:fs/promises';
import { LEDGER_FILE } from './config.js';

/**
 * The Evidence Ledger: atomic, human-verified facts about you.
 *
 * This is the durable asset in this project. It cannot be generated, because the
 * entire point is that a person checked each entry and it is true. Everything the
 * applier ever writes must trace back to entries in here.
 *
 * Fact shape:
 *   id       stable slug, referenced by answers
 *   text     the claim, in your own words, literally true
 *   tags     extra strings that count as supported when they appear in an answer
 *            (project codenames, tech spellings, metric restatements)
 */

export const FACT_REQUIRED = ['id', 'text'];

export function validateLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object') return { ok: false, errors: ['ledger is not an object'] };

  const facts = ledger.facts;
  if (!Array.isArray(facts)) return { ok: false, errors: ['ledger.facts must be an array'] };

  const ids = new Set();
  facts.forEach((f, i) => {
    for (const k of FACT_REQUIRED) {
      if (!f?.[k] || typeof f[k] !== 'string' || !f[k].trim()) {
        errors.push(`facts[${i}]: missing or empty "${k}"`);
      }
    }
    if (f?.id) {
      if (ids.has(f.id)) errors.push(`facts[${i}]: duplicate id "${f.id}"`);
      ids.add(f.id);
    }
    if (f?.tags && !Array.isArray(f.tags)) errors.push(`facts[${i}]: tags must be an array`);
    if (f?.verified === false) errors.push(`facts[${i}] ("${f.id}"): marked verified:false`);
  });

  return { ok: errors.length === 0, errors };
}

export async function loadLedger(file = LEDGER_FILE) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { ok: false, empty: true, facts: [], errors: [`no ledger at ${file}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, empty: false, facts: [], errors: [`ledger is not valid JSON: ${err.message}`] };
  }
  const { ok, errors } = validateLedger(parsed);
  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  return { ok, empty: facts.length === 0, facts, errors, profile: parsed.profile ?? {} };
}

/** Index facts by id for fast lookup during validation. */
export function indexFacts(facts) {
  return new Map(facts.map((f) => [f.id, f]));
}

/** The searchable support text for a fact: its claim plus any declared tags. */
export function factCorpus(fact) {
  return [fact.text, ...(fact.tags ?? [])].join(' \n ');
}
