import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { DiffEngine } from '../../src/coder/diff-engine.js';

const TEST_SCRATCH = resolve('test-scratch/diff-test');

test('DiffEngine: Successfully applies atomic search-and-replace block', () => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
  const sampleFile = resolve(TEST_SCRATCH, 'auth.js');
  writeFileSync(
    sampleFile,
    `function authenticate(req, res) {
  // Check user token
  const token = req.headers.authorization;
  if (!token) return res.status(401).send();
  return next();
}\n`,
    'utf-8'
  );

  const diffText = `<<<<<<< SEARCH
  // Check user token
  const token = req.headers.authorization;
  if (!token) return res.status(401).send();
=======
  // Check user token with cryptographic nonce
  const token = req.headers.authorization;
  const nonce = req.headers['x-auth-nonce'];
  if (!token || !nonce) return res.status(401).send();
>>>>>>> REPLACE`;

  const result = DiffEngine.applyPatch(sampleFile, diffText);
  assert.equal(result.success, true);
  assert.equal(result.blocksApplied, 1);

  const updatedContent = readFileSync(sampleFile, 'utf-8');
  assert.match(updatedContent, /x-auth-nonce/);

  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

test('DiffEngine: Rejects ambiguous search block with multiple occurrences', () => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
  const sampleFile = resolve(TEST_SCRATCH, 'ambiguous.js');
  writeFileSync(sampleFile, `const x = 1;\nconst x = 1;\n`, 'utf-8');

  const diffText = `<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`;

  assert.throws(
    () => DiffEngine.applyPatch(sampleFile, diffText),
    /Target content is ambiguous/
  );

  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

test('DiffEngine: Chesterton\'s Fence rejects excessive line deletion', () => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
  const sampleFile = resolve(TEST_SCRATCH, 'guarded.js');
  const longOriginal = Array.from({ length: 20 }, (_, i) => `// Critical Guard Line ${i}`).join('\n') + '\n';
  writeFileSync(sampleFile, longOriginal, 'utf-8');

  const diffText = `<<<<<<< SEARCH
${longOriginal.trim()}
=======
// Deleted all guards
>>>>>>> REPLACE`;

  assert.throws(
    () => DiffEngine.applyPatch(sampleFile, diffText),
    /Chesterton's Fence Violation: Diff attempts excessive line deletion/
  );

  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});
