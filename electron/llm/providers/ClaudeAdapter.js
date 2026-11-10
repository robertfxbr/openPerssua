// Anthropic API (Claude) com API key do usuário.

const { readSseStream } = require('./OpenAIAdapter');
const { toAnthropic } = require('../messageFormat');

class ClaudeAdapter {
  constructor({ settingsStore }) {
    this.id = 'claude';
    this.label = 'Claude API (key paga por uso)';
    this.settingsStore = settingsStore;
  }

  async isConfigured() {
    return Boolean(await this.settingsStore.get('anthropic.apiKey'));
  }

  buildBody({ messages, model, stream }) {
    // Anthropic separa system do array de mensagens
    const system = messages.find((m) => m.role === 'system')?.content;
    const rest = messages.filter((m) => m.role !== 'system');
    return {
      model: model || 'claude-sonnet-4-5',
      max_tokens: 2048,
      ...(system ? { system } : {}),
      messages: toAnthropic(rest),
      stream,
    };
  }

  async request(body, signal) {
    const apiKey = await this.settingsStore.get('anthropic.apiKey');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    return res;
  }

  async chat({ messages, model, signal }) {
    const res = await this.request(this.buildBody({ messages, model, stream: false }), signal);
    const data = await res.json();
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  async chatStream({ messages, model, onChunk, signal }) {
    const res = await this.request(this.buildBody({ messages, model, stream: true }), signal);
    await readSseStream(res, (json) => {
      if (json.type === 'content_block_delta' && json.delta?.text) onChunk(json.delta.text);
    });
  }
}

module.exports = { ClaudeAdapter };
