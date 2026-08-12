/* global chrome, document */
const $ = (id) => document.getElementById(id);
const status = (msg, warn = false) => {
  $('status').textContent = msg;
  $('status').className = warn ? 'warn' : '';
};

function countFacts(ledgerText) {
  try {
    const l = JSON.parse(ledgerText);
    return Array.isArray(l.facts) ? l.facts.length : 0;
  } catch {
    return 0;
  }
}

function renderLiveWarning() {
  const dry = $('dryRun').checked;
  $('livebox').className = dry ? '' : 'live';
  $('livewarn').innerHTML = dry
    ? 'Nothing will be submitted. Recommended until you have watched it fill a real form.'
    : '<span class="warn">LIVE. Applications will be submitted to real employers under your name.</span>';
}

async function load() {
  const { ledger, answers, settings, reports } = await chrome.storage.local.get([
    'ledger',
    'answers',
    'settings',
    'reports',
  ]);
  if (ledger) $('ledger').value = JSON.stringify(ledger, null, 2);
  if (answers) $('answers').value = JSON.stringify({ answers }, null, 2);
  $('dryRun').checked = settings?.dryRun !== false;
  renderLiveWarning();

  const list = reports ?? [];
  $('reports').innerHTML = list.length
    ? '<ul>' +
      list
        .slice(0, 15)
        .map((r) => {
          const when = new Date(r.at).toLocaleString();
          const what = r.submitted ? 'SUBMITTED' : 'dry run';
          const ref = r.refusals?.length ? ` — ${r.refusals.length} refused` : '';
          return `<li>${when} — ${what}${ref}<br><small>${r.url ?? ''}</small></li>`;
        })
        .join('') +
      '</ul>'
    : 'None yet.';
}

$('dryRun').addEventListener('change', renderLiveWarning);

$('save').addEventListener('click', async () => {
  let ledger, answersDoc;
  try {
    ledger = JSON.parse($('ledger').value || '{}');
  } catch (e) {
    return status(`Ledger is not valid JSON: ${e.message}`, true);
  }
  try {
    answersDoc = JSON.parse($('answers').value || '{}');
  } catch (e) {
    return status(`Answer bank is not valid JSON: ${e.message}`, true);
  }

  const facts = countFacts($('ledger').value);
  if (!$('dryRun').checked && facts === 0) {
    return status('Refusing to enable live mode with an empty ledger.', true);
  }

  await chrome.storage.local.set({
    ledger,
    answers: answersDoc.answers ?? answersDoc,
    settings: { dryRun: $('dryRun').checked },
  });
  status(`Saved. ${facts} fact(s) loaded.`);
});

load();
