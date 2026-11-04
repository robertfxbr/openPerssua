// Claude Code CLI como backend: chama `claude -p` em subprocess.
// Usa a assinatura/login local do Claude Code — nenhuma API key necessária.
// O prompt vai pelo STDIN (não por argv): evita quebra de quoting e injeção
// de shell quando o texto do usuário contém aspas/acentos, e contorna o
// limite de tamanho de linha de comando do Windows.

const { spawn } = require('child_process');

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

  chat({ messages, signal }) {
    return this.run(this.flatten(messages), null, signal);
  }

  chatStream({ messages, onChunk, signal }) {
    return this.run(this.flatten(messages), onChunk, signal);
  }

  run(prompt, onChunk, signal) {
    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', onChunk ? 'stream-json' : 'text'];
      // shell:true no Windows para resolver claude.cmd; o prompt NÃO passa
      // pela linha de comando (vai por stdin), então não há risco de quoting.
      const child = spawn('claude', args, { shell: true });
      let output = '';
      let ndjsonBuffer = '';

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
          try {
            const event = JSON.parse(line);
            // eventos stream-json do Claude Code: assistant message deltas
            const delta = event?.message?.content?.[0]?.text || event?.delta?.text;
            if (delta) { output += delta; onChunk(delta); }
          } catch { /* linha parcial */ }
        }
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', killOnAbort);
        if (code === 0) resolve(output.trim());
        else reject(new Error(`claude CLI saiu com ${code}: ${stderr.slice(0, 500)}`));
      });

      // Prompt por stdin e fecha o stream para o CLI começar
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

module.exports = { ClaudeCodeAdapter };
