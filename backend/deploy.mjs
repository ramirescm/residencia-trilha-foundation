import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const packages = [
  { env: 'CATALOG_FUNCTION', file: 'catalog.zip', runtime: 'nodejs24.x' },
  { env: 'ORDER_API_FUNCTION', file: 'orders.zip', runtime: 'dotnet8' },
  { env: 'ORDER_PROCESSOR_FUNCTION', file: 'processor.zip', runtime: 'nodejs24.x' },
];
export const digest = bytes => createHash('sha256').update(bytes).digest('base64');
function cli(args) {
  try {
    const result = execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AWS_PAGER: '' } });
    return result.trim() ? JSON.parse(result) : {};
  } catch (error) {
    // Never include GetFunction download URLs or credentials in errors.
    throw new Error(`AWS ${args[0]} ${args[1]} failed (exit ${error.status ?? 'unknown'}). Inspect AWS logs/permissions.`);
  }
}
export async function deploy({ directory, env = process.env, aws = cli, download = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Cannot download rollback artifact: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}, log = console.log }) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
  if (!env.GITHUB_SHA || manifest.sha !== env.GITHUB_SHA) throw new Error('Artifact SHA does not match the workflow commit');
  const names = packages.map(p => env[p.env]);
  if (names.some(n => !n || !/^[A-Za-z0-9-_]{1,64}$/.test(n)) || new Set(names).size !== 3) throw new Error('Provide three distinct, unqualified Lambda names');
  const scratch = mkdtempSync(join(tmpdir(), 'residencia-backend-'));
  const changed = [];
  let uncertainTarget;
  try {
    // Preflight and backup ALL targets before the first update.
    const targets = [];
    for (const [index, pkg] of packages.entries()) {
      const bytes = readFileSync(join(directory, pkg.file));
      if (bytes.length > 50 * 1024 * 1024 || digest(bytes) !== manifest.files[pkg.file]) throw new Error(`Invalid ZIP/hash/size: ${pkg.file}`);
      const info = aws(['lambda', 'get-function', '--function-name', names[index]]);
      const cfg = info.Configuration;
      if (cfg.Runtime !== pkg.runtime || cfg.Architectures?.[0] !== 'arm64' || cfg.PackageType !== 'Zip' || cfg.State !== 'Active' || cfg.LastUpdateStatus !== 'Successful') throw new Error(`Unexpected configuration or pending update: ${names[index]}`);
      const previous = await download(info.Code.Location);
      if (digest(previous) !== cfg.CodeSha256) throw new Error(`Rollback backup hash mismatch: ${names[index]}`);
      const backup = join(scratch, pkg.file);
      writeFileSync(backup, previous, { mode: 0o600 });
      targets.push({ name: names[index], file: resolve(directory, pkg.file), hash: digest(bytes), backup, previousHash: cfg.CodeSha256, revision: cfg.RevisionId });
    }
    for (const target of targets) {
      // A network error may occur after AWS accepted the update; flag that target
      // for manual inspection rather than claiming an atomic rollback.
      uncertainTarget = target.name;
      const updated = aws(['lambda', 'update-function-code', '--function-name', target.name, '--zip-file', `fileb://${target.file}`, '--revision-id', target.revision]);
      uncertainTarget = undefined;
      target.revision = updated.RevisionId;
      changed.push(target);
      aws(['lambda', 'wait', 'function-updated-v2', '--function-name', target.name]);
      const state = aws(['lambda', 'get-function-configuration', '--function-name', target.name]);
      if (state.CodeSha256 !== target.hash || state.LastUpdateStatus !== 'Successful') throw new Error(`Verification failed: ${target.name}`);
      target.revision = state.RevisionId;
      log(`Verified ${target.name}: ${target.hash}`);
    }
    return { sha: manifest.sha, functions: targets.map(t => ({ name: t.name, codeSha256: t.hash })) };
  } catch (error) {
    const failed = [];
    for (const target of changed.reverse()) {
      try {
        const cfg = aws(['lambda', 'get-function-configuration', '--function-name', target.name]);
        if (cfg.RevisionId !== target.revision) throw new Error('Concurrent modification; refusing overwrite');
        aws(['lambda', 'update-function-code', '--function-name', target.name, '--zip-file', `fileb://${target.backup}`, '--revision-id', cfg.RevisionId]);
        aws(['lambda', 'wait', 'function-updated-v2', '--function-name', target.name]);
        const restored = aws(['lambda', 'get-function-configuration', '--function-name', target.name]);
        if (restored.CodeSha256 !== target.previousHash) throw new Error('Rollback hash mismatch');
        log(`Restored ${target.name}`);
      } catch { failed.push(target.name); }
    }
    throw new Error(`${error.message}${failed.length ? `. ROLLBACK INCOMPLETE: ${failed.join(', ')}. Manual recovery required.` : '. Previous code restored for completed updates (if any).'}${uncertainTarget ? ` Verify ${uncertainTarget} manually: its update response was not received.` : ''}`);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  deploy({ directory: resolve(process.argv[2] ?? 'release') }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
