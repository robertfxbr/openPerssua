// Empacotamento programático em 2 fases (contorna problemas do ambiente):
// 1) build target "dir" → win-unpacked SEM o whisper-bin
// 2) robocopy do whisper-bin (robocopy tem retry nativo para locks de antivírus)
// 3) build --prepackaged → instalador NSIS a partir do win-unpacked completo
const { execFileSync } = require('child_process');
const { build, Platform } = require('electron-builder');

const sharedConfig = {
  appId: 'com.teka.app',
  productName: 'Teka',
  directories: { output: 'release' },
  files: ['electron/**/*', 'dist/**/*', 'package.json'],
  asar: false,
  win: { target: 'nsis' },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'Teka',
  },
};

async function main() {
  // Fase 1: app sem whisper-bin
  console.log('fase 1: empacotando app…');
  await build({ targets: Platform.WINDOWS.createTarget(['dir']), config: sharedConfig });

  // Fase 2: whisper-bin via robocopy (/R:10 = 10 tentativas por arquivo travado)
  console.log('fase 2: copiando whisper-bin com robocopy…');
  try {
    execFileSync('robocopy', [
      'whisper-bin',
      'release\\win-unpacked\\resources\\whisper-bin',
      '/E', '/R:10', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    ], { stdio: 'inherit' });
  } catch (e) {
    // robocopy retorna código > 7 só em erro real; 0-7 são sucesso/cópias
    if (e.status > 7) throw e;
  }

  // Fase 3: NSIS a partir do diretório completo
  console.log('fase 3: gerando instalador NSIS…');
  const artifacts = await build({
    targets: Platform.WINDOWS.createTarget(['nsis']),
    prepackaged: 'release/win-unpacked',
    config: sharedConfig,
  });
  console.log('BUILD OK:', artifacts);
}

main().catch((err) => {
  console.error('BUILD FALHOU:', err.stack || err);
  process.exit(1);
});
