import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CorruptFileError, readJson, readJsonOr, updateJson, writeJson } from '../src/store.js';
import { saveInit } from '../src/ui/init.js';

async function tmpdir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'bamboo-store-'));
}

test('readJson distinguishes missing from corrupt', async () => {
  const dir = await tmpdir();
  const missing = path.join(dir, 'nope.json');
  const corrupt = path.join(dir, 'bad.json');
  await fs.writeFile(corrupt, '{ "facts": [ , ] }');

  const r = await readJson(missing);
  assert.equal(r.exists, false, 'missing must not throw');

  await assert.rejects(() => readJson(corrupt), CorruptFileError, 'corrupt must throw, never default');
});

test('REFUSES to overwrite a corrupt ledger — the P0 this module exists for', async () => {
  const dir = await tmpdir();
  const ledger = path.join(dir, 'ledger.json');
  const original = '{ "facts": [ {"id":"a","text":"real fact"} ], }'; // trailing comma typo
  await fs.writeFile(ledger, original);

  await assert.rejects(
    () => updateJson(ledger, (l) => ({ ...l, touched: true }), { whenMissing: {} }),
    CorruptFileError,
  );

  // The critical assertion: the user's file is untouched.
  assert.equal(await fs.readFile(ledger, 'utf8'), original, 'a bad parse must never destroy the file');
});

test('saveInit refuses rather than zeroing a hand-edited ledger', async () => {
  const dir = await tmpdir();
  const ledgerFile = path.join(dir, 'ledger.json');
  const configFile = path.join(dir, 'config.json');
  const original = '{ "facts": [ {"id":"proj","text":"I built bamboo"} ] ,}';
  await fs.writeFile(ledgerFile, original);

  await assert.rejects(
    () => saveInit({ workAuthorization: 'authorized_any', graduationYear: '2028' }, { configFile, ledgerFile }),
    CorruptFileError,
  );
  assert.equal(await fs.readFile(ledgerFile, 'utf8'), original, 'facts must survive a failed init');
});

test('saveInit preserves existing facts when the ledger is valid', async () => {
  const dir = await tmpdir();
  const ledgerFile = path.join(dir, 'ledger.json');
  const configFile = path.join(dir, 'config.json');
  await writeJson(ledgerFile, { profile: { name: 'X' }, facts: [{ id: 'a', text: 'kept' }] });

  await saveInit(
    { boards: ['greenhouse'], intervalMinutes: 5, forReal: false, workAuthorization: 'authorized_any', graduationYear: '2028' },
    { configFile, ledgerFile },
  );

  const { value } = await readJson(ledgerFile);
  assert.equal(value.facts.length, 1, 'facts must survive');
  assert.equal(value.facts[0].text, 'kept');
  assert.equal(value.profile.name, 'X', 'unrelated profile fields must survive');
  assert.equal(value.profile.workAuthorization, 'authorized_any');
  assert.equal(value.profile.graduationYear, '2028');
});

test('updateJson keeps a .bak of the previous good contents', async () => {
  const dir = await tmpdir();
  const f = path.join(dir, 'ledger.json');
  await writeJson(f, { facts: [{ id: 'v1' }] });
  await updateJson(f, (v) => ({ facts: [{ id: 'v2' }] }), { backup: true });

  const { value: current } = await readJson(f);
  const { value: backup } = await readJson(`${f}.bak`);
  assert.equal(current.facts[0].id, 'v2');
  assert.equal(backup.facts[0].id, 'v1', 'previous version must be recoverable');
});

test('writeJson leaves no temp files behind', async () => {
  const dir = await tmpdir();
  await writeJson(path.join(dir, 'a.json'), { x: 1 });
  const left = (await fs.readdir(dir)).filter((f) => f.includes('.tmp'));
  assert.deepEqual(left, [], 'temp files must be renamed away, not orphaned');
});

test('writeJson creates missing parent directories', async () => {
  const dir = await tmpdir();
  const nested = path.join(dir, 'deep', 'nested', 'f.json');
  await writeJson(nested, { ok: true });
  assert.equal((await readJson(nested)).value.ok, true);
});

test('readJsonOr tolerates both missing and corrupt for derived state', async () => {
  const dir = await tmpdir();
  const corrupt = path.join(dir, 'state.json');
  await fs.writeFile(corrupt, 'not json at all');
  assert.deepEqual(await readJsonOr(corrupt, { seen: {} }), { seen: {} });
  assert.deepEqual(await readJsonOr(path.join(dir, 'gone.json'), { seen: {} }), { seen: {} });
});

test('updateJson throws when the file is missing and no default is given', async () => {
  const dir = await tmpdir();
  await assert.rejects(() => updateJson(path.join(dir, 'gone.json'), (v) => v), { code: 'ENOENT' });
});
