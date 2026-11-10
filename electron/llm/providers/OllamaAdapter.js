// Ollama / LM Studio / qualquer servidor OpenAI-compatible em loopback.
// No original isso é o caso de uso principal do proxy `custom-api` (o proxy
// existe porque esses servidores locais falham em preflight CORS do browser;
// aqui o fetch roda no main process, que não tem CORS).

const { readSseStream } = require('./OpenAIAdapter');
const { toOpenAIChat } = require('../messageFormat');

class OllamaAdapter {
  constructor({ settingsStore }) {
    this.id = 'ollama';
    this.label = 'Local (Ollama / LM Studio)';
    this.settingsStore = settingsStore;
  }

  async baseUrl() {
    return (await this.settingsStore.get('ollama.baseUrl')) || 'http://127.0.0.1:11434';
  }

  async isConfigured() {
    try {
      const res = await fetch(`${await this.baseUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat({ messages, model, signal }) {
    const res = await fetch(`${await this.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'llama3.1', messages: toOpenAIChat(messages) }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  async chatStream({ messages, model, onChunk, signal }) {
    const res = await fetch(`${await this.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'llama3.1', messages: toOpenAIChat(messages), stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    await readSseStream(res, (json) => {
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) onChunk(delta);
    });
  }
}

module.exports = { OllamaAdapter };
