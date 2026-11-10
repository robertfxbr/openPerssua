// Vocabulário embutido para viés de transcrição do Whisper (initial_prompt).
//
// O whisper.cpp aceita um campo `prompt` que é injetado como contexto inicial
// do decoder: termos presentes ali ganham prioridade fonética, o que corrige
// nomes próprios e jargões (ex.: "Robert" → não "bitch"). Referências da
// técnica: parâmetro initial_prompt do whisper.cpp/whisper e "keyword
// boosting" da API Whisper da OpenAI.
//
// Fontes das listas (ver README > Créditos de dados):
//  - Nomes brasileiros: IBGE/Censo 2010 (datasets-br/prenomes e
//    MedidaSP/nomes-brasileiros-ibge, top frequências)
//  - Frequência lexical PT-BR: NILC/USP São Carlos via Linguateca,
//    Corpus Brasileiro (PUC-SP), hermitdave/FrequencyWords,
//    CaiqueDourado/dicionario-portugues
//  - Termos de reunião/entrevista/tecnologia: curadoria manual PT-BR + EN-US
//
// Limite prático: o prompt efetivo do Whisper é curto (~200 tokens); manter
// as listas enxutas e priorizar o prompt do usuário (vem primeiro).

// Nomes próprios mais frequentes no Brasil (IBGE) — maior ganho real de
// precisão em conversas, onde nomes próprios são o erro mais comum.
const NOMES_BR =
  'José, João, Antônio, Francisco, Carlos, Paulo, Pedro, Lucas, Luiz, Marcos, ' +
  'Luis, Gabriel, Rafael, Daniel, Marcelo, Bruno, Eduardo, Felipe, Rodrigo, ' +
  'Roberto, Robert, Ricardo, André, Thiago, Diego, Leonardo, Gustavo, ' +
  'Guilherme, Matheus, Vitor, Vinícius, Alexandre, Fernando, Fábio, Renato, ' +
  'Márcio, Anderson, Jefferson, César, Maria, Ana, Francisca, Antônia, ' +
  'Adriana, Juliana, Márcia, Fernanda, Patrícia, Aline, Sandra, Camila, ' +
  'Amanda, Bruna, Jéssica, Letícia, Júlia, Luciana, Vanessa, Mariana, ' +
  'Gabriela, Renata, Carla, Beatriz, Larissa, Carolina, Natália, Priscila, ' +
  'Débora, Cristiane, Paula, Rafaela, Silva, Santos, Oliveira, Souza, ' +
  'Rodrigues, Ferreira, Alves, Pereira, Lima, Gomes, Costa, Ribeiro, ' +
  'Martins, Carvalho, Almeida, Lopes, Soares, Fernandes, Vieira, Barbosa, ' +
  'Rocha, Dias, Nascimento, Andrade, Moreira, Nunes, Marques, Machado, ' +
  'Mendes, Freitas, Cardoso, Ramos, Gonçalves, Santana, Teixeira';

// Reuniões e entrevistas de emprego (PT-BR).
const REUNIAO_PT =
  'entrevista, reunião, experiência, currículo, pretensão salarial, ' +
  'benefícios, home office, híbrido, presencial, contratação, CLT, PJ, ' +
  'estágio, júnior, pleno, sênior, tech lead, gestor, feedback, onboarding, ' +
  'cultura, desafio, projeto, prazo, entrega, sprint, daily, planning, ' +
  'retrospectiva, roadmap, backlog, stakeholder, KPI, OKR, meta, resultado, ' +
  'orçamento, budget, faturamento, cliente, fornecedor, contrato, proposta, ' +
  'alinhamento, pauta, ata, follow-up, deadline';

// Tecnologia (PT-BR + termos usados em inglês no dia a dia brasileiro).
const TECH_PT =
  'desenvolvedor, programador, front-end, back-end, full stack, DevOps, ' +
  'banco de dados, API, JavaScript, TypeScript, Python, React, Node.js, ' +
  'Java, C#, SQL, Git, GitHub, Docker, Kubernetes, AWS, Azure, nuvem, ' +
  'microsserviços, testes, deploy, CI/CD, machine learning, inteligência ' +
  'artificial, LLM, prompt, produto, UX, UI, designer, product owner, ' +
  'scrum master, agile, kanban, ChatGPT, Claude, OpenAI, Anthropic';

// Núcleo EN-US para reuniões/entrevistas em inglês.
const VOCAB_EN =
  'Robert, interview, meeting, experience, resume, salary, benefits, remote, ' +
  'hybrid, hiring, manager, feedback, onboarding, culture, challenge, ' +
  'project, deadline, deliverable, sprint, standup, retrospective, roadmap, ' +
  'backlog, stakeholder, KPI, OKR, budget, revenue, client, vendor, ' +
  'contract, proposal, agenda, minutes, follow-up, developer, frontend, ' +
  'backend, full stack, DevOps, database, API, JavaScript, TypeScript, ' +
  'Python, React, Node.js, SQL, Git, GitHub, Docker, Kubernetes, AWS, ' +
  'Azure, cloud, microservices, CI/CD, machine learning, AI, LLM, product, ' +
  'UX, UI, scrum, agile, kanban, ChatGPT, Claude, OpenAI, Anthropic, ' +
  'Teka';

const VOCAB_PT = `${NOMES_BR}. ${REUNIAO_PT}. ${TECH_PT}. Teka`;

// Versão compacta para idioma "auto": nomes (maior fonte de erro) + núcleo EN.
const VOCAB_AUTO = `${NOMES_BR}. ${REUNIAO_PT}. ${TECH_PT}. ${VOCAB_EN}`;

/**
 * Compõe o prompt de viés final: o prompt do usuário tem prioridade (vem
 * primeiro), seguido do vocabulário embutido do idioma ativo.
 * @param {string} userPrompt vocabulário livre do usuário (settings stt.prompt)
 * @param {string} language 'pt' | 'en' | 'auto'
 */
function composePrompt(userPrompt, language = 'auto') {
  const parts = [];
  const custom = String(userPrompt || '').trim();
  if (custom) parts.push(custom);
  if (language === 'en') parts.push(VOCAB_EN);
  else if (language === 'pt') parts.push(VOCAB_PT);
  else parts.push(VOCAB_AUTO);
  return parts.join(' ');
}

module.exports = { composePrompt, VOCAB_PT, VOCAB_EN, VOCAB_AUTO };
