import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {encodeValue} from '../src/runtime.js';
const require = createRequire(import.meta.url);
const VirtualMachine = require('scratch-vm');
const StringUtil = require('../node_modules/scratch-vm/src/util/string-util.js');
require('minilog').disable(); // Expected headless costume warnings; no rendering is validated.
export const vmVersion = JSON.parse(readFileSync(new URL('../node_modules/scratch-vm/package.json', import.meta.url))).version;

export async function runVm(project, maxTicks = 20000) {
  const vm = new VirtualMachine();
  try {
    // No storage, renderer, extension URLs, clock start, or network services.
    // Inputs are trusted synthetic fixtures with no assets or extensions.
    await vm.loadProject(JSON.stringify(project));
    vm.setTurboMode(true);
    vm.runtime.currentStepTime = 1000 / 30; // Initialize the scheduler without starting its interval.
    vm.greenFlag();
    let ticks = 0;
    while (vm.runtime.threads.length && ticks < maxTicks) { vm.runtime._step(); ticks++; }
    if (vm.runtime.threads.length) throw new Error(`Scratch VM exceeded ${maxTicks} scheduler ticks`);
    return {
      ticks,
      variables: project.targets.flatMap((target, targetIndex) => {
        const loaded = vm.runtime.targets.filter(t => t.isOriginal)[targetIndex];
        return Object.keys(target.variables).map(id => ({targetIndex, id, value: encodeValue(loaded.variables[StringUtil.replaceUnsafeChars(id)].value)}));
      })
    };
  } finally { vm.quit(); vm.clear(); }
}
