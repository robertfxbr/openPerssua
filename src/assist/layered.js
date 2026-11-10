// Resposta "em camadas" do modo Entrevista (ver electron/prompts/assist.js):
//   1ª linha  - a resposta direta, que o candidato começa a falar
//   "• a: b"  - argumentos com a prova depois dos dois-pontos
//   "↪ Se insistirem: ..." - preparo para a próxima pergunta
// Funciona com texto ainda chegando (streaming): cada linha aparece no
// lugar certo assim que começa. Texto fora do formato vira parágrafo comum.

const BULLET = /^\s*(?:[•●▪◦*-]|\d+[.)])\s+/;
const PUSH = /^\s*(?:↪\s*)?se insistirem\s*:?\s*/i;

function clean(line) {
  return line.replace(/\*\*/g, '').trim(); // modelo às vezes manda negrito
}

export function parseLayered(text) {
  const lines = String(text || '').split('\n').map(clean).filter(Boolean);
  const out = { lead: '', points: [], push: '', extra: [] };
  for (const line of lines) {
    if (PUSH.test(line)) { out.push = line.replace(PUSH, ''); continue; }
    if (BULLET.test(line)) {
      const body = line.replace(BULLET, '');
      const i = body.indexOf(':');
      // "argumento: prova" separa em duas partes; sem dois-pontos fica inteiro
      out.points.push(i > 0 && i < 60 ? { claim: body.slice(0, i).trim(), proof: body.slice(i + 1).trim() } : { claim: body, proof: '' });
      continue;
    }
    if (!out.lead && !out.points.length) out.lead = line;
    else out.extra.push(line);
  }
  return out;
}

// Só a primeira linha (modo mini e cópia rápida)
export function leadLine(text) {
  return parseLayered(text).lead || String(text || '').trim().split('\n')[0] || '';
}
