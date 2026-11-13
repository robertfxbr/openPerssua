import assert from 'node:assert/strict';
import { serializeAssistants, parseAssistantImport, MAX_TRANSFER_BYTES } from '../src/assistants/transfer.mjs';

const old = { id: 'c-1', name: 'Antigo', mode: 'interview', instructions: 'Gerais' };
const context = { text: 'Experiência real', files: [{ name: 'vaga.txt', text: 'Requisitos' }] };
const preferences = { certainOnly: true };
const json = serializeAssistants([old], { 'c-1': context }, { 'c-1': preferences });
const parsed = parseAssistantImport(json, []);
assert.equal(parsed[0].instructions, old.instructions);
assert.deepEqual(parsed[0].context, context);
assert.deepEqual(parsed[0].preferences, preferences);
assert.equal(parsed[0].category, 'Geral');
const allFields = { ...parsed[0], instructionsByUse: { response: 'R', live: 'V', questions: 'P', summary: 'S' }, category: 'Minha' };
const full = serializeAssistants([allFields], { 'c-1': context }, { 'c-1': preferences });
assert.deepEqual(parseAssistantImport(full, [])[0], allFields);
const existing = parseAssistantImport(full, ['c-1'], () => 'c-novo');
assert.equal(existing[0].id, 'c-novo');
const document = JSON.parse(json);
document.assistants.push({ ...document.assistants[0] });
assert.equal(parseAssistantImport(JSON.stringify(document), [], () => 'c-outro')[1].id, 'c-outro');
document.assistants[0].id = 'padrao';
assert.notEqual(parseAssistantImport(JSON.stringify(document), [], () => `c-${crypto.randomUUID()}`)[0].id, 'padrao');

for (const invalid of ['null', '[]', '{}', '{', '{"format":"outro","version":1,"assistants":[]}',
  '{"format":"teka-assistants","version":99,"assistants":[]}', '{"__proto__":{"poluido":true}}',
  'x'.repeat(MAX_TRANSFER_BYTES + 1)]) assert.throws(() => parseAssistantImport(invalid, []));
assert.equal({}.poluido, undefined);
for (const patch of [{ name: 4 }, { mode: 'executar' }, { instructions: 'a'.repeat(4001) },
  { context: { text: 'a'.repeat(20001), files: [] } }, { context: { text: '', files: [{ name: 'a', text: false }] } },
  { preferences: { certainOnly: 'false' } }, { instructionsByUse: { response: 5 } }, { category: 'a'.repeat(41) }]) {
  const doc = JSON.parse(json); doc.assistants[0] = { ...doc.assistants[0], ...patch };
  assert.throws(() => parseAssistantImport(JSON.stringify(doc), []));
}
const malicious = JSON.parse(json);
malicious.assistants[0].command = 'nunca executar';
assert.equal(parseAssistantImport(JSON.stringify(malicious), [])[0].command, undefined);
assert.throws(() => parseAssistantImport(json, Array.from({ length: 100 }, (_, i) => `c-${i}`)), /100/);
console.log('PASS: exportação/importação completa, legado, conflitos, limites e entradas hostis');
