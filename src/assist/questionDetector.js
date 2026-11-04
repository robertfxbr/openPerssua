// Detector leve de perguntas na fala do OUTRO participante (audio do sistema).
// Heuristica local, sem LLM — roda a cada delta de transcricao.
// Cobre PT-BR e EN, incluindo prompts tipicos de entrevista sem "?"
// ("fale sobre voce", "tell me about...").

const INTERROGATIVE_STARTERS = [
  // PT-BR
  'como', 'qual', 'quais', 'quando', 'onde', 'por que', 'porque',
  'quanto', 'quantos', 'quantas', 'quem', 'o que', 'em que',
  'de que', 'a que', 'pra que', 'para que', 'sera que', 'será que',
  'voce pode', 'voce consegue', 'voce poderia', 'voce saberia',
  'voce ja', 'voce tem', 'voce conhece', 'voce se considera',
  'voce acha', 'voce trabalhou', 'voce pretende', 'voce topa',
  'como voce', 'como foi', 'como seria', 'como esta', 'como está',
  'quanto tempo', 'qual a', 'qual o', 'qual foi', 'qual seria',
  'pode me', 'poderia me', 'consegue me', 'queria saber', 'queria te perguntar',
  'gostaria de saber', 'me conta', 'me conte', 'me fala', 'me fale',
  'me explica', 'me explique', 'me diz', 'me diga', 'me descreva',
  'fale sobre', 'fala sobre', 'conte sobre', 'fale um pouco', 'fale-me sobre',
  'descreva', 'comente sobre', 'explique como', 'diga-me',
  'se apresenta', 'se apresente', 'apresente-se',
  'tem alguma', 'existe alguma', 'chegou a', 'costuma',
  // EN-US
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'whose',
  "what's", 'how do you', 'how would you', 'how did you', 'how long',
  'what would you', 'what do you', 'what did you', 'what are your',
  'can you', 'could you', 'would you', 'do you', 'did you', 'are you',
  'have you', 'is there', 'if you could', 'suppose', 'imagine',
  'tell me', 'tell us', 'describe', 'walk me', 'walk us', 'walk through',
  'explain', 'give me an example', 'give us an example', 'give an example',
  'talk about', 'share with', 'share an example', "i'm curious",
  'i was wondering', 'any experience', 'ever had to',
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
