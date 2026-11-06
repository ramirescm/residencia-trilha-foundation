import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploy, packages, digest } from '../deploy.mjs';

async function scenario(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'deploy-test-'));
  const env = { GITHUB_SHA: 'a'.repeat(40) };
  const files = {};
  const states = {};
  const calls = [];
  for (const [i, pkg] of packages.entries()) {
    env[pkg.env] = `function-${i}`;
    const bytes = Buffer.from(`new-${i}`);
    writeFileSync(join(directory, pkg.file), bytes);
    files[pkg.file] = digest(bytes);
    states[`function-${i}`] = { Runtime: pkg.runtime, Architectures: ['arm64'], PackageType: 'Zip', State: 'Active', LastUpdateStatus: 'Successful', CodeSha256: digest(Buffer.from(`old-function-${i}`)), RevisionId: 'initial' };
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ sha: env.GITHUB_SHA, files }));
  if (options.wrongCommit) env.GITHUB_SHA = 'b'.repeat(40);
  if (options.wrongRuntime) states['function-2'].Runtime = 'nodejs22.x';
  if (options.badHash) writeFileSync(join(directory, 'catalog.zip'), 'tampered');
  let updates = 0;
  const aws = args => {
    calls.push(args);
    const name = args[args.indexOf('--function-name') + 1];
    if (args[1] === 'get-function') return { Configuration: { ...states[name] }, Code: { Location: name } };
    if (args[1] === 'get-function-configuration') return { ...states[name] };
    if (args[1] === 'wait') return {};
    if (args[1] === 'update-function-code') {
      updates++;
      if (options.failSecond && updates === 2) throw new Error('Simulated AWS failure');
      if (options.rollbackFailure && updates >= 2) throw new Error('Simulated deploy and rollback failure');
      assert.equal(args[args.indexOf('--revision-id') + 1], states[name].RevisionId);
      const file = args[args.indexOf('--zip-file') + 1].slice('fileb://'.length);
      states[name].CodeSha256 = digest(readFileSync(file));
      states[name].RevisionId = `revision-${updates}`;
      return { ...states[name] };
    }
    throw new Error('Unexpected AWS operation');
  };
  try {
    const run = deploy({ directory, env, aws, download: async name => Buffer.from(`old-${name}`), log: () => {} });
    if (options.rollbackFailure) await assert.rejects(run, /ROLLBACK INCOMPLETE: function-0/);
    else if (options.failSecond || options.badHash || options.wrongCommit || options.wrongRuntime) await assert.rejects(run);
    else assert.equal((await run).functions.length, 3);
    return { states, calls, updates };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('validates all functions before deploying and verifies code hashes', async () => {
  const { calls, updates } = await scenario();
  assert.equal(updates, 3);
  assert.equal(calls.slice(0, 3).every(a => a[1] === 'get-function'), true);
});
test('restores first function if second deployment fails', async () => {
  const { states, updates } = await scenario({ failSecond: true });
  assert.equal(updates, 3);
  for (const [name, state] of Object.entries(states)) assert.equal(state.CodeSha256, digest(Buffer.from(`old-${name}`)));
});
test('tampered artifact aborts before any AWS mutation', async () => {
  assert.equal((await scenario({ badHash: true })).updates, 0);
});
test('wrong commit cannot deploy an artifact from another run', async () => {
  assert.equal((await scenario({ wrongCommit: true })).updates, 0);
});
test('all runtimes must match before any update', async () => {
  assert.equal((await scenario({ wrongRuntime: true })).updates, 0);
});
test('failed rollback explicitly requires manual recovery', async () => {
  assert.equal((await scenario({ rollbackFailure: true })).updates, 3);
});
