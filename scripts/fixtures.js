import {writeFile} from 'node:fs/promises';
import {examples} from './programs.js';
import {listExamples, generatedLists, listSeedStart, listSeedCount} from './list-programs.js';
import {procedureExamples, generatedProcedures, procedureSeedStart, procedureSeedCount} from './procedure-programs.js';
import {sb3} from './zip.js';
for (const [name, {project, expected, expectedLists}] of Object.entries({...examples(), ...listExamples(), ...procedureExamples()})) {
  await writeFile(new URL(`../examples/${name}.sb3`, import.meta.url), sb3(project));
  await writeFile(new URL(`../examples/${name}.project.json`, import.meta.url), JSON.stringify(project, null, 2) + '\n');
  await writeFile(new URL(`../examples/${name}.expected.json`, import.meta.url), JSON.stringify(expectedLists ? {variables: expected, lists: expectedLists} : expected, null, 2) + '\n');
}
console.log('Wrote nine deterministic synthetic .sb3 fixtures and their readable JSON.');
const {generated} = await import('./programs.js');
const corpus = Array.from({length: 128}, (_, index) => { const seed = 0x5eed0000 + index; return {seed, project: generated(seed)}; });
await writeFile(new URL('../test/fixtures/generated.jsonl', import.meta.url), corpus.map(item => JSON.stringify(item)).join('\n') + '\n');
console.log('Wrote 128 generated fixtures with independent seeds 0x5eed0000–0x5eed007f.');

const lists = Array.from({length: listSeedCount}, (_, index) => { const seed = listSeedStart + index; return {seed, project: generatedLists(seed)}; });
await writeFile(new URL('../test/fixtures/lists-generated.jsonl', import.meta.url), lists.map(item => JSON.stringify(item)).join('\n') + '\n');
console.log(`Wrote ${listSeedCount} seeded list programs.`);

const procedures = Array.from({length: procedureSeedCount}, (_, index) => { const seed = procedureSeedStart + index; return {seed, project: generatedProcedures(seed)}; });
await writeFile(new URL('../test/fixtures/procedures-generated.jsonl', import.meta.url), procedures.map(item => JSON.stringify(item)).join('\n') + '\n');
console.log(`Wrote ${procedureSeedCount} seeded procedure programs.`);
