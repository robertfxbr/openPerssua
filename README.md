# OpenPerssua

> **Autor e mantenedor:** [Robert](https://github.com/robertfxbr) —
> desenvolvido com assistência de IA (Kimi). Contribuições são bem-vindas;
> veja `AGENTS.md` — inclui a política de créditos que vale também para
> agentes de IA que trabalharem neste código.

Copiloto de reuniões open source para desktop (Windows/macOS/Linux): um overlay
sempre visível que escuta o microfone e o áudio do sistema, transcreve com
Whisper local e responde perguntas sobre a conversa — **com o LLM que você já
tem**: ChatGPT (assinatura, via login OAuth), OpenAI API, Claude API,
**Claude Code CLI** ou Ollama local.

Projeto de portfólio: reimplementação limpa (MIT) baseada em análise de
comportamento de um produto comercial feita com
[REA](https://github.com/morluto/rea). Nenhum código ou asset do produto
original é usado. Ver `../ARCHITECTURE.md` para o desmembramento completo das
lógicas (274 canais IPC mapeados, 245 módulos analisados).

## Destaques técnicos

- **Electron + React + Vite**, processo principal modular (1 arquivo por domínio)
- **LLMRouter** com adapters plugáveis — interface única `chat/chatStream`:

  | Adapter | Backend | Credencial |
  |---|---|---|
  | `OpenAIAdapter` | api.openai.com | API key |
  | `ChatGPTOAuthAdapter` | Responses API | assinatura ChatGPT (OAuth PKCE, fluxo público do Codex CLI) |
  | `ClaudeAdapter` | api.anthropic.com | API key |
  | `ClaudeCodeAdapter` | subprocess `claude -p` | login local do Claude Code |
  | `OllamaAdapter` | servidor OpenAI-compatible local | nenhuma |

- **OAuth PKCE** contra `auth.openai.com` com token cifrado via `safeStorage`
- **Whisper local** (whisper.cpp server embutido no instalador) com buffer de
  áudio limitado e deltas de transcrição via IPC; SQLite (better-sqlite3) para
  sessões/mensagens
- **Captura de áudio do sistema (loopback)** via `electron-audio-loopback`:
  o app ouve o que os outros dizem em chamadas de Discord, Zoom, Google Meet,
  Teams etc. — sem driver virtual e sem configurar "mixagem estéreo". Duas
  sessões STT paralelas: `mic` (você) e `system` (a reunião)
- **Copiloto ativo (auto-assist)**: detector local de perguntas (heurística
  PT-BR/EN com janela de contexto — reconhece pergunta quebrada em duas
  falas), três modos (Entrevista com perfil/STAR, Reunião, Livre), cooldown
  anti-spam, chips de reformulação ("mais curto", "mais formal", "em inglês",
  "exemplo prático") e gatilho manual (botão ✦)
- **Rascunho ao vivo (modo Entrevista)**: o copiloto começa a redigir a
  resposta ~1s depois de detectar o início da pergunta — enquanto o
  entrevistador ainda está falando. Se a pergunta crescer, o rascunho é
  abortado e recomeçado com o texto completo (debounce de 1,4s), então a
  resposta final costuma estar pronta antes de ele terminar de perguntar
- **Atalhos globais configuráveis** (aba "atalhos" nas configurações): grave
  outra combinação, desative ou volte ao padrão. Combinação já usada por outro
  app aparece com ⚠. Padrões, todos sem tirar o foco da chamada:

  | Ação | Padrão |
  |---|---|
  | Mostrar/ocultar o overlay | `Ctrl+Shift+Space` |
  | Ligar/desligar a escuta | `Ctrl+Shift+M` |
  | Sugerir o que dizer agora | `Ctrl+Shift+Enter` |
  | Copiar a última sugestão | `Ctrl+Shift+C` (ou `Y` se o C estiver ocupado) |
  | Analisar a tela | `Ctrl+Shift+X` |
  | Perguntar sobre o texto copiado | `Ctrl+Shift+K` |
  | Mover para o próximo monitor | `Ctrl+Alt+→` |

- **Análise de tela** (botão 📷 ou atalho): captura o monitor onde o overlay
  está (o overlay some na hora da foto) e manda para um modelo de visão.
  Texto digitado no campo vira a pergunta sobre a tela. Funciona com OpenAI,
  ChatGPT, Claude API e modelos de visão no Ollama; o Claude Code CLI não
  recebe imagens e avisa isso
- **Texto copiado como pergunta**: o botão 📋 anexa o que está na área de
  transferência à próxima pergunta; o atalho pergunta direto sobre o trecho
- **Resumo automático** ao encerrar a escuta (decisões, ações, pendências),
  salvo na sessão em SQLite
- **VAD por fim de fala** (energy-based, AudioWorklet em thread dedicada):
  o flush acontece no fim do enunciado, não num relógio fixo — frases não são
  mais cortadas e o Whisper não "alucina" em silêncio. Idioma fixo PT-BR/EN-US
- **Vocabulário embutido de viés (prompt-biasing)**: nomes brasileiros mais
  frequentes (IBGE), termos de reunião/entrevista e tecnologia PT-BR/EN são
  injetados como `initial_prompt` do Whisper em toda sessão, corrigindo nomes
  próprios e jargões; o campo "vocabulário" das configurações soma termos
  seus (empresa, equipe, produto) com prioridade máxima
- **Histórico de sessões** com transcrição, respostas do copiloto e
  exportação em Markdown. Renomear, excluir (com confirmação), limpar tudo,
  duração e contagem de falas por sessão, e **continuar uma sessão antiga**:
  as falas anteriores voltam como contexto e as novas entram na mesma sessão
- **Timer da sessão** na pílula de status e no modo mini
- **Rolagem inteligente da transcrição**: acompanha a fala nova só se você já
  está no fim; se rolou para cima para reler, aparece "↓ novas falas"
- **Multi-monitor**: escolha o monitor do overlay na aba "sistema", pelo
  atalho ou pelo menu da bandeja (a posição relativa é mantida)
- **Logs de debug**: copiar o trecho recente ou abrir a pasta, pela aba
  "sistema" ou pela bandeja
- **Refresh token OAuth** do ChatGPT: o login não expira mais a cada sessão
- **Modo mini** (pílula compacta com a sugestão ao vivo), **medidores de
  áudio** mic/sistema, **temas** (escuro/claro, 3 acentos, opacidade, fonte)
  e **onboarding** de primeira execução em 3 passos
- Overlay transparente, always-on-top, com click-through e atalho global
- Streaming SSE/NDJSON ponta a ponta com abort (`AbortController`)

## Rodando

```bash
npm install
npm run dev        # Vite + Electron com hot reload
```

Pré-requisitos conforme o provedor escolhido:
- Whisper local: coloque o `whisper-server` (whisper.cpp) em
  `<userData>/whisper-bin/` — o modelo GGML é baixado automaticamente.
- Claude Code: `claude` CLI instalado e autenticado (`claude login`).
- Ollama: servidor em `http://127.0.0.1:11434`.

## Estrutura

```
electron/
  main.js                  bootstrap + bandeja + ações dos atalhos
  preload.js               contextBridge com allowlist
  windows/OverlayWindow.js overlay always-on-top / click-through
  shortcuts/               atalhos globais configuráveis
  system/                  monitores, captura de tela, logs
  stt/WhisperService.js    whisper.cpp server + sessões + cap de buffer
  llm/LLMRouter.js         seleção de provedor
  llm/messageFormat.js     mensagens com imagem no formato de cada API
  llm/providers/           OpenAI, ChatGPT OAuth, Claude, Claude Code, Ollama
  db/                      better-sqlite3 + schema.sql
  prompts/                 copiloto, resumo e análise de tela (anti prompt-injection)
  ipc/index.js             handlers por domínio
src/main.jsx               UI do overlay (React)
src/history/               tela de histórico
src/panels/                abas "atalhos" e "sistema" das configurações
```

## Gerando o instalador (Windows)

```bash
npm install        # se better-sqlite3 falhar por falta de Visual Studio,
                   # use: npm install --ignore-scripts (o electron-builder
                   # baixa o binário nativo certo para o Electron na hora de empacotar)
npm run dist:win   # gera release/OpenPerssua Setup X.Y.Z.exe (NSIS)
```

Notas de ambiente:
- Rode com um Node.js standalone (`C:\Program Files\nodejs\node.exe`). Se o
  ambiente tiver `ELECTRON_RUN_AS_NODE=1` exportado, remova-o antes do build
  (`env -u ELECTRON_RUN_AS_NODE ...`) — senão os processos filhos do
  electron-builder se comportam como Node e quebram o empacotamento.
- Se a extração do pacote `winCodeSign` falhar com "Cannot create symbolic
  link" (privilégio ausente no Windows sem Developer Mode), use o wrapper
  tolerante: renomeie `node_modules/7zip-bin/win/x64/7za.exe` para
  `7za-real.exe` e compile `7za.cs` (incluído neste repo) com
  `csc.exe -nologo -out:7za.exe 7za.cs` — o wrapper ignora erros de symlink
  que só afetam itens de build para macOS.
- O instalador não é assinado digitalmente (sem certificado); o Windows
  SmartScreen pode exibir aviso na primeira execução.

## Créditos de dados (vocabulário embutido)

O viés de transcrição (`electron/stt/vocabulary.js`) usa frequências e listas
públicas — obrigado aos mantenedores:

- **Nomes brasileiros**: IBGE/Censo 2010, via
  [datasets-br/prenomes](https://github.com/datasets-br/prenomes) e
  [MedidaSP/nomes-brasileiros-ibge](https://github.com/MedidaSP/nomes-brasileiros-ibge)
- **Frequência lexical PT-BR**: NILC/USP São Carlos e Corpus Brasileiro
  (PUC-SP) via [Linguateca](https://www.linguateca.pt/),
  [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) e
  [CaiqueDourado/dicionario-portugues](https://github.com/CaiqueDourado/dicionario-portugues)
- **Técnica de prompt-biasing**: parâmetro `initial_prompt`/`--prompt` do
  [whisper.cpp](https://github.com/ggerganov/whisper.cpp) e "keyword boosting"
  da API Whisper da OpenAI

Se você mantém alguma dessas fontes e quiser ajuste na atribuição, abra uma
issue.

## Licença

MIT — ver `LICENSE`.
