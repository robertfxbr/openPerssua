# Auditoria do OpenPerssua — v0.1.0 → v0.1.1

Auditoria de código realizada em 02/11/2026 sobre a primeira versão empacotada.
Cada achado abaixo foi **corrigido** no código; a coluna "gravidade" reflete o
impacto antes da correção.

## Críticos (quebravam funcionalidade)

| # | Arquivo | Problema | Correção |
|---|---|---|---|
| C1 | `electron/main.js` | **Microfone negado no app empacotado**: sem `setPermissionRequestHandler`, o Electron nega `getUserMedia` por padrão e a escuta falhava silenciosamente | Handler de permissões com allowlist (`media`, `display-capture`, `clipboard-sanitized-write`) |
| C2 | `electron/preload.js` × `ipc/index.js` | **Canal órfão**: renderer chamava `overlay:toggle`, mas não existia handler no main | Handler registrado |
| C3 | `electron/llm/providers/ChatGPTOAuthAdapter.js` | **Endpoint errado**: tokens OAuth do login ChatGPT não são aceitos em `api.openai.com/v1/responses` — toda chamada retornaria 401 | Migrado para o backend do Codex (`chatgpt.com/backend-api/codex/responses`) com header `OpenAI-Beta: responses=experimental` e `chatgpt-account-id` extraído do JWT |
| C4 | `src/main.jsx` | **Race no streaming**: listeners de chunk eram inscritos *depois* do invoke; o primeiro delta podia se perder | Listeners inscritos antes do invoke, com Promise de conclusão |

## Altos (falhas em condições reais de uso)

| # | Arquivo | Problema | Correção |
|---|---|---|---|
| A1 | `electron/llm/providers/ClaudeCodeAdapter.js` | Prompt do usuário ia por **argv com shell:true** — aspas/acentos quebravam o comando e havia risco de injeção de shell + limite de 8k chars do Windows | Prompt enviado por **stdin** (`claude -p` lê stdin); argv só com flags |
| A2 | `electron/stt/WhisperService.js` | `setTimeout(1500)` fixo aguardando o whisper carregar — modelos maiores que `base` estouravam | Poll de readiness HTTP com timeout de 120 s |
| A3 | `electron/stt/WhisperService.js` | Download de modelo gravava direto no destino: interrupção deixava GGML corrompido que o whisper tentava carregar | Download em `.part` + rename atômico + validação de tamanho |
| A4 | `electron/llm/LLMRouter.js` | Provedor não configurado gerava erro críptico do HTTP 401 | Erro explícito orientando a abrir Configurações |
| A5 | `electron/main.js` | Sem tray: fechar o overlay encerrava o app no Windows, e sem janela não havia como reabrir | App residente + Tray com Mostrar/Ocultar e Sair |

## Médios (robustez e higiene)

| # | Arquivo | Problema | Correção |
|---|---|---|---|
| M1 | `electron/stt/WhisperService.js` | `whisper-server` ficava **órfão** ao fechar o app | `dispose()` mata o processo no `before-quit` (via `disposeIpc`) |
| M2 | `electron/llm/providers/ChatGPTOAuthAdapter.js` | Servidor de callback OAuth sem timeout: se o usuário fechasse o navegador, a porta 1455 ficava presa e a promise pendurada | Timeout de 5 min + `server.close()` garantido |
| M3 | `src/main.jsx` | `AudioContext`, `ScriptProcessor` e tracks de mic **vazavam** ao parar a escuta | `stopMicCapture()` desconecta, fecha e para tudo |
| M4 | `src/main.jsx` | Transcrição crescia sem limite em memória (reunião de horas) | Cap de 500 linhas (janela deslizante) |
| M5 | `electron/stt/WhisperService.js` | Cap de buffer descartava 1 chunk antigo independente do tamanho | Loop descarta até caber, correto para chunks heterogêneos |
| M6 | `electron/stt/WhisperService.js` | Erro binário ausente aparecia como ECONNREFUSED genérico | Verificação de existência com mensagem orientando o README |
| M7 | `electron/main.js` | Falha silenciosa ao registrar atalho global em uso por outro app | Retorno checado + log de aviso |
| M8 | `electron/ipc/index.js` | `webContents.send` em janela destruída lançava exceção | Guards `isDestroyed()` em todos os sends |
| M9 | `electron/ipc/index.js` | `db:get-sessions-page` aceitava offset/limit arbitrários | Clamp (offset ≥ 0, 1 ≤ limit ≤ 100) |
| M10 | `index.html` | Sem Content-Security-Policy | CSP básica adicionada |
| M11 | `src/main.jsx` | Erros de LLM/mic invisíveis para o usuário | Estado `error` exibido na UI |
| M12 | `electron/stt/WhisperService.js` | Chunks < 0,5 s de áudio geravam inference vazia/ruidosamente | Ignorados no flush |
| M13 | `electron/llm/providers/ClaudeCodeAdapter.js` | Probe `claude --version` podia pendurar | Timeout de 5 s no probe |

## Verificações pós-correção

- `node --check` em todos os módulos alterados ✅
- Build Vite + empacotamento NSIS ✅
- Instalação silenciosa + smoke test do app instalado ✅

## Pendências conhecidas (não são bugs — roadmap)

- Áudio do sistema (loopback) — fase 2, requer `electron-audio-loopback`
- VAD contínuo (hoje: flush a cada 5 s)
- Whisper binário não incluído no instalador (download manual)
- Refresh token do OAuth ChatGPT (login expira → relogar)
- Assinatura digital do instalador (requer certificado)

---

## Changelog pós-auditoria

### v0.2.2 (2026-11-02)
- Atalho global `Ctrl+Shift+M` liga/desliga a escuta sem focar a janela
- Posição e tamanho do overlay persistidos (`window-state.json`), com validação de tela visível

### v0.2.1 (2026-11-02)
- **VAD por fim de fala** (RMS > 0.012; silêncio de 1,1s encerra o enunciado; teto de 15s) — substitui o flush fixo de 5s; elimina cortes de frase e alucinações do Whisper em silêncio
- **AudioWorklet** (`pcm-worklet` inline via Blob URL) substitui `ScriptProcessorNode` (depreciado), com fallback automático
- Seletor de idioma do Whisper: PT-BR / EN-US (fixo melhora precisão vs `auto`)
- Tela de **histórico de sessões** (🕘): lista, detalhe com transcrição + respostas, exportação em Markdown para a área de transferência

### v0.2.0 (2026-11-02)
- Modelo padrão do adapter OAuth: `gpt-6.1-sol` (padrão atual do backend Codex)
- Lista de modelos atualizada p/ geração GPT-6 (6.1 Luna / 6 Luna / 6.1 Sol / 6 Astra / 5.5)

### v0.1.9 (2026-11-02)
- **Modo instantâneo**: `reasoning: { effort: 'low' }` nas chamadas ao backend Codex (latência ~1,5s vs ~6s)
- Campo "modelo" editável no painel ⚙ (vale para assist/ask/resumo)

### v0.1.8 (2026-11-02)
- Detector de perguntas com janela de contexto (reconhece pergunta quebrada em 2 flushes; pendência de 4,5s sem "?")
- Resumo automático ao encerrar a escuta (salvo na sessão)
- Refresh token OAuth ChatGPT (renova 60s antes de expirar; preserva refresh_token)
- Atalhos globais: `Ctrl+Shift+Enter` sugerir, `Ctrl+Shift+C`/`Y` copiar sugestão
- Modo mini (pílula 400×148 com sugestão ao vivo), medidores de áudio mic/sistema,
  chips de reformulação, onboarding 3 passos, temas (escuro/claro, 3 acentos, opacidade, fonte)

### v0.1.7 (2026-11-02)
- Copiloto ativo (auto-assist): detector local de perguntas PT/EN, 3 modos (Entrevista/Reunião/Livre), perfil do usuário, cooldown 12s
