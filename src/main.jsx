import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { detectQuestion } from './assist/questionDetector';
import { leadLine } from './assist/layered';
import { SuggestedQuestions } from './assist/SuggestedQuestions';
import { LayeredAnswer } from './assist/LayeredAnswer';
import { HistoryView } from './history/HistoryView';
import { ShortcutsPanel } from './panels/ShortcutsPanel';
import { SystemPanel } from './panels/SystemPanel';
import { AIPanel } from './panels/AIPanel';
import { AssistantsPanel } from './panels/AssistantsPanel';
import { ToolsPanel } from './panels/ToolsPanel';
import { McpConfirmations } from './panels/McpConfirmations';
import { normalizePreferences } from './assistants/preferences.mjs';
import { VoicePanel, HEAVY_MODELS } from './panels/VoicePanel';
import { DiagnosticsPanel } from './panels/DiagnosticsPanel';
import { parseAssistantImport } from './assistants/transfer.mjs';
import { contextToText, normalizeContext } from './assistants/context.mjs';
import { BUILTIN_ASSISTANTS, findAssistant } from './assistants/presets';
import { createListenReminder } from './audio/listenReminder.mjs';
import { findEcho, ECHO_WINDOW_MS } from './audio/echo';
import { formatClock } from './util/time';
import { prettyAccelerator } from './util/accelerator';
import {
  History, Settings2, Minimize2, Maximize2, EyeOff, Ghost, MousePointerClick, Mic, Square, LoaderCircle, Sparkles, Camera,
  ClipboardPaste, ArrowUp, Zap, IdCard, ChevronDown, ChevronUp, Mail, X, Copy,
} from 'lucide-react';
import '@fontsource-variable/bricolage-grotesque';
import { Markdown } from './ui/Markdown';
import { TekaMark } from './ui/TekaMark';
import './styles.css';

const api = window.teka;
const MAX_TRANSCRIPT_LINES = 500; // cap para não crescer sem limite em reuniões longas
const ASSIST_CONTEXT_LINES = 40;  // janela de contexto enviada ao LLM no auto-assist
const INTERVIEW_CONTEXT_LINES = 24; // entrevista: menos texto, primeira linha chega antes
const ASSIST_COOLDOWN_MS = 12000; // mínimo entre sugestões automáticas
const PENDING_QUESTION_MS = 4500; // espera a continuação de pergunta sem "?"
const PENDING_QUESTION_DRAFT_MS = 1200; // no modo entrevista, o rascunho começa rápido
const DRAFT_REFRESH_MS = 1400;    // debounce do refinamento enquanto o outro fala
const NEAR_BOTTOM_PX = 48;        // abaixo disso a transcrição conta como "no fim"
const CLIPBOARD_DEFAULT_QUESTION = 'Explique ou responda o trecho que copiei.';

// Memória de reuniões longas: a cada 80 falas ainda não resumidas, as mais
// antigas (menos as 20 últimas) viram um resumo curto que acompanha as
// perguntas. No máximo 200 falas por chamada.
const COMPACT_TRIGGER_LINES = 80;
const COMPACT_KEEP_RECENT = 20;
const COMPACT_MAX_CHUNK = 200;
const SUMMARY_FULL_LINES = 300;  // até aqui o resumo final lê a transcrição inteira
const TRANSLATE_QUEUE_MAX = 8;   // fila de tradução: descarta as mais velhas
const TRANSLATE_ERROR_GAP_MS = 30000; // não repete o mesmo aviso de erro toda fala
const DEFAULT_TRANSLATE = { enabled: false, target: 'en', sources: 'system' };

// ---- VAD (voice activity detection) por energia ----
// Em vez de flush fixo a cada 5s (que cortava frases e gerava alucinações do
// Whisper em silêncio), o flush acontece no FIM da fala: 1,1s de silêncio após
// voz detectada, com teto de 15s por janela.
const VAD_THRESHOLD = 0.012;     // RMS mínimo p/ considerar fala
const SYS_SOUND_RMS = 0.002;     // qualquer som do PC (o loopback mudo entrega zeros)
const SYS_SILENT_MS = 90000;     // tempo sem som do PC antes do aviso
const SYS_SILENT_MIC_MS = 15000; // e você já falou isso nesse meio tempo
const VAD_SILENCE_MS = 1100;     // silêncio que encerra o enunciado
const VAD_MAX_WINDOW_MS = 15000; // força flush em falas muito longas
const STT_SLOW_MS = 20000;       // fala que demora mais que isso para sair: avisa

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

// Na entrevista os ajustes mantêm o formato em camadas e ajudam a argumentar
const INTERVIEW_REFINE_CHIPS = [
  ['Mais curto', 'Mantenha o formato, com a primeira linha mais curta e só 2 linhas "•" bem enxutas.'],
  ['Mais forte', 'Mantenha o formato e deixe os argumentos mais convincentes: troque generalidades por provas concretas do perfil, com números.'],
  ['Outra objeção', 'Mantenha o formato e troque a linha "Se insistirem" por uma objeção provável mais difícil, com a resposta.'],
  ['Em inglês', 'Mantenha o formato e responda em inglês.'],
];

const WHISPER_MODELS = [
  ['ggml-tiny.bin', 'Tiny — mais rápido, menos preciso (75 MB)'],
  ['ggml-base.bin', 'Base — equilíbrio (148 MB)'],
  ['ggml-small.bin', 'Small — bem mais preciso em PT-BR (466 MB) · recomendado'],
];

// Acentos do tema. a = cor principal (marca, botões, você), b = segunda cor
// (respostas da IA). No modo claro as duas escurecem para manter contraste.
// "teka" é a identidade padrão: lima sobre grafite, com pêssego nas respostas.
const ACCENTS = {
  teka: { a: '#c5ef6b', b: '#ffb38a', aLight: '#5d8a10', bLight: '#b4551f' },
  oceano: { a: '#5cc8ff', b: '#a99bff', aLight: '#0f6fa3', bLight: '#5b49c9' },
  ambar: { a: '#ffcb52', b: '#ff8fa3', aLight: '#9a6a00', bLight: '#b8324c' },
};

const DEFAULT_THEME = { mode: 'dark', accent: 'teka', opacity: 0.96, fontScale: 1 };

// Modelos aceitos pelo backend Codex com conta ChatGPT (vazio = padrão)
const MODEL_OPTIONS = [
  ['gpt-6-luna', 'GPT-6 Luna — mais rápido e econômico ✦ recomendado'],
  ['gpt-6-sol', 'GPT-6 Sol — equilíbrio'],
  ['gpt-6.1-sol', 'GPT-6.1 Sol — máxima qualidade (padrão Codex)'],
  ['gpt-6-astra', 'GPT-6 Astra — frontier, lento e pesado'],
];

function applyTheme(t) {
  const root = document.documentElement;
  // acento salvo de versões antigas (ex.: "aurora") cai na identidade padrão
  const acc = ACCENTS[t.accent] || ACCENTS.teka;
  const light = t.mode === 'light';
  root.dataset.theme = light ? 'light' : 'dark';
  root.style.setProperty('--mint', light ? acc.aLight : acc.a);
  root.style.setProperty('--lilac', light ? acc.bLight : acc.b);
  // texto sobre a cor principal: escuro no tema escuro, claro no tema claro
  root.style.setProperty('--accent-ink', light ? '#fbfaf6' : '#161a0c');
  if (light) {
    root.style.setProperty('--bg', `rgba(247, 245, 240, ${t.opacity})`);
    root.style.setProperty('--text', '#1b1a17');
    root.style.setProperty('--text-dim', '#6b675f');
    root.style.setProperty('--surface', 'rgba(40, 32, 20, 0.05)');
    root.style.setProperty('--surface-hover', 'rgba(40, 32, 20, 0.09)');
    root.style.setProperty('--border', 'rgba(40, 32, 20, 0.12)');
  } else {
    root.style.setProperty('--bg', `rgba(22, 21, 19, ${t.opacity})`);
    root.style.setProperty('--text', '#f1efe9');
    root.style.setProperty('--text-dim', '#a29e94');
    root.style.setProperty('--surface', 'rgba(255, 250, 240, 0.05)');
    root.style.setProperty('--surface-hover', 'rgba(255, 250, 240, 0.09)');
    root.style.setProperty('--border', 'rgba(255, 250, 240, 0.09)');
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
  // Modo fantasma (fica no processo principal; aqui só o espelho para a UI)
  const [ghost, setGhostState] = useState({ hidden: false, clickThrough: false, hideTray: false });
  const [levels, setLevels] = useState({ mic: 0, sys: 0 });
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [showTheme, setShowTheme] = useState(false);
  const [onboarding, setOnboarding] = useState(null); // null | 0|1|2 (passo)
  const [sttModel, setSttModel] = useState('ggml-base.bin');
  const [llmModel, setLlmModel] = useState(''); // '' = padrão do provedor
  const [sttLang, setSttLang] = useState('pten'); // idioma do Whisper: pt | en | pten (detecta PT ou EN a cada fala)
  const [sttPrompt, setSttPrompt] = useState(''); // viés de vocabulário (nomes, jargões)

  // ---- histórico de sessões ----
  const [view, setView] = useState('live'); // 'live' | 'history'
  const [resumeTarget, setResumeTarget] = useState(null); // sessão antiga a continuar na próxima escuta

  // ---- painel de configurações / timer / rolagem ----
  const [settingsTab, setSettingsTab] = useState('aparencia'); // aparencia | atalhos | sistema
  const [shortcutList, setShortcutList] = useState([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [newBelow, setNewBelow] = useState(false); // há falas novas abaixo da área visível

  // ---- contexto colado e análise de tela ----
  const [attached, setAttached] = useState(null);       // { text } anexado à próxima pergunta
  const [answerQuestions, setAnswerQuestions] = useState(null);
  const [screenQuestions, setScreenQuestions] = useState(null);
  const [answerNote, setAnswerNote] = useState('');     // de onde veio a pergunta da resposta atual
  const [screenResult, setScreenResult] = useState(null); // { image, question, text, streaming }

  // ---- onda 2: assistentes, memória, tradução, eco, e-mail, atualização ----
  const [assistantId, setAssistantId] = useState('padrao');
  const [customAssistants, setCustomAssistants] = useState([]);
  const [assistantContexts, setAssistantContexts] = useState({});
  const [assistantPreferences, setAssistantPreferences] = useState({});
  const [answerTools, setAnswerTools] = useState([]);
  const [screenTools, setScreenTools] = useState([]);
  useEffect(() => api.mcp.onUsed(({ streamId, used }) => {
    if (streamId && streamId === askStreamIdRef.current) setAnswerTools(used);
    if (streamId && streamId === screenStreamIdRef.current) setScreenTools(used);
  }), []);
  const [compactEnabled, setCompactEnabled] = useState(true);
  const [thinkMore, setThinkMore] = useState(false);
  const [longListenReminder, setLongListenReminder] = useState(false);
  const [listenDeadline, setListenDeadline] = useState(null);
  const [memory, setMemory] = useState('');
  const [translate, setTranslate] = useState(DEFAULT_TRANSLATE);
  const [echoFilter, setEchoFilter] = useState(true);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [sttFast, setSttFast] = useState(false); // transcrição rápida (troca um pouco de precisão)
  const [followup, setFollowup] = useState(null); // { text, streaming }
  const [updateInfo, setUpdateInfo] = useState(null); // release nova (ou "já atualizado")
  const [updateProgress, setUpdateProgress] = useState(null);
  const [updateFile, setUpdateFile] = useState(null);  // instalador baixado e conferido
  const [updateAuto, setUpdateAuto] = useState(false); // vai reiniciar sozinho quando der

  const sessionRef = useRef(null);   // { dbId, micSttId, sysSttId }
  const audioRef = useRef(null);     // { mic|sys: { stream, audioCtx, processor, analyser, flusher } }
  const transcriptEndRef = useRef(null);
  const transcriptBoxRef = useRef(null);
  const nearBottomRef = useRef(true);   // usuário está vendo o fim da transcrição?
  const sessionStartRef = useRef(null); // Date.now() do início da escuta atual
  // Vigia do áudio do sistema: o Windows só entrega o som da saída PADRÃO.
  // Se a chamada toca em outro fone/caixa, o lado "Reunião" fica mudo e o
  // usuário precisa saber disso durante a chamada, não depois.
  const sysWatchRef = useRef(null);
  const lastSttErrorRef = useRef('');
  const [sysSilent, setSysSilent] = useState(false);
  const [sttSlow, setSttSlow] = useState(null); // transcrição atrasada: { model, heavy, gpu }
  const sttSlowShownRef = useRef(false);        // uma vez por escuta
  const askRef = useRef(null);          // ask() atual, p/ atalhos registrados uma vez
  const screenRef = useRef(null);       // runScreenAnalysis() atual, idem
  const screenStreamIdRef = useRef(null);
  const screenAbortedRef = useRef(false); // usuário dispensou a análise no meio
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
  const assistSettledRef = useRef(null);     // resolve quando o rascunho atual encerra
  const assistSupersededRef = useRef(false); // rascunho abortado p/ versão mais completa
  const assistRefreshingRef = useRef(false); // refresh de rascunho em andamento
  const refreshTimerRef = useRef(null);      // debounce do refinamento ao vivo
  const askStreamIdRef = useRef(null);
  const lastQuestionRef = useRef('');
  const lastAssistAtRef = useRef(0);
  const sysWindowRef = useRef([]);   // últimas falas do sistema p/ detector com contexto
  const pendingRef = useRef(null);   // pergunta sem "?" aguardando continuação
  const vadRef = useRef({});         // estado VAD por slot (mic|sys)
  const listenReminderRef = useRef(null);
  const stoppingRef = useRef(false);
  const toggleListenRef = useRef(null); // p/ atalho global sem closure obsoleta
  const entryIdRef = useRef(0);          // id de cada fala (tradução e eco mexem nelas)
  const pendingMicWritesRef = useRef(new Map()); // falas do mic esperando a checagem de eco
  const memoryRef = useRef({ text: '', uptoTs: 0, session: null });
  const compactingRef = useRef(false);
  const compactEnabledRef = useRef(compactEnabled);
  const translateRef = useRef(translate);
  const translateQueueRef = useRef([]);
  const translatingRef = useRef(false);
  const translateErrorAtRef = useRef(0);
  const echoFilterRef = useRef(echoFilter);
  const noiseRef = useRef(noiseSuppression);
  const sttFastRef = useRef(sttFast);
  const customAssistantsRef = useRef([]);
  const assistantMutationRef = useRef(false);
  const assistantUsesRef = useRef({});
  const assistantPreferencesRef = useRef({});
  const assistantContextRef = useRef('');
  const assistantRef = useRef('');       // instruções do assistente escolhido
  const summaryCtxRef = useRef(null);    // { dbId, transcript, memory } da última sessão encerrada

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
  useEffect(() => { compactEnabledRef.current = compactEnabled; }, [compactEnabled]);
  useEffect(() => { translateRef.current = translate; }, [translate]);
  useEffect(() => { echoFilterRef.current = echoFilter; }, [echoFilter]);
  useEffect(() => { noiseRef.current = noiseSuppression; }, [noiseSuppression]);
  useEffect(() => { sttFastRef.current = sttFast; }, [sttFast]);
  useEffect(() => {
    const assistant = findAssistant(assistantId, customAssistants);
    assistantRef.current = assistant.instructions || '';
    assistantUsesRef.current = assistant.instructionsByUse || {};
    assistantPreferencesRef.current = assistantPreferences[assistantId] || {};
    assistantContextRef.current = contextToText(assistantContexts[assistantId]);
  }, [assistantId, customAssistants, assistantContexts, assistantPreferences]);

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
    api.settings.get('ui.autoScroll').then((v) => {
      if (v !== undefined && v !== null) setAutoScroll(Boolean(v));
    });
    api.shortcuts.list().then(setShortcutList).catch(() => {});
    const loadFlag = (key, setter) => api.settings.get(key).then((v) => {
      if (v !== undefined && v !== null) setter(Boolean(v));
    });
    loadFlag('audio.echoFilter', setEchoFilter);
    loadFlag('audio.noiseSuppression', setNoiseSuppression);
    loadFlag('stt.fast', setSttFast);
    loadFlag('llm.compact', setCompactEnabled);
    loadFlag('llm.thinkMore', setThinkMore);
    loadFlag('audio.longListenReminder', setLongListenReminder);
    api.settings.get('translate.config').then((t) => t && setTranslate({ ...DEFAULT_TRANSLATE, ...t }));
    api.settings.getAll().then((all) => {
      const contexts = {};
      const preferences = {};
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('assistant.preferences.')) preferences[key.slice(22)] = normalizePreferences(value);
        if (key.startsWith('assistant.context.')) contexts[key.slice(18)] = normalizeContext(value);
      }
      setAssistantContexts(contexts);
      setAssistantPreferences(preferences);
    }).catch((e) => setError(`contextos: ${e.message}`));
    api.settings.get('assistants.custom').then((list) => {
      if (Array.isArray(list)) { customAssistantsRef.current = list; setCustomAssistants(list); }
    });
    api.settings.get('assistants.active').then((id) => id && setAssistantId(id));

    const unsubDelta = api.stt.onDelta(({ source, text }) => {
      if (!text?.trim()) return;
      handleTranscription(source, text);
    });
    const unsubUpdate = api.update.onAvailable(handleUpdateResult);
    const unsubUpdateProg = api.update.onProgress(setUpdateProgress);
    // baixada em segundo plano: só falta reiniciar
    const unsubUpdateReady = api.update.onReady((r) => {
      setUpdateInfo(r);
      setUpdateFile('light');
      setUpdateAuto(Boolean(r.autoInstall));
    });

    // Atalhos globais: ✦ sugerir agora / copiar sugestão (sem focar a janela)
    const unsubTrig = api.overlay.onAssistTrigger(() => {
      runAssist(lastQuestionRef.current || '');
    });
    const unsubCopy = api.overlay.onCopySuggestion(() => {
      const s = suggestionRef.current;
      if (s?.text) copyText(s.text);
    });
    const unsubListen = api.overlay.onToggleListen(() => {
      toggleListenRef.current?.();
    });
    const unsubScreen = api.overlay.onScreenshotTrigger(() => {
      screenRef.current?.();
    });
    // Atalho "perguntar sobre o texto copiado": anexa o trecho e já pergunta
    const unsubClip = api.overlay.onClipboardPrompt(({ text }) => {
      if (!text) { setError('área de transferência vazia: copie um texto antes do atalho'); return; }
      askRef.current?.({ question: CLIPBOARD_DEFAULT_QUESTION, context: text });
    });
    const unsubProg = api.stt.onModelProgress((p) => setModelProgress(p));
    api.overlay.getGhost?.().then((g) => g && setGhostState(g)).catch(() => {});
    // Atalho e bandeja também mudam o fantasma: a UI só acompanha
    const unsubGhost = api.overlay.onGhostChanged?.((g) => setGhostState((cur) => ({ ...cur, ...g }))) || (() => {});

    return () => {
      unsubGhost();
      unsubDelta();
      unsubTrig();
      unsubCopy();
      unsubListen();
      unsubScreen();
      unsubClip();
      unsubProg();
      unsubUpdate();
      unsubUpdateReady();
      unsubUpdateProg();
      flushPendingWrites();
      stopAllCaptures();
    };
  }, []);

  // ================= falas: eco, banco, tradução e memória =================
  // Registrado uma vez (no onDelta), então só usa refs.

  function handleTranscription(source, text) {
    const now = Date.now();
    let lines = transcriptRef.current;
    if (echoFilterRef.current) {
      if (source === 'mic') {
        // Fala do mic igual a uma da reunião recém-chegada: é a caixa de som
        const recentSys = lines.filter((t) => t.source === 'system' && now - t.ts <= ECHO_WINDOW_MS);
        if (findEcho(text, now, recentSys)) return;
      } else {
        // A fala da reunião chegou depois do eco: tira o eco que já entrou
        const echoes = lines.filter((t) => t.source === 'mic' && pendingMicWritesRef.current.has(t.id)
          && findEcho(t.text, t.ts, [{ text, ts: now }]));
        if (echoes.length) {
          const ids = new Set(echoes.map((e) => e.id));
          for (const id of ids) {
            clearTimeout(pendingMicWritesRef.current.get(id)?.timer);
            pendingMicWritesRef.current.delete(id);
          }
          lines = lines.filter((t) => !ids.has(t.id));
        }
      }
    }
    entryIdRef.current += 1;
    const entry = { id: entryIdRef.current, source, text, ts: now };
    transcriptRef.current = [...lines.slice(-MAX_TRANSCRIPT_LINES + 1), entry];
    setTranscript(transcriptRef.current);
    persistTranscription(entry);
    if (source === 'system') {
      sysWindowRef.current = [...sysWindowRef.current.slice(-2), text];
      maybeAutoAssist();
    }
    maybeTranslate(entry);
    maybeCompact();
  }

  // Com o filtro de eco ligado, a fala do mic espera alguns segundos antes de
  // ir para o banco: se a mesma fala chegar pelo áudio do sistema, ela é eco
  // e nem chega a ser gravada.
  function persistTranscription(entry) {
    const dbId = sessionRef.current?.dbId;
    if (!dbId) return;
    const write = () => api.db.addTranscription({ sessionId: dbId, source: entry.source, text: entry.text });
    if (entry.source === 'mic' && echoFilterRef.current) {
      const timer = setTimeout(() => {
        pendingMicWritesRef.current.delete(entry.id);
        write();
      }, ECHO_WINDOW_MS);
      pendingMicWritesRef.current.set(entry.id, { timer, write });
    } else {
      write();
    }
  }

  function flushPendingWrites() {
    for (const pending of pendingMicWritesRef.current.values()) {
      clearTimeout(pending.timer);
      pending.write();
    }
    pendingMicWritesRef.current.clear();
  }

  function maybeTranslate(entry) {
    const cfg = translateRef.current;
    if (!cfg.enabled || !providerRef.current) return;
    if (cfg.sources !== 'all' && entry.source !== 'system') return;
    const queue = translateQueueRef.current;
    queue.push(entry);
    if (queue.length > TRANSLATE_QUEUE_MAX) queue.shift();
    runTranslateQueue();
  }

  // Uma tradução por vez, na ordem das falas
  async function runTranslateQueue() {
    if (translatingRef.current) return;
    translatingRef.current = true;
    try {
      while (translateQueueRef.current.length) {
        const entry = translateQueueRef.current.shift();
        const cfg = translateRef.current;
        if (!cfg.enabled) { translateQueueRef.current = []; break; }
        try {
          const out = String(await api.llm.chat({
            mode: 'translate',
            text: entry.text,
            target: cfg.target,
            model: llmModelRef.current || undefined,
          }) || '').trim().replace(/^["“]|["”]$/g, '');
          // "=" = a fala já estava no idioma escolhido
          if (!out || out === '=' || out === entry.text.trim()) continue;
          transcriptRef.current = transcriptRef.current.map((t) => (t.id === entry.id ? { ...t, translation: out } : t));
          setTranscript(transcriptRef.current);
        } catch (e) {
          if (Date.now() - translateErrorAtRef.current > TRANSLATE_ERROR_GAP_MS) {
            translateErrorAtRef.current = Date.now();
            setError(`tradução: ${e.message || e}`);
          }
          translateQueueRef.current = [];
        }
      }
    } finally {
      translatingRef.current = false;
    }
  }

  // Resume as falas antigas em segundo plano (ver COMPACT_*)
  function maybeCompact() {
    if (!compactEnabledRef.current || compactingRef.current || !providerRef.current || !sessionRef.current) return;
    const mem = memoryRef.current;
    const pendingLines = transcriptRef.current.filter((t) => t.ts > mem.uptoTs);
    if (pendingLines.length < COMPACT_TRIGGER_LINES) return;
    const chunk = pendingLines.slice(0, Math.min(pendingLines.length - COMPACT_KEEP_RECENT, COMPACT_MAX_CHUNK));
    const session = mem.session;
    compactingRef.current = true;
    api.llm.chat({
      mode: 'compact',
      memory: mem.text,
      transcript: chunk,
      model: llmModelRef.current || undefined,
    })
      .then((text) => {
        const t = String(text || '').trim();
        if (!t || memoryRef.current.session !== session) return; // sessão trocou no meio
        memoryRef.current = { ...memoryRef.current, text: t, uptoTs: chunk[chunk.length - 1].ts };
        setMemory(t);
      })
      .catch((e) => console.warn('compactação falhou:', e))
      .finally(() => { compactingRef.current = false; });
  }

  // Contexto para o LLM: com memória, vão o resumo e só as falas depois dele
  function liveContext(limit) {
    const mem = memoryRef.current;
    const all = transcriptRef.current;
    const lines = compactEnabledRef.current && mem.text ? all.filter((t) => t.ts > mem.uptoTs) : all;
    return {
      memory: compactEnabledRef.current && mem.text ? mem.text : undefined,
      transcript: limit ? lines.slice(-limit) : lines,
    };
  }

  function resetMemory(session) {
    memoryRef.current = { text: '', uptoTs: 0, session };
    setMemory('');
  }

  // ================= assistentes =================

  function selectAssistant(id, selected) {
    setAssistantId(id);
    api.settings.set('assistants.active', id);
    const a = selected || findAssistant(id, customAssistants);
    if (a.mode) changeAssistMode(a.mode);
  }

  function saveAssistantPreferences(id, value) {
    const preferences = normalizePreferences(value);
    setAssistantPreferences((all) => ({ ...all, [id]: preferences }));
    return api.settings.set(`assistant.preferences.${id}`, preferences).catch((e) => setError(`assistente: ${e.message}`));
  }

  function saveAssistantContext(id, value) {
    const context = normalizeContext(value);
    setAssistantContexts((all) => ({ ...all, [id]: context }));
    return api.settings.set(`assistant.context.${id}`, context).catch((e) => setError(`contexto: ${e.message}`));
  }

  async function mutateAssistants(operation) {
    if (assistantMutationRef.current) throw new Error('Aguarde o assistente terminar de salvar.');
    assistantMutationRef.current = true;
    try { return await operation(); }
    finally { assistantMutationRef.current = false; }
  }

  async function saveCustomAssistants(list) {
    return mutateAssistants(async () => {
      const previous = customAssistantsRef.current;
      await api.settings.set('assistants.custom', list);
      customAssistantsRef.current = list;
      setCustomAssistants(list);
      for (const a of previous.filter((a) => !list.some((n) => n.id === a.id))) {
        await api.settings.delete(`assistant.preferences.${a.id}`);
        await api.settings.delete(`assistant.context.${a.id}`);
        setAssistantPreferences((all) => { const next = { ...all }; delete next[a.id]; return next; });
        setAssistantContexts((all) => { const next = { ...all }; delete next[a.id]; return next; });
      }
    });
  }

  async function importAssistants(items) {
    if (!items.length) return;
    return mutateAssistants(async () => {
      // A leitura do arquivo pode ter começado em outro painel: confere os ids de novo sob o lock.
      items = parseAssistantImport(JSON.stringify({ format: 'teka-assistants', version: 1, assistants: items }), customAssistantsRef.current.map((a) => a.id));
      const list = [...customAssistantsRef.current, ...items.map(({ context, preferences, ...assistant }) => assistant)];
      const entries = items.flatMap((item) => [
        [`assistant.context.${item.id}`, item.context], [`assistant.preferences.${item.id}`, item.preferences],
      ]);
      entries.push(['assistants.custom', list]);
      await api.settings.setAssistantData(entries);
      customAssistantsRef.current = list;
      setCustomAssistants(list);
      setAssistantContexts((all) => ({ ...all, ...Object.fromEntries(items.map((a) => [a.id, a.context])) }));
      setAssistantPreferences((all) => ({ ...all, ...Object.fromEntries(items.map((a) => [a.id, a.preferences])) }));
    });
  }

  // ================= atualização =================

  function handleUpdateResult(r) {
    if (!r?.ok) {
      if (r?.manual) setError(`atualização: ${r?.error || 'falhou'}`);
      return;
    }
    if (r.available) setUpdateInfo(r);
    else if (r.manual) setUpdateInfo({ upToDate: true, current: r.current, note: r.note });
  }

  async function downloadUpdate() {
    setUpdateProgress({ received: 0, total: 0 });
    const r = await api.update.download();
    setUpdateProgress(null);
    if (!r?.ok) { setError(`atualização: ${r?.error || 'falha no download'}`); return; }
    // pacote leve já está no lugar: falta só reiniciar
    setUpdateFile(r.mode === 'light' ? 'light' : r.file);
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    return bytes < 1024 * 1024 ? ` (${Math.max(1, Math.round(bytes / 1024))} KB)` : ` (${(bytes / 1024 / 1024).toFixed(1)} MB)`;
  }

  // O processo principal só reinicia sozinho com a escuta parada e a pessoa
  // sem mexer no Teka há alguns minutos: avisa quando a escuta muda e, no
  // máximo a cada 30 s, quando a pessoa clica ou digita na janela.
  const activityRef = useRef({ listening: false, working: false });
  useEffect(() => {
    activityRef.current = { listening: listening || starting, working: busy };
    api.update.reportActivity?.(activityRef.current)?.catch(() => {});
  }, [listening, starting, busy]);
  useEffect(() => {
    let last = 0;
    const touch = () => {
      const now = Date.now();
      if (now - last < 30000) return;
      last = now;
      api.update.reportActivity?.(activityRef.current)?.catch(() => {});
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, []);

  function skipUpdate() {
    if (updateInfo?.version) api.settings.set('update.skipVersion', updateInfo.version);
    setUpdateInfo(null);
  }

  // ================= preferências da onda 2 =================

  function changeFlag(key, setter, value) {
    setter(value);
    api.settings.set(key, value);
  }

  function changeTranslate(patch) {
    const next = { ...translate, ...patch };
    setTranslate(next);
    api.settings.set('translate.config', next);
    if (!next.enabled) translateQueueRef.current = [];
  }

  // Rolagem automática: só acompanha a fala nova se o usuário já estiver no
  // fim da lista. Se ele rolou para cima para reler, a tela fica parada e
  // aparece o botão "novas falas".
  useEffect(() => {
    if (!transcript.length) return;
    if (autoScroll && nearBottomRef.current) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setNewBelow(true);
    }
  }, [transcript]);

  function onTranscriptScroll(e) {
    const el = e.currentTarget;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    if (near) setNewBelow(false);
  }

  function jumpToLatest() {
    nearBottomRef.current = true;
    setNewBelow(false);
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function changeAutoScroll(value) {
    setAutoScroll(value);
    api.settings.set('ui.autoScroll', value);
    if (value) jumpToLatest();
  }

  // Timer da sessão: atualiza 1x por segundo enquanto escuta
  useEffect(() => {
    if (!listening) { setElapsedMs(0); return undefined; }
    const tick = () => setElapsedMs(Date.now() - (sessionStartRef.current || Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [listening]);

  // Cópia pelo processo principal (funciona mesmo com o overlay sem foco)
  function copyText(text) {
    return api.clipboard.writeText(text).catch(() => navigator.clipboard.writeText(text));
  }

  // medidores de nível de áudio (mic + sistema) enquanto escuta
  useEffect(() => {
    if (!listening) { setLevels({ mic: 0, sys: 0 }); return undefined; }
    const id = setInterval(() => {
      setLevels({ mic: readLevel('mic'), sys: readLevel('sys') });
    }, 180);
    return () => clearInterval(id);
  }, [listening]);

  useEffect(() => {
    setListenDeadline(null);
    if (!listening || !longListenReminder) return undefined;
    const reminder = createListenReminder({ startedAt: sessionStartRef.current ?? Date.now(),
      onWarn: (deadline) => {
        setListenDeadline(deadline);
        api.overlay.show().catch(() => {});
      },
      onPause: () => { setListenDeadline(null); toggleListenRef.current?.({ pause: true }); },
    });
    listenReminderRef.current = reminder;
    reminder.tick();
    const timer = setInterval(() => reminder.tick(), 1000);
    return () => { clearInterval(timer); reminder.cancel(); listenReminderRef.current = null; };
  }, [listening, longListenReminder]);

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

  function openHistory() {
    setView('history');
  }

  // "Continuar sessão" no histórico: volta para a tela ao vivo com as falas
  // antigas carregadas (o copiloto usa como contexto) e já começa a ouvir.
  // As falas novas entram na mesma sessão do banco.
  function resumeFromHistory(session, transcriptions) {
    if (listening || starting) return;
    const lines = transcriptions.map((t) => {
      entryIdRef.current += 1;
      return { id: entryIdRef.current, source: t.source, text: t.text, ts: t.ts };
    });
    transcriptRef.current = lines.slice(-MAX_TRANSCRIPT_LINES);
    setTranscript(transcriptRef.current);
    setSuggestion(null);
    setSummary(null);
    setResumeTarget({ id: session.id, subject: session.subject });
    setView('live');
    nearBottomRef.current = true;
    toggleListening({ resumeId: session.id });
  }

  // ================= copiloto ativo =================

  // Detector com janela de contexto: uma pergunta falada pode chegar quebrada
  // em 2 flushes. No modo ENTREVISTA, o copiloto não espera a pergunta acabar:
  // começa a rascunhar assim que detecta o início e, se a pergunta continuar
  // crescendo (o entrevistador ainda está falando), aborta o rascunho e
  // recomeça com o texto mais completo — "rascunho ao vivo".
  function maybeAutoAssist() {
    if (!autoAssistRef.current) return;
    const combined = sysWindowRef.current.slice(-2).join(' ');
    const q = detectQuestion(combined);
    if (!q) return;

    const interview = assistModeRef.current === 'interview';
    const last = lastQuestionRef.current;

    // A pergunta detectada é uma extensão da anterior → refina o rascunho
    // (debounced), em vez de ignorar como duplicata ou disparar como nova.
    const grows = last && q !== last && (q.includes(last) || last.includes(q));
    if (grows && interview) {
      lastQuestionRef.current = q;
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (assistRefreshingRef.current) return;
        assistRefreshingRef.current = true;
        refreshDraft(q).finally(() => { assistRefreshingRef.current = false; });
      }, DRAFT_REFRESH_MS);
      return;
    }
    if (q === last) return;
    if (assistBusyRef.current) return;

    const hasTerminator = q.includes('?');
    if (!hasTerminator) {
      if (pendingRef.current?.q === q) return; // já aguardando continuação
      clearTimeout(pendingRef.current?.timer);
      // Entrevista: rascunha cedo; o restante da pergunta entra pelo
      // refinamento ao vivo. Outros modos: espera a continuação.
      const wait = interview ? PENDING_QUESTION_DRAFT_MS : PENDING_QUESTION_MS;
      pendingRef.current = {
        q,
        timer: setTimeout(() => fireAssist(q), wait),
      };
      return;
    }
    clearTimeout(pendingRef.current?.timer);
    pendingRef.current = null;
    fireAssist(q);
  }

  // Aborta o rascunho em andamento e recomeça com a pergunta mais completa.
  // Se o rascunho já terminou, simplesmente gera de novo (a pergunta cresceu
  // depois que a resposta ficou pronta).
  async function refreshDraft(newQ) {
    const sid = assistStreamIdRef.current;
    if (sid) {
      assistSupersededRef.current = true;
      api.llm.abortStream(sid);
      await (assistSettledRef.current || Promise.resolve());
    } else if (assistBusyRef.current) {
      return; // stream ainda iniciando: a próxima janela de debounce pega
    }
    if (!autoAssistRef.current || assistModeRef.current !== 'interview') return;
    runAssist(newQ, undefined, { draft: true });
  }

  function fireAssist(q) {
    if (assistBusyRef.current) return;
    if (q === lastQuestionRef.current) return;
    const now = Date.now();
    if (now - lastAssistAtRef.current < ASSIST_COOLDOWN_MS) return;
    lastQuestionRef.current = q;
    lastAssistAtRef.current = now;
    runAssist(q, undefined, { draft: assistModeRef.current === 'interview' });
  }

  // Clique numa fala: o copiloto responde a ela, mesmo se já estiver
  // respondendo outra (a resposta em andamento dá lugar à nova). Com texto
  // selecionado, o clique é de quem quer copiar e não dispara nada.
  async function answerLine(line) {
    if (window.getSelection()?.toString().trim()) return;
    if (!line?.text?.trim()) return;
    clearTimeout(pendingRef.current?.timer);
    pendingRef.current = null;
    clearTimeout(refreshTimerRef.current);
    const sid = assistStreamIdRef.current;
    if (sid) {
      assistSupersededRef.current = true;
      api.llm.abortStream(sid);
    }
    if (assistBusyRef.current) await (assistSettledRef.current || Promise.resolve());
    lastAssistAtRef.current = Date.now(); // o auto não atropela logo em seguida
    runAssist(line.text);
  }

  async function runAssist(q, instruction, opts = {}) {
    if (assistBusyRef.current) return;
    assistBusyRef.current = true;
    assistSupersededRef.current = false;
    if (q) lastQuestionRef.current = q;
    setError('');
    setSummary(null);
    const layered = assistModeRef.current === 'interview';
    setSuggestion({ question: q || '', text: '', streaming: true, draft: !!opts.draft, layered });
    let acc = '';
    let streamErr = null;

    const matches = (streamId) =>
      !assistStreamIdRef.current || streamId === assistStreamIdRef.current;

    const unsubChunk = api.llm.onStreamChunk(({ streamId, delta }) => {
      if (!matches(streamId)) return;
      acc += delta;
      setSuggestion((s) => (s ? { ...s, text: acc } : s));
    });
    // stream-error também encerra a espera — no refresh ao vivo o abort
    // intencional chega por este canal; sem isso o assist travaria "ocupado"
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const unsubDone = api.llm.onStreamDone(({ streamId }) => {
      if (!matches(streamId)) return;
      unsubDone();
      resolveDone();
    });
    const unsubErr = api.llm.onStreamError(({ streamId, error: err }) => {
      if (!matches(streamId)) return;
      streamErr = err;
      unsubDone();
      resolveDone();
    });
    // Resolve só no finally (após liberar assistBusyRef) — o refresh ao vivo
    // aguarda este sinal antes de recomeçar, evitando corrida com o "ocupado".
    let resolveSettled;
    assistSettledRef.current = new Promise((resolve) => { resolveSettled = resolve; });

    try {
      const { streamId } = await api.llm.chatStream({
        mode: 'assist',
        question: q,
        ...liveContext(layered ? INTERVIEW_CONTEXT_LINES : ASSIST_CONTEXT_LINES),
        assistant: assistantRef.current || undefined,
        assistantInstructionsByUse: assistantUsesRef.current,
        assistantContext: assistantContextRef.current || undefined,
        certainOnly: assistantPreferencesRef.current.certainOnly === true,
        assistMode: assistModeRef.current,
        profile: profileRef.current,
        instruction,
        model: llmModelRef.current || undefined,
      });
      assistStreamIdRef.current = streamId;
      await done;
      const superseded = assistSupersededRef.current;
      if (streamErr && !superseded) setError(`sugestão: ${streamErr}`);
      const dbId = sessionRef.current?.dbId;
      if (dbId && acc && !superseded) {
        api.db.addMessage({ sessionId: dbId, role: 'assistant', content: acc });
      }
    } catch (e) {
      if (!assistSupersededRef.current) {
        setError(`sugestão: ${e.message || e}`);
        setSuggestion(null);
      }
    } finally {
      unsubChunk();
      unsubErr();
      assistStreamIdRef.current = null;
      assistBusyRef.current = false;
      setSuggestion((s) => (s ? { ...s, streaming: false } : s));
      resolveSettled();
    }
  }

  // ================= resumo pós-sessão =================

  async function summarizeSession(dbId, lines) {
    // Sessão curta: o resumo lê tudo. Longa: memória compactada + o final.
    const long = lines.length > SUMMARY_FULL_LINES;
    const ctx = {
      dbId,
      transcript: long ? lines.slice(-SUMMARY_FULL_LINES) : lines,
      memory: long && memoryRef.current.text ? memoryRef.current.text : undefined,
    };
    summaryCtxRef.current = ctx;
    setFollowup(null);
    if (lines.length < 3 || !providerRef.current) return;
    setSummary({ text: '', streaming: true });
    // Entrou em modo Entrevista no meio da sessão: a sessão passa a ser de entrevista
    const interview = assistModeRef.current === 'interview';
    if (interview && dbId) api.db.setKind(dbId, 'interview');
    try {
      const text = await api.llm.chat({
        mode: 'summary',
        assistant: assistantRef.current || undefined,
        assistantInstructionsByUse: assistantUsesRef.current,
        assistantContext: assistantContextRef.current || undefined,
        certainOnly: assistantPreferencesRef.current.certainOnly === true,
        summaryKind: interview ? 'interview' : undefined,
        profile: interview ? profileRef.current : undefined,
        transcript: ctx.transcript,
        memory: ctx.memory,
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

  // E-mail de follow-up a partir da última sessão encerrada
  async function generateFollowup() {
    const ctx = summaryCtxRef.current;
    if (!ctx || followup?.streaming) return;
    setFollowup({ text: '', streaming: true });
    try {
      const text = await api.llm.chat({
        mode: 'email',
        transcript: ctx.transcript,
        memory: ctx.memory,
        summary: summary?.text || undefined,
        assistant: assistantRef.current || undefined,
        assistantInstructionsByUse: assistantUsesRef.current,
        assistantContext: assistantContextRef.current || undefined,
        certainOnly: assistantPreferencesRef.current.certainOnly === true,
        model: llmModelRef.current || undefined,
      });
      setFollowup({ text, streaming: false });
      if (ctx.dbId && text) {
        api.db.addMessage({ sessionId: ctx.dbId, role: 'assistant', content: `[E-MAIL DE FOLLOW-UP]\n${text}` });
      }
    } catch (e) {
      setFollowup(null);
      setError(`e-mail: ${e.message || e}`);
    }
  }

  // ================= captura de áudio =================

  // opts.resumeId: id de uma sessão antiga para continuar (vem do histórico).
  // Pelo botão do microfone o argumento é o evento de clique, então só um
  // texto em resumeId conta como pedido de retomada.
  async function toggleListening(opts) {
    if (stoppingRef.current) return;
    setError('');
    if (listening) {
      stoppingRef.current = true;
      const pausing = opts?.pause === true;
      setListening(false);
      setListenDeadline(null);
      stopAllCaptures();
      const sess = sessionRef.current;
      const lines = transcriptRef.current;
      if (sess) {
        await api.stt.stopSession(sess.micSttId).catch(() => {});
        if (sess.sysSttId) await api.stt.stopSession(sess.sysSttId).catch(() => {});
        sessionRef.current = null;
        flushPendingWrites(); // falas do mic ainda na checagem de eco
        translateQueueRef.current = [];
        // Grava o fim: é o que dá a duração da sessão no histórico
        api.db.endSession(sess.dbId).catch(() => {});
      }
      setListening(false);
      setResumeTarget(pausing && sess ? { id: sess.dbId, paused: true } : null);
      setLevels({ mic: 0, sys: 0 });
      sysWatchRef.current = null;
      setSysSilent(false);
      setSttSlow(null);
      sttSlowShownRef.current = false;
      stoppingRef.current = false;
      if (pausing) setError('Escuta pausada pelo lembrete. Suas falas estão salvas; toque no microfone para continuar.');
      else summarizeSession(sess?.dbId, lines); // resumo automático em background
      return;
    }
    if (starting) return; // clique duplo durante preparo/download — ignora
    const resumeId = typeof opts?.resumeId === 'string' ? opts.resumeId : resumeTarget?.paused ? resumeTarget.id : null;
    setStarting(true);
    setModelProgress(null);
    let dbId = null;
    try {
      setSummary(null);
      if (resumeId) {
        const r = await api.db.resumeSession(resumeId);
        if (!r?.ok) throw new Error('a sessão escolhida não existe mais');
        dbId = resumeId;
      } else {
        dbId = (await api.db.createSession({
          subject: 'Sessão overlay',
          kind: assistModeRef.current === 'interview' ? 'interview' : undefined,
        })).id;
      }
      const { sessionId: micSttId } = await api.stt.startSession({
        source: 'mic',
        model: sttModelRef.current,
        language: sttLangRef.current,
        prompt: sttPromptRef.current,
        fast: sttFastRef.current,
      });
      sessionRef.current = { dbId, micSttId, sysSttId: null };
      if (!(resumeId && resumeTarget?.paused)) resetMemory(dbId);
      await startMicCapture(micSttId);
      sessionStartRef.current = Date.now();
      setListening(true);

      // Áudio do sistema (Discord/Zoom/Meet): best-effort — se não houver
      // saída de som ou o loopback falhar, a escuta do mic continua.
      try {
        const { sessionId: sysSttId } = await api.stt.startSession({
          source: 'system',
          model: sttModelRef.current,
          language: sttLangRef.current,
          prompt: sttPromptRef.current,
          fast: sttFastRef.current,
        });
        sessionRef.current.sysSttId = sysSttId;
        await startSystemCapture(sysSttId);
        sysWatchRef.current = { lastSoundAt: Date.now(), micSpeechMs: 0, warned: false };
        setSysSilent(false);
      } catch (e) {
        console.warn('loopback indisponível:', e);
        setError('áudio do sistema indisponível — transcrito apenas o microfone');
      }
    } catch (e) {
      stopAllCaptures();
      // A sessão STT do mic pode ter subido antes da falha (ex.: microfone
      // negado): encerra para não deixar o whisper-server preso a ela.
      const failed = sessionRef.current;
      if (failed?.micSttId) api.stt.stopSession(failed.micSttId).catch(() => {});
      sessionRef.current = null;
      // Sessão nova que nunca chegou a ouvir sai do banco (senão o histórico
      // enche de sessões vazias); uma retomada volta a ficar encerrada.
      if (dbId && resumeId) api.db.endSession(dbId).catch(() => {});
      else if (dbId) api.db.deleteSession(dbId).catch(() => {});
      setResumeTarget(null);
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

    const frameMs = (float.length / 16000) * 1000;
    watchSystemAudio(slot, rms, frameMs);

    const v = vadRef.current[slot];
    if (!v) return;
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

  // Avisa quando você fala há um tempo e nenhum som do PC chega há 90 s.
  // Qualquer som (voz, notificação, ruído) zera a contagem e tira o aviso.
  function watchSystemAudio(slot, rms, frameMs) {
    const w = sysWatchRef.current;
    if (!w) return;
    if (slot === 'sys') {
      if (rms > SYS_SOUND_RMS) {
        w.lastSoundAt = Date.now();
        w.micSpeechMs = 0;
        if (w.warned) { w.warned = false; setSysSilent(false); }
      }
      return;
    }
    if (rms > VAD_THRESHOLD) w.micSpeechMs += frameMs;
    if (!w.warned && w.micSpeechMs >= SYS_SILENT_MIC_MS && Date.now() - w.lastSoundAt >= SYS_SILENT_MS) {
      w.warned = true;
      setSysSilent(true);
    }
  }

  function flushSlot(slot, sttId) {
    const v = vadRef.current[slot];
    if (!v?.hasSpeech) return;
    v.hasSpeech = false;
    v.speaking = false;
    v.silenceMs = 0;
    v.lastFlushAt = Date.now();
    // Falha na transcrição aparece na tela (antes sumia em silêncio e a
    // escuta parecia ligada sem transcrever nada). Mesmo erro repetido não
    // pisca de novo.
    // Fala que leva mais de 20 s para virar texto: a transcrição está ficando
    // para trás (modelo grande no processador, PC ocupado) e parece não
    // funcionar. Avisa uma vez por escuta, dizendo o que fazer.
    const slowTimer = setTimeout(warnSlowStt, STT_SLOW_MS);
    api.stt.flush(sttId).catch((e) => {
      const msg = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (lastSttErrorRef.current === msg) return;
      lastSttErrorRef.current = msg;
      setError(`a transcrição falhou: ${msg}`);
    }).finally(() => clearTimeout(slowTimer));
  }

  async function warnSlowStt() {
    if (sttSlowShownRef.current || !sessionRef.current) return;
    sttSlowShownRef.current = true;
    const name = sttModelRef.current;
    const [models, gpu] = await Promise.all([
      api.stt.listModels().catch(() => []),
      api.stt.gpuStatus?.().catch(() => null) ?? null,
    ]);
    if (!sessionRef.current) return; // a escuta parou nesse meio tempo
    const onGpu = Boolean(gpu?.backend && gpu.backend.kind !== 'cpu');
    setSttSlow({
      model: models.find((m) => m.name === name)?.label || name,
      heavy: HEAVY_MODELS.has(name) && !onGpu,
      gpu: Boolean(gpu?.gpu) && !onGpu,
    });
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
    // O cancelamento de eco do navegador só cobre o que ele mesmo toca; o eco
    // da reunião (Zoom/Meet tocando pela caixa) é tratado em handleTranscription.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: noiseRef.current, autoGainControl: true },
    });
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

  // override { question, context } vem dos atalhos (texto copiado). Pelo
  // botão de enviar o argumento é o evento de clique, então só um objeto com
  // question em texto conta como override.
  async function ask(override) {
    const isOverride = typeof override?.question === 'string';
    const q = isOverride ? override.question : question;
    const context = isOverride ? override.context : attached?.text;
    if (!q.trim() || busy) return;
    setError('');
    setAnswer('');
    setAnswerTools([]);
    setAnswerQuestions(null);
    setAnswerNote(context ? `sobre o trecho copiado (${context.length} caracteres)` : '');
    setBusy(true);
    // Inscreve os listeners ANTES do invoke: o primeiro chunk pode chegar
    // antes da promise do invoke resolver (race real observado em auditoria).
    const questionSeed = { ...liveContext(), assistant: assistantRef.current,
      assistantInstructionsByUse: assistantUsesRef.current, assistantContext: assistantContextRef.current,
      profile: profileRef.current, model: llmModelRef.current, question: q };
    const requestedStreamId = crypto.randomUUID();
    askStreamIdRef.current = requestedStreamId;
    let streamError = null;
    let resolveDone;
    let acc = '';
    const matches = (streamId) =>
      !askStreamIdRef.current || streamId === askStreamIdRef.current;
    const unsubChunk = api.llm.onStreamChunk(({ streamId, delta }) => {
      if (!matches(streamId)) return;
      acc += delta;
      setAnswer(acc);
    });
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const unsubErr = api.llm.onStreamError(({ streamId, error: err }) => {
      if (!matches(streamId)) return;
      streamError = err;
      setError(err);
      resolveDone();
    });
    const unsubDone = api.llm.onStreamDone(({ streamId }) => { if (matches(streamId)) resolveDone(); });
    try {
      const { streamId } = await api.llm.chatStream({
        streamId: requestedStreamId,
        assistantId,
        question: q,
        ...liveContext(),
        assistant: assistantRef.current || undefined,
        assistantInstructionsByUse: assistantUsesRef.current,
        assistantContext: assistantContextRef.current || undefined,
        certainOnly: assistantPreferencesRef.current.certainOnly === true,
        context: context || undefined,
        profile: profileRef.current,
        assistMode: assistModeRef.current,
        model: llmModelRef.current || undefined,
      });
      askStreamIdRef.current = streamId;
      await done;
      if (acc && !streamError) setAnswerQuestions({ ...questionSeed, answer: acc });
      const dbId = sessionRef.current?.dbId;
      if (dbId && acc) api.db.addMessage({ sessionId: dbId, role: 'assistant', content: acc });
      if (!isOverride) setQuestion('');
      setAttached(null); // o trecho vale para uma pergunta só
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      unsubChunk();
      unsubErr();
      unsubDone();
      askStreamIdRef.current = null;
      setBusy(false);
    }
  }

  // Botão 📋: anexa o texto copiado à próxima pergunta digitada
  async function attachClipboard() {
    const text = String(await api.clipboard.readText().catch(() => '')).trim();
    if (!text) { setError('área de transferência vazia: copie um texto primeiro'); return; }
    setAttached({ text: text.slice(0, 20000) });
  }

  // ================= análise de tela =================

  // Captura a tela onde o overlay está e manda para o modelo de visão. Se
  // houver texto no campo de pergunta, ele vira a pergunta sobre a tela.
  async function runScreenAnalysis() {
    if (screenStreamIdRef.current || screenResult?.capturing) return;
    setError('');
    const q = question.trim();
    setScreenTools([]);
    setScreenResult({ image: null, question: q, text: '', streaming: true, capturing: true });

    setScreenQuestions(null);
    const questionSeed = { ...liveContext(), assistant: assistantRef.current, assistantInstructionsByUse: assistantUsesRef.current,
      assistantContext: assistantContextRef.current, profile: profileRef.current, model: llmModelRef.current, question: q };
    const shot = await api.screen.capture().catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (!shot?.ok) {
      setScreenResult(null);
      setError(`captura de tela: ${shot?.error || 'falhou'}`);
      return;
    }
    if (q) setQuestion('');
    setScreenResult({ image: shot.dataUrl, question: q, text: '', streaming: true });

    const streamId = crypto.randomUUID();
    screenStreamIdRef.current = streamId;
    screenAbortedRef.current = false;
    let acc = '';
    let streamErr = null;
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const unsubChunk = api.llm.onStreamChunk(({ streamId: id, delta }) => {
      if (id !== streamId) return;
      acc += delta;
      setScreenResult((s) => (s ? { ...s, text: acc } : s));
    });
    const unsubDone = api.llm.onStreamDone(({ streamId: id }) => {
      if (id === streamId) resolveDone();
    });
    const unsubErr = api.llm.onStreamError(({ streamId: id, error: err }) => {
      if (id !== streamId) return;
      streamErr = err;
      resolveDone();
    });

    try {
      await api.llm.chatStream({
        mode: 'screen',
        assistantId,
        streamId,
        image: shot.dataUrl,
        question: q,
        ...liveContext(),
        assistant: assistantRef.current || undefined,
        assistantInstructionsByUse: assistantUsesRef.current,
        assistantContext: assistantContextRef.current || undefined,
        certainOnly: assistantPreferencesRef.current.certainOnly === true,
        profile: profileRef.current,
        assistMode: assistModeRef.current,
        model: llmModelRef.current || undefined,
      });
      await done;
      if (acc && !streamErr && !screenAbortedRef.current) setScreenQuestions({ ...questionSeed, answer: acc });
      if (streamErr && !screenAbortedRef.current) setError(`análise de tela: ${streamErr}`);
      const dbId = sessionRef.current?.dbId;
      if (dbId && acc && !screenAbortedRef.current) {
        api.db.addMessage({
          sessionId: dbId,
          role: 'assistant',
          content: `[ANÁLISE DE TELA]${q ? ` ${q}` : ''}\n${acc}`,
        });
      }
    } catch (e) {
      setError(`análise de tela: ${e.message || e}`);
    } finally {
      unsubChunk();
      unsubDone();
      unsubErr();
      screenStreamIdRef.current = null;
      // Sem nenhuma resposta (erro de provedor, por exemplo) o cartão some:
      // senão ficaria a imagem com "analisando…" parado para sempre.
      setScreenResult((s) => (s && acc ? { ...s, streaming: false } : null));
    }
  }

  // Dispensar o cartão também interrompe a resposta, se ainda estiver vindo
  function dismissScreenResult() {
    if (screenStreamIdRef.current) {
      screenAbortedRef.current = true;
      api.llm.abortStream(screenStreamIdRef.current);
    }
    setScreenResult(null);
  }

  // Atalhos globais chamam sempre a versão atual destas funções
  useEffect(() => {
    askRef.current = ask;
    screenRef.current = runScreenAnalysis;
  });

  // ================= UI =================

  // Combinação atual de uma ação, para dicas e tooltips ("Ctrl+Shift+M")
  function hintKey(id) {
    const s = shortcutList.find((x) => x.id === id);
    if (!s?.accelerator) return 'sem atalho';
    // ⚠ = combinação em uso por outro app; troque na aba "atalhos"
    return `${prettyAccelerator(s.accelerator)}${s.registered ? '' : ' ⚠'}`;
  }

  async function changeGhost(patch) {
    try {
      const g = await api.overlay.setGhost(patch);
      if (g) setGhostState(g);
    } catch (e) {
      setError(`modo fantasma: ${e?.message || e}`);
    }
  }

  const ghostTitle = ghost.hidden
    ? `Modo fantasma ligado: some do compartilhamento de tela e de gravações (${hintKey('toggle-ghost')})`
    : `Modo fantasma: sumir do compartilhamento de tela e de gravações (${hintKey('toggle-ghost')})`;

  // Com os cliques atravessando, nada na janela responde ao mouse: o aviso
  // diz qual atalho devolve o controle.
  const clickThroughNotice = ghost.clickThrough ? <div className="ghost-notice">
    <MousePointerClick size={13} />
    <span>cliques atravessam a janela · {hintKey('toggle-click-through')} volta</span>
  </div> : null;

  const sysNotice = sysSilent && listening ? <div className="sys-notice" role="status">
    <b>Nenhum som do computador chegou no último minuto e meio.</b> Se a outra pessoa está falando e nada aparece como Reunião, a chamada deve estar tocando em outro fone ou caixa: deixe esse aparelho como saída padrão do Windows, ou escolha "Padrão" na saída de áudio do Discord, Zoom ou Teams.
    <button className="mini-link" onClick={() => setSysSilent(false)}>ok</button>
  </div> : null;

  const sttSlowNotice = sttSlow && listening ? <div className="sys-notice" role="status">
    <b>A transcrição está atrasada: cada fala está levando mais de 20 s para aparecer.</b>{' '}
    {sttSlow.heavy
      ? `O modelo ${sttSlow.model} é pesado demais para o processador. Em ⚙ → voz, ${sttSlow.gpu ? 'ligue a placa de vídeo ou ' : ''}use o Small e comece a escuta de novo.`
      : `O processador pode estar ocupado com outro programa. Em ⚙ → voz, ${sttSlow.gpu ? 'ligar a placa de vídeo ou ' : ''}usar um modelo menor (Small ou Base) deixa cada fala mais rápida.`}
    <button className="mini-link" onClick={() => setSttSlow(null)}>ok</button>
  </div> : null;

  const listenNotice = listenDeadline !== null && listening ? <div className="listen-notice" role="alert">
    <span>continuar ouvindo? A escuta pausa em até 60 s.</span>
    <button className="chip" onClick={() => { listenReminderRef.current?.confirm(); setListenDeadline(null); }}>continuar</button>
    <button className="mini-link" onClick={() => toggleListening({ pause: true })}>pausar agora</button>
  </div> : null;

  // ---- modo mini: barra com os comandos do dia a dia + o texto mais recente ----
  // Mostra, nesta ordem: sugestão, análise da tela, resposta, última fala.
  if (compact) {
    const latest = transcript[transcript.length - 1];
    const card = suggestion?.text ? { kind: 'sugestão', text: suggestion.layered ? leadLine(suggestion.text) : suggestion.text, streaming: suggestion.streaming }
      : screenResult?.text ? { kind: 'tela', text: screenResult.text, streaming: screenResult.streaming }
        : answer ? { kind: 'resposta', text: answer, streaming: busy }
          : null;
    return (
      <div className={`app compact ${ghost.clickThrough ? 'passthrough' : ''}`}>
        {listenNotice}
        {clickThroughNotice}
        {sysNotice}
        {sttSlowNotice}
        <div className="compact-bar">
          <TekaMark size={18} />
          <button
            className={`compact-mic ${listening ? 'on' : ''}`}
            onClick={toggleListening}
            disabled={starting}
            title={`${listening ? 'Parar' : 'Iniciar'} escuta (${hintKey('toggle-listen')})`}
          >
            {starting ? <LoaderCircle size={14} className="spin" /> : listening ? <Square size={11} fill="currentColor" /> : <Mic size={14} />}
            <span>{starting ? 'preparando' : listening ? formatClock(elapsedMs) : 'ouvir'}</span>
          </button>
          <div className="compact-spacer" />
          <button className="icon-btn" title={`Sugerir o que dizer agora (${hintKey('assist')})`} onClick={() => runAssist(lastQuestionRef.current || '')} disabled={busy || suggestion?.streaming}><Sparkles size={15} /></button>
          <button className="icon-btn" title={`Analisar a tela (${hintKey('screenshot')})`} onClick={runScreenAnalysis} disabled={Boolean(screenResult?.streaming)}><Camera size={15} /></button>
          <button className="icon-btn" title="Copiar o texto abaixo" onClick={() => card && copyText(card.text)} disabled={!card?.text}><Copy size={15} /></button>
          <button className={`icon-btn ghost-btn ${ghost.hidden ? 'active' : ''}`} title={ghostTitle} onClick={() => changeGhost({ hidden: !ghost.hidden })}><Ghost size={15} /></button>
          <button className="icon-btn" title="Voltar à janela completa" onClick={toggleCompact}><Maximize2 size={15} /></button>
          <button className="icon-btn" title={`Esconder (${hintKey('toggle-overlay')})`} onClick={() => api.overlay.toggle()}><EyeOff size={15} /></button>
        </div>
        <div className="compact-body">
          {card ? (
            <>
              <span className="compact-kind">{card.kind}{card.streaming ? '…' : ''}</span>
              <Markdown className="compact-text" text={card.text} />
            </>
          ) : latest ? (
            <div className="compact-text dim"><b>{latest.source === 'mic' ? 'Você' : 'Reunião'}:</b> {latest.text}</div>
          ) : (
            <div className="compact-text dim">
              {listening ? 'Ouvindo. As falas e sugestões aparecem aqui.' : 'Toque em ouvir para começar, ou pergunte abaixo.'}
            </div>
          )}
          {error && <div className="compact-error">{error}</div>}
        </div>
        <div className="compact-ask">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
            placeholder="Pergunte rápido…"
          />
          <button className="send-btn" onClick={ask} disabled={busy || !question.trim()} title="Enviar">
            {busy ? <LoaderCircle size={14} className="spin" /> : <ArrowUp size={15} strokeWidth={2.4} />}
          </button>
        </div>
      </div>
    );
  }

  // ---- tela de histórico ----
  if (view === 'history') {
    return (
      <HistoryView
        notice={listenNotice}
        onBack={() => setView('live')}
        onResume={resumeFromHistory}
        onError={setError}
        copyText={copyText}
        listening={listening || starting}
        activeSessionId={sessionRef.current?.dbId || null}
        model={llmModel || undefined}
        assistantInstructionsByUse={findAssistant(assistantId, customAssistants).instructionsByUse}
        assistantContext={contextToText(assistantContexts[assistantId])}
        assistant={assistantRef.current || undefined}
        profile={profile}
      />
    );
  }

  return (
    <div className={`app ${ghost.clickThrough ? 'passthrough' : ''}`}>
      <div className="header">
        <div className="logo">
          <TekaMark size={24} />
          <span className="logo-name">teka</span>
        </div>
        <div className={`status-pill ${listening ? 'on' : ''}`} title={resumeTarget ? `continuando: ${resumeTarget.subject || 'sessão anterior'}` : undefined}>
          <span className="dot" />
          {listening ? `ouvindo · ${formatClock(elapsedMs)}` : 'parado'}
        </div>
        <button className="icon-btn" title="Histórico de sessões" onClick={openHistory}><History size={16} /></button>
        <button className={`icon-btn ${showTheme ? 'active' : ''}`} title="Configurações" onClick={() => setShowTheme(!showTheme)}><Settings2 size={16} /></button>
        <button className={`icon-btn ghost-btn ${ghost.hidden ? 'active' : ''}`} title={ghostTitle} onClick={() => changeGhost({ hidden: !ghost.hidden })}><Ghost size={16} /></button>
        <button className="icon-btn" title="Modo mini" onClick={toggleCompact}><Minimize2 size={16} /></button>
        <button className="icon-btn" title={`Esconder (${hintKey('toggle-overlay')})`} onClick={() => api.overlay.toggle()}><EyeOff size={16} /></button>
      </div>

      {listenNotice}
      {clickThroughNotice}
      {sysNotice}
      {sttSlowNotice}
      {showTheme && (
        <div className="theme-panel">
          <div className="settings-tabs">
            {[['aparencia', 'visual'], ['ia', 'IA'], ['assistentes', 'assistentes'], ['ferramentas', 'ferramentas'], ['voz', 'voz'], ['atalhos', 'atalhos'], ['sistema', 'sistema']].map(([id, label]) => (
              <button
                key={id}
                className={`settings-tab ${settingsTab === id ? 'active' : ''}`}
                onClick={() => setSettingsTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {settingsTab === 'atalhos' && <ShortcutsPanel onChange={setShortcutList} />}
          {settingsTab === 'ferramentas' && <ToolsPanel />}

          {settingsTab === 'sistema' && (
            <SystemPanel
              autoScroll={autoScroll}
              onAutoScrollChange={changeAutoScroll}
              onError={setError}
              onUpdateResult={handleUpdateResult}
              sttModel={sttModel}
              provider={provider}
              listening={listening || starting}
            />
          )}

          {settingsTab === 'ia' && (<>
            <div className="theme-row">
              <span className="theme-label">modelo</span>
              <input
                className="model-input"
                list="llm-models"
                value={llmModel}
                placeholder="automático (padrão do provedor)"
                title="Modelo do cérebro principal"
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
            <AIPanel
              providers={providers}
              mainProvider={provider}
              onProvidersChanged={refreshProviders}
              thinkMore={thinkMore}
              onThinkMoreChange={(v) => changeFlag('llm.thinkMore', setThinkMore, v)}
              compactEnabled={compactEnabled}
              onCompactChange={(v) => changeFlag('llm.compact', setCompactEnabled, v)}
              memory={memory}
              translate={translate}
              onTranslateChange={changeTranslate}
            />
          </>)}

          {settingsTab === 'assistentes' && (
            <AssistantsPanel
              activeId={assistantId}
              custom={customAssistants}
              onSelect={selectAssistant}
              onCustomChange={saveCustomAssistants}
              onImport={importAssistants}
              onError={setError}
              preferences={assistantPreferences}
              onPreferencesChange={saveAssistantPreferences}
              contexts={assistantContexts}
              onContextChange={saveAssistantContext}
            />
          )}

          {settingsTab === 'voz' && (
            <VoicePanel
              longListenReminder={longListenReminder}
              onLongListenReminderChange={(v) => changeFlag('audio.longListenReminder', setLongListenReminder, v)}
              sttModel={sttModel}
              onSelectModel={selectSttModel}
              sttLang={sttLang}
              onLang={(l) => { setSttLang(l); api.settings.set('stt.language', l); }}
              sttPrompt={sttPrompt}
              onPrompt={(v) => { setSttPrompt(v); api.settings.set('stt.prompt', v); }}
              echoFilter={echoFilter}
              onEchoFilter={(v) => changeFlag('audio.echoFilter', setEchoFilter, v)}
              noiseSuppression={noiseSuppression}
              onNoise={(v) => changeFlag('audio.noiseSuppression', setNoiseSuppression, v)}
              sttFast={sttFast}
              onSttFast={(v) => changeFlag('stt.fast', setSttFast, v)}
              listening={listening || starting}
              onError={setError}
            />
          )}

          {settingsTab === 'aparencia' && (<>
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
          <div className="panel-section">modo fantasma</div>
          <label className="option-label"><input type="checkbox" checked={ghost.hidden} onChange={(e) => changeGhost({ hidden: e.target.checked })} /> Sumir do compartilhamento de tela ({hintKey('toggle-ghost')})</label>
          <div className="panel-note">Quem assiste à sua tela (Meet, Zoom, Teams, Discord, OBS) e prints veem o que está atrás do Teka. Na sua tela ele continua normal. O Teka já não aparece na barra de tarefas nem no Alt+Tab.</div>
          <label className="option-label"><input type="checkbox" checked={ghost.hideTray} onChange={(e) => changeGhost({ hideTray: e.target.checked })} /> Tirar também o ícone da bandeja</label>
          <div className="panel-note">Só vale com o fantasma ligado. Para mostrar ou esconder o Teka, use {hintKey('toggle-overlay')}.</div>
          <label className="option-label"><input type="checkbox" checked={ghost.clickThrough} onChange={(e) => changeGhost({ clickThrough: e.target.checked })} /> Cliques atravessam a janela ({hintKey('toggle-click-through')})</label>
          <div className="panel-note">O mouse passa pelo Teka e clica no app de baixo. Os atalhos continuam funcionando; o mesmo atalho devolve o mouse.</div>
          </>)}
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
        {provider === 'chatgpt-oauth' && chatGptAuthed && (
          <span className="auth-badge" title="ChatGPT conectado">
            <span className="dot" />conectado
            <button className="auth-link" onClick={logoutChatGpt} title="Desconectar o ChatGPT">sair</button>
          </span>
        )}
      </div>

      {provider === 'chatgpt-oauth' && (
        chatGptAuthed ? null : (
          <div className="auth-row">
            <button className="login-btn" onClick={startChatGptLogin} disabled={authBusy}>
              {authBusy ? 'aguardando autorização no navegador…' : 'Entrar com ChatGPT'}
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
          <Zap size={13} strokeWidth={2.4} /> auto
        </button>
      </div>

      <div className="profile-row">
        <div className="select-wrap small" title="Assistente: junta modo e instruções de foco (Configurações → assistentes)">
          <select value={assistantId} onChange={(e) => selectAssistant(e.target.value)}>
            {[...BUILTIN_ASSISTANTS, ...customAssistants].map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <button className="profile-toggle" onClick={() => setShowProfile(!showProfile)}>
          <IdCard size={14} /> meu contexto {showProfile ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {profile.trim() && !showProfile && <span className="profile-dot" title="Contexto preenchido" />}
      </div>
      {assistMode === 'interview' && !profile.trim() && !showProfile && (
        <div className="profile-warning">
          sem o seu contexto, as respostas saem com lacunas [assim].{' '}
          <button className="mini-link" onClick={() => setShowProfile(true)}>colar currículo</button>
        </div>
      )}
      {showProfile && (
        <textarea
          className="profile-editor"
          value={profile}
          rows={4}
          placeholder="Cole aqui seu currículo, resumo do LinkedIn, pontos fortes… O copiloto usa isso para responder como VOCÊ em entrevistas."
          onChange={(e) => saveProfile(e.target.value)}
        />
      )}

      <div className={`hero ${transcript.length || answer || suggestion || summary || screenResult ? 'tight' : ''}`}>
        <button
          className={`mic-hero ${listening ? 'listening' : ''}`}
          onClick={toggleListening}
          disabled={starting}
          title={`${listening ? 'Parar' : 'Iniciar'} escuta (${hintKey('toggle-listen')})`}
        >
          {starting ? <LoaderCircle size={24} className="spin" /> : listening ? <Square size={20} fill="currentColor" /> : <Mic size={26} />}
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
          <span className="hero-label">
            {resumeTarget?.paused ? 'escuta pausada · toque para continuar' : resumeTarget ? 'retomando a sessão…' : 'toque para ouvir a reunião'}
          </span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {updateInfo && (
        <div className="update-banner">
          {updateInfo.upToDate ? (
            <>
              <span>{updateInfo.note || `você está na versão mais recente (${updateInfo.current})`}</span>
              <button className="mini-link" onClick={() => setUpdateInfo(null)}>✕</button>
            </>
          ) : (
            <>
              <span>
                {updateFile === 'light'
                  ? (updateAuto
                    ? `✦ versão ${updateInfo.version} baixada: o Teka reinicia sozinho quando você não estiver ouvindo`
                    : `✦ versão ${updateInfo.version} pronta (você tem ${updateInfo.current})`)
                  : `✦ versão ${updateInfo.version} disponível (você tem ${updateInfo.current})`}
              </span>
              <div className="update-actions">
                {updateFile ? (
                  <button
                    className="chip"
                    disabled={listening || starting}
                    title={listening
                      ? 'Pare a escuta antes de atualizar'
                      : updateFile === 'light' ? 'Fecha e abre o app de novo já na versão nova' : 'Fecha o app e abre o instalador'}
                    onClick={() => api.update.install(updateFile)}
                  >
                    {updateFile === 'light' ? 'reiniciar agora' : 'instalar e reiniciar'}
                  </button>
                ) : updateProgress ? (
                  <span className="inline-status">
                    baixando{updateProgress.total ? ` ${Math.round((updateProgress.received / updateProgress.total) * 100)}%` : '…'}
                  </span>
                ) : updateInfo.canInstall ? (
                  <button
                    className="chip"
                    onClick={downloadUpdate}
                    title={updateInfo.mode === 'light'
                      ? 'Baixa só o código novo; não precisa reinstalar'
                      : 'Esta versão troca o Electron ou módulos nativos: precisa do instalador completo'}
                  >
                    {updateInfo.mode === 'light' ? `atualizar${formatSize(updateInfo.size)}` : `baixar instalador${formatSize(updateInfo.size)}`}
                  </button>
                ) : null}
                <button className="mini-link" onClick={() => api.update.openPage(updateInfo.pageUrl)}>ver novidades ↗</button>
                {updateFile !== 'light' && (
                  <button className="mini-link" title="Não avisar mais desta versão" onClick={skipUpdate}>ignorar</button>
                )}
                {updateFile === 'light' && (
                  <button className="mini-link" title="Esconder o aviso; a versão nova entra no próximo reinício" onClick={() => setUpdateInfo(null)}>✕</button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {summary && (
        <div className="summary">
          <div className="sug-head">
            <span className="label"><Sparkles size={12} /> resumo da sessão{summary.streaming ? '…' : ''}</span>
            <div className="sug-actions">
              <button
                onClick={generateFollowup}
                disabled={summary.streaming || followup?.streaming}
                title="Escrever o e-mail de follow-up desta reunião"
              >
                <Mail size={13} /> e-mail
              </button>
              <button
                onClick={() => copyText(summary.text)}
                disabled={!summary.text}
                title="Copiar resumo"
              >
                copiar
              </button>
              <button onClick={() => setSummary(null)} title="Dispensar">✕</button>
            </div>
          </div>
          {summary.text ? <Markdown className="sug-text" text={summary.text} /> : <div className="sug-text">gerando resumo…</div>}
        </div>
      )}

      {followup && (
        <div className="summary">
          <div className="sug-head">
            <span className="label"><Mail size={12} /> e-mail de follow-up{followup.streaming ? '…' : ''}</span>
            <div className="sug-actions">
              <button onClick={() => copyText(followup.text)} disabled={!followup.text} title="Copiar e-mail">copiar</button>
              <button onClick={() => setFollowup(null)} title="Dispensar">✕</button>
            </div>
          </div>
          {followup.text ? <Markdown className="sug-text" text={followup.text} /> : <div className="sug-text">escrevendo…</div>}
        </div>
      )}

      {suggestion && (
        <div className="suggestion">
          <div className="sug-head">
            <span className="label">
              <Sparkles size={12} /> {suggestion.draft && suggestion.streaming ? 'rascunho ao vivo' : 'sugestão'}
              {suggestion.streaming ? '…' : ''}
            </span>
            <div className="sug-actions">
              <button
                onClick={() => copyText(suggestion.text)}
                disabled={!suggestion.text}
                title={`Copiar sugestão (${hintKey('copy-suggestion')})`}
              >
                copiar
              </button>
              <button onClick={() => setSuggestion(null)} title="Dispensar">✕</button>
            </div>
          </div>
          {suggestion.question && <div className="sug-question">“{suggestion.question}”</div>}
          {suggestion.layered
            ? <LayeredAnswer text={suggestion.text} />
            : suggestion.text ? <Markdown className="sug-text" text={suggestion.text} /> : <div className="sug-text">pensando…</div>}
          {!suggestion.streaming && suggestion.text && (
            <div className="sug-chips">
              {(suggestion.layered ? INTERVIEW_REFINE_CHIPS : REFINE_CHIPS).map(([label, instruction]) => (
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

      {screenResult && (
        <div className="suggestion screen-card">
          <div className="sug-head">
            <span className="label">
              <Camera size={12} /> análise da tela{screenResult.streaming ? '…' : ''}
            </span>
            <div className="sug-actions">
              <button
                onClick={() => copyText(screenResult.text)}
                disabled={!screenResult.text}
                title="Copiar análise"
              >
                copiar
              </button>
              <button onClick={dismissScreenResult} title="Dispensar">✕</button>
            </div>
          </div>
          {screenResult.image && (
            <img className="screen-thumb" src={screenResult.image} alt="captura analisada" />
          )}
          {screenResult.question && <div className="sug-question">“{screenResult.question}”</div>}
          {!!screenTools.length && <div className="mcp-used">Ferramentas: {screenTools.map(t => `${t.serverName || 'MCP'} · ${t.name}${t.isError ? ' (erro)' : ''}`).join(', ')}</div>}
          {screenResult.text
            ? <Markdown className="sug-text" text={screenResult.text} />
            : <div className="sug-text">{screenResult.capturing ? 'capturando a tela…' : 'analisando…'}</div>}
          {!screenResult.streaming && <SuggestedQuestions key={screenQuestions?.answer} seed={screenQuestions} onAsk={ask} onError={setError} />}
        </div>
      )}

      <div className="transcript" ref={transcriptBoxRef} onScroll={onTranscriptScroll}>
        {transcript.length === 0 && !answer && !suggestion && !summary && !followup && !screenResult && (
          <div className="transcript-empty">
            <span className="big"><TekaMark size={34} /></span>
            A transcrição da conversa aparece aqui.
            <br />No modo <b>Entrevista</b> com <b>auto</b> ligado, o copiloto
            <br />rascunha sua resposta enquanto o entrevistador ainda fala.
            <br />Clique numa fala para ver uma resposta para ela.
            <br />
            <span className="hint">
              {hintKey('toggle-listen')} ouvir · {hintKey('assist')} sugerir · {hintKey('copy-suggestion')} copiar
              <br />{hintKey('screenshot')} analisar tela · {hintKey('clipboard-prompt')} perguntar sobre texto copiado
            </span>
          </div>
        )}
        {transcript.map((t, i) => (
          <div
            key={t.id ?? i}
            className={`bubble ${t.source} clickable ${suggestion?.question === t.text ? 'answered' : ''}`}
            role="button"
            tabIndex={0}
            title="Clique para o copiloto responder a esta fala"
            onClick={() => answerLine(t)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); answerLine(t); } }}
          >
            <span className="who">
              {t.source === 'mic' ? 'Você' : 'Reunião'}
              <span className="reply-hint"><Sparkles size={9} /> responder</span>
            </span>
            {t.text}
            {t.translation && <span className="translation">{t.translation}</span>}
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>

      {newBelow && (
        <button className="chip new-below" onClick={jumpToLatest}>↓ novas falas</button>
      )}

      {answer && (
        <div className="answer">
          <span className="label"><Sparkles size={12} /> resposta{answerNote ? ` · ${answerNote}` : ''}</span>
          <Markdown text={answer} />
          {!!answerTools.length && <div className="mcp-used">Ferramentas: {answerTools.map(t => `${t.serverName || 'MCP'} · ${t.name}${t.isError ? ' (erro)' : ''}`).join(', ')}</div>}
          {!busy && <SuggestedQuestions key={answerQuestions?.answer} seed={answerQuestions} onAsk={ask} onError={setError} />}
        </div>
      )}

      {attached && (
        <div className="attached-chip" title={attached.text.slice(0, 400)}>
          <span><ClipboardPaste size={13} /> trecho anexado · {attached.text.length} caracteres</span>
          <button className="mini-link" onClick={() => setAttached(null)} title="Remover o trecho">✕</button>
        </div>
      )}

      <div className="composer">
        <button
          className="assist-btn"
          onClick={() => runAssist(lastQuestionRef.current || '')}
          disabled={busy || suggestion?.streaming}
          title={`Sugerir o que dizer agora (${hintKey('assist')})`}
        >
          <Sparkles size={17} />
        </button>
        <button
          className="tool-btn"
          onClick={runScreenAnalysis}
          disabled={Boolean(screenResult?.streaming)}
          title={`Analisar a tela (${hintKey('screenshot')}). O texto digitado vira a pergunta.`}
        >
          <Camera size={17} />
        </button>
        <button
          className={`tool-btn ${attached ? 'active' : ''}`}
          onClick={attachClipboard}
          title={`Anexar o texto copiado à pergunta (atalho direto: ${hintKey('clipboard-prompt')})`}
        >
          <ClipboardPaste size={17} />
        </button>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder={attached ? 'O que você quer saber sobre o trecho?' : 'Pergunte sobre a reunião…'}
        />
        <button className="send-btn" onClick={ask} disabled={busy || !question.trim()}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} strokeWidth={2.4} />}
        </button>
      </div>

      {onboarding !== null && (
        <div className="onboarding">
          <div className="ob-card">
            <div className="ob-steps">
              {[0, 1, 2, 3].map((i) => (
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

            {onboarding === 3 && (
              <>
                <h3>Verificação</h3>
                <p className="ob-desc">Um teste rápido de tudo que a escuta usa. Fale algo quando o microfone estiver sendo testado.</p>
                <DiagnosticsPanel sttModel={sttModel} provider={provider} disabled={listening || starting} />
              </>
            )}

            <div className="ob-nav">
              <button className="auth-link" onClick={finishOnboarding}>pular</button>
              <div style={{ flex: 1 }} />
              {onboarding > 0 && (
                <button className="chip" onClick={() => setOnboarding(onboarding - 1)}>voltar</button>
              )}
              {onboarding < 3
                ? <button className="send-btn wide" onClick={() => setOnboarding(onboarding + 1)}>próximo</button>
                : <button className="send-btn wide" onClick={finishOnboarding}>concluir ✦</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<><App /><McpConfirmations /></>);
