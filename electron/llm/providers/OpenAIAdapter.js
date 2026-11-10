// OpenAI API (api.openai.com) com API key do usuário.
// Equivale ao `custom-api:fetch-stream` do original apontado para a OpenAI.

const { toOpenAIChat } = require('../messageFormat');

class OpenAIAdapter {
  constructor({ settingsStore }) {
    this.id = 'openai';
    this.label = 'OpenAI API (API key)';
    this.settingsStore = settingsStore;
  }

  async isConfigured() {
    return Boolean(await this.settingsStore.get('openai.apiKey'));
  }

  async chat({ messages, model, signal }) {
    const apiKey = await this.settingsStore.get('openai.apiKey');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: toOpenAIChat(messages) }),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  async chatStream({ messages, model, onChunk, signal }) {
    const apiKey = await this.settingsStore.get('openai.apiKey');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: toOpenAIChat(messages), stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    await readSseStream(res, (json) => {
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) onChunk(delta);
    });
  }
}

// Leitor SSE compartilhado (data: {...}\n\n) — mesmo formato usado pelo
// proxy `custom-api` do original para repassar chunks ao renderer.
async function readSseStream(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try { onData(JSON.parse(payload)); } catch { /* keep-alive parcial */ }
    }
  }
}

module.exports = { OpenAIAdapter, readSseStream };
