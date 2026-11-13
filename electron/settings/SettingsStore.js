// Settings persistidas em JSON simples (o original usa um store próprio com
// sync via localStorage + canais `settings:*`; aqui, arquivo único).
//
// Chaves terminadas em "apiKey" são segredos: ficam cifradas com o
// safeStorage do sistema (DPAPI no Windows) quando ele está disponível, e
// nunca voltam em texto puro para a tela.

const fs = require('fs');
const path = require('path');

const MASK = '••••••';
const isSecret = (key) => typeof key === 'string' && key.endsWith('apiKey');

// Fora do Electron (testes com ELECTRON_RUN_AS_NODE) não há safeStorage
function getSafeStorage() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
  } catch {
    return null;
  }
}

class SettingsStore {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'settings.json');
    this.cache = null;
  }

  load() {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  async get(key) {
    const value = this.load()[key];
    if (isSecret(key) && value && typeof value === 'object' && value.enc) {
      const safe = getSafeStorage();
      if (!safe) return '';
      try {
        return safe.decryptString(Buffer.from(value.enc, 'base64'));
      } catch {
        return ''; // cifrado em outro usuário/máquina: trata como ausente
      }
    }
    return value;
  }

  async set(key, value) {
    let stored = value;
    if (isSecret(key) && typeof value === 'string') {
      const trimmed = value.trim();
      const safe = getSafeStorage();
      stored = trimmed && safe ? { enc: safe.encryptString(trimmed).toString('base64') } : trimmed;
    }
    this.load()[key] = stored;
    fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
  }

  async delete(key) {
    delete this.load()[key];
    fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
  }

  // Valor para a tela: segredo vira só "tem / não tem"
  async getForRenderer(key) {
    if (!isSecret(key)) return this.get(key);
    return (await this.get(key)) ? MASK : '';
  }

  async getAll() {
    // Nunca vaza segredos para a tela: mascara valores de chaves API
    const all = { ...this.load() };
    for (const k of Object.keys(all)) {
      if (isSecret(k)) all[k] = all[k] ? MASK : '';
    }
    return all;
  }
}

module.exports = { SettingsStore, isSecret, MASK };
