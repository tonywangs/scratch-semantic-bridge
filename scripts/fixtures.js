import {writeFile} from 'node:fs/promises';
import {examples} from './programs.js';
import {sb3} from './zip.js';
for (const [name, {project, expected}] of Object.entries(examples())) {
  await writeFile(new URL(`../examples/${name}.sb3`, import.meta.url), sb3(project));
  await writeFile(new URL(`../examples/${name}.project.json`, import.meta.url), JSON.stringify(project, null, 2) + '\n');
  await writeFile(new URL(`../examples/${name}.expected.json`, import.meta.url), JSON.stringify(expected, null, 2) + '\n');
}
console.log('Wrote three deterministic synthetic .sb3 fixtures and their readable JSON.');
const {generated} = await import('./programs.js');
const corpus = Array.from({length: 128}, (_, index) => { const seed = 0x5eed0000 + index; return {seed, project: generated(seed)}; });
await writeFile(new URL('../test/fixtures/generated.jsonl', import.meta.url), corpus.map(item => JSON.stringify(item)).join('\n') + '\n');
console.log('Wrote 128 generated fixtures with independent seeds 0x5eed0000–0x5eed007f.');
