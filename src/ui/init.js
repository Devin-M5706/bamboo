/**
 * `bamboo init` — the setup wizard driver.
 *
 * Rendering lives in init-view.js; this file owns keyboard state and what gets written.
 *
 * Two of these questions are not preferences. Work authorization and graduation year
 * feed the dropdown resolver directly, and they are the fields most often required on
 * real forms. Asking them here is why init exists at all -- without them every
 * application stops at the first dropdown.
 */
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { CONFIG_FILE, LEDGER_FILE } from '../config.js';
import { columns } from './theme.js';
import { initScreen } from './init-view.js';

export const QUESTIONS = [
  {
    key: 'boards',
    question: 'Which boards should bamboo watch?',
    hint: 'space to toggle, enter to accept',
    multi: true,
    choices: [
      { label: 'Greenhouse', count: '37 boards', value: 'greenhouse' },
      { label: 'Ashby', count: '23 boards', value: 'ashby' },
      { label: 'Lever', count: '5 boards', value: 'lever' },
    ],
    initial: [0, 1, 2],
  },
  {
    key: 'intervalMinutes',
    question: 'How often should it check?',
    hint: 'enter to accept',
    choices: [
      { label: 'Every minute', count: 'heaviest', value: 1 },
      { label: 'Every 5 minutes', count: 'recommended', value: 5 },
      { label: 'Every 15 minutes', value: 15 },
      { label: 'Hourly', count: 'lightest', value: 60 },
    ],
    initial: [1],
  },
  {
    key: 'workAuthorization',
    question: 'Your work authorization in the US?',
    hint: 'asked on 4 of every 32 forms, always required',
    choices: [
      { label: 'Authorized for any employer', value: 'authorized_any' },
      { label: 'Authorized, present employer only', value: 'authorized_current_employer_only' },
      { label: 'I need visa sponsorship', value: 'requires_sponsorship' },
      { label: 'Not authorized', value: 'not_authorized' },
    ],
    initial: [0],
  },
  {
    key: 'graduationYear',
    question: 'Expected graduation year?',
    hint: 'enter to accept',
    choices: ['2026', '2027', '2028', '2029', '2030'].map((y) => ({ label: y, value: y })),
    initial: [2],
  },
  {
    key: 'forReal',
    question: 'Submit applications automatically?',
    hint: 'dry run fills the form and stops',
    choices: [
      { label: 'No — dry run, I will review first', count: 'recommended', value: false },
      { label: 'Yes — submit for real', count: 'needs a full ledger', value: true },
    ],
    initial: [0],
  },
];

const PREVIEW = [
  'With these settings bamboo checks',
  '65 boards every 5 minutes.',
  '',
  'On a burst day that is about 76',
  'postings surfaced without you',
  'hitting refresh once.',
  '',
  'Nothing is submitted in dry run.',
];

/** Build the view model the renderer expects. */
export function viewModel(state) {
  const questions = QUESTIONS.map((q, i) => {
    if (i < state.step) {
      return {
        question: q.question,
        state: 'done',
        answer: (state.answers[q.key] ?? []).map((j) => q.choices[j].label).join(', '),
      };
    }
    if (i > state.step) return { question: q.question, state: 'future' };
    return {
      question: q.question,
      hint: q.hint,
      state: 'active',
      choices: q.choices,
      selected: state.selected,
      cursor: state.cursor,
    };
  });
  return { questions, step: state.step + 1, steps: QUESTIONS.length, preview: PREVIEW };
}

function resolveAnswers(answers) {
  const out = {};
  for (const q of QUESTIONS) {
    const picked = (answers[q.key] ?? []).map((i) => q.choices[i].value);
    out[q.key] = q.multi ? picked : picked[0];
  }
  return out;
}

/** Interactive run. Returns the resolved config, or null if the user quit. */
export async function runInit({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY) {
    throw new Error('init needs an interactive terminal (stdin is not a TTY)');
  }

  const state = { step: 0, cursor: 0, selected: [...QUESTIONS[0].initial], answers: {} };
  let painted = 0;

  const draw = () => {
    if (painted) output.write(`\x1b[${painted}A\x1b[0J`);
    const text = initScreen(viewModel(state), columns());
    output.write(text + '\n');
    painted = text.split('\n').length + 1;
  };

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  output.write('\x1b[?25l'); // hide cursor

  const cleanup = () => {
    output.write('\x1b[?25h\x1b[0m'); // show cursor, reset colour
    if (input.isTTY) input.setRawMode(false);
    input.pause();
  };

  return new Promise((resolve) => {
    const onKey = (str, key) => {
      const q = QUESTIONS[state.step];

      if (key.ctrl && key.name === 'c') {
        input.off('keypress', onKey);
        cleanup();
        return resolve(null);
      }
      if (key.name === 'up') state.cursor = Math.max(0, state.cursor - 1);
      else if (key.name === 'down') state.cursor = Math.min(q.choices.length - 1, state.cursor + 1);
      else if (key.name === 'space') {
        if (q.multi) {
          state.selected = state.selected.includes(state.cursor)
            ? state.selected.filter((i) => i !== state.cursor)
            : [...state.selected, state.cursor].sort((a, b) => a - b);
        } else state.selected = [state.cursor];
      } else if (key.name === 'return') {
        if (!q.multi) state.selected = [state.cursor];
        if (!state.selected.length) return; // a question with no answer is not answered
        state.answers[q.key] = state.selected;
        state.step += 1;
        if (state.step >= QUESTIONS.length) {
          input.off('keypress', onKey);
          draw();
          cleanup();
          return resolve(resolveAnswers(state.answers));
        }
        state.cursor = QUESTIONS[state.step].initial[0] ?? 0;
        state.selected = [...QUESTIONS[state.step].initial];
      }
      draw();
    };

    input.on('keypress', onKey);
    draw();
  });
}

/**
 * Persist what init collected.
 *
 * Config goes to its own file; the two profile answers are merged into the ledger,
 * because that is where the dropdown resolver reads them from and having two sources
 * of truth for "am I authorized to work here" would be a bug waiting to happen.
 */
export async function saveInit(config, { configFile = CONFIG_FILE, ledgerFile = LEDGER_FILE } = {}) {
  await fs.writeFile(
    configFile,
    JSON.stringify(
      {
        boards: config.boards,
        intervalMinutes: config.intervalMinutes,
        forReal: config.forReal,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  let ledger = { profile: {}, facts: [] };
  try {
    ledger = JSON.parse(await fs.readFile(ledgerFile, 'utf8'));
  } catch {
    // no ledger yet; init creates the profile half of one
  }
  ledger.profile = {
    ...(ledger.profile ?? {}),
    workAuthorization: config.workAuthorization,
    graduationYear: config.graduationYear,
  };
  await fs.writeFile(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');

  return { configFile, ledgerFile };
}
