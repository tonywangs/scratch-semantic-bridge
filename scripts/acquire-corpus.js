// Explicit online acquisition step, never called by offline verification or CLI.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url));
const sources = JSON.parse(await readFile(resolve(root, 'corpus/sources.json')));
const manifest = JSON.parse(await readFile(resolve(root, 'corpus/manifest.json')));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--from')) throw new Error('Usage: node scripts/acquire-corpus.js [--from PINNED_SOURCE_CHECKOUT]');
const hash = b => createHash('sha256').update(b).digest('hex');
for (const [i, source] of sources.files.entries()) {
  const row = manifest.files[i];
  if (row.id !== source.id || !row.path.startsWith('fixtures/') || row.path.includes('..')) throw new Error('Invalid frozen corpus mapping');
  const destination = resolve(root, 'corpus', row.path);
  let bytes;
  try { bytes = await readFile(destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (bytes) {
    if (hash(bytes) !== source.sha256 || bytes.length !== source.bytes) throw new Error(`Existing fixture changed: ${source.id}`);
    continue;
  }
  if (args.length) bytes = await readFile(resolve(args[1], source.sourcePath));
  else {
    const url = `https://raw.githubusercontent.com/scratchfoundation/scratch-vm/${sources.revision}/${source.sourcePath}`;
    const response = await fetch(url, {signal: AbortSignal.timeout(30000), redirect: 'error'});
    if (!response.ok) throw new Error(`Acquisition failed: ${source.id} HTTP ${response.status}`);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > source.bytes) throw new Error(`Unexpected fixture size: ${source.id}`);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  }
  const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (bytes.length !== source.bytes || hash(bytes) !== source.sha256 || gitBlob !== source.gitBlob) throw new Error(`Source hash mismatch: ${source.id}`);
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, bytes, {flag: 'wx'});
}
console.log(`Acquired/verified ${sources.files.length} frozen SB3 fixtures at ${sources.revision}.`);
