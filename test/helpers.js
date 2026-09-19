import {compile} from '../src/compiler.js';
export async function execute(project, options = {}, runOptions = {}) {
  const {code} = compile(project, options);
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return module.run(runOptions);
}
export const values = result => Object.fromEntries(result.variables.map(v => [v.id, v.value]));
