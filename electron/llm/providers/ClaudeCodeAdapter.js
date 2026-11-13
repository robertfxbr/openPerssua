// Claude Code CLI como backend: chama `claude -p` em subprocess.
// Usa a assinatura/login local do Claude Code — nenhuma API key necessária.
// O prompt vai pelo STDIN (não por argv): evita quebra de quoting e injeção
// de shell quando o texto do usuário contém aspas/acentos, e contorna o
// limite de tamanho de linha de comando do Windows.

const { spawn } = require('child_process');
const { cliHelp, cliEffortArgs, isEffortError } = require('../reasoning');
const { hasImages } = require('../messageFormat');

class ClaudeCodeAdapter {
  constructor({ settingsStore }) {
    this.id = 'claude-code';
    this.label = 'Claude Code (CLI local)';
    this.settingsStore = settingsStore;
  }

  isConfigured() {
    return new Promise((resolve) => {
      const probe = spawn('claude', ['--version'], { shell: true });
      probe.on('error', () => resolve(false));
      probe.on('close', (code) => resolve(code === 0));
      setTimeout(() => { probe.kill(); resolve(false); }, 5000);
    });
  }

  flatten(messages) {
    // CLI recebe um prompt único: system + histórico achatados
    return messages
      .map((m) => (m.role === 'system' ? m.content : `${m.role.toUpperCase()}: ${m.content}`))
      .join('\n\n');
  }

  // O modo `claude -p` recebe só texto pelo stdin: sem este aviso a imagem
  // seria descartada em silêncio e a resposta viria sem ter visto a tela.
  rejectImages(messages) {
    if (hasImages(messages)) {
      throw new Error('o Claude Code (CLI) não recebe imagens; para analisar a tela, escolha OpenAI, ChatGPT, Claude API ou um modelo de visão no Ollama');
    }
  }

  async chat({ messages, signal, fast, thinkMore }) {
    this.rejectImages(messages);
    return this.runWithEffort(this.flatten(messages), null, signal, { fast, thinkMore });
  }

  async chatStream({ messages, onChunk, signal, fast, thinkMore }) {
    this.rejectImages(messages);
    return this.runWithEffort(this.flatten(messages), onChunk, signal, { fast, thinkMore });
  }

  async runWithEffort(prompt, onChunk, signal, { fast, thinkMore }) {
    const help = fast || thinkMore ? await cliHelp('claude') : '';
    const effortArgs = cliEffortArgs('claude', fast ? 'low' : thinkMore ? 'high' : undefined, help);
    let emitted = false;
    const emit = onChunk ? (text) => { emitted = true; onChunk(text); } : null;
    try { return await this.run(prompt, emit, signal, effortArgs); }
    catch (e) {
      if (!effortArgs.length || emitted || signal?.aborted || !isEffortError(e)) throw e;
      return this.run(prompt, emit, signal);
    }
  }

  run(prompt, onChunk, signal, effortArgs = []) {
    if (signal?.aborted) return Promise.reject(new Error('cancelado'));
    return new Promise((resolve, reject) => {
      // stream-json com --print exige --verbose (sem ele a CLI recusa e sai
      // com código 1). --include-partial-messages faz a resposta chegar em
      // pedaços, como nos outros provedores, em vez de tudo no final.
      const args = onChunk
        ? ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
        : ['-p', '--output-format', 'text'];
      // shell:true no Windows para resolver claude.cmd; o prompt NÃO passa
      // pela linha de comando (vai por stdin), então não há risco de quoting.
      args.push(...effortArgs);
      const child = spawn('claude', args, { shell: true, windowsHide: true });
      let output = '';
      let ndjsonBuffer = '';
      let sawDelta = false;      // chegaram pedaços (text_delta)?
      let fullAssistant = '';    // mensagem completa, para CLI sem pedaços
      let result = null;         // evento final { result, is_error }

      const emit = (text) => { output += text; onChunk(text); };

      const handleEvent = (event) => {
        if (event.type === 'stream_event') {
          const e = event.event;
          if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
            sawDelta = true;
            emit(e.delta.text);
          }
        } else if (event.type === 'assistant') {
          // Guarda e só usa se não vierem pedaços: com --include-partial-messages
          // a mensagem completa repete o texto que já foi emitido.
          const blocks = event.message?.content || [];
          fullAssistant += blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
        } else if (event.type === 'result') {
          result = event;
        }
      };

      const killOnAbort = () => child.kill('SIGTERM');
      if (signal) signal.addEventListener('abort', killOnAbort, { once: true });

      child.stdout.on('data', (data) => {
        const text = data.toString();
        if (!onChunk) { output += text; return; }
        ndjsonBuffer += text;
        const lines = ndjsonBuffer.split('\n');
        ndjsonBuffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try { handleEvent(JSON.parse(line)); } catch { /* linha parcial */ }
        }
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', killOnAbort);
        // Erros como login expirado chegam no evento final, não no stderr
        if (result?.is_error) {
          reject(new Error(`Claude Code: ${String(result.result || 'erro sem detalhe').slice(0, 500)}`));
          return;
        }
        if (onChunk && !sawDelta && fullAssistant) emit(fullAssistant);
        if (code === 0) resolve(output.trim());
        else reject(new Error(`claude CLI saiu com ${code}: ${(stderr || result?.result || '').slice(0, 500)}`));
      });

      // Prompt por stdin e fecha o stream para o CLI começar
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

module.exports = { ClaudeCodeAdapter };
