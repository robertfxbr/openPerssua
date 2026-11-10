// Interface comum de provedores LLM.
// No original essa função é exercida pelos barramentos `custom-api:*`,
// `codex-api:*` e `llm-local:*`. Aqui vira um contrato único de adapter:
//
//   id: string
//   label: string
//   isConfigured(): Promise<boolean>
//   chat({ messages, model?, signal? }): Promise<string>
//   chatStream({ messages, model?, onChunk, signal? }): Promise<void>
//
// Cada tarefa (responder, sugerir, resumir, analisar tela, traduzir) pode usar
// um provedor e um modelo próprios. Sem escolha para a tarefa, vale o provedor
// principal com o modelo principal.

const { OpenAIAdapter } = require('./providers/OpenAIAdapter');
const { ChatGPTOAuthAdapter } = require('./providers/ChatGPTOAuthAdapter');
const { ClaudeAdapter } = require('./providers/ClaudeAdapter');
const { ClaudeCodeAdapter } = require('./providers/ClaudeCodeAdapter');
const { OllamaAdapter } = require('./providers/OllamaAdapter');
const { OpenAICompatibleAdapter, PRESETS } = require('./providers/OpenAICompatibleAdapter');
const { CodexCliAdapter, GeminiCliAdapter } = require('./providers/CliAdapters');

const TASKS = {
  chat: 'perguntas digitadas',
  assist: 'sugestões ao vivo',
  summary: 'resumo e e-mail',
  screen: 'análise de tela',
  translate: 'tradução',
};

// Campos de configuração dos provedores que não vêm de um preset
const FIELDS = {
  openai: [{ key: 'openai.apiKey', label: 'API key', secret: true }],
  claude: [{ key: 'anthropic.apiKey', label: 'API key', secret: true }],
  ollama: [{ key: 'ollama.baseUrl', label: 'endereço', placeholder: 'http://127.0.0.1:11434' }],
};
// Como ligar os provedores sem campo de configuração
const HINTS = {
  'chatgpt-oauth': 'Escolha este como cérebro e clique em "Entrar com ChatGPT": usa a sua assinatura, sem API key.',
  'claude-code': 'Instale o Claude Code e rode "claude login" uma vez: usa a sua assinatura Claude.',
};
const KEY_URLS = {
  openai: 'https://platform.openai.com/api-keys',
  claude: 'https://console.anthropic.com/settings/keys',
};
const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-4-5',
  ollama: 'llama3.1',
};

class LLMRouter {
  constructor({ settingsStore, tokenStore }) {
    // Primeiro os que usam login/assinatura ou rodam no PC (sem custo extra);
    // as APIs pagas por uso ficam por último.
    this.providers = [
      new ChatGPTOAuthAdapter({ tokenStore }),
      new ClaudeCodeAdapter({ settingsStore }),
      new CodexCliAdapter({ settingsStore }),
      new GeminiCliAdapter({ settingsStore }),
      new OllamaAdapter({ settingsStore }),
      ...PRESETS.map((preset) => new OpenAICompatibleAdapter({ settingsStore, preset })),
      new OpenAIAdapter({ settingsStore }),
      new ClaudeAdapter({ settingsStore }),
    ];
    this.settingsStore = settingsStore;
  }

  async listProviders() {
    return Promise.all(this.providers.map(async (p) => ({
      id: p.id,
      label: p.label,
      configured: await p.isConfigured().catch(() => false),
      fields: p.fields || FIELDS[p.id] || [],
      keyUrl: p.keyUrl || KEY_URLS[p.id] || null,
      hint: p.hint || HINTS[p.id] || null,
      defaultModel: p.defaultModel || DEFAULT_MODELS[p.id] || null,
    })));
  }

  async ensureConfigured(provider, task) {
    if (await provider.isConfigured()) return provider;
    const where = task && TASKS[task] ? ` (escolhido para ${TASKS[task]})` : '';
    throw new Error(`provedor "${provider.label}"${where} não configurado: abra as Configurações, aba "IA"`);
  }

  async activeProvider() {
    const selected = await this.settingsStore.get('llm.provider');
    const provider = this.providers.find((p) => p.id === selected)
      || this.providers.find((p) => p.id === 'ollama');
    if (!provider) throw new Error('nenhum provedor LLM disponível');
    return this.ensureConfigured(provider);
  }

  // Decide provedor e modelo de uma chamada. A escolha da tarefa vence; o
  // modelo principal só vale com o provedor principal (um "gpt-..." não faz
  // sentido mandado para o Gemini, por exemplo).
  async resolve(task, model) {
    const overrides = (await this.settingsStore.get('llm.tasks')) || {};
    const o = task ? overrides[task] : null;
    if (o?.provider) {
      const provider = this.providers.find((p) => p.id === o.provider);
      if (provider) {
        return { provider: await this.ensureConfigured(provider, task), model: o.model?.trim() || undefined };
      }
    }
    if (o?.model?.trim()) return { provider: await this.activeProvider(), model: o.model.trim() };
    return { provider: await this.activeProvider(), model };
  }

  async chat(req) {
    const { provider, model } = await this.resolve(req.task, req.model);
    return provider.chat({ ...req, model });
  }

  async chatStream(req) {
    const { provider, model } = await this.resolve(req.task, req.model);
    return provider.chatStream({ ...req, model });
  }
}

module.exports = { LLMRouter, TASKS };
