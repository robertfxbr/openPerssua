import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { detectQuestion } from './assist/questionDetector';
import './styles.css';

const api = window.openperssua;
const MAX_TRANSCRIPT_LINES = 500; // cap para não crescer sem limite em reuniões longas
const ASSIST_CONTEXT_LINES = 40;  // janela de contexto enviada ao LLM no auto-assist
const ASSIST_COOLDOWN_MS = 12000; // mínimo entre sugestões automáticas
const PENDING_QUESTION_MS = 4500; // espera a continuação de pergunta sem "?"

// ---- VAD (voice activity detection) por energia ----
// Em vez de flush fixo a cada 5s (que cortava frases e gerava alucinações do
// Whisper em silêncio), o flush acontece no FIM da fala: 1,1s de silêncio após
// voz detectada, com teto de 15s por janela.
const VAD_THRESHOLD = 0.012;     // RMS mínimo p/ considerar fala
const VAD_SILENCE_MS = 1100;     // silêncio que encerra o enunciado
const VAD_MAX_WINDOW_MS = 15000; // força flush em falas muito longas

// AudioWorklet inline (substitui o depreciado ScriptProcessorNode)
const WORKLET_CODE = `
class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
`;

const ASSIST_MODES = [
  ['interview', 'Entrevista'],
  ['meeting', 'Reunião'],
  ['free', 'Livre'],
];

const REFINE_CHIPS = [
  ['Mais curto', 'Responda de forma mais curta e direta (máximo 2 frases).'],
  ['Mais formal', 'Use tom mais formal e profissional.'],
  ['Em inglês', 'Responda em inglês.'],
  ['Exemplo prático', 'Inclua um exemplo prático e concreto na resposta.'],
];

const WHISPER_MODELS = [
  ['ggml-tiny.bin', 'Tiny — mais rápido, menos preciso (75 MB)'],
  ['ggml-base.bin', 'Base — equilíbrio (148 MB)'],
  ['ggml-small.bin', 'Small — bem mais preciso em PT-BR (466 MB) · recomendado'],
];

const ACCENTS = {
  aurora: { a: '#2fe0b0', b: '#8b7cf6', aSoft: 'rgba(47,224,176,0.16)', bSoft: 'rgba(139,124,246,0.14)' },
  oceano: { a: '#38bdf8', b: '#818cf8', aSoft: 'rgba(56,189,248,0.16)', bSoft: 'rgba(129,140,248,0.14)' },
  ambar: { a: '#fbbf24', b: '#fb7185', aSoft: 'rgba(251,191,36,0.16)', bSoft: 'rgba(251,113,133,0.14)' },
};

const DEFAULT_THEME = { mode: 'dark', accent: 'aurora', opacity: 0.95, fontScale: 1 };

// Modelos aceitos pelo backend Codex com conta ChatGPT (vazio = padrão)
const MODEL_OPTIONS = [
  ['gpt-6-luna', 'GPT-6 Luna — mais rápido e econômico ✦ recomendado'],
  ['gpt-6-sol', 'GPT-6 Sol — equilíbrio'],
  ['gpt-6.1-sol', 'GPT-6.1 Sol — máxima qualidade (padrão Codex)'],
  ['gpt-6-astra', 'GPT-6 Astra — frontier, lento e pesado'],
];

function applyTheme(t) {
  const root = document.documentElement;
  const acc = ACCENTS[t.accent] || ACCENTS.aurora;
  root.style.setProperty('--mint', acc.a);
  root.style.setProperty('--lilac', acc.b);
  root.style.setProperty('--mint-soft', acc.aSoft);
  root.style.setProperty('--lilac-soft', acc.bSoft);
  if (t.mode === 'light') {
    root.style.setProperty('--bg', `rgba(244, 245, 250, ${t.opacity})`);
    root.style.setProperty('--text', '#17181f');
    root.style.setProperty('--text-dim', '#5c606e');
    root.style.setProperty('--surface', 'rgba(15, 15, 25, 0.05)');
    root.style.setProperty('--surface-hover', 'rgba(15, 15, 25, 0.1)');
    root.style.setProperty('--border', 'rgba(15, 15, 25, 0.12)');
  } else {
    root.style.setProperty('--bg', `rgba(19, 17, 26, ${t.opacity})`);
    root.style.setProperty('--text', '#eef0f6');
    root.style.setProperty('--text-dim', '#989ca8');
    root.style.setProperty('--surface', 'rgba(255, 255, 255, 0.055)');
    root.style.setProperty('--surface-hover', 'rgba(255, 255, 255, 0.1)');
    root.style.setProperty('--border', 'rgba(255, 255, 255, 0.08)');
  }
  document.body.style.fontSize = `${14 * t.fontScale}px`;
}

function App() {
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [transcript, setTranscript] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false); // preparando escuta (download de modelo etc.)
  const [modelProgress, setModelProgress] = useState(null); // { received, total }
  const [busy, setBusy] = useState(false);
  const [chatGptAuthed, setChatGptAuthed] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  // ---- copiloto ativo ----
  const [assistMode, setAssistMode] = useState('interview');
  const [autoAssist, setAutoAssist] = useState(true);
  const [profile, setProfile] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [suggestion, setSuggestion] = useState(null); // { question, text, streaming }

  // ---- resumo pós-sessão ----
  const [summary, setSummary] = useState(null); // { text, streaming }

  // ---- modo mini / níveis de áudio / tema / onboarding ----
  const [compact, setCompact] = useState(false);
  const [levels, setLevels] = useState({ mic: 0, sys: 0 });
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [showTheme, setShowTheme] = useState(false);
  const [onboarding, setOnboarding] = useState(null); // null | 0|1|2 (passo)
  const [sttModel, setSttModel] = useState('ggml-base.bin');
  const [llmModel, setLlmModel] = useState(''); // '' = padrão do provedor
  const [sttLang, setSttLang] = useState('pt'); // idioma do Whisper: pt | en
  const [sttPrompt, setSttPrompt] = useState(''); // viés de vocabulário (nomes, jargões)

  // ---- histórico de sessões ----
  const [view, setView] = useState('live'); // 'live' | 'history'
  const [historySessions, setHistorySessions] = useState([]);
  const [historyDetail, setHistoryDetail] = useState(null); // { session, transcriptions, messages }

  const sessionRef = useRef(null);   // { dbId, micSttId, sysSttId }
  const audioRef = useRef(null);     // { mic|sys: { stream, audioCtx, processor, analyser, flusher } }
  const transcriptEndRef = useRef(null);
  const transcriptRef = useRef([]);  // espelho do estado p/ callbacks fora do render

  // refs p/ valores usados dentro de callbacks de evento (registrados uma vez)
  const assistModeRef = useRef(assistMode);
  const autoAssistRef = useRef(autoAssist);
  const profileRef = useRef(profile);
  const providerRef = useRef(provider);
  const sttModelRef = useRef(sttModel);
  const llmModelRef = useRef(llmModel);
  const sttLangRef = useRef(sttLang);
  const sttPromptRef = useRef(sttPrompt);
  const suggestionRef = useRef(suggestion);
  const assistBusyRef = useRef(false);
  const assistStreamIdRef = useRef(null);
  const askStreamIdRef = useRef(null);
  const lastQuestionRef = useRef('');
  const lastAssistAtRef = useRef(0);
  const sysWindowRef = useRef([]);   // últimas falas do sistema p/ detector com contexto
  const pendingRef = useRef(null);   // pergunta sem "?" aguardando continuação
  const vadRef = useRef({});         // estado VAD por slot (mic|sys)
  const toggleListenRef = useRef(null); // p/ atalho global sem closure obsoleta

  useEffect(() => { assistModeRef.current = assistMode; }, [assistMode]);
  useEffect(() => { autoAssistRef.current = autoAssist; }, [autoAssist]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { providerRef.current = provider; }, [provider]);
  useEffect(() => { sttModelRef.current = sttModel; }, [sttModel]);
  useEffect(() => { llmModelRef.current = llmModel; }, [llmModel]);
  useEffect(() => { sttLangRef.current = sttLang; }, [sttLang]);
  useEffect(() => { sttPromptRef.current = sttPrompt; }, [sttPrompt]);
  useEffect(() => { suggestionRef.current = suggestion; }, [suggestion]);
  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    refreshProviders();
    api.settings.get('llm.provider').then((p) => {
      if (!p) return;
      setProvider(p);
      // Sem isso, toda abertura do app mostrava "Entrar com ChatGPT" mesmo
      // com token válido salvo — parecia que a conta desconectava.
      if (p === 'chatgpt-oauth') checkChatGptAuth();
    });
    api.settings.get('assist.mode').then((m) => m && setAssistMode(m));
    api.settings.get('assist.auto').then((v) => {
      if (v !== undefined && v !== null) setAutoAssist(Boolean(v));
    });
    api.settings.get('assist.profile').then((p) => p && setProfile(p));
    api.settings.get('stt.model').then((m) => m && setSttModel(m));
    api.settings.get('llm.model').then((m) => m && setLlmModel(m));
    api.settings.get('stt.language').then((l) => l && setSttLang(l));
    api.settings.get('stt.prompt').then((p) => p && setSttPrompt(p));
    api.settings.get('ui.theme').then((t) => t && setTheme({ ...DEFAULT_THEME, ...t }));
    api.settings.get('onboarding.done').then((done) => {
      if (!done) setOnboarding(0);
    });

    const unsubDelta = api.stt.onDelta(({ source, text }) => {
      if (!text?.trim()) return;
      const entry = { source, text, ts: Date.now() };
      transcriptRef.current = [...transcriptRef.current.slice(-MAX_TRANSCRIPT_LINES + 1), entry];
      setTranscript(transcriptRef.current);
      const dbId = sessionRef.current?.dbId;
      if (dbId) api.db.addTranscription({ sessionId: dbId, source, text });
      if (source === 'system') {
        sysWindowRef.current = [...sysWindowRef.current.slice(-2), text];
        maybeAutoAssist();
      }
    });

    // Atalhos globais: ✦ sugerir agora / copiar sugestão (sem focar a janela)
    const unsubTrig = api.overlay.onAssistTrigger(() => {
      runAssist(lastQuestionRef.current || '');
    });
    const unsubCopy = api.overlay.onCopySuggestion(() => {
      const s = suggestionRef.current;
      if (s?.text) navigator.clipboard.writeText(s.text);
    });
    const unsubListen = api.overlay.onToggleListen(() => {
      toggleListenRef.current?.();
    });
    const unsubProg = api.stt.onModelProgress((p) => setModelProgress(p));

    return () => {
      unsubDelta();
      unsubTrig();
      unsubCopy();
      unsubListen();
      unsubProg();
      stopAllCaptures();
    };
  }, []);

  // autoscroll da transcrição
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // medidores de nível de áudio (mic + sistema) enquanto escuta
  useEffect(() => {
    if (!listening) { setLevels({ mic: 0, sys: 0 }); return undefined; }
    const id = setInterval(() => {
      setLevels({ mic: readLevel('mic'), sys: readLevel('sys') });
    }, 180);
    return () => clearInterval(id);
  }, [listening]);

  function readLevel(slot) {
    const a = audioRef.current?.[slot];
    if (!a?.analyser) return 0;
    const buf = new Uint8Array(a.analyser.fftSize);
    a.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
  }

  function refreshProviders() {
    api.llm.listProviders().then(setProviders).catch((e) => setError(String(e)));
  }

  async function selectProvider(id) {
    setProvider(id);
    await api.settings.set('llm.provider', id);
    if (id === 'chatgpt-oauth') checkChatGptAuth();
    refreshProviders();
  }

  async function checkChatGptAuth() {
    try {
      const { authenticated } = await api.auth.getChatGptStatus();
      setChatGptAuthed(authenticated);
    } catch { /* status desconhecido */ }
  }

  async function startChatGptLogin() {
    setError('');
    setAuthBusy(true);
    try {
      await api.auth.startChatGptOAuth();
      await checkChatGptAuth();
      refreshProviders();
    } catch (e) {
      setError(`login ChatGPT: ${e.message || e}`);
    } finally {
      setAuthBusy(false);
    }
  }

  async function logoutChatGpt() {
    await api.auth.logoutChatGpt();
    setChatGptAuthed(false);
    refreshProviders();
  }

  function changeAssistMode(mode) {
    setAssistMode(mode);
    api.settings.set('assist.mode', mode);
  }

  function toggleAutoAssist() {
    const next = !autoAssist;
    setAutoAssist(next);
    api.settings.set('assist.auto', next);
  }

  function saveProfile(value) {
    setProfile(value);
    api.settings.set('assist.profile', value);
  }

  function updateTheme(patch) {
    const next = { ...theme, ...patch };
    setTheme(next);
    api.settings.set('ui.theme', next);
  }

  async function toggleCompact() {
    const next = !compact;
    const r = await api.overlay.setCompact(next).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (!r?.ok) {
      setError(`modo mini: ${r?.error || 'falha ao redimensionar a janela'}`);
      return;
    }
    setCompact(next);
  }

  function selectSttModel(model) {
    setSttModel(model);
    api.settings.set('stt.model', model);
  }

  function finishOnboarding() {
    api.settings.set('onboarding.done', '1');
    setOnboarding(null);
  }

  // ================= histórico de sessões =================

  async function openHistory() {
    setView('history');
    setHistoryDetail(null);
    try {
      const sessions = await api.db.getSessions({ limit: 50 });
      setHistorySessions(sessions || []);
    } catch (e) {
      setError(`histórico: ${e.message || e}`);
    }
  }

  async function openHistorySession(session) {
    try {
      const [transcriptions, messages] = await Promise.all([
        api.db.getTranscriptions(session.id),
        api.db.getMessages(session.id),
      ]);
      setHistoryDetail({ session, transcriptions, messages });
    } catch (e) {
      setError(`histórico: ${e.message || e}`);
    }
  }

  function exportHistoryMarkdown() {
    if (!historyDetail) return;
    const { session, transcriptions, messages } = historyDetail;
    const dt = new Date(session.started_at).toLocaleString('pt-BR');
    const lines = [`# Sessão OpenPerssua — ${dt}`, ''];
    if (transcriptions.length) {
      lines.push('## Transcrição', '');
      for (const t of transcriptions) {
        lines.push(`**${t.source === 'mic' ? 'Você' : 'Reunião'}:** ${t.text}`, '');
      }
    }
    const summaries = messages.filter((m) => m.content?.startsWith('[RESUMO'));
    const answers = messages.filter((m) => !m.content?.startsWith('[RESUMO'));
    if (summaries.length) {
      lines.push('## Resumo', '');
      for (const m of summaries) lines.push(m.content.replace('[RESUMO DA SESSÃO]\n', ''), '');
    }
    if (answers.length) {
      lines.push('## Respostas do copiloto', '');
      for (const m of answers) lines.push(m.content, '');
    }
    navigator.clipboard.writeText(lines.join('\n'));
  }

  // ================= copiloto ativo =================

  // Detector com janela de contexto: uma pergunta falada pode chegar quebrada
  // em 2 flushes de 5s. Combina as últimas falas e, se não houver "?", espera
  // a continuação antes de disparar (pending com timeout).
  function maybeAutoAssist() {
    if (!autoAssistRef.current || assistBusyRef.current) return;
    const combined = sysWindowRef.current.slice(-2).join(' ');
    const q = detectQuestion(combined);
    if (!q) return;
    if (q === lastQuestionRef.current) return;

    const hasTerminator = q.includes('?');
    if (!hasTerminator) {
      if (pendingRef.current?.q === q) return; // já aguardando continuação
      clearTimeout(pendingRef.current?.timer);
      pendingRef.current = {
        q,
        timer: setTimeout(() => fireAssist(q), PENDING_QUESTION_MS),
      };
      return;
    }
    clearTimeout(pendingRef.current?.timer);
    pendingRef.current = null;
    fireAssist(q);
  }

  function fireAssist(q) {
    if (assistBusyRef.current) return;
    if (q === lastQuestionRef.current) return;
    const now = Date.now();
    if (now - lastAssistAtRef.current < ASSIST_COOLDOWN_MS) return;
    lastQuestionRef.current = q;
    lastAssistAtRef.current = now;
    runAssist(q);
  }

  async function runAssist(q, instruction) {
    if (assistBusyRef.current) return;
    assistBusyRef.current = true;
    setError('');
    setSummary(null);
    setSuggestion({ question: q || '', text: '', streaming: true });
    let acc = '';
    let streamErr = null;

    const matches = (streamId) =>
      !assistStreamIdRef.current || streamId === assistStreamIdRef.current;

    const unsubChunk = api.llm.onStreamChunk(({ streamId, delta }) => {
      if (!matches(streamId)) return;
      acc += delta;
      setSuggestion((s) => (s ? { ...s, text: acc } : s));
    });
    const unsubErr = api.llm.onStreamError(({ streamId, error: err }) => {
      if (!matches(streamId)) return;
      streamErr = err;
    });
    const done = new Promise((resolve) => {
      const unsubDone = api.llm.onStreamDone(({ streamId }) => {
        if (!matches(streamId)) return;
        unsubDone();
        resolve();
      });
    });

    try {
      const { streamId } = await api.llm.chatStream({
        mode: 'assist',
        question: q,
        transcript: transcriptRef.current.slice(-ASSIST_CONTEXT_LINES),
        assistMode: assistModeRef.current,
        profile: profileRef.current,
        instruction,
        model: llmModelRef.current || undefined,
      });
      assistStreamIdRef.current = streamId;
      await done;
      if (streamErr) setError(`sugestão: ${streamErr}`);
      const dbId = sessionRef.current?.dbId;
      if (dbId && acc) api.db.addMessage({ sessionId: dbId, role: 'assistant', content: acc });
    } catch (e) {
      setError(`sugestão: ${e.message || e}`);
      setSuggestion(null);
    } finally {
      unsubChunk();
      unsubErr();
      assistStreamIdRef.current = null;
      assistBusyRef.current = false;
      setSuggestion((s) => (s ? { ...s, streaming: false } : s));
    }
  }

  // ================= resumo pós-sessão =================

  async function summarizeSession(dbId, lines) {
    if (lines.length < 3 || !providerRef.current) return;
    setSummary({ text: '', streaming: true });
    try {
      const text = await api.llm.chat({
        mode: 'summary',
        transcript: lines.slice(-300),
        model: llmModelRef.current || undefined,
      });
      setSummary({ text, streaming: false });
      if (dbId && text) {
        api.db.addMessage({ sessionId: dbId, role: 'assistant', content: `[RESUMO DA SESSÃO]\n${text}` });
      }
    } catch (e) {
      setSummary(null);
      setError(`resumo: ${e.message || e}`);
    }
  }

  // ================= captura de áudio =================

  async function toggleListening() {
    setError('');
    if (listening) {
      stopAllCaptures();
      const sess = sessionRef.current;
      const lines = transcriptRef.current;
      if (sess) {
        await api.stt.stopSession(sess.micSttId).catch(() => {});
        if (sess.sysSttId) await api.stt.stopSession(sess.sysSttId).catch(() => {});
        sessionRef.current = null;
      }
      setListening(false);
      setLevels({ mic: 0, sys: 0 });
      summarizeSession(sess?.dbId, lines); // resumo automático em background
      return;
    }
    if (starting) return; // clique duplo durante preparo/download — ignora
    setStarting(true);
    setModelProgress(null);
    try {
      setSummary(null);
      const { id: dbId } = await api.db.createSession({ subject: 'Sessão overlay' });
      const { sessionId: micSttId } = await api.stt.startSession({
        source: 'mic',
        model: sttModelRef.current,
        language: sttLangRef.current,
        prompt: sttPromptRef.current,
      });
      sessionRef.current = { dbId, micSttId, sysSttId: null };
      await startMicCapture(micSttId);
      setListening(true);

      // Áudio do sistema (Discord/Zoom/Meet): best-effort — se não houver
      // saída de som ou o loopback falhar, a escuta do mic continua.
      try {
        const { sessionId: sysSttId } = await api.stt.startSession({
          source: 'system',
          model: sttModelRef.current,
          language: sttLangRef.current,
          prompt: sttPromptRef.current,
        });
        sessionRef.current.sysSttId = sysSttId;
        await startSystemCapture(sysSttId);
      } catch (e) {
        console.warn('loopback indisponível:', e);
        setError('áudio do sistema indisponível — transcrito apenas o microfone');
      }
    } catch (e) {
      stopAllCaptures();
      sessionRef.current = null;
      setError(`falha ao iniciar escuta: ${e.message || e}`);
    } finally {
      setStarting(false);
      setModelProgress(null);
    }
  }

  // expõe para o atalho global Ctrl+Shift+M (sem closure obsoleta)
  useEffect(() => { toggleListenRef.current = toggleListening; });

  function stopCapture(slot) {
    const a = audioRef.current?.[slot];
    if (!a) return;
    try {
      a.node?.disconnect();
      a.processor?.disconnect();
      a.analyser?.disconnect();
      a.audioCtx.close();
    } catch { /* já fechado */ }
    a.stream.getTracks().forEach((t) => t.stop());
    delete audioRef.current[slot];
    delete vadRef.current[slot];
  }

  function stopAllCaptures() {
    stopCapture('mic');
    stopCapture('sys');
  }

  // VAD por energia: converte o chunk em PCM, envia ao Whisper e decide o
  // flush no fim da fala (silêncio de 1,1s) — não mais por relógio fixo.
  function handleAudioChunk(slot, sttId, float) {
    if (!sessionRef.current) return;

    let sum = 0;
    for (let i = 0; i < float.length; i++) sum += float[i] * float[i];
    const rms = Math.sqrt(sum / float.length);

    const pcm = new Int16Array(float.length);
    for (let i = 0; i < float.length; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, float[i] * 32768));
    }
    api.stt.sendAudio(sttId, pcm.buffer);

    const v = vadRef.current[slot];
    if (!v) return;
    const frameMs = (float.length / 16000) * 1000;
    if (rms > VAD_THRESHOLD) {
      v.speaking = true;
      v.hasSpeech = true;
      v.silenceMs = 0;
    } else if (v.speaking) {
      v.silenceMs += frameMs;
      if (v.silenceMs >= VAD_SILENCE_MS) flushSlot(slot, sttId);
    }
    if (v.hasSpeech && Date.now() - v.lastFlushAt >= VAD_MAX_WINDOW_MS) {
      flushSlot(slot, sttId);
    }
  }

  function flushSlot(slot, sttId) {
    const v = vadRef.current[slot];
    if (!v?.hasSpeech) return;
    v.hasSpeech = false;
    v.speaking = false;
    v.silenceMs = 0;
    v.lastFlushAt = Date.now();
    api.stt.flush(sttId).catch(() => {});
  }

  // Encaminha PCM 16kHz mono de uma MediaStream para a sessão STT.
  // Usa AudioWorklet (thread de áudio dedicada); cai p/ ScriptProcessor
  // se o worklet não estiver disponível.
  async function pipeStreamToStt(stream, sttId, slot) {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    vadRef.current[slot] = { speaking: false, hasSpeech: false, silenceMs: 0, lastFlushAt: Date.now() };

    let node = null;
    let processor = null;
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
      await audioCtx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(audioCtx, 'pcm-worklet');
      node.port.onmessage = (e) => handleAudioChunk(slot, sttId, e.data);
      source.connect(node);
      node.connect(audioCtx.destination);
    } catch (e) {
      console.warn('AudioWorklet indisponível, usando ScriptProcessor:', e);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (ev) => handleAudioChunk(slot, sttId, ev.inputBuffer.getChannelData(0));
      source.connect(processor);
      processor.connect(audioCtx.destination);
    }
    audioRef.current = audioRef.current || {};
    audioRef.current[slot] = { stream, audioCtx, node, processor, analyser };
  }

  async function startMicCapture(sttId) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await pipeStreamToStt(stream, sttId, 'mic');
  }

  // Áudio do sistema via electron-audio-loopback: o plugin faz o
  // getDisplayMedia devolver o mix de saída (o que toca no PC).
  async function startSystemCapture(sttId) {
    await api.audio.enableLoopback();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } finally {
      await api.audio.disableLoopback().catch(() => {});
    }
    // remove tracks de vídeo (obrigatório pedir video:true, mas não usamos)
    stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('loopback sem track de áudio');
    }
    await pipeStreamToStt(stream, sttId, 'sys');
  }

  // ================= pergunta manual =================

  async function ask() {
    if (!question.trim() || busy) return;
    setError('');
    setAnswer('');
    setBusy(true);
    // Inscreve os listeners ANTES do invoke: o primeiro chunk pode chegar
    // antes da promise do invoke resolver (race real observado em auditoria).
    let acc = '';
    const matches = (streamId) =>
      !askStreamIdRef.current || streamId === askStreamIdRef.current;
    const unsubChunk = api.llm.onStreamChunk(({ streamId, delta }) => {
      if (!matches(streamId)) return;
      acc += delta;
      setAnswer(acc);
    });
    const unsubErr = api.llm.onStreamError(({ streamId, error: err }) => {
      if (matches(streamId)) setError(err);
    });
    const done = new Promise((resolve) => {
      const unsubDone = api.llm.onStreamDone(({ streamId }) => {
        if (!matches(streamId)) return;
        unsubDone();
        resolve();
      });
    });
    try {
      const { streamId } = await api.llm.chatStream({
        question,
        transcript,
        model: llmModelRef.current || undefined,
      });
      askStreamIdRef.current = streamId;
      await done;
      const dbId = sessionRef.current?.dbId;
      if (dbId && acc) api.db.addMessage({ sessionId: dbId, role: 'assistant', content: acc });
      setQuestion('');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      unsubChunk();
      unsubErr();
      askStreamIdRef.current = null;
      setBusy(false);
    }
  }

  // ================= UI =================

  // ---- modo mini: pílula com status + última sugestão ----
  if (compact) {
    return (
      <div className="app compact">
        <div className="compact-bar">
          <button className="icon-btn" title="Expandir" onClick={toggleCompact}>▢</button>
          <span className={`status-dot ${listening ? 'on' : ''}`} />
          <div className="compact-text">
            {suggestion?.text
              ? suggestion.text.slice(0, 140)
              : listening ? 'ouvindo…' : 'OpenPerssua'}
            {suggestion?.streaming && <span className="caret">▌</span>}
          </div>
          {suggestion?.text && (
            <button
              className="icon-btn"
              title="Copiar sugestão"
              onClick={() => navigator.clipboard.writeText(suggestion.text)}
            >
              ⧉
            </button>
          )}
          <button className="icon-btn" title="Esconder (Ctrl+Shift+Space)" onClick={() => api.overlay.toggle()}>—</button>
        </div>
      </div>
    );
  }

  // ---- tela de histórico ----
  if (view === 'history') {
    return (
      <div className="app">
        <div className="header">
          <button className="icon-btn" title="Voltar" onClick={() => { setView('live'); setHistoryDetail(null); }}>←</button>
          <div className="logo">
            <span className="logo-name">{historyDetail ? 'Sessão' : 'Histórico'}</span>
          </div>
          {historyDetail && (
            <button className="icon-btn" title="Copiar como Markdown" onClick={exportHistoryMarkdown}>⧉</button>
          )}
          <button className="icon-btn" title="Esconder (Ctrl+Shift+Space)" onClick={() => api.overlay.toggle()}>—</button>
        </div>

        {!historyDetail ? (
          <div className="history-list">
            {historySessions.length === 0 && (
              <div className="transcript-empty">
                <span className="big">🕘</span>
                Nenhuma sessão gravada ainda.
                <br />Inicie uma escuta e ela aparecerá aqui.
              </div>
            )}
            {historySessions.map((s) => (
              <button key={s.id} className="history-item" onClick={() => openHistorySession(s)}>
                <span className="history-date">
                  {new Date(s.started_at).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span className="history-subject">{s.subject || 'Sessão overlay'}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="transcript">
            <button className="chip history-back" onClick={() => setHistoryDetail(null)}>← todas as sessões</button>
            {historyDetail.transcriptions.map((t, i) => (
              <div key={i} className={`bubble ${t.source}`}>
                <span className="who">{t.source === 'mic' ? 'Você' : 'Reunião'}</span>
                {t.text}
              </div>
            ))}
            {historyDetail.messages.map((m, i) => (
              <div key={`m${i}`} className="answer">
                <span className="label">✦ copiloto</span>
                {m.content}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <div className="logo">
          <div className="logo-mark">◆</div>
          <span className="logo-name">OpenPerssua</span>
        </div>
        <div className={`status-pill ${listening ? 'on' : ''}`}>
          <span className="dot" />
          {listening ? 'ouvindo' : 'parado'}
        </div>
        <button className="icon-btn" title="Histórico de sessões" onClick={openHistory}>🕘</button>
        <button className={`icon-btn ${showTheme ? 'active' : ''}`} title="Aparência" onClick={() => setShowTheme(!showTheme)}>⚙</button>
        <button className="icon-btn" title="Modo mini" onClick={toggleCompact}>▂</button>
        <button className="icon-btn" title="Esconder (Ctrl+Shift+Space)" onClick={() => api.overlay.toggle()}>—</button>
      </div>

      {showTheme && (
        <div className="theme-panel">
          <div className="theme-row">
            <span className="theme-label">modo</span>
            <div className="mode-pills slim">
              <button className={`pill ${theme.mode === 'dark' ? 'active' : ''}`} onClick={() => updateTheme({ mode: 'dark' })}>escuro</button>
              <button className={`pill ${theme.mode === 'light' ? 'active' : ''}`} onClick={() => updateTheme({ mode: 'light' })}>claro</button>
            </div>
          </div>
          <div className="theme-row">
            <span className="theme-label">acento</span>
            <div className="swatches">
              {Object.entries(ACCENTS).map(([id, c]) => (
                <button
                  key={id}
                  className={`swatch ${theme.accent === id ? 'active' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${c.a}, ${c.b})` }}
                  title={id}
                  onClick={() => updateTheme({ accent: id })}
                />
              ))}
            </div>
          </div>
          <div className="theme-row">
            <span className="theme-label">opacidade</span>
            <input
              type="range" min="0.8" max="1" step="0.01" value={theme.opacity}
              onChange={(e) => updateTheme({ opacity: Number(e.target.value) })}
            />
          </div>
          <div className="theme-row">
            <span className="theme-label">fonte</span>
            <input
              type="range" min="0.9" max="1.15" step="0.05" value={theme.fontScale}
              onChange={(e) => updateTheme({ fontScale: Number(e.target.value) })}
            />
          </div>
          <div className="theme-row">
            <span className="theme-label">idioma</span>
            <div className="mode-pills slim">
              <button
                className={`pill ${sttLang === 'pt' ? 'active' : ''}`}
                onClick={() => { setSttLang('pt'); api.settings.set('stt.language', 'pt'); }}
                title="Transcrição em português (Brasil)"
              >
                PT-BR
              </button>
              <button
                className={`pill ${sttLang === 'en' ? 'active' : ''}`}
                onClick={() => { setSttLang('en'); api.settings.set('stt.language', 'en'); }}
                title="Transcription in English (US)"
              >
                EN-US
              </button>
            </div>
          </div>
          <div className="theme-row">
            <span className="theme-label">vocabulário</span>
            <input
              className="model-input"
              value={sttPrompt}
              placeholder="nomes próprios e jargões (ex.: Robert, OpenPerssua)"
              title="O Whisper usa como contexto — soma-se ao vocabulário embutido (nomes IBGE + termos de reunião e tecnologia PT-BR/EN)"
              onChange={(e) => {
                setSttPrompt(e.target.value);
                api.settings.set('stt.prompt', e.target.value);
              }}
            />
          </div>
          <div className="theme-row">
            <span className="theme-label">modelo</span>
            <input
              className="model-input"
              list="llm-models"
              value={llmModel}
              placeholder="automático (padrão do provedor)"
              onChange={(e) => {
                setLlmModel(e.target.value.trim());
                api.settings.set('llm.model', e.target.value.trim());
              }}
            />
            <datalist id="llm-models">
              {MODEL_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </datalist>
          </div>
        </div>
      )}

      <div className="provider-row">
        <div className="select-wrap">
          <select value={provider} onChange={(e) => selectProvider(e.target.value)}>
            <option value="">Escolha o cérebro…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.configured ? ' ✓' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {provider === 'chatgpt-oauth' && (
        chatGptAuthed ? (
          <div className="auth-row">
            <span className="auth-pill ok">✓ ChatGPT conectado</span>
            <button className="auth-link" onClick={logoutChatGpt}>sair</button>
          </div>
        ) : (
          <div className="auth-row">
            <button className="login-btn" onClick={startChatGptLogin} disabled={authBusy}>
              {authBusy ? 'aguardando autorização no navegador…' : '⬡ Entrar com ChatGPT'}
            </button>
          </div>
        )
      )}

      <div className="assist-row">
        <div className="mode-pills">
          {ASSIST_MODES.map(([id, label]) => (
            <button
              key={id}
              className={`pill ${assistMode === id ? 'active' : ''}`}
              onClick={() => changeAssistMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`auto-toggle ${autoAssist ? 'on' : ''}`}
          onClick={toggleAutoAssist}
          title="Sugerir resposta automaticamente quando detectar uma pergunta"
        >
          ⚡ auto
        </button>
      </div>

      <div className="profile-row">
        <button className="profile-toggle" onClick={() => setShowProfile(!showProfile)}>
          🎯 meu contexto {showProfile ? '▴' : '▾'}
        </button>
        {profile.trim() && !showProfile && <span className="profile-dot" title="Contexto preenchido" />}
      </div>
      {showProfile && (
        <textarea
          className="profile-editor"
          value={profile}
          rows={4}
          placeholder="Cole aqui seu currículo, resumo do LinkedIn, pontos fortes… O copiloto usa isso para responder como VOCÊ em entrevistas."
          onChange={(e) => saveProfile(e.target.value)}
        />
      )}

      <div className="hero">
        <button
          className={`mic-hero ${listening ? 'listening' : ''}`}
          onClick={toggleListening}
          disabled={starting}
          title={listening ? 'Parar escuta (Ctrl+Shift+M)' : 'Iniciar escuta (Ctrl+Shift+M)'}
        >
          {starting ? '⏳' : listening ? '⏹' : '🎙'}
        </button>
        {listening ? (
          <>
            <div className="wave"><span /><span /><span /><span /><span /></div>
            <div className="levels">
              <div className="level-row">
                <span className="level-label">você</span>
                <div className="level-track"><div className="level-fill mic" style={{ width: `${levels.mic * 100}%` }} /></div>
              </div>
              <div className="level-row">
                <span className="level-label">sistema</span>
                <div className="level-track"><div className="level-fill sys" style={{ width: `${levels.sys * 100}%` }} /></div>
              </div>
            </div>
          </>
        ) : starting ? (
          <span className="hero-label">
            {modelProgress?.total
              ? `baixando modelo… ${Math.round((modelProgress.received / modelProgress.total) * 100)}%`
              : 'preparando…'}
          </span>
        ) : (
          <span className="hero-label">toque para ouvir a reunião</span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {summary && (
        <div className="summary">
          <div className="sug-head">
            <span className="label">✦ resumo da sessão{summary.streaming ? '…' : ''}</span>
            <div className="sug-actions">
              <button
                onClick={() => navigator.clipboard.writeText(summary.text)}
                disabled={!summary.text}
                title="Copiar resumo"
              >
                copiar
              </button>
              <button onClick={() => setSummary(null)} title="Dispensar">✕</button>
            </div>
          </div>
          <div className="sug-text">{summary.text || 'gerando resumo…'}</div>
        </div>
      )}

      {suggestion && (
        <div className="suggestion">
          <div className="sug-head">
            <span className="label">✦ sugestão{suggestion.streaming ? '…' : ''}</span>
            <div className="sug-actions">
              <button
                onClick={() => navigator.clipboard.writeText(suggestion.text)}
                disabled={!suggestion.text}
                title="Copiar sugestão"
              >
                copiar
              </button>
              <button onClick={() => setSuggestion(null)} title="Dispensar">✕</button>
            </div>
          </div>
          {suggestion.question && <div className="sug-question">“{suggestion.question}”</div>}
          <div className="sug-text">{suggestion.text || 'pensando…'}</div>
          {!suggestion.streaming && suggestion.text && (
            <div className="sug-chips">
              {REFINE_CHIPS.map(([label, instruction]) => (
                <button
                  key={label}
                  className="chip"
                  onClick={() => runAssist(suggestion.question, instruction)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="transcript">
        {transcript.length === 0 && !answer && !suggestion && !summary && (
          <div className="transcript-empty">
            <span className="big">✦</span>
            A transcrição da conversa aparece aqui.
            <br />No modo <b>Entrevista</b> com ⚡ auto ligado, o copiloto
            <br />sugere sua resposta assim que detectar uma pergunta.
            <br /><span className="hint">Ctrl+Shift+M ouvir · Enter sugerir · C/Y copiar</span>
          </div>
        )}
        {transcript.map((t, i) => (
          <div key={i} className={`bubble ${t.source}`}>
            <span className="who">{t.source === 'mic' ? 'Você' : 'Reunião'}</span>
            {t.text}
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>

      {answer && (
        <div className="answer">
          <span className="label">✦ resposta</span>
          {answer}
        </div>
      )}

      <div className="composer">
        <button
          className="assist-btn"
          onClick={() => runAssist(lastQuestionRef.current || '')}
          disabled={busy || suggestion?.streaming}
          title="Sugerir o que dizer agora (Ctrl+Shift+Enter)"
        >
          ✦
        </button>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="Pergunte sobre a reunião…"
        />
        <button className="send-btn" onClick={ask} disabled={busy || !question.trim()}>
          {busy ? '…' : '↑'}
        </button>
      </div>

      {onboarding !== null && (
        <div className="onboarding">
          <div className="ob-card">
            <div className="ob-steps">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`ob-dot ${onboarding === i ? 'active' : ''} ${onboarding > i ? 'done' : ''}`} />
              ))}
            </div>

            {onboarding === 0 && (
              <>
                <h3>Modelo de transcrição</h3>
                <p className="ob-desc">O Whisper roda 100% local. O download acontece no primeiro uso.</p>
                <div className="ob-options">
                  {WHISPER_MODELS.map(([id, label]) => (
                    <button
                      key={id}
                      className={`ob-option ${sttModel === id ? 'active' : ''}`}
                      onClick={() => selectSttModel(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {onboarding === 1 && (
              <>
                <h3>Escolha o cérebro</h3>
                <p className="ob-desc">Use sua assinatura ChatGPT (login), uma API key, o Claude Code ou Ollama local.</p>
                <div className="select-wrap">
                  <select value={provider} onChange={(e) => selectProvider(e.target.value)}>
                    <option value="">Selecionar provedor…</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}{p.configured ? ' ✓' : ''}</option>
                    ))}
                  </select>
                </div>
                {provider === 'chatgpt-oauth' && !chatGptAuthed && (
                  <button className="login-btn" onClick={startChatGptLogin} disabled={authBusy}>
                    {authBusy ? 'aguardando autorização…' : '⬡ Entrar com ChatGPT'}
                  </button>
                )}
                {provider === 'chatgpt-oauth' && chatGptAuthed && (
                  <span className="auth-pill ok">✓ ChatGPT conectado</span>
                )}
              </>
            )}

            {onboarding === 2 && (
              <>
                <h3>Seu contexto</h3>
                <p className="ob-desc">Cole currículo, LinkedIn ou pontos fortes — o copiloto responde como você em entrevistas. Pode pular e preencher depois em "🎯 meu contexto".</p>
                <textarea
                  className="profile-editor"
                  value={profile}
                  rows={5}
                  placeholder="Ex.: 5 anos com React/Node, liderei migração de monólito, inglês fluente…"
                  onChange={(e) => saveProfile(e.target.value)}
                />
              </>
            )}

            <div className="ob-nav">
              <button className="auth-link" onClick={finishOnboarding}>pular</button>
              <div style={{ flex: 1 }} />
              {onboarding > 0 && (
                <button className="chip" onClick={() => setOnboarding(onboarding - 1)}>voltar</button>
              )}
              {onboarding < 2
                ? <button className="send-btn wide" onClick={() => setOnboarding(onboarding + 1)}>próximo</button>
                : <button className="send-btn wide" onClick={finishOnboarding}>concluir ✦</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
