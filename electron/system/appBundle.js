// Atualização leve: o código do app (pastas electron/ e dist/ + package.json)
// vem num pacote .asar de ~1 MB guardado em <userData>/app-updates. O
// executável, o Electron e os módulos nativos continuam os do instalador.
//
// Proteções:
// - só carrega pacote mais novo que o instalador e compatível com ele
//   (shellMin: versão mínima do instalador exigida pelo pacote);
// - se o pacote falhar ao abrir (erro no require ou a janela nunca chega a
//   carregar), na próxima abertura ele é descartado e volta o código do
//   instalador.
//
// Usa original-fs: o fs do Electron trata arquivos .asar como pastas.

const fs = require('original-fs');
const path = require('path');

const DIR_NAME = 'app-updates';
const CURRENT = 'current.json';
const BOOT_MARK = 'boot-attempt.json';

// "v0.4.1" -> [0, 4, 1]; inválido -> null
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

// -1, 0 ou 1; versão inválida conta como a menor possível
function compareVersions(a, b) {
  const x = parseVersion(a) || [-1, -1, -1];
  const y = parseVersion(b) || [-1, -1, -1];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

// Mesma regra do main.js: quem já usava o app com o nome OpenPerssua
// continua na pasta antiga (ver comentário lá)
function resolveUserData(app) {
  if (app.commandLine.hasSwitch('user-data-dir')) return app.getPath('userData');
  const legacy = path.join(app.getPath('appData'), 'openperssua');
  return fs.existsSync(legacy) ? legacy : app.getPath('userData');
}

function updatesDir(userData) {
  return path.join(userData, DIR_NAME);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// No Windows o .asar em uso fica travado e não dá para apagar na hora da
// troca. Na abertura seguinte, antes de carregar qualquer pacote, os antigos
// já estão livres e saem aqui.
function removeStaleBundles(dir, keep) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (/^app-[\d.]+\.asar(\.part)?$/.test(name) && name !== keep) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* tenta de novo depois */ }
    }
  }
}

// Decide qual código abrir. Devolve { bundle: caminho do .asar | null, reason }.
// Função pura sobre o disco, para dar para testar sem Electron.
function pickBundle(userData, shellVersion) {
  const dir = updatesDir(userData);
  const current = readJson(path.join(dir, CURRENT));
  if (!current) {
    removeStaleBundles(dir, null); // sobra de um pacote descartado que estava travado
    return { bundle: null, reason: 'sem atualização leve' };
  }

  const file = path.join(dir, path.basename(String(current.file || '')));
  const discard = (reason) => {
    try { fs.renameSync(path.join(dir, CURRENT), path.join(dir, `descartado-${Date.now()}.json`)); } catch { /* já foi */ }
    try { fs.rmSync(path.join(dir, BOOT_MARK), { force: true }); } catch { /* idem */ }
    removeStaleBundles(dir, null); // nenhum pacote carregado ainda: sai tudo
    return { bundle: null, reason };
  };

  if (compareVersions(current.version, shellVersion) <= 0) {
    // O instalador já é igual ou mais novo: o pacote ficou velho
    try { fs.rmSync(file, { force: true }); } catch { /* sem problema */ }
    return discard(`instalador ${shellVersion} já cobre o pacote ${current.version}`);
  }
  if (compareVersions(shellVersion, current.shellMin || '0.0.0') < 0) {
    return discard(`pacote ${current.version} pede instalador ${current.shellMin}+`);
  }
  if (!fs.existsSync(file)) return discard('arquivo do pacote sumiu');

  const mark = readJson(path.join(dir, BOOT_MARK));
  if (mark && mark.version === current.version) {
    return discard(`o pacote ${current.version} não abriu na última vez`);
  }
  removeStaleBundles(dir, path.basename(file));
  return { bundle: file, version: current.version, reason: 'ok' };
}

// Antes de carregar o pacote: se esta marca sobreviver até a próxima
// abertura, o pacote não abriu direito
function markBootAttempt(userData, version) {
  fs.mkdirSync(updatesDir(userData), { recursive: true });
  fs.writeFileSync(path.join(updatesDir(userData), BOOT_MARK), JSON.stringify({ version, at: Date.now() }));
}

// Chamado quando a janela carregou: o pacote está bom
function confirmBoot(userData) {
  try { fs.rmSync(path.join(updatesDir(userData), BOOT_MARK), { force: true }); } catch { /* nada a fazer */ }
}

// Grava um pacote já baixado e conferido e o deixa como atual. O antigo é
// apagado só depois que o novo está no lugar.
function installBundle(userData, { version, shellMin, sha512, data }) {
  const dir = updatesDir(userData);
  fs.mkdirSync(dir, { recursive: true });
  const name = `app-${parseVersion(version).join('.')}.asar`;
  const dest = path.join(dir, name);
  fs.writeFileSync(`${dest}.part`, data);
  fs.renameSync(`${dest}.part`, dest);
  const previous = readJson(path.join(dir, CURRENT));
  fs.writeFileSync(path.join(dir, CURRENT), JSON.stringify({ version, shellMin, sha512, file: name, installedAt: Date.now() }, null, 2));
  fs.rmSync(path.join(dir, BOOT_MARK), { force: true });
  if (previous?.file && previous.file !== name) {
    try { fs.rmSync(path.join(dir, path.basename(previous.file)), { force: true }); } catch { /* fica para depois */ }
  }
  return dest;
}

module.exports = {
  parseVersion, compareVersions, resolveUserData, pickBundle, markBootAttempt, confirmBoot, installBundle, updatesDir,
};
