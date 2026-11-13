// STT local via whisper.cpp em modo servidor (`whisper-server`), com
// buffer limitado — espelha LocalWhisperService/WhisperSession do original,
// mas enxuto: 1 sessão por fonte (mic | system), deltas via IPC.

const { cleanTranscript, isSilent } = require('./cleanTranscript');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { composePrompt } = require('./vocabulary');

const MAX_BUFFER_BYTES = 16 * 1024 * 1024; // equivalente ao CappedAudioBuffer
const SERVER_PORT = 8178;
const MODEL_LOAD_TIMEOUT_MS = 120000; // modelos grandes demoram
const DETECT_PORT = 8179; // servidor do detector de idioma (modo PT+EN)
const DETECT_MODEL = 'ggml-tiny.bin';
// pt e en: idioma fixo. pten: detecta português ou inglês a cada fala.
// auto: qualquer idioma (o Whisper decide; não aparece na tela).
const LANGUAGES = new Set(['pt', 'en', 'pten', 'auto']);

// Modelos ggml oficiais do whisper.cpp que o app sabe baixar. Só nomes desta
// lista são aceitos: o nome vira caminho de arquivo, e um nome livre poderia
// apontar para fora da pasta de modelos.
const MODEL_CATALOG = [
  { name: 'ggml-tiny.bin', label: 'Tiny', approxMB: 75, note: 'mais rápido, menos preciso' },
  { name: 'ggml-base.bin', label: 'Base', approxMB: 142, note: 'equilíbrio' },
  { name: 'ggml-small.bin', label: 'Small', approxMB: 466, note: 'bem melhor em PT-BR · recomendado' },
  { name: 'ggml-large-v3-turbo-q5_0.bin', label: 'Large v3 Turbo (q5)', approxMB: 547, note: 'qualidade alta, compacto' },
  { name: 'ggml-medium.bin', label: 'Medium', approxMB: 1463, note: 'preciso, pede CPU forte' },
  { name: 'ggml-large-v3-turbo.bin', label: 'Large v3 Turbo', approxMB: 1549, note: 'quase o Large, bem mais rápido' },
  { name: 'ggml-large-v3.bin', label: 'Large v3', approxMB: 2951, note: 'máxima precisão, lento sem GPU' },
];
const CATALOG_NAMES = new Set(MODEL_CATALOG.map((m) => m.name));

function assertModelName(name) {
  if (!CATALOG_NAMES.has(name)) throw new Error(`modelo desconhecido: ${name}`);
}

class WhisperService {
  constructor({ userDataDir, sendToRenderer }) {
    this.userDataDir = userDataDir;
    this.sendToRenderer = sendToRenderer;
    this.sessions = new Map(); // sessionId -> { buffers, active }
    // whisper-servers: main transcreve, detector só detecta o idioma (PT+EN).
    // ready é a Promise compartilhada de readiness; model, o ggml carregado.
    this.servers = {
      main: { proc: null, ready: null, model: null, stderrTail: '' },
      detector: { proc: null, ready: null, model: null, stderrTail: '' },
    };
    this.downloads = new Map();   // nome -> promise do download em andamento
    this.progress = new Map();    // nome -> { received, total }
    this.controllers = new Map(); // nome -> AbortController (cancelar)
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
    assertModelName(name);
    if (this.downloads.has(name)) return this.downloads.get(name);
    const controller = new AbortController();
    this.controllers.set(name, controller);
    const p = this._doDownload(name, (prog) => {
      this.progress.set(name, prog);
      if (onProgress) onProgress({ name, ...prog });
    }, controller.signal)
      .finally(() => {
        this.downloads.delete(name);
        this.progress.delete(name);
        this.controllers.delete(name);
      });
    this.downloads.set(name, p);
    return p;
  }

  cancelDownload(name) {
    const c = this.controllers.get(name);
    if (!c) return { ok: false, error: 'nenhum download deste modelo em andamento' };
    c.abort();
    return { ok: true };
  }

  modelPath(name) {
    assertModelName(name);
    return path.join(this.modelsDir(), name);
  }

  isInstalled(name) {
    const p = this.modelPath(name);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  }

  // Catálogo com o estado de cada modelo no disco, para a aba "voz"
  listModels() {
    return MODEL_CATALOG.map((m) => {
      const p = path.join(this.modelsDir(), m.name);
      const bytes = fs.existsSync(p) ? fs.statSync(p).size : 0;
      return {
        ...m,
        installed: bytes > 0,
        bytes,
        downloading: this.downloads.has(m.name),
        progress: this.progress.get(m.name) || null,
        loaded: this.servers.main.model === p,
      };
    });
  }

  // Apagar o modelo que o servidor está usando só é permitido sem escuta
  // ativa; nesse caso o servidor é encerrado antes (no Windows o arquivo
  // fica travado enquanto o processo roda).
  deleteModel(name) {
    const p = this.modelPath(name);
    if (this.downloads.has(name)) return { ok: false, error: 'cancele o download antes de apagar' };
    const inUse = Object.keys(this.servers).filter((slot) => this.servers[slot].model === p);
    if (inUse.length) {
      if (this.sessions.size > 0) return { ok: false, error: 'pare a escuta antes de apagar o modelo em uso' };
      for (const slot of inUse) this._stop(slot);
    }
    fs.rmSync(p, { force: true });
    fs.rmSync(`${p}.part`, { force: true });
    return { ok: true };
  }

  async _doDownload(name, onProgress, signal) {
    const dest = path.join(this.modelsDir(), name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return { path: dest, cached: true };

    fs.mkdirSync(this.modelsDir(), { recursive: true });
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`;
    const res = await fetch(url, { signal });
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
    } catch (err) {
      // Cancelado ou rede caiu: fecha e apaga o .part para não sobrar lixo
      await new Promise((r) => out.end(r));
      fs.rmSync(tmp, { force: true });
      if (signal?.aborted) throw new Error('download cancelado');
      throw err;
    }
    await new Promise((r) => out.end(r));
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

  // Onde está o whisper-server (binary null se não houver nenhum)
  findBinary() {
    const exeName = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
    // 1) userData (download manual) — 2) resources do app empacotado (embutido)
    const candidates = [
      path.join(this.userDataDir, 'whisper-bin', exeName),
      ...(process.resourcesPath ? [path.join(process.resourcesPath, 'whisper-bin', exeName)] : []),
      path.join(__dirname, '..', '..', 'whisper-bin', exeName), // dev
    ];
    return { binary: candidates.find((p) => fs.existsSync(p)) || null, candidates };
  }

  // Sobe whisper-server; em produção o binário fica em resources/whisper-bin
  async ensureServer(modelPath) {
    return this._ensure('main', modelPath, SERVER_PORT);
  }

  // Segundo whisper-server, só com o modelo Tiny, que apenas detecta o idioma
  // de cada fala no modo PT+EN. No banco de testes o Tiny acertou PT x EN em
  // 225 de 225 trechos (limpo, com ruído e com som de chamada) em 0,7 s; o
  // Small levaria 3,4 s para a mesma detecção.
  async ensureDetector(onProgress) {
    const { path: modelPath } = await this.downloadModel(DETECT_MODEL, onProgress);
    // Se a transcrição já usa o Tiny, o mesmo servidor detecta
    if (this.servers.main.model === modelPath && this.servers.main.ready) return this.servers.main.ready;
    return this._ensure('detector', modelPath, DETECT_PORT);
  }

  // Um whisper-server por "vaga" (main = transcrição, detector = idioma).
  // Trocar o modelo de uma vaga reinicia o processo dela: o servidor carrega
  // o ggml uma única vez no boot.
  _ensure(slot, modelPath, port) {
    const st = this.servers[slot];
    if (st.ready && st.model !== modelPath) this._stop(slot);
    if (st.ready) return st.ready;

    const { binary, candidates } = this.findBinary();
    if (!binary) {
      throw new Error(`whisper-server não encontrado em nenhum destes caminhos: ${candidates.join(' | ')}`);
    }

    const proc = spawn(binary, [
      '--model', modelPath,
      '--host', '127.0.0.1',
      '--port', String(port),
      // Sem --convert: o app já manda WAV 16 kHz mono, que o servidor lê
      // direto. O --convert chamava o FFmpeg e gravava um arquivo temporário
      // na pasta atual; aberto a partir de uma pasta sem permissão de escrita
      // (ex.: System32), toda fala voltava "FFmpeg conversion failed".
      // Não gera tokens de "não fala" ([Música], (risos)): menos lixo no
      // silêncio e mesma precisão no banco de testes
      '--suppress-nst',
      '--threads', String(whisperThreads()),
    ], {
      // A saída precisa ser lida ou descartada: o whisper-server escreve
      // várias linhas por pedido e, com o pipe cheio, trava no meio de uma
      // transcrição. O stdout vai fora; do stderr fica só o fim, para erro.
      stdio: ['ignore', 'ignore', 'pipe'],
      // pasta própria e gravável, seja de onde for que o Teka foi aberto
      cwd: this.userDataDir,
      windowsHide: true,
    });
    if (proc.pid) lowerPriority(proc.pid);
    st.stderrTail = '';
    proc.stderr.on('data', (d) => { st.stderrTail = (st.stderrTail + d.toString()).slice(-2000); });
    st.proc = proc;
    st.model = modelPath;
    // Só limpa a vaga se ainda for este processo: ao trocar de modelo, o
    // processo antigo morre depois que o novo já ocupou a vaga.
    proc.on('exit', () => {
      if (st.proc === proc) { st.proc = null; st.ready = null; }
    });

    // Poll de readiness em vez de sleep fixo: modelos ggml-medium/large
    // levam muito mais que 1,5s para carregar.
    const ready = (async () => {
      const deadline = Date.now() + MODEL_LOAD_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (st.proc !== proc) throw new Error(`whisper-server encerrou durante o carregamento: ${st.stderrTail.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
          if (res.ok || res.status === 404) return port;
        } catch { /* ainda subindo */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('timeout aguardando whisper-server carregar o modelo');
    })();
    st.ready = ready;
    ready.catch(() => { if (st.ready === ready) st.ready = null; });
    return ready;
  }

  _stop(slot) {
    const st = this.servers[slot];
    if (st.proc) st.proc.kill();
    st.proc = null;
    st.ready = null;
    st.model = null;
  }

  async startSession({ sessionId, source = 'mic', model = 'ggml-base.bin', language = 'pt', prompt, fast = false, onProgress }) {
    if (!LANGUAGES.has(language)) language = 'pt';
    const { path: modelPath } = await this.downloadModel(model, onProgress);
    const port = await this.ensureServer(modelPath);
    // PT+EN: o detector sobe junto, para a primeira fala não esperar por ele
    const detectPort = language === 'pten' ? await this.ensureDetector(onProgress) : null;
    // Viés de vocabulário: o embutido do idioma e, por último, o do usuário.
    // No PT+EN o prompt é montado em cada fala, depois de saber o idioma.
    this.sessions.set(sessionId, {
      source, language, userPrompt: prompt, prompt: composePrompt(prompt, language),
      fast: Boolean(fast), port, detectPort, lastLang: null, pcmChunks: [], bytes: 0, active: true,
    });
    return { sessionId, port };
  }

  // Idioma de um trecho, só entre português e inglês. Devolve 'pt' | 'en',
  // ou null se o detector falhar ou achar outro idioma. Com response_format
  // json a resposta traz só o idioma mais provável; o verbose_json traria as
  // probabilidades, mas o servidor refaz a detecção para isso (dobra o tempo).
  async detectLanguage(session, wav) {
    try {
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      form.append('response_format', 'json');
      form.append('language', 'auto');
      form.append('detect_language', 'true');
      const res = await fetch(`http://127.0.0.1:${session.detectPort}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      return pickPtEn(await res.json());
    } catch {
      return null;
    }
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
    if (isSilent(pcm)) return null; // trecho mudo: o Whisper só inventaria texto

    const wav = pcmToWav(pcm, 16000);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    // O idioma vai sempre: sem o campo, o whisper-server usa o padrão dele,
    // que é inglês (e não automático), e fala em português virava tradução.
    let language = session.language;
    let prompt = session.prompt;
    if (language === 'pten') {
      // Se o detector falhar ou apontar outro idioma, vale o da fala anterior
      const lang = await this.detectLanguage(session, wav);
      if (lang) session.lastLang = lang;
      language = lang || session.lastLang || 'auto';
      prompt = composePrompt(session.userPrompt, language);
    }
    form.append('language', language);
    // Viés de vocabulário: o Whisper usa o prompt como contexto inicial,
    // o que corrige nomes próprios e jargões (ex.: "Robert" → não "bitch")
    if (prompt) form.append('prompt', prompt);
    // Transcrição rápida: o Whisper completa todo trecho até 30 s antes de
    // processar. Aqui ele processa uma janela menor quando a fala cabe nela.
    const audioCtx = session.fast ? fastAudioCtx(pcm.length) : null;
    if (audioCtx) form.append('audio_ctx', String(audioCtx));

    const res = await fetch(`http://127.0.0.1:${session.port}/inference`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`whisper inference: HTTP ${res.status}`);
    const data = await res.json();
    const text = cleanTranscript(data.text);
    if (!text) return null; // silêncio, ruído ou alucinação conhecida

    this.sendToRenderer('stt:transcription-delta', {
      sessionId, source: session.source, text, ts: Date.now(),
      lang: language === 'auto' ? null : language,
    });
    return text;
  }

  async stopSession(sessionId) {
    const text = await this.flush(sessionId).catch(() => null);
    const session = this.sessions.get(sessionId);
    if (session) session.active = false;
    this.sessions.delete(sessionId);
    this.sendToRenderer('stt:transcription-complete', { sessionId, text });
    return { sessionId, finalText: text };
  }

  // Mata os whisper-servers — chamado no before-quit para não deixar processo órfão
  dispose() {
    for (const s of this.sessions.values()) s.active = false;
    this.sessions.clear();
    for (const slot of Object.keys(this.servers)) this._stop(slot);
  }
}

// Threads do whisper-server. Sempre sobram 2 núcleos para o app da reunião
// (Teams, Meet, Zoom). Numa reunião simulada num i5 de 6 núcleos, usar os 6
// atrasou 10% dos quadros e nem deixou a transcrição mais rápida, porque a
// reunião também disputa a CPU.
// Acima de 6 núcleos lógicos, conta metade: são processadores com
// hyperthreading, e o Whisper não ganha com o núcleo lógico extra.
function whisperThreads(logical = os.availableParallelism ? os.availableParallelism() : os.cpus().length) {
  const n = logical <= 6 ? logical - 2 : Math.floor(logical / 2);
  return Math.min(8, Math.max(2, n));
}

// Prioridade "abaixo do normal": quando a reunião precisa da CPU, o Windows
// atende a reunião primeiro e o Whisper espera. Com 4 threads nessa
// prioridade, nenhum quadro da reunião simulada atrasou; a fala demorou uns
// 15% a mais só nos momentos em que a CPU estava ocupada.
function lowerPriority(pid) {
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch { /* sem permissão: segue na prioridade normal */ }
}

// Resposta do detect_language -> 'pt' | 'en', ou null se for outro idioma.
// Com probabilidades (verbose_json), escolhe o mais provável dos dois.
function pickPtEn(data) {
  const p = data?.language_probabilities;
  if (p && (p.pt || p.en)) return (p.pt || 0) >= (p.en || 0) ? 'pt' : 'en';
  const top = data?.detected_language || data?.language;
  if (top === 'pt' || top === 'portuguese') return 'pt';
  if (top === 'en' || top === 'english') return 'en';
  return null;
}

// audio_ctx do modo rápido, ou null para a janela inteira (30 s).
// O Whisper usa 50 quadros por segundo; pcmBytes é PCM s16le mono 16 kHz
// (32000 bytes por segundo).
//
// A janela é FIXA em 1024 quadros (20 s) para falas de até 10 s, com 10 s de
// folga, e inteira acima disso. Uma janela que mudava a cada fala (tamanho da
// fala + folga) corrompia o whisper-server: com flash attention e o
// vocabulário no prompt, a partir do 15º pedido todas as falas voltavam
// vazias, até reiniciar o servidor. Com 1024 fixo (alternando com a janela
// inteira) foram 140 pedidos sem falha, no small e no base. No banco de
// testes (small, 6 threads): 3,5 s -> 2,5 s por fala; erro de palavras igual
// (9,1%) nas vozes PT/EN e 28,9% -> 30,4% na voz mais difícil.
const FAST_AUDIO_CTX = 1024;
function fastAudioCtx(pcmBytes) {
  const secs = pcmBytes / 32000;
  return secs * 50 + 512 <= FAST_AUDIO_CTX ? FAST_AUDIO_CTX : null;
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

module.exports = { WhisperService, MODEL_CATALOG, fastAudioCtx, whisperThreads, pickPtEn };
