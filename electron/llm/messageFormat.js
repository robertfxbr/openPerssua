// Mensagens com imagem (análise de tela).
//
// Os prompts montam mensagens no formato interno
//   { role, content: 'texto', images?: ['data:image/jpeg;base64,...'] }
// e cada provedor converte para o formato da própria API aqui. Mensagens sem
// imagem passam sem mudança, então o caminho de texto puro não é afetado.

function hasImages(messages) {
  return messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
}

// 'data:image/jpeg;base64,AAAA' -> { mediaType: 'image/jpeg', data: 'AAAA' }
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('imagem em formato inesperado (esperado data URL base64)');
  return { mediaType: match[1], data: match[2] };
}

// OpenAI Chat Completions, Ollama e LM Studio (endpoint compatível)
function toOpenAIChat(messages) {
  return messages.map(({ images, ...m }) => {
    if (!images?.length) return m;
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    };
  });
}

// Anthropic Messages API: imagem antes do texto, como a documentação recomenda
function toAnthropic(messages) {
  return messages.map(({ images, ...m }) => {
    if (!images?.length) return m;
    return {
      role: m.role,
      content: [
        ...images.map((url) => {
          const { mediaType, data } = parseDataUrl(url);
          return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
        }),
        { type: 'text', text: m.content },
      ],
    };
  });
}

// Responses API (backend Codex da assinatura ChatGPT)
function toResponsesInput(messages) {
  return messages.map((m) => {
    const textType = m.role === 'assistant' ? 'output_text' : 'input_text';
    const content = [{ type: textType, text: m.content }];
    for (const url of m.images || []) content.push({ type: 'input_image', image_url: url });
    return { role: m.role, content };
  });
}

module.exports = { hasImages, parseDataUrl, toOpenAIChat, toAnthropic, toResponsesInput };
