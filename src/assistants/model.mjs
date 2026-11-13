export const INSTRUCTION_USES = [
  ['response', 'Resposta e tela'],
  ['live', 'Sugestão ao vivo'],
  ['questions', 'Perguntas sugeridas'],
  ['summary', 'Resumo e e-mail'],
];
export const DEFAULT_CATEGORIES = ['Geral', 'Entrevistas', 'Reuniões', 'Vendas', 'Estudo', 'Atendimento'];

// O formato antigo já tem as instruções gerais; campos novos são opcionais.
export function normalizeAssistant(value) {
  return {
    id: typeof value?.id === 'string' ? value.id : '',
    name: typeof value?.name === 'string' ? value.name.slice(0, 60) : '',
    mode: ['interview', 'meeting', 'free'].includes(value?.mode) ? value.mode : null,
    instructions: typeof value?.instructions === 'string' ? value.instructions.slice(0, 4000) : '',
    category: typeof value?.category === 'string' && value.category.trim() ? value.category.trim().slice(0, 40) : 'Geral',
    instructionsByUse: Object.fromEntries(INSTRUCTION_USES.map(([key]) => [key,
      typeof value?.instructionsByUse?.[key] === 'string' ? value.instructionsByUse[key].slice(0, 4000) : ''])),
  };
}

const searchable = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function filterAssistants(assistants, query = '', category = '') {
  return assistants.filter((a) => searchable(a.name).includes(searchable(query.trim()))
    && (!category || normalizeAssistant(a).category === category));
}

export function categoryCounts(assistants, query = '') {
  const counts = new Map();
  for (const a of filterAssistants(assistants, query)) {
    const category = normalizeAssistant(a).category;
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return counts;
}

export function parseSuggestedQuestions(text) {
  try {
    const items = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return Array.isArray(items) ? items.filter((q) => typeof q === 'string' && q.trim())
      .slice(0, 3).map((q) => q.trim().slice(0, 200)) : [];
  } catch { return []; }
}
