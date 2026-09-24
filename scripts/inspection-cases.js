import {ProcedureProgram} from './procedure-programs.js';

// Independent contracts: expected findings come from each deliberate mutation,
// never from the inspector or compiler. Fixtures are synthetic, seed-reproducible.
export const inspectionSeedStart = 0x1a5e0000;
export const inspectionSeedCount = 24;
export const inspectionKinds = [
  'supported', 'live-unsupported', 'disconnected-unsupported', 'dangling-next',
  'next-cycle', 'reporter-cycle', 'duplicate-definition', 'missing-definition',
  'bad-metadata', 'dead-branch-recursion', 'multiple-entries', 'simultaneous-errors',
  'missing-variables', 'unicode', 'bad-parameter', 'unused-recursion',
  'target-local-missing', 'hidden-unsupported', 'bad-input', 'extensions',
  'dangling-parent', 'shared-reporter', 'bad-field', 'other-event'
];

export function inspectionCase(seed, kind) {
  let random = seed >>> 0;
  const number = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) % 100; };
  const p = new ProcedureProgram({}, {result: ['result', number()]});
  const leaf = p.procedure('叶子 %s', [['参数', number()]], {ids: ['参数输入']});
  const leafSet = p.set('result', p.argument('参数'));
  p.body(leaf, [leafSet]);
  const outer = p.procedure('outer');
  const nestedCall = p.call(leaf, [p.literal(number())]);
  p.body(outer, [p.branch(p.literal(false), [nestedCall])]);
  const unused = p.procedure('unused');
  const unusedSet = p.set('result', p.literal(number()));
  const unusedBody = [unusedSet, ...Array.from({length: number() % 4}, () => p.change('result', p.literal(number())))];
  p.body(unused, unusedBody);
  const entryCall = p.call(outer), set = p.set('result', p.literal(number()));
  const project = p.finish([entryCall, set]);
  const hat = Object.keys(p.blocks).find(id => p.blocks[id].opcode === 'event_whenflagclicked');
  const expected = {compatible: false, findings: []};
  const finding = (code, blockId = null, severity = 'error', targetIndex = blockId === null ? null : 0) => expected.findings.push({code, blockId, severity, targetIndex});
  switch (kind) {
    case 'supported': expected.compatible = true; break;
    case 'live-unsupported': p.blocks[set].opcode = 'looks_say'; finding('UNSUPPORTED_OPCODE', set); break;
    case 'disconnected-unsupported': {
      const id = p.block('motion_movesteps'); finding('UNSUPPORTED_OPCODE', id); finding('UNREACHABLE_BLOCK', id); expected.disconnected = id; break;
    }
    case 'dangling-next': p.blocks[set].next = 'absent'; finding('MISSING_BLOCK', set); break;
    case 'next-cycle': p.blocks[set].next = entryCall; finding('BLOCK_CYCLE', set); break;
    case 'reporter-cycle': {
      const id = p.block('operator_not'); p.blocks[id].inputs.OPERAND = [2, id]; p.blocks[id].parent = set;
      p.blocks[set].inputs.VALUE = [2, id]; finding('BLOCK_CYCLE', id); break;
    }
    case 'duplicate-definition': {
      const duplicate = p.procedure('unused'); finding('AMBIGUOUS_PROCEDURE', duplicate.id); break;
    }
    case 'missing-definition': p.blocks[entryCall].mutation.proccode = 'absent'; finding('MISSING_PROCEDURE', entryCall, 'warning'); expected.compatible = true; break;
    case 'bad-metadata': p.blocks[leaf.prototypeId].mutation.warp = true; finding('INVALID_PROCEDURE', leaf.prototypeId); break;
    case 'dead-branch-recursion': {
      const call = p.call(outer); p.blocks[leafSet].next = call; p.blocks[call].parent = leafSet;
      finding('RECURSIVE_PROCEDURE'); expected.findings.at(-1).possibleBlockIds = [call, nestedCall]; expected.findings.at(-1).blockId = undefined; break;
    }
    case 'multiple-entries': {
      const id = p.block('event_whenflagclicked'); p.blocks[id].topLevel = true;
      finding('SCRIPT_COUNT'); expected.allEntriesSupported = true; break;
    }
    case 'simultaneous-errors':
      p.blocks[set].opcode = 'looks_say'; p.blocks[nestedCall].next = 'absent'; p.blocks[unused.prototypeId].mutation.argumentids = 'broken';
      finding('UNSUPPORTED_OPCODE', set); finding('MISSING_BLOCK', nestedCall); finding('INVALID_PROCEDURE', unused.prototypeId); break;
    case 'missing-variables':
      p.blocks[set].fields.VARIABLE = ['absent', 'absent']; p.blocks[unusedSet].fields.VARIABLE = ['missing', 'missing'];
      finding('MISSING_VARIABLE', set); finding('MISSING_VARIABLE', unusedSet); break;
    case 'unicode': {
      // Rename all block IDs, maintaining references. No ASCII-only assumptions.
      const rename = id => id === null ? null : `积木😀${id}é`;
      project.targets[0].blocks = Object.fromEntries(Object.entries(p.blocks).map(([id, block]) => {
        const b = structuredClone(block); b.next = rename(b.next); b.parent = rename(b.parent);
        for (const d of Object.values(b.inputs)) for (let i = 1; i < d.length; i++) if (typeof d[i] === 'string') d[i] = rename(d[i]);
        return [rename(id), b];
      }));
      project.targets[0].name = '舞台😀'; expected.compatible = true; break;
    }
    case 'bad-parameter': p.blocks[leaf.prototypeId].mutation.argumentnames = '[]'; finding('INVALID_PROCEDURE', leaf.prototypeId); break;
    case 'unused-recursion': {
      const call = p.call(unused), tail = unusedBody.at(-1); p.blocks[tail].next = call; p.blocks[call].parent = tail;
      finding('RECURSIVE_PROCEDURE', call); break;
    }
    case 'target-local-missing': {
      const sprite = {name: 'Sprite', isStage: false, blocks: {[hat]: p.blocks[hat], [entryCall]: p.blocks[entryCall], [set]: p.blocks[set]}, variables: {}, lists: {}, broadcasts: {}};
      for (const id of [hat, entryCall, set]) delete p.blocks[id]; project.targets.push(sprite);
      finding('MISSING_PROCEDURE', entryCall, 'warning', 1); expected.compatible = true; break;
    }
    case 'hidden-unsupported': {
      const id = p.block('sensing_answer'); p.blocks[id].shadow = true; p.blocks[id].parent = set;
      p.blocks[set].inputs.VALUE = [3, [10, number()], id]; finding('UNSUPPORTED_OPCODE', id); break;
    }
    case 'bad-input': p.blocks[set].inputs.VALUE = [3, [10, 1]]; finding('INVALID_INPUT', set); break;
    case 'extensions': project.extensions = ['pen']; finding('UNSUPPORTED_FEATURE'); break;
    case 'dangling-parent': p.blocks[set].parent = 'absent'; finding('MISSING_BLOCK', set); finding('INVALID_PARENT', set); break;
    case 'shared-reporter': {
      const id = p.block('operator_round', {NUM: [1, [4, number()]]}); p.blocks[id].parent = set;
      const second = p.set('result', [2, id]); p.blocks[id].parent = set;
      p.blocks[set].inputs.VALUE = [2, id]; p.blocks[set].next = second; p.blocks[second].parent = set;
      finding('SHARED_BLOCK', id); break;
    }
    case 'bad-field': delete p.blocks[set].fields.VARIABLE; finding('INVALID_FIELD', set); break;
    case 'other-event': p.blocks[hat].opcode = 'event_whenkeypressed'; finding('UNSUPPORTED_OPCODE', hat); finding('EXTRA_SCRIPT', hat); finding('SCRIPT_COUNT'); break;
    default: throw new Error(`Unknown fixture kind: ${kind}`);
  }
  if (kind === 'supported') expected.reachability = {[hat]: 'entry', [outer.id]: 'called-procedure', [leaf.id]: 'called-procedure', [unused.id]: 'uncalled-procedure'};
  return {seed, kind, project, expected};
}
export function* inspectionCases() {
  for (let i = 0; i < inspectionSeedCount; i++) for (const kind of inspectionKinds) yield inspectionCase(inspectionSeedStart + i, kind);
}
