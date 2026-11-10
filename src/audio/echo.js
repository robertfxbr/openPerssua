// Filtro de eco por texto.
//
// Sem fone, o microfone capta o som da reunião que sai da caixa de som e a
// mesma fala aparece duas vezes: como "Reunião" (loopback) e como "Você"
// (mic). O cancelamento de eco do navegador não resolve aqui, porque ele só
// conhece o áudio que o próprio navegador toca, e o Zoom/Meet/Teams tocam por
// fora. A saída é comparar os textos: fala do mic quase igual a uma fala do
// sistema dos últimos segundos é eco e sai da transcrição.

export const ECHO_WINDOW_MS = 10000; // distância máxima entre as duas falas
export const ECHO_THRESHOLD = 0.6;   // fração de palavras em comum
const MIN_WORDS = 3;                 // frases curtas ("sim", "ok") coincidem por acaso

// "Olá, Mundo!" -> ["ola", "mundo"]
export function words(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

// Quanto da fala menor aparece na maior (0 a 1). Usar a menor como base
// pega o caso comum de o Whisper cortar a fala em pedaços diferentes nas
// duas fontes.
export function overlap(a, b) {
  const wa = words(a);
  const wb = words(b);
  if (wa.length < MIN_WORDS || wb.length < MIN_WORDS) return 0;
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const pool = new Map();
  for (const w of big) pool.set(w, (pool.get(w) || 0) + 1);
  let hits = 0;
  for (const w of small) {
    const n = pool.get(w) || 0;
    if (n > 0) { hits++; pool.set(w, n - 1); }
  }
  return hits / small.length;
}

// A fala nova bate com alguma da outra fonte dentro da janela de tempo?
// candidates: [{ text, ts }]
export function findEcho(text, ts, candidates) {
  return candidates.find((c) => Math.abs(ts - c.ts) <= ECHO_WINDOW_MS
    && overlap(text, c.text) >= ECHO_THRESHOLD) || null;
}
