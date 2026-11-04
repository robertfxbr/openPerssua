// Settings persistidas em JSON simples (o original usa um store próprio com
// sync via localStorage + canais `settings:*`; aqui, arquivo único).

const fs = require('fs');
const path = require('path');

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
    return this.load()[key];
  }

  async set(key, value) {
    this.load()[key] = value;
    fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
  }

  async getAll() {
    // Nunca vaza segredos para a tela: mascara valores de chaves API
    const all = { ...this.load() };
    for (const k of Object.keys(all)) {
      if (k.endsWith('apiKey') && typeof all[k] === 'string') all[k] = all[k] ? '••••••' : '';
    }
    return all;
  }
}

module.exports = { SettingsStore };
