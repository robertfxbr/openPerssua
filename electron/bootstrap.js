// Ponto de entrada do app. Decide entre o código que veio no instalador e
// uma atualização leve já baixada e conferida (ver system/appBundle.js).
// Fica de propósito pequeno e sem dependências: se ele quebrar, nada abre.

const path = require('path');
const Module = require('module');
const { app } = require('electron');
const bundles = require('./system/appBundle');

const SHELL_VERSION = require('../package.json').version;
global.tekaShellVersion = SHELL_VERSION;
global.tekaVersion = SHELL_VERSION;
global.tekaBundle = null;

function loadBuiltin() {
  require('./main.js');
}

function start() {
  // --dev e testes sempre usam o código local
  if (process.argv.includes('--dev') || process.env.TEKA_NO_LIGHT_UPDATE === '1') return loadBuiltin();

  const userData = bundles.resolveUserData(app);
  const pick = bundles.pickBundle(userData, SHELL_VERSION);
  if (!pick.bundle) return loadBuiltin();

  // O pacote não leva node_modules: electron-log, better-sqlite3 etc. vêm do
  // instalador. Para os arquivos de dentro do pacote, o Node passa a procurar
  // também na pasta node_modules da instalação.
  // (Module.globalPaths não serve: é só uma cópia, o Node não lê ela.)
  const installModules = path.join(__dirname, '..', 'node_modules');
  const bundleRoot = path.resolve(pick.bundle) + path.sep;
  const originalNodeModulePaths = Module._nodeModulePaths;
  Module._nodeModulePaths = function nodeModulePaths(from) {
    const paths = originalNodeModulePaths.call(this, from);
    if ((path.resolve(from) + path.sep).startsWith(bundleRoot)) paths.push(installModules);
    return paths;
  };
  bundles.markBootAttempt(userData, pick.version);
  global.tekaVersion = pick.version;
  global.tekaBundle = pick.bundle;
  try {
    require(path.join(pick.bundle, 'electron', 'main.js'));
  } catch (err) {
    // Falhou já no carregamento: descarta o pacote e reabre com o instalador
    // (o electron-log ainda não existe aqui: o erro fica num arquivo ao lado)
    try {
      require('fs').writeFileSync(
        path.join(bundles.updatesDir(userData), 'ultimo-erro.txt'),
        `${new Date().toISOString()} pacote ${pick.version}\n${err?.stack || err}\n`,
      );
    } catch { /* sem onde gravar, segue o fallback */ }
    bundles.pickBundle(userData, SHELL_VERSION); // a marca de boot faz o descarte
    app.relaunch();
    app.exit(0);
  }
}

start();
