// Atalhos globais configuráveis pelo usuário.
//
// Cada ação tem uma lista de combinações padrão (a primeira que o sistema
// aceitar vence) e pode receber uma combinação personalizada, salva em
// settings.json na chave "shortcuts" como { idDaAcao: "Ctrl+Shift+X" }.
// Valor "" significa atalho desativado de propósito.

const { globalShortcut } = require('electron');
const log = require('electron-log');

const SHORTCUT_ACTIONS = [
  { id: 'toggle-overlay', label: 'Mostrar/ocultar o overlay', defaults: ['CommandOrControl+Shift+Space'] },
  { id: 'toggle-listen', label: 'Ligar/desligar a escuta', defaults: ['CommandOrControl+Shift+M'] },
  { id: 'assist', label: 'Sugerir o que dizer agora', defaults: ['CommandOrControl+Shift+Enter'] },
  // Ctrl+Shift+C costuma estar ocupado (terminal, outros copilotos): cai para Y
  { id: 'copy-suggestion', label: 'Copiar a última sugestão', defaults: ['CommandOrControl+Shift+C', 'CommandOrControl+Shift+Y'] },
  { id: 'screenshot', label: 'Analisar a tela', defaults: ['CommandOrControl+Shift+X'] },
  { id: 'clipboard-prompt', label: 'Perguntar sobre o texto copiado', defaults: ['CommandOrControl+Shift+K'] },
  { id: 'next-display', label: 'Mover para o próximo monitor', defaults: ['CommandOrControl+Alt+Right'] },
];

class ShortcutManager {
  // handlers: { [idDaAcao]: () => void }
  constructor({ settingsStore, handlers }) {
    this.settingsStore = settingsStore;
    this.handlers = handlers;
    this.overrides = {};
    this.state = {};       // { id: { accelerator, registered } }
    this.suspended = false;
  }

  async init() {
    const saved = await this.settingsStore.get('shortcuts');
    this.overrides = saved && typeof saved === 'object' ? { ...saved } : {};
    this.registerAll();
  }

  // Combinações candidatas de uma ação: a personalizada (se houver) ou as padrão
  candidatesFor(action) {
    if (Object.prototype.hasOwnProperty.call(this.overrides, action.id)) {
      const custom = this.overrides[action.id];
      return custom ? [custom] : []; // "" = desativado
    }
    return action.defaults;
  }

  // Tenta registrar uma combinação. register() lança erro para texto
  // inválido e devolve false quando outro app já usa a combinação.
  tryRegister(accelerator, handler) {
    try {
      return globalShortcut.register(accelerator, handler);
    } catch {
      return false;
    }
  }

  registerAll() {
    globalShortcut.unregisterAll();
    this.state = {};
    for (const action of SHORTCUT_ACTIONS) {
      const candidates = this.candidatesFor(action);
      const handler = () => this.handlers[action.id]?.();
      let registered = null;
      for (const accelerator of candidates) {
        if (this.tryRegister(accelerator, handler)) { registered = accelerator; break; }
      }
      this.state[action.id] = {
        accelerator: registered || candidates[0] || '',
        registered: Boolean(registered),
      };
      if (candidates.length && !registered) {
        log.warn(`atalho "${action.id}" não registrado (${candidates.join(' / ')} em uso ou inválido)`);
      }
    }
  }

  list() {
    return SHORTCUT_ACTIONS.map((action) => ({
      id: action.id,
      label: action.label,
      accelerator: this.state[action.id]?.accelerator || '',
      registered: Boolean(this.state[action.id]?.registered),
      defaultAccelerator: action.defaults[0],
      custom: Object.prototype.hasOwnProperty.call(this.overrides, action.id),
    }));
  }

  // accelerator: string nova, "" para desativar, null para voltar ao padrão
  async set(id, accelerator) {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
    if (!action) return { ok: false, error: `ação desconhecida: ${id}` };

    if (accelerator) {
      // A mesma combinação em duas ações faria só uma delas funcionar
      const clash = SHORTCUT_ACTIONS.find((a) => a.id !== id
        && this.state[a.id]?.registered
        && this.state[a.id].accelerator.toLowerCase() === accelerator.toLowerCase());
      if (clash) return { ok: false, error: `já usado em "${clash.label}"` };
    }

    const previous = Object.prototype.hasOwnProperty.call(this.overrides, id)
      ? { had: true, value: this.overrides[id] }
      : { had: false };

    if (accelerator === null) delete this.overrides[id];
    else this.overrides[id] = accelerator;

    this.registerAll();

    // Combinação nova recusada pelo sistema: desfaz e avisa, em vez de
    // deixar a ação sem atalho nenhum.
    if (accelerator && !this.state[id].registered) {
      if (previous.had) this.overrides[id] = previous.value;
      else delete this.overrides[id];
      this.registerAll();
      return { ok: false, error: 'combinação inválida ou em uso por outro app' };
    }

    await this.settingsStore.set('shortcuts', this.overrides);
    if (this.suspended) globalShortcut.unregisterAll();
    return { ok: true, shortcuts: this.list() };
  }

  // Durante a gravação de um atalho na tela, os atuais ficam desligados:
  // senão apertar a combinação antiga disparava a ação em vez de ser gravada.
  suspend(enabled) {
    this.suspended = Boolean(enabled);
    if (this.suspended) globalShortcut.unregisterAll();
    else this.registerAll();
    return { ok: true };
  }

  dispose() {
    globalShortcut.unregisterAll();
  }
}

module.exports = { ShortcutManager, SHORTCUT_ACTIONS };
