import { BUILTIN_ASSISTANTS } from './presets.js';
import { normalizeAssistant, INSTRUCTION_USES } from './model.mjs';
import { normalizeContext, MAX_CONTEXT_CHARS, MAX_CONTEXT_FILES } from './context.mjs';

export const MAX_TRANSFER_BYTES = 20 * 1024 * 1024;
export const MAX_CUSTOM_ASSISTANTS = 100;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function string(value, name, max, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name}: texto inválido ou maior que ${max} caracteres.`);
  return value;
}

function validateItem(item, index) {
  if (!object(item)) throw new Error(`Assistente ${index + 1}: formato inválido.`);
  const id = string(item.id, 'Id', 80);
  if (!/^[a-zA-Z0-9][\w-]*$/.test(id) || FORBIDDEN_KEYS.has(id)) throw new Error('Id de assistente inválido.');
  const name = string(item.name, 'Nome', 60).trim();
  if (!name) throw new Error('O assistente precisa de um nome.');
  if (item.mode !== null && !['interview', 'meeting', 'free'].includes(item.mode)) throw new Error('Modo de assistente inválido.');
  string(item.instructions, 'Instruções gerais', 4000, true);
  string(item.category, 'Categoria', 40, true);
  if (item.instructionsByUse !== undefined && !object(item.instructionsByUse)) throw new Error('Instruções por uso inválidas.');
  for (const [key, label] of INSTRUCTION_USES) string(item.instructionsByUse?.[key], label, 4000, true);
  if (item.preferences !== undefined && !object(item.preferences)) throw new Error('Preferências inválidas.');
  if (item.preferences?.certainOnly !== undefined && typeof item.preferences.certainOnly !== 'boolean') throw new Error('A opção de certeza deve ser ligada ou desligada.');
  const context = item.context ?? { text: '', files: [] };
  if (!object(context)) throw new Error('Contexto inválido.');
  const text = string(context.text, 'Contexto', MAX_CONTEXT_CHARS, true);
  const files = context.files ?? [];
  if (!Array.isArray(files) || files.length > MAX_CONTEXT_FILES) throw new Error('Limite de 30 anexos por assistente.');
  let total = text.length;
  for (const file of files) {
    if (!object(file)) throw new Error('Anexo inválido.');
    string(file.name, 'Nome do anexo', 120);
    total += string(file.text, 'Texto do anexo', MAX_CONTEXT_CHARS).length;
  }
  if (total > MAX_CONTEXT_CHARS) throw new Error('O contexto excede 20.000 caracteres.');
  // Reconstrói somente campos conhecidos; nenhum comando ou caminho é usado.
  return { ...normalizeAssistant({ ...item, name }), context: normalizeContext(context),
    preferences: { certainOnly: item.preferences?.certainOnly === true } };
}

export function serializeAssistants(custom, contexts, preferences) {
  const assistants = custom.filter((a) => !BUILTIN_ASSISTANTS.some((b) => b.id === a.id)).map((a) => ({
    ...normalizeAssistant(a), context: normalizeContext(contexts[a.id]),
    preferences: { certainOnly: preferences[a.id]?.certainOnly === true },
  }));
  const json = JSON.stringify({ format: 'teka-assistants', version: 1, assistants }, null, 2);
  // Usa a mesma validação da importação para garantir ida e volta.
  parseAssistantImport(json, []);
  return json;
}

export function parseAssistantImport(json, existingIds, createId = () => `c-${crypto.randomUUID()}`) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_TRANSFER_BYTES) throw new Error('Arquivo grande demais (máximo de 20 MB).');
  let document;
  try {
    document = JSON.parse(json, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('Chave não permitida.');
      return value;
    });
  } catch { throw new Error('JSON inválido ou com chaves não permitidas.'); }
  if (!object(document) || document.format !== 'teka-assistants' || document.version !== 1 || !Array.isArray(document.assistants)) {
    throw new Error('Formato não reconhecido. Escolha um JSON de assistentes exportado pelo Teka.');
  }
  if (document.assistants.length > MAX_CUSTOM_ASSISTANTS || existingIds.length + document.assistants.length > MAX_CUSTOM_ASSISTANTS) throw new Error('Limite de 100 assistentes próprios.');
  const used = new Set([...existingIds, ...BUILTIN_ASSISTANTS.map((a) => a.id)]);
  return document.assistants.map((source, index) => {
    const item = validateItem(source, index);
    if (used.has(item.id)) {
      let candidate;
      for (let attempt = 0; attempt < 100; attempt++) {
        candidate = createId();
        if (/^[a-zA-Z0-9][\w-]{0,79}$/.test(candidate) && !FORBIDDEN_KEYS.has(candidate) && !used.has(candidate)) break;
        candidate = null;
      }
      if (!candidate) throw new Error('Não foi possível gerar um id livre.');
      item.id = candidate;
    }
    used.add(item.id);
    return item;
  });
}
