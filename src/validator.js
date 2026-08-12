/**
 * Trace-or-refuse validation.
 *
 * The implementation lives in validator.core.js, which has zero imports so the
 * browser extension can reuse it verbatim (see scripts/build-extension.js).
 * Do not add logic here -- add it to the core, or the extension and the CLI drift
 * apart and only one of them refuses.
 */
export { extractClaims, validateAnswer, validateBank } from './validator.core.js';
