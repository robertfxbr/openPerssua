// Interface comum de provedores LLM.
// No original essa função é exercida pelos barramentos `custom-api:*`,
// `codex-api:*` e `llm-local:*`. Aqui vira um contrato único de adapter:
//
//   id: string
//   label: string
//   isConfigured(): Promise<boolean>
//   chat({ messages, model?, signal? }): Promise<string>
//   chatStream({ messages, model?, onChunk, signal? }): Promise<void>

const { OpenAIAdapter } = require('./providers/OpenAIAdapter');
const { ChatGPTOAuthAdapter } = require('./providers/ChatGPTOAuthAdapter');
const { ClaudeAdapter } = require('./providers/ClaudeAdapter');
const { ClaudeCodeAdapter } = require('./providers/ClaudeCodeAdapter');
const { OllamaAdapter } = require('./providers/OllamaAdapter');

class LLMRouter {
  constructor({ settingsStore, tokenStore }) {
    this.providers = [
      new OpenAIAdapter({ settingsStore }),
      new ChatGPTOAuthAdapter({ tokenStore }),
      new ClaudeAdapter({ settingsStore }),
      new ClaudeCodeAdapter({ settingsStore }),
      new OllamaAdapter({ settingsStore }),
    ];
    this.settingsStore = settingsStore;
  }

  async listProviders() {
    return Promise.all(this.providers.map(async (p) => ({
      id: p.id,
      label: p.label,
      configured: await p.isConfigured(),
    })));
  }

  async activeProvider() {
    const selected = await this.settingsStore.get('llm.provider');
    const provider = this.providers.find((p) => p.id === selected)
      || this.providers.find((p) => p.id === 'ollama');
    if (!provider) throw new Error('nenhum provedor LLM disponível');
    if (!(await provider.isConfigured())) {
      throw new Error(`provedor "${provider.label}" não configurado — abra as Configurações e selecione/credencie um provedor`);
    }
    return provider;
  }

  async chat(req) {
    const provider = await this.activeProvider();
    return provider.chat(req);
  }

  async chatStream(req) {
    const provider = await this.activeProvider();
    return provider.chatStream(req);
  }
}

module.exports = { LLMRouter };
