// Limpeza do texto copiado: tira oferta e abertura de assistente, nunca fala legítima.
import { cleanForCopy as c } from '../src/assist/cleanCopy.mjs';
let f = 0;
const eq = (name, got, want) => { const ok = got === want; if (!ok) f++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(got)); };
eq('oferta no fim', c('Eu trabalhei 3 anos com React.\n\nSe quiser, posso montar uma versão mais curta.'), 'Eu trabalhei 3 anos com React.');
eq('quer que eu', c('Resposta.\nQuer que eu adapte para inglês?'), 'Resposta.');
eq('posso também', c('Resposta.\n\n---\nPosso também preparar perguntas para o entrevistador.'), 'Resposta.');
eq('despedida', c('Resposta.\n\nEspero ter ajudado!'), 'Resposta.');
eq('inglês', c('I led the migration.\n\nIf you want, I can make it shorter.'), 'I led the migration.');
eq('abertura', c('Claro! Aqui está uma sugestão:\n\nEu proporia dividir a entrega.'), 'Eu proporia dividir a entrega.');
eq('aqui está:', c('Aqui está o e-mail:\nOlá, [nome]...'), 'Olá, [nome]...');
eq('negrito na oferta', c('Texto.\n\n**Se preferir, eu monto um roteiro completo.**'), 'Texto.');
// não pode mexer no que é fala legítima
eq('posso legítimo no fim', c('Fechamos o escopo hoje.\nPosso te mandar o relatório amanhã?'), 'Fechamos o escopo hoje.\nPosso te mandar o relatório amanhã?');
eq('quer que eu no meio', c('Quer que eu apresente o plano agora?\nAcho que ajuda a decidir.'), 'Quer que eu apresente o plano agora?\nAcho que ajuda a decidir.');
eq('camadas intactas', c('Eu escolheria Postgres.\n• Consistência: transações\n↪ Se insistirem: falo do custo'), 'Eu escolheria Postgres.\n• Consistência: transações\n↪ Se insistirem: falo do custo');
eq('claro como fala', c('Claro, dá para entregar até sexta.'), 'Claro, dá para entregar até sexta.');
eq('só oferta: mantém', c('Se quiser, posso detalhar.'), 'Se quiser, posso detalhar.');
eq('posso te ajudar é fala', c('Revisei o plano.\nPosso te ajudar a revisar o documento?'), 'Revisei o plano.\nPosso te ajudar a revisar o documento?');
eq('posso também é oferta', c('Revisei o plano.\nPosso também preparar um resumo para o time.'), 'Revisei o plano.');
console.log(f ? `FAIL: ${f} caso(s) da limpeza de cópia` : 'PASS: limpeza de cópia (ofertas e aberturas saem, fala legítima fica)');
if (f) process.exit(1);
