// Assistentes prontos: cada um junta um modo do copiloto e instruções de foco.
// Textos escritos para o Teka. O usuário pode duplicar e editar.

export const BUILTIN_ASSISTANTS = [
  {
    id: 'padrao',
    name: 'Padrão',
    mode: null, // não troca o modo atual
    instructions: '',
  },
  {
    id: 'entrevista-tecnica',
    name: 'Entrevista técnica',
    mode: 'interview',
    instructions: 'Priorize precisão técnica. Explique o raciocínio em passos curtos, cite trade-offs e complexidade quando fizer sentido e só mostre código se a pergunta pedir. Se a resposta não estiver clara, sugira admitir com honestidade e dizer como investigaria.',
  },
  {
    id: 'entrevista-comportamental',
    name: 'Entrevista comportamental',
    mode: 'interview',
    instructions: 'Responda com histórias reais do perfil, mostrando o impacto com números quando o perfil tiver. Evite clichês de entrevista. Termine com o que foi aprendido ou o que faria diferente.',
  },
  {
    id: 'vendas',
    name: 'Vendas e negociação',
    mode: 'meeting',
    instructions: 'Ajude a conduzir a conversa comercial: identifique a dor do cliente, sugira perguntas de descoberta, responda objeções com calma e proponha sempre um próximo passo concreto. Nunca invente preço, prazo ou condição comercial.',
  },
  {
    id: 'equipe',
    name: 'Reunião de equipe',
    mode: 'meeting',
    instructions: 'Seja objetivo: ajude a relatar progresso, bloqueios e próximos passos. Sugira perguntas que destravem decisões e avise quando uma tarefa ficar sem dono ou sem prazo.',
  },
  {
    id: 'aula',
    name: 'Aula e estudo',
    mode: 'free',
    instructions: 'Explique os conceitos citados de forma didática, com uma analogia simples e um exemplo. Destaque os termos que valem anotar e sugira uma pergunta para tirar dúvida com quem está ensinando.',
  },
  {
    id: 'atendimento',
    name: 'Atendimento ao cliente',
    mode: 'meeting',
    instructions: 'Ajude a resolver o problema do cliente: confirme o entendimento, sugira passos de diagnóstico em ordem e frases cordiais. Não prometa nada que dependa de outra área sem confirmar antes.',
  },
];

export const ASSISTANT_MODES = [
  ['interview', 'Entrevista'],
  ['meeting', 'Reunião'],
  ['free', 'Livre'],
];

export function findAssistant(id, custom) {
  return (custom || []).find((a) => a.id === id)
    || BUILTIN_ASSISTANTS.find((a) => a.id === id)
    || BUILTIN_ASSISTANTS[0];
}
