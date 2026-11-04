// STT local via whisper.cpp em modo servidor (`whisper-server`), com
// buffer limitado — espelha LocalWhisperService/WhisperSession do original,
// mas enxuto: 1 sessão por fonte (mic | system), deltas via IPC.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MAX_BUFFER_BYTES = 16 * 1024 * 1024; // equivalente ao CappedAudioBuffer
const SERVER_PORT = 8178;
const MODEL_LOAD_TIMEOUT_MS = 120000; // modelos grandes demoram

class WhisperService {
  constructor({ userDataDir, sendToRenderer }) {
    this.userDataDir = userDataDir;
    this.sendToRenderer = sendToRenderer;
    this.sessions = new Map(); // sessionId -> { buffers, active }
    this.serverProcess = null;
    this.serverReady = null; // Promise compartilhada de readiness
    this.loadedModel = null; // ggml carregado no servidor atual
  }

  modelsDir() {
    return path.join(this.userDataDir, 'whisper-models');
  }

  // Baixa um ggml do HuggingFace (whisper.cpp models).
  // Escreve em arquivo temporário e renomeia — download interrompido não
  // deixa modelo corrompido que o whisper tentaria carregar.
  // Downloads do MESMO modelo são serializados: dois cliques/sessões
  // paralelos dividem a mesma promise em vez de corromper o .part.
  async downloadModel(name = 'ggml-base.bin', onProgress) {
    this.downloads = this.downloads || new Map();
    if (this.downloads.has(name)) return this.downloads.get(name);
    const p = this._doDownload(name, onProgress)
      .finally(() => this.downloads.delete(name));
    this.downloads.set(name, p);
    return p;
  }

  async _doDownload(name, onProgress) {
    const dest = path.join(this.modelsDir(), name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return { path: dest, cached: true };

    fs.mkdirSync(this.modelsDir(), { recursive: true });
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download do modelo falhou: HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = `${dest}.part`;
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(value);
        received += value.length;
        if (onProgress && total) onProgress({ received, total });
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (total && received !== total) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`download incompleto: ${received}/${total} bytes`);
    }
    // Corrida entre chamadas paralelas: se o destino já apareceu (outra
    // chamada venceu o rename), o .part órfão é só descartado.
    try {
      fs.renameSync(tmp, dest);
    } catch (e) {
      const destOk = fs.existsSync(dest) && fs.statSync(dest).size > 0;
      fs.rmSync(tmp, { force: true });
      if (!(e.code === 'ENOENT' && destOk)) throw e;
    }
    return { path: dest, cached: false };
  }

  // Sobe whisper-server; em produção o binário fica em resources/whisper-bin
  async ensureServer(modelPath) {
    // Troca de modelo (ex.: base → small) exige reiniciar o servidor — ele
    // carrega o ggml uma única vez no boot do processo.
    if (this.serverReady && this.loadedModel && this.loadedModel !== modelPath) {
      if (this.serverProcess) this.serverProcess.kill();
      this.serverProcess = null;
      this.serverReady = null;
    }
    if (this.serverReady) return this.serverReady;

    const exeName = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
    // 1) userData (download manual) — 2) resources do app empacotado (embutido)
    const candidates = [
      path.join(this.userDataDir, 'whisper-bin', exeName),
      ...(process.resourcesPath ? [path.join(process.resourcesPath, 'whisper-bin', exeName)] : []),
      path.join(__dirname, '..', '..', 'whisper-bin', exeName), // dev
    ];
    const binary = candidates.find((p) => fs.existsSync(p));
    if (!binary) {
      throw new Error(`whisper-server não encontrado em nenhum destes caminhos: ${candidates.join(' | ')}`);
    }

    this.serverProcess = spawn(binary, [
      '--model', modelPath,
      '--host', '127.0.0.1',
      '--port', String(SERVER_PORT),
      '--convert',
    ]);
    this.loadedModel = modelPath;
    this.serverProcess.on('exit', () => { this.serverProcess = null; this.serverReady = null; });

    // Poll de readiness em vez de sleep fixo: modelos ggml-medium/large
    // levam muito mais que 1,5s para carregar.
    this.serverReady = (async () => {
      const deadline = Date.now() + MODEL_LOAD_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (!this.serverProcess) throw new Error('whisper-server encerrou durante o carregamento');
        try {
          const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/`, { signal: AbortSignal.timeout(1000) });
          if (res.ok || res.status === 404) return SERVER_PORT;
        } catch { /* ainda subindo */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('timeout aguardando whisper-server carregar o modelo');
    })();

    this.serverReady.catch(() => { this.serverReady = null; });
    return this.serverReady;
  }

  async startSession({ sessionId, source = 'mic', model = 'ggml-base.bin', language = 'auto', prompt, onProgress }) {
    const { path: modelPath } = await this.downloadModel(model, onProgress);
    const port = await this.ensureServer(modelPath);
    this.sessions.set(sessionId, { source, language, prompt, port, pcmChunks: [], bytes: 0, active: true });
    return { sessionId, port };
  }

  // chunk: ArrayBuffer PCM 16kHz mono vindo do renderer (mic ou loopback)
  pushAudio(sessionId, chunk) {
    const session = this.sessions.get(sessionId);
    if (!session?.active) return;
    const buf = Buffer.from(chunk);
    if (session.bytes + buf.length > MAX_BUFFER_BYTES) {
      // Descarta os chunks mais antigos até caber (cap deslizante)
      while (session.pcmChunks.length && session.bytes + buf.length > MAX_BUFFER_BYTES) {
        session.bytes -= session.pcmChunks.shift().length;
      }
    }
    session.pcmChunks.push(buf);
    session.bytes += buf.length;
  }

  // Transcreve o buffer acumulado e emite delta — o original faz isso
  // continuamente via VAD; aqui, sob demanda (flush) para simplificar.
  async flush(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.pcmChunks.length === 0) return null;
    const pcm = Buffer.concat(session.pcmChunks);
    session.pcmChunks = [];
    session.bytes = 0;
    if (pcm.length < 16000 * 2 * 0.5) return null; // < 0,5s de áudio: ignora

    const wav = pcmToWav(pcm, 16000);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    if (session.language !== 'auto') form.append('language', session.language);
    // Viés de vocabulário: o Whisper usa o prompt como contexto inicial,
    // o que corrige nomes próprios e jargões (ex.: "Robert" → não "bitch")
    if (session.prompt) form.append('prompt', session.prompt);

    const res = await fetch(`http://127.0.0.1:${session.port}/inference`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`whisper inference: HTTP ${res.status}`);
    const data = await res.json();

    this.sendToRenderer('stt:transcription-delta', {
      sessionId, source: session.source, text: data.text, ts: Date.now(),
    });
    return data.text;
  }

  async stopSession(sessionId) {
    const text = await this.flush(sessionId).catch(() => null);
    const session = this.sessions.get(sessionId);
    if (session) session.active = false;
    this.sessions.delete(sessionId);
    this.sendToRenderer('stt:transcription-complete', { sessionId, text });
    return { sessionId, finalText: text };
  }

  // Mata o whisper-server — chamado no before-quit para não deixar processo órfão
  dispose() {
    for (const s of this.sessions.values()) s.active = false;
    this.sessions.clear();
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
      this.serverReady = null;
    }
  }
}

// WAV header mínimo para PCM s16le mono
function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

module.exports = { WhisperService };
