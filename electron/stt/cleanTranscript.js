// Limpa o que o Whisper devolve antes de virar fala na transcrição.
//
// Em silêncio ou ruído o Whisper "alucina": devolve texto que ninguém disse,
// quase sempre o mesmo punhado de frases (legendas de vídeo do treino dele)
// ou marcações como [Música]. Medido no banco de testes: silêncio virava
// ".com." e ruído virava "[Som de fio]".

// Frases que só aparecem como alucinação quando são a fala INTEIRA
const HALLUCINATIONS = [
  'legendas pela comunidade amara.org',
  'legendado por',
  'obrigado por assistir',
  'obrigada por assistir',
  'inscreva-se no canal',
  'thanks for watching',
  'thank you for watching',
  'subtitles by the amara.org community',
  '.com',
  'tchau',
  'obrigado',
  'obrigada',
  'thank you',
];

function normalize(t) {
  return t.toLowerCase().replace(/[\s.!?…,"'“”]+/g, ' ').trim();
}

const NORMALIZED = new Set(HALLUCINATIONS.map(normalize));

function cleanTranscript(text) {
  let t = String(text || '');
  // [Música], (risos), *aplausos*: marcação de som, não é fala
  t = t.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (!/\p{L}{2,}/u.test(t)) return ''; // sobrou só pontuação ou letra solta
  if (NORMALIZED.has(normalize(t))) return '';
  // A fala inteira é só um "endereço" (o modelo base devolveu
  // "www.sup.com.com.au" num trecho mudo)
  if (/^(www\.)?[\w-]+(\.[\w-]+)*\.(com|org|net|br|au|io)(\.[\w-]+)*\.?$/i.test(t)) return '';
  return t;
}

// Pico de volume do PCM s16le. Abaixo de ~-40 dBFS não há fala para o
// Whisper, só silêncio ou chiado, que é onde ele alucina.
const SILENCE_PEAK = 330;
function isSilent(pcm) {
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    if (Math.abs(pcm.readInt16LE(i)) >= SILENCE_PEAK) return false;
  }
  return true;
}

module.exports = { cleanTranscript, isSilent, SILENCE_PEAK };
