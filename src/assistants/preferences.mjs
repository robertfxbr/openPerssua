export const MCP_STAGES = [['choice', 'Escolha da ferramenta'], ['result', 'Resumo do resultado'], ['next', 'Próximo passo']];

export function normalizePreferences(value) {
  const result = { certainOnly: value?.certainOnly === true };
  if (Array.isArray(value?.mcpServerIds)) result.mcpServerIds = [...new Set(value.mcpServerIds.filter(id => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)))].slice(0, 100);
  if (value?.mcpInstructions && typeof value.mcpInstructions === 'object') result.mcpInstructions = Object.fromEntries(MCP_STAGES.map(([stage]) => [stage,
    typeof value.mcpInstructions[stage] === 'string' ? value.mcpInstructions[stage].slice(0, 4000) : '']));
  return result;
}

// Permissões são locais: importar um assistente nunca habilita servidores.
export function exportPreferences(value) {
  const { mcpServerIds, ...portable } = normalizePreferences(value);
  return portable;
}
