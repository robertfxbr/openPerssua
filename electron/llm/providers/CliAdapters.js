// Provedores por linha de comando: usam o login que o usuário já tem na
// própria CLI (assinatura ChatGPT no Codex, conta Google no Gemini), sem API
// key e sem cobrança por uso fora do plano.
//
// O prompt vai pelo stdin (nunca pela linha de comando): com shell:true no
// Windows, texto do usuário em argv abriria espaço para injeção de comando.
// Pelo mesmo motivo o nome do modelo só passa se for um identificador simples.
// A CLI roda na pasta temporária, longe dos arquivos do usuário.

const { spawn } = require('child_process');
const os = require('os');
const { cliHelp, cliEffortArgs, isEffortError } = require('../reasoning');
const { hasImages } = require('../messageFormat');

const SAFE_MODEL = /^[\w.:/-]{1,64}$/;
const PROBE_TIMEOUT_MS = 5000;

function flatten(messages) {
  return messages
    .map((m) => (m.role === 'system' ? m.content : `${m.role.toUpperCase()}: ${m.content}`))
    .join('\n\n');
}

function probe(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, ['--version'], { shell: true, cwd: os.tmpdir() });
    const timer = setTimeout(() => { p.kill(); resolve(false); }, PROBE_TIMEOUT_MS);
    p.on('error', () => { clearTimeout(timer); resolve(false); });
    p.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

// Roda a CLI com o prompt no stdin. onChunk recebe o texto conforme sai
// (quando a CLI imprime aos poucos) ou de uma vez no fim.
function runCli({ cmd, args, prompt, onChunk, signal, clean = (t) => t, streamStdout = false, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: true, cwd: os.tmpdir() });
    let out = '';
    let err = '';
    const kill = () => child.kill('SIGTERM');
    if (signal) {
      if (signal.aborted) { kill(); reject(new Error('cancelado')); return; }
      signal.addEventListener('abort', kill, { once: true });
    }
    child.stdout.on('data', (d) => {
      const text = d.toString();
      out += text;
      if (streamStdout && onChunk) onChunk(clean(text));
    });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => reject(new Error(`${label}: não foi possível executar "${cmd}" (${e.message})`)));
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', kill);
      if (signal?.aborted) { reject(new Error('cancelado')); return; }
      const text = clean(out).trim();
      if (code !== 0) {
        reject(new Error(`${label} saiu com ${code}: ${(err || out).trim().slice(-500)}`));
        return;
      }
      if (!streamStdout && onChunk && text) onChunk(text);
      resolve(text);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

class CliAdapter {
  constructor({ id, label, cmd, hint, settingsStore }) {
    this.id = id;
    this.label = label;
    this.cmd = cmd;
    this.hint = hint;
    this.settingsStore = settingsStore;
    this.fields = [];
  }

  isConfigured() { return probe(this.cmd); }

  rejectImages(messages) {
    if (hasImages(messages)) {
      throw new Error(`${this.label.split(' (')[0]} não recebe imagens por aqui; para analisar a tela, use o ChatGPT (login) ou um modelo de visão no Ollama`);
    }
  }

  modelArgs(model) {
    return model && SAFE_MODEL.test(model) ? ['-m', model] : [];
  }

  async chat({ messages, model, signal, fast, thinkMore }) {
    this.rejectImages(messages);
    return this.run({ prompt: flatten(messages), model, signal, fast, thinkMore });
  }

  async chatStream({ messages, model, onChunk, signal, fast, thinkMore }) {
    this.rejectImages(messages);
    return this.run({ prompt: flatten(messages), model, onChunk, signal, fast, thinkMore });
  }
}

// Codex CLI (`codex exec`): entra com a conta ChatGPT. Só a resposta final
// sai no stdout (o progresso vai para o stderr), então ela chega de uma vez.
class CodexCliAdapter extends CliAdapter {
  constructor({ settingsStore }) {
    super({
      id: 'codex-cli',
      label: 'Codex CLI (login ChatGPT)',
      cmd: 'codex',
      hint: 'Instale o Codex CLI e rode "codex login" uma vez: ele usa a sua assinatura do ChatGPT.',
      settingsStore,
    });
  }

  async run({ prompt, model, onChunk, signal, fast, thinkMore }) {
    const help = fast || thinkMore ? await cliHelp('codex') : '';
    const efforts = fast ? ['minimal', 'low', undefined] : thinkMore ? ['medium', 'high', 'low', undefined] : [undefined];
    const base = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', ...this.modelArgs(model)];
    for (let i = 0; i < efforts.length; i++) {
      const args = cliEffortArgs('codex', efforts[i], help);
      try {
        return await runCli({ cmd: this.cmd, args: [...base, ...args], prompt, onChunk, signal, label: 'Codex CLI' });
      } catch (e) {
        if (!args.length || signal?.aborted || !isEffortError(e) || i === efforts.length - 1) throw e;
      }
    }
  }
}

// Gemini CLI: entra com a conta Google (tem cota gratuita). Com o stdin
// redirecionado ela roda sem modo interativo e imprime a resposta aos poucos.
class GeminiCliAdapter extends CliAdapter {
  constructor({ settingsStore }) {
    super({
      id: 'gemini-cli',
      label: 'Gemini CLI (login Google)',
      cmd: 'gemini',
      hint: 'Instale o Gemini CLI e rode "gemini" uma vez no terminal para entrar com a conta Google (há cota gratuita).',
      settingsStore,
    });
  }

  run({ prompt, model, onChunk, signal }) {
    return runCli({
      cmd: this.cmd,
      args: this.modelArgs(model),
      prompt,
      onChunk,
      signal,
      streamStdout: true,
      // Aviso de login que algumas versões imprimem antes da resposta
      clean: (t) => t.replace(/^Loaded cached credentials\.?\s*\n?/m, ''),
      label: 'Gemini CLI',
    });
  }
}

module.exports = { CodexCliAdapter, GeminiCliAdapter, runCli, SAFE_MODEL };
