export const INSTRUCTION_USES = [
  ['response', 'Resposta e tela'],
  ['live', 'Sugestão ao vivo'],
  ['questions', 'Perguntas sugeridas'],
  ['summary', 'Resumo e e-mail'],
];

// O formato antigo já tem as instruções gerais; campos novos são opcionais.
export function normalizeAssistant(value) {
  return {
    id: typeof value?.id === 'string' ? value.id : '',
    name: typeof value?.name === 'string' ? value.name.slice(0, 60) : '',
    mode: ['interview', 'meeting', 'free'].includes(value?.mode) ? value.mode : null,
    instructions: typeof value?.instructions === 'string' ? value.instructions.slice(0, 4000) : '',
    instructionsByUse: Object.fromEntries(INSTRUCTION_USES.map(([key]) => [key,
      typeof value?.instructionsByUse?.[key] === 'string' ? value.instructionsByUse[key].slice(0, 4000) : ''])),
  };
}

export function parseSuggestedQuestions(text) {
  try {
    const items = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return Array.isArray(items) ? items.filter((q) => typeof q === 'string' && q.trim())
      .slice(0, 3).map((q) => q.trim().slice(0, 200)) : [];
  } catch { return []; }
}
