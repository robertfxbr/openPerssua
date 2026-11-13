# Assistentes do Teka

Em **Configurações → assistentes**, cada linha tem um botão **contexto**. Ele também funciona nos prontos: não altera suas instruções originais.

- Escreva informações e anexe texto, código ou PDF com texto selecionável. Só o texto extraído e o nome ficam salvos. Limite: 20.000 caracteres, 30 anexos; arquivos de até 20 MB e PDFs de até 500 páginas. O Teka avisa ao cortar texto. PDF sem texto não é anexado.
- **Responder só com certeza** começa desligado. Restringe resposta, tela e sugestão ao vivo aos fatos da transcrição e dos contextos. Em entrevista, pede uma forma honesta de admitir o que falta. Essa é uma restrição de prompt; a obediência depende do modelo.
- Nos próprios, **instruções gerais** continuam valendo. **Instruções por uso** começa recolhido; cada campo soma-se às gerais apenas no seu uso. O formato antigo `{id,name,mode,instructions}` continua aceito.
- **Sugerir perguntas**, depois da resposta manual ou da tela, faz uma chamada opcional. As perguntas usam o contexto e o assistente daquela resposta.
- A busca ignora maiúsculas e acentos. O filtro mostra contagens para o nome buscado. Categoria pode ser escolhida ou escrita.
- **Exportar JSON** inclui somente próprios, com instruções, categoria, contexto e preferência de certeza. Importar preserva os existentes e troca ids em conflito. Máximo de 100 próprios e JSON de até 20 MB. A gravação da importação é feita em conjunto; conteúdo do arquivo nunca é executado.

Em **Configurações → IA**, **Pensar mais** começa desligado. Só perguntas manuais e tela pedem mais raciocínio. OAuth tenta `medium`, `high` e níveis menores, até omitir o parâmetro quando necessário. Ao vivo tenta os níveis mais rápidos. Codex e Claude consultam a ajuda da CLI antes de enviar opções, com recuo se o esforço for recusado. Outros provedores ignoram a chave.

Em **Configurações → voz**, o lembrete de escuta longa começa desligado. Depois de 30 minutos, mostra o overlay sem roubar foco e dá 60 segundos para confirmar. Sem resposta, pausa e mantém falas e memória; tocar no microfone retoma a mesma sessão. Confirmar renova os 30 minutos.

## Persistência e empacotamento

Contextos: `assistant.context.<id>`. Preferências: `assistant.preferences.<id>`. Instruções e categoria continuam em `assistants.custom`. Chaves globais: `llm.thinkMore` e `audio.longListenReminder`.

PDF.js é dependência de desenvolvimento usada exclusivamente no renderer, em chunks carregados sob demanda. O worker é emitido em `dist/`; a CSP permite `worker-src 'self' blob:`. Não há nova dependência do processo principal, mudança de versão ou de `teka.shellDeps`.

## Verificação local

```powershell
npm run build
npm run test:assistants
```

A suíte roda oito scripts: prompts e isolamento de instruções; contexto e PDFs sintéticos; compatibilidade do formato antigo e filtros; JSON, conflitos e entradas hostis; persistência conjunta e falha de gravação; esforço e recuo OAuth com transporte simulado; relógio do lembrete; interface compilada com preload real.

O teste de interface abre sua própria instância oculta do Electron, usa settings temporários e um provedor simulado. Exercita edição antiga, texto/PDF em worker, corte, persistência, download/importação JSON, exclusões simultâneas, extração terminando após exclusão, troca de aba durante importação, perguntas e pausa/retomada com áudio fictício do Chromium e relógio acelerado. O teste usa o fallback de áudio, sem microfone nem loopback reais. Fecha somente sua própria instância.

Não houve inferência real, teste com tokens do usuário, installer, release ou push. A aderência das respostas dos modelos e o funcionamento da escuta em dispositivos reais permanecem fora dessa verificação.

Referências técnicas: [PDF.js](https://mozilla.github.io/pdf.js/examples/), [configuração do Codex](https://learn.chatgpt.com/docs/config-file/config-reference), [CLI do Claude](https://code.claude.com/docs/en/cli-reference), [CLI do Gemini](https://geminicli.com/docs/cli/cli-reference/). A ajuda do Gemini local não pôde ser consultada devido ao JSON inválido preexistente em `trustedFolders.json`; esse arquivo não foi alterado.
