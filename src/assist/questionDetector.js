// Detector leve de perguntas na fala do OUTRO participante (audio do sistema).
// Heuristica local, sem LLM — roda a cada delta de transcricao.
// Cobre PT-BR e EN, incluindo prompts tipicos de entrevista sem "?"
// ("fale sobre voce", "tell me about...").

const INTERROGATIVE_STARTERS = [
  // PT
  'como', 'qual', 'quais', 'quando', 'onde', 'por que', 'porque',
  'quanto', 'quantos', 'quantas', 'quem', 'voce pode',
  'voce consegue', 'voce poderia',
  'voce ja', 'voce tem', 'voce conhece',
  'voce acha', 'voce trabalhou',
  'pode me', 'poderia me', 'consegue me', 'queria saber', 'queria te perguntar',
  'gostaria de saber', 'me conta', 'me conte', 'me fala', 'me fale',
  'me explica', 'me explique', 'me diz', 'me diga',
  'fale sobre', 'fala sobre', 'conte sobre', 'fale um pouco', 'fale-me sobre',
  'se apresenta', 'se apresente', 'apresente-se',
  // EN
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'whose',
  'can you', 'could you', 'would you', 'do you', 'did you', 'are you',
  'have you', 'is there', 'tell me', 'tell us', 'describe', 'walk me',
  'walk us', 'explain', 'give me an example', 'give us an example',
  'talk about', 'share with', "i'm curious", 'i was wondering',
];

const MIN_LEN = 14; // abaixo disso costuma ser ruido de transcricao

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacriticos combinantes
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Retorna a pergunta detectada no trecho (string) ou null.
 * Estrategia:
 *  1. Se ha "?", extrai a sentenca interrogativa mais longa.
 *  2. Senao, casa inicios interrogativos/imperativos tipicos de pergunta.
 */
export function detectQuestion(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length < MIN_LEN) return null;

  // 1. sentenca terminada em "?"
  const qMarkMatches = raw.match(/[^.!?\n]{10,}\?/g);
  if (qMarkMatches?.length) {
    return qMarkMatches.sort((a, b) => b.length - a.length)[0].trim();
  }

  // 2. inicio interrogativo/imperativo (sem "?")
  const norm = normalize(raw);
  for (const starter of INTERROGATIVE_STARTERS) {
    const s = normalize(starter);
    if (norm.startsWith(s) || norm.includes(` ${s} `)) {
      return raw;
    }
  }
  return null;
}

export default { detectQuestion };
