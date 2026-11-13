// Pedaços de prompt reaproveitados por vários modos.

const MAX_ASSISTANT_CHARS = 8002; // gerais + instruções do uso atual
const MAX_MEMORY_CHARS = 6000;

// Instruções do assistente escolhido (Configurações → assistentes). Vêm do
// próprio usuário, então entram no system prompt, abaixo das regras fixas:
// elas ajustam tom e foco, mas não revogam as regras de segurança.
function withAssistant(system, instructions) {
  const text = typeof instructions === 'string' ? instructions.trim().slice(0, MAX_ASSISTANT_CHARS) : '';
  if (!text) return system;
  return `${system}\n\nInstruções do assistente escolhido pelo usuário (seguem valendo as regras acima):\n${text}`;
}

// Memória compactada da reunião: resumo das falas antigas que já saíram da
// janela de contexto. Também é dado derivado da transcrição, não instrução.
function memoryBlock(memory) {
  const text = typeof memory === 'string' ? memory.trim().slice(0, MAX_MEMORY_CHARS) : '';
  if (!text) return '';
  return `<memoria_da_reuniao>\nResumo do que foi dito antes das falas abaixo:\n${text}\n</memoria_da_reuniao>\n`;
}

function transcriptLines(transcript) {
  return (transcript || []).map((t) => `[${t.source}] ${t.text}`).join('\n');
}

module.exports = { withAssistant, memoryBlock, transcriptLines };
