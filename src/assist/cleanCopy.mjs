// Garantia na hora de copiar: o prompt já proíbe, mas se o modelo escapar
// com uma oferta ("Se quiser, posso...") ou uma abertura de assistente
// ("Claro! Aqui está:"), isso não vai junto para a área de transferência.
//
// Conservador de propósito: só tira linhas inteiras no COMEÇO ou no FIM do
// texto, e só quando elas falam do próprio assistente. O meio da resposta
// nunca é tocado, porque uma sugestão de fala pode ter "posso" legítimo
// ("Posso te mandar o relatório amanhã?").

// Fecho: oferta de mais ajuda ou despedida de assistente
const TRAILING = [
  // "Se quiser, posso...", "Se preferir, eu monto...", "Caso queira, consigo..."
  /^(se (você )?(quiser|preferir|precisar|desejar)|caso (você )?(queira|prefira|precise|deseje))\b.*\b(posso|consigo|eu (posso|faço|monto|preparo|adapto|escrevo|gero|crio))\b/i,
  // "Quer que eu...", "Gostaria que eu...", "Prefere que eu..."
  /^(você )?(quer|gostaria|prefere|deseja) que eu\b/i,
  // "Posso também montar...", "Posso ainda preparar..." (sem "também/ainda"
  // pode ser fala de verdade: "Posso te ajudar a revisar o documento?")
  /^(eu )?posso (também|ainda) (te |lhe )?(ajudar|montar|preparar|criar|gerar|adaptar|reescrever|fazer|elaborar|detalhar|aprofundar|sugerir|transformar|resumir|traduzir|ajustar|escrever)\b/i,
  // despedidas
  /^(espero (ter ajudado|que (isso )?ajude)|qualquer (dúvida|coisa)|me avise( se)?|me diga se|fico à disposição|estou à disposição|bons estudos|boa sorte)\b/i,
  // inglês
  /^(if you('d)? (want|like|prefer)|would you like me|do you want me|want me to|let me know|i can also|i('d| would) be happy to|hope (this|that) helps|feel free to)\b/i,
];

// Abertura: só a linha que é inteira de assistente ("Claro! Aqui está:")
const LEADING = [
  // (sem \b depois de "está": no JavaScript, \b não vê fim de palavra após letra acentuada)
  /^(claro|com certeza|certo|perfeito|ótima pergunta|boa pergunta|excelente pergunta)[!.,]?\s*((aqui está|aqui vai|segue)(?=[\s:]).*)?$/i,
  /^(aqui está|aqui vai|segue)(?=[\s:]).{0,60}:$/i,
  /^(sure|of course|great question|here('s| is)\b.{0,60}:)[!.]?$/i,
];

// Uma "linha" para o teste: sem marcador de lista, negrito ou emoji na frente
function bare(line) {
  return line.trim().replace(/^([-*•>↪]\s*|\*\*|__)+/, '').replace(/(\*\*|__)$/, '').trim();
}

export function cleanForCopy(text) {
  if (typeof text !== 'string') return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const isBlank = (l) => !l.trim();
  // fim: tira linhas de oferta/despedida (e separadores "---" soltos)
  for (;;) {
    while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
    if (!lines.length) break;
    const raw = lines[lines.length - 1].trim();
    if (/^[-–—_*]{3,}$/.test(raw) || TRAILING.some((re) => re.test(bare(raw)))) { lines.pop(); continue; }
    break;
  }
  // começo: tira a abertura de assistente
  for (;;) {
    while (lines.length && isBlank(lines[0])) lines.shift();
    if (!lines.length) break;
    if (LEADING.some((re) => re.test(bare(lines[0])))) { lines.shift(); continue; }
    break;
  }
  const out = lines.join('\n').trim();
  // Se a limpeza apagaria tudo, melhor copiar o original do que nada
  return out || text.trim();
}
