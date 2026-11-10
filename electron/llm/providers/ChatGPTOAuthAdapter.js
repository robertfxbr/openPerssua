// ChatGPT via OAuth PKCE — mesmo fluxo público do Codex CLI que o original
// usa em `codexAuth.js`: authorize em auth.openai.com, redirect loopback,
// token guardado cifrado com safeStorage do Electron. Permite usar a
// assinatura ChatGPT (Plus/Pro/Team) em vez de API key.

const crypto = require('crypto');
const http = require('http');
const { shell, safeStorage } = require('electron');

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
// Client ID público do Codex CLI (codex-rs/login/src/server.rs)
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_PORTS = [1455, 1457];
const SCOPES = 'openid profile email offline_access';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // usuário tem 5 min para concluir no navegador

class ChatGPTOAuthAdapter {
  constructor({ tokenStore }) {
    this.id = 'chatgpt-oauth';
    this.label = 'ChatGPT (assinatura via login)';
    this.tokenStore = tokenStore; // persiste token cifrado (ver ipc/auth)
  }

  async isConfigured() {
    const token = await this.tokenStore.read();
    return Boolean(token?.access_token);
  }

  // ---- Refresh automático ----
  // O access_token (JWT) expira; o refresh_token (offline_access) renova sem
  // refazer o login no navegador.
  static jwtExpiresAt(jwt) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      return payload.exp ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  async refreshToken(token) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: token.refresh_token,
      }),
    });
    if (!res.ok) throw new Error(`refresh token ${res.status}: ${await res.text()}`);
    const fresh = await res.json();
    // Nem todo provedor devolve refresh_token novo — preserva o anterior.
    const merged = { ...token, ...fresh, refresh_token: fresh.refresh_token || token.refresh_token };
    await this.tokenStore.write(merged);
    return merged;
  }

  async getValidToken() {
    const token = await this.tokenStore.read();
    if (!token?.access_token) return null;
    const exp = ChatGPTOAuthAdapter.jwtExpiresAt(token.access_token);
    const MARGIN_MS = 60 * 1000; // renova 1 min antes de expirar
    if (exp && Date.now() < exp - MARGIN_MS) return token;
    if (!token.refresh_token) return token; // sem refresh: usa até o servidor rejeitar
    try {
      return await this.refreshToken(token);
    } catch {
      return token; // refresh falhou (rede?) — tenta o token atual mesmo assim
    }
  }

  // ---- OAuth PKCE ----
  static generatePkce() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  async startLogin() {
    const { verifier, challenge } = ChatGPTOAuthAdapter.generatePkce();
    const state = crypto.randomBytes(16).toString('hex');

    const { port, codePromise } = await this.listenForCallback(state);

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', `http://localhost:${port}/auth/callback`);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    await shell.openExternal(url.toString());

    const code = await codePromise;
    const token = await this.exchangeCode(code, verifier, port);
    await this.tokenStore.write(token);
    return { ok: true };
  }

  listenForCallback(expectedState) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const tryPort = (idx) => {
        if (idx >= REDIRECT_PORTS.length) return reject(new Error('portas 1455/1457 ocupadas'));
        const port = REDIRECT_PORTS[idx];
        let resolveCode, rejectCode;
        const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

        const server = http.createServer((req, res) => {
          const u = new URL(req.url, `http://localhost:${port}`);
          if (u.pathname !== '/auth/callback') { res.end(); return; }
          if (u.searchParams.get('state') !== expectedState) {
            res.writeHead(400).end('state inválido');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Login concluído — pode fechar esta aba.</h1>');
          resolveCode(u.searchParams.get('code'));
          clearTimeout(timeout);
          server.close();
        });
        // Sem timeout o servidor ficaria aberto para sempre se o usuário
        // fechar a aba do navegador sem concluir o login.
        const timeout = setTimeout(() => {
          server.close();
          rejectCode(new Error('login expirado (5 min sem retorno do navegador)'));
        }, LOGIN_TIMEOUT_MS);
        codePromise.finally(() => clearTimeout(timeout)).catch(() => {});

        server.on('error', () => tryPort(idx + 1));
        server.listen(port, 'localhost', () => {
          if (!settled) { settled = true; resolve({ port, codePromise }); }
        });
      };
      tryPort(0);
    });
  }

  async exchangeCode(code, verifier, port) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: `http://localhost:${port}/auth/callback`,
      }),
    });
    if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // ---- Chamadas usando o token da assinatura ----
  // O Codex CLI consome o endpoint de Responses API com o token OAuth.
  async chat({ messages }) {
    let result = '';
    await this.chatStream({ messages, onChunk: (d) => { result += d; } });
    return result;
  }

  // Tokens OAuth do login ChatGPT NÃO são aceitos em api.openai.com — o
  // Codex CLI consome o backend próprio (chatgpt.com/backend-api/codex),
  // com o account-id extraído do JWT e header beta de responses.
  async chatStream({ messages, model, onChunk, signal }) {
    let token = await this.getValidToken();
    if (!token?.access_token) throw new Error('não autenticado — faça login com ChatGPT');

    const { toResponsesInput } = require('../messageFormat');
    const input = toResponsesInput(messages);

    const body = (modelName) => JSON.stringify({
      model: modelName,
      input,
      stream: true,
      store: false,
      instructions: 'You are a helpful meeting copilot assistant.',
      // Copiloto ao vivo: latência importa mais que raciocínio profundo
      reasoning: { effort: 'low' },
    });

    const doRequest = (accessToken, modelName) => {
      const accountId = extractAccountId(accessToken);
      return fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'OpenAI-Beta': 'responses=experimental',
          ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
        },
        body: body(modelName),
        signal,
      });
    };

    const DEFAULT_MODEL = 'gpt-6.1-sol'; // padrão do backend Codex (contas ChatGPT)
    let res = await doRequest(token.access_token, model || DEFAULT_MODEL);

    // 401: access_token expirado apesar do exp do JWT — força refresh e
    // tenta uma vez com o token novo (conta "desconectando" resolvida).
    if (res.status === 401 && token.refresh_token) {
      token = await this.refreshToken(token);
      res = await doRequest(token.access_token, model || DEFAULT_MODEL);
    }

    // Fallback automático: modelo recusado pelo backend (ex.: tier não
    // liberado p/ conta ChatGPT) → tenta uma vez com o modelo padrão.
    if (!res.ok && res.status === 400 && model && model !== DEFAULT_MODEL) {
      const errText = await res.text();
      if (errText.includes('model is not supported') || errText.includes('model_not_found')) {
        res = await doRequest(token.access_token, DEFAULT_MODEL);
      } else {
        throw new Error(`Codex backend ${res.status}: ${errText}`);
      }
    }
    if (!res.ok) throw new Error(`Codex backend ${res.status}: ${await res.text()}`);

    const { readSseStream } = require('./OpenAIAdapter');
    await readSseStream(res, (json) => {
      if (json.type === 'response.output_text.delta' && json.delta) onChunk(json.delta);
    });
  }
}

// O access_token do fluxo Codex é um JWT; o claim `chatgpt_account_id`
// identifica a conta/workspace da assinatura.
function extractAccountId(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return payload['https://api.openai.com/auth']?.chatgpt_account_id || payload.chatgpt_account_id || null;
  } catch {
    return null;
  }
}

// Token store com criptografia do SO (Keychain/DPAPI) — padrão do original.
class TokenStore {
  constructor(filePath, fs) {
    this.filePath = filePath;
    this.fs = fs;
  }

  async read() {
    try {
      const blob = this.fs.readFileSync(this.filePath);
      if (!safeStorage.isEncryptionAvailable()) return JSON.parse(blob.toString());
      return JSON.parse(safeStorage.decryptString(blob));
    } catch {
      return null;
    }
  }

  async write(token) {
    const plain = JSON.stringify({ ...token, stored_at: Date.now() });
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain) : Buffer.from(plain);
    this.fs.writeFileSync(this.filePath, data);
  }

  async clear() {
    this.fs.rmSync(this.filePath, { force: true });
  }
}

module.exports = { ChatGPTOAuthAdapter, TokenStore };
