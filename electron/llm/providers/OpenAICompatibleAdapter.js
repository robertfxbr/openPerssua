// Servidor local que fala o formato da OpenAI (/chat/completions): LM Studio,
// llama.cpp server, Jan, vLLM... Roda no PC do usuário, sem custo por uso.
// Fica como "preset" para que outros servidores do mesmo formato possam entrar
// com uma linha só, sem um arquivo por empresa.

const { readSseStream } = require('./OpenAIAdapter');
const { toOpenAIChat } = require('../messageFormat');

// baseUrl null = o usuário informa o endereço
const PRESETS = [
  {
    id: 'custom',
    label: 'Servidor local compatível com OpenAI (LM Studio, llama.cpp)',
    baseUrl: null,
    defaultModel: null,
  },
];

class OpenAICompatibleAdapter {
  constructor({ settingsStore, preset }) {
    this.settingsStore = settingsStore;
    this.preset = preset;
    this.id = preset.id;
    this.label = preset.label;
    this.defaultModel = preset.defaultModel;
    this.keyUrl = preset.keyUrl || null;
    // Campos que a aba "IA" mostra para configurar este provedor
    this.fields = preset.baseUrl
      ? [{ key: `${preset.id}.apiKey`, label: 'API key', secret: true }]
      : [
        { key: 'custom.baseUrl', label: 'endereço', placeholder: 'http://127.0.0.1:1234/v1' },
        { key: 'custom.apiKey', label: 'token', secret: true, optional: true },
        { key: 'custom.model', label: 'modelo', placeholder: 'nome do modelo no servidor' },
      ];
  }

  async baseUrl() {
    const url = this.preset.baseUrl || (await this.settingsStore.get('custom.baseUrl')) || '';
    return String(url).trim().replace(/\/+$/, '');
  }

  async isConfigured() {
    if (this.preset.baseUrl) return Boolean(await this.settingsStore.get(`${this.id}.apiKey`));
    // Endereço próprio: precisa de URL http(s) e de um modelo (não há padrão)
    const url = await this.baseUrl();
    const model = await this.settingsStore.get('custom.model');
    return /^https?:\/\//i.test(url) && Boolean(String(model || '').trim());
  }

  async request({ messages, model, stream, signal }) {
    const apiKey = await this.settingsStore.get(`${this.id}.apiKey`);
    const chosen = model
      || (this.preset.baseUrl ? this.defaultModel : String(await this.settingsStore.get('custom.model') || '').trim());
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${await this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: chosen, messages: toOpenAIChat(messages), stream }),
      signal,
    });
    if (!res.ok) throw new Error(`${this.label.split(' (')[0]} ${res.status}: ${(await res.text()).slice(0, 400)}`);
    return res;
  }

  async chat({ messages, model, signal }) {
    const res = await this.request({ messages, model, stream: false, signal });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async chatStream({ messages, model, onChunk, signal }) {
    const res = await this.request({ messages, model, stream: true, signal });
    await readSseStream(res, (json) => {
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) onChunk(delta);
    });
  }
}

module.exports = { OpenAICompatibleAdapter, PRESETS };
