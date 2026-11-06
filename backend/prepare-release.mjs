import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packages, digest } from './deploy.mjs';
const backend = dirname(fileURLToPath(import.meta.url));
const destination = resolve(process.argv[2] ?? 'release');
const sources = ['01-catalog-backend-api-lambda/catalog-backend-api-lambda.zip', '02-order-backend-api-lambda/order-backend-api-lambda.zip', '03-order-processor-lambda/order-processor-lambda.zip'];
if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')) throw new Error('Set GITHUB_SHA to the full tested commit');
mkdirSync(destination, { recursive: true });
const files = {};
for (const [i, pkg] of packages.entries()) {
  const source = join(backend, 'lambdas', sources[i]);
  copyFileSync(source, join(destination, pkg.file));
  files[pkg.file] = digest(readFileSync(source));
}
writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ sha: process.env.GITHUB_SHA, files }, null, 2));
