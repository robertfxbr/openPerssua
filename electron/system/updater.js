// Atualização pelo GitHub Releases do projeto.
//
// Dois caminhos:
// - leve (o normal): a release traz teka-update.json + teka-app-<versão>.asar,
//   só com o código do app (~1 MB). Baixa, confere o SHA-512 do json, guarda
//   em <userData>/app-updates e reinicia. Nada de instalador. Ver appBundle.js.
// - instalador: quando a release mexe no Electron ou num módulo nativo, o
//   json pede um instalador mínimo (shellMin) maior que o atual. Aí baixa o
//   Setup .exe e confere o SHA-512 contra o latest.yml do electron-builder.
//   O instalador não é assinado, então quem decide rodar é sempre o usuário.
// Sem arquivo verificável, só oferecemos abrir a página da release.

const { app, shell } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bundles = require('./appBundle');

const REPO = 'robertfxbr/openPerssua';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const LIGHT_MANIFEST = 'teka-update.json';
const MAX_LIGHT_BYTES = 50 * 1024 * 1024; // pacote leve real tem ~1 MB

// Versão em uso (a do pacote leve, se houver) e a do instalador.
// Os globais vêm do bootstrap.js; sem ele (testes), vale a do package.json.
function currentVersion() { return global.tekaVersion || app.getVersion(); }
function shellVersion() { return global.tekaShellVersion || app.getVersion(); }

const parseVersion = bundles.parseVersion;
function isNewer(remote, local) {
  if (!parseVersion(remote) || !parseVersion(local)) return false;
  return bundles.compareVersions(remote, local) > 0;
}

// latest.yml do electron-builder: pega o sha512 do arquivo principal
function parseLatestYml(text) {
  const pathMatch = text.match(/^path:\s*(.+)$/m);
  const shaMatch = text.match(/^sha512:\s*(\S+)$/m);
  if (!pathMatch || !shaMatch) return null;
  return { path: pathMatch[1].trim().replace(/^['"]|['"]$/g, ''), sha512: shaMatch[1].trim() };
}

// teka-update.json: confere cada campo antes de confiar
function parseLightManifest(data, releaseVersion) {
  if (!data || typeof data !== 'object') return null;
  const { version, shellMin, file, sha512, size } = data;
  if (!parseVersion(version) || bundles.compareVersions(version, releaseVersion) !== 0) return null;
  if (!parseVersion(shellMin)) return null;
  if (typeof file !== 'string' || !/^teka-app-[\d.]+\.asar$/.test(file)) return null;
  if (typeof sha512 !== 'string' || !/^[A-Za-z0-9+/]{80,100}={0,2}$/.test(sha512)) return null;
  const bytes = Number(size) || 0;
  if (bytes > MAX_LIGHT_BYTES) return null;
  return { version, shellMin, file, sha512, size: bytes };
}

let lastRelease = null; // resultado do último check, usado pelo download

const safeUrl = (a) => (a && String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX) ? a.browser_download_url : null);

async function fetchLightManifest(assets, version) {
  const json = assets.find((a) => a.name === LIGHT_MANIFEST);
  if (!safeUrl(json)) return null;
  try {
    const res = await fetch(safeUrl(json), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const manifest = parseLightManifest(await res.json(), version);
    if (!manifest) return null;
    const asar = assets.find((a) => a.name === manifest.file);
    if (!safeUrl(asar)) return null;
    return { ...manifest, url: safeUrl(asar) };
  } catch {
    return null; // sem pacote leve: cai no instalador
  }
}

async function checkForUpdate() {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Teka-updater' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return { available: false, current: currentVersion(), note: 'nenhuma release publicada ainda' };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const available = isNewer(version, currentVersion());

  const exe = assets.find((a) => /\.exe$/i.test(a.name) && /setup/i.test(a.name));
  const yml = assets.find((a) => a.name === 'latest.yml');
  const light = available ? await fetchLightManifest(assets, version) : null;
  // O pacote leve só serve se o instalador atual é novo o bastante para ele
  const lightOk = Boolean(light && bundles.compareVersions(shellVersion(), light.shellMin) >= 0);
  const installerOk = process.platform === 'win32' && Boolean(safeUrl(exe) && safeUrl(yml));

  lastRelease = {
    version,
    light: lightOk ? light : null,
    exeUrl: safeUrl(exe),
    exeName: exe?.name || null,
    exeSize: exe?.size || 0,
    ymlUrl: safeUrl(yml),
  };
  return {
    available,
    current: currentVersion(),
    version,
    notes: String(rel.body || '').slice(0, 2000),
    pageUrl: String(rel.html_url || RELEASES_PAGE).startsWith('https://github.com/') ? rel.html_url : RELEASES_PAGE,
    mode: lightOk ? 'light' : installerOk ? 'installer' : null,
    size: lightOk ? light.size : (exe?.size || 0),
    // pacote leve existe mas pede instalador mais novo
    needsInstaller: Boolean(light && !lightOk),
    canInstall: lightOk || installerOk,
  };
}

// Baixa a URL inteira, conta o progresso e devolve o SHA-512 (base64).
// toFile: grava em disco; sem ele, devolve os bytes em memória.
async function download(url, { total, onProgress, toFile, maxBytes }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  const size = Number(res.headers.get('content-length')) || total || 0;
  if (maxBytes && size > maxBytes) throw new Error('arquivo maior que o esperado');
  const hash = crypto.createHash('sha512');
  const out = toFile ? fs.createWriteStream(toFile) : null;
  const chunks = [];
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (maxBytes && received > maxBytes) throw new Error('arquivo maior que o esperado');
      hash.update(value);
      if (out) out.write(value); else chunks.push(Buffer.from(value));
      if (onProgress && size) onProgress({ received, total: size });
    }
  } finally {
    if (out) await new Promise((r) => out.end(r));
  }
  return { sha512: hash.digest('base64'), data: out ? null : Buffer.concat(chunks) };
}

async function downloadLight(rel, onProgress) {
  const { light } = rel;
  const got = await download(light.url, { total: light.size, onProgress, maxBytes: MAX_LIGHT_BYTES });
  if (got.sha512 !== light.sha512) throw new Error('o pacote baixado não confere com o hash da release; nada foi trocado');
  bundles.installBundle(app.getPath('userData'), {
    version: light.version, shellMin: light.shellMin, sha512: light.sha512, data: got.data,
  });
  return { ok: true, mode: 'light', version: light.version };
}

async function downloadInstaller(rel, onProgress) {
  if (!rel.exeUrl || !rel.ymlUrl) throw new Error('esta release não tem instalador verificável; use "abrir página"');
  const ymlRes = await fetch(rel.ymlUrl, { signal: AbortSignal.timeout(15000) });
  if (!ymlRes.ok) throw new Error(`latest.yml: HTTP ${ymlRes.status}`);
  const meta = parseLatestYml(await ymlRes.text());
  if (!meta) throw new Error('latest.yml sem hash do instalador');

  const dir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  const safeName = path.basename(rel.exeName).replace(/[^\w .-]/g, '_');
  const dest = path.join(dir, safeName);
  const tmp = `${dest}.part`;
  const got = await download(rel.exeUrl, { total: rel.exeSize, onProgress, toFile: tmp });
  if (got.sha512 !== meta.sha512) {
    fs.rmSync(tmp, { force: true });
    throw new Error('o arquivo baixado não confere com o hash da release; nada foi instalado');
  }
  fs.renameSync(tmp, dest);
  return { ok: true, mode: 'installer', file: dest, version: rel.version };
}

async function downloadUpdate(onProgress) {
  const rel = lastRelease;
  if (!rel) throw new Error('verifique as atualizações antes de baixar');
  if (!isNewer(rel.version, currentVersion())) throw new Error('já está na versão mais recente');
  return rel.light ? downloadLight(rel, onProgress) : downloadInstaller(rel, onProgress);
}

// Pacote leve: só reinicia, o bootstrap abre a versão nova.
// Instalador: só aceita o que o próprio downloadUpdate deixou na pasta.
function installUpdate(file) {
  if (file === 'light') {
    app.relaunch();
    setTimeout(() => app.quit(), 200);
    return { ok: true };
  }
  const dir = path.join(app.getPath('userData'), 'updates');
  const resolved = path.resolve(String(file || ''));
  if (path.dirname(resolved) !== dir || !fs.existsSync(resolved)) {
    return { ok: false, error: 'instalador não encontrado; baixe de novo' };
  }
  spawn(resolved, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 500);
  return { ok: true };
}

function openReleasesPage(url) {
  const target = typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`) ? url : RELEASES_PAGE;
  shell.openExternal(target);
  return { ok: true };
}

// Para a aba "sistema": de onde veio o código que está rodando
function versionInfo() {
  return {
    version: currentVersion(),
    shellVersion: shellVersion(),
    light: Boolean(global.tekaBundle),
  };
}

module.exports = {
  checkForUpdate, downloadUpdate, installUpdate, openReleasesPage, versionInfo,
  isNewer, parseLatestYml, parseLightManifest,
};
