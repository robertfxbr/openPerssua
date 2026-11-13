import assert from 'node:assert/strict';
import { normalizeAssistant, parseSuggestedQuestions } from '../src/assistants/model.mjs';
import { findAssistant } from '../src/assistants/presets.js';

const old = { id: 'c-antigo', name: 'Antigo', mode: 'interview', instructions: 'Use fatos reais' };
const opened = normalizeAssistant(findAssistant(old.id, [old]));
assert.equal(opened.instructions, old.instructions);
assert.equal(opened.mode, old.mode);
assert.deepEqual(opened.instructionsByUse, { response: '', live: '', questions: '', summary: '' });
const edited = normalizeAssistant({ ...opened, name: 'Editado' });
assert.equal(edited.instructions, old.instructions);
assert.equal(findAssistant(edited.id, [edited]).name, 'Editado');
assert.equal(normalizeAssistant({ instructions: 'a'.repeat(5000) }).instructions.length, 4000);
assert.deepEqual(parseSuggestedQuestions('["Uma?",null,4,"Duas?"]'), ['Uma?', 'Duas?']);
assert.deepEqual(parseSuggestedQuestions('```json\n["Uma?"]\n```'), ['Uma?']);
assert.deepEqual(parseSuggestedQuestions('texto inesperado'), []);
console.log('PASS: formato antigo abre, edita e é encontrado; perguntas validadas');
