// Só o texto extraído é persistido. Nomes nunca são usados como caminhos.
export const MAX_CONTEXT_CHARS = 20000;
export const MAX_CONTEXT_FILES = 30;

export function normalizeContext(value) {
  let remaining = MAX_CONTEXT_CHARS;
  const take = (text) => {
    const result = typeof text === 'string' ? text.slice(0, remaining) : '';
    remaining -= result.length;
    return result;
  };
  const text = take(value?.text);
  const files = (Array.isArray(value?.files) ? value.files : []).slice(0, MAX_CONTEXT_FILES)
    .filter((f) => typeof f?.name === 'string' && typeof f?.text === 'string')
    .map((f) => ({ name: f.name.slice(0, 120), text: take(f.text) }));
  return { text, files };
}

export function contextSize(value) {
  const context = normalizeContext(value);
  return context.text.length + context.files.reduce((n, f) => n + f.text.length, 0);
}

export function contextToText(value) {
  const { text, files } = normalizeContext(value);
  return [text, ...files.map((f) => `Arquivo: ${f.name}\n${f.text}`)].filter(Boolean).join('\n\n');
}

export function appendContextFile(value, file) {
  const context = normalizeContext(value);
  if (context.files.length >= MAX_CONTEXT_FILES) throw new Error('Limite de 30 anexos por assistente.');
  const room = MAX_CONTEXT_CHARS - contextSize(context);
  if (room <= 0) throw new Error('Contexto cheio. Remova um anexo ou reduza o texto.');
  const text = file.text.slice(0, room);
  return { context: normalizeContext({ ...context, files: [...context.files, { name: file.name, text }] }),
    truncated: text.length < file.text.length };
}
