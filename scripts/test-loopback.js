// Teste E2E do loopback de áudio do sistema, rodando dentro do Electron:
//   Teka.exe scripts/test-loopback.js
// 1. Toca samples/jfk.wav pelos alto-falantes (SoundPlayer do Windows)
// 2. Captura o áudio do SISTEMA via electron-audio-loopback (getDisplayMedia)
// 3. Grava 12s em loopback-capture.wav
// 4. Transcreve com whisper-cli e grava o texto em loopback-result.txt

const { app, BrowserWindow, ipcMain } = require('electron');
const { initMain: initAudioLoopback } = require('electron-audio-loopback');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

initAudioLoopback();

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'scripts', 'jfk.wav');
const OUT_WAV = path.join(ROOT, 'scripts', 'loopback-capture.wav');
const OUT_TXT = path.join(ROOT, 'scripts', 'loopback-result.txt');
const RECORD_MS = 12000;

const RENDERER_JS = `
  const { ipcRenderer } = require('electron');
  async function main() {
    await ipcRenderer.invoke('enable-loopback-audio');
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } finally {
      await ipcRenderer.invoke('disable-loopback-audio').catch(() => {});
    }
    stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return { error: 'sem track de áudio no loopback' };

    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    src.connect(proc); proc.connect(ctx.destination);
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    await new Promise((r) => setTimeout(r, ${RECORD_MS}));
    proc.disconnect(); ctx.close(); stream.getTracks().forEach((t) => t.stop());

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Int16Array(total);
    let off = 0, peak = 0;
    for (const c of chunks) for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      if (Math.abs(s) > peak) peak = Math.abs(s);
      pcm[off++] = s * 32767;
    }
    return { pcm: pcm.buffer, peak, seconds: total / 16000 };
  }
  main();
`;

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, 'test-loopback.html'));
  await new Promise((r) => win.webContents.once('did-finish-load', r));

  // Toca o áudio de teste pelos alto-falantes 1s antes da captura começar
  setTimeout(() => {
    spawn('powershell', ['-NoProfile', '-Command',
      `(New-Object Media.SoundPlayer '${SAMPLE.replace(/'/g, "''")}').PlaySync()`]);
  }, 1000);

  try {
    const result = await win.webContents.executeJavaScript(RENDERER_JS, true);
    if (result?.error) {
      fs.writeFileSync(OUT_TXT, `ERRO: ${result.error}`);
      app.exit(1);
    }
    const pcm = Buffer.from(result.pcm);
    fs.writeFileSync(OUT_WAV, pcmToWav(pcm, 16000));
    fs.writeFileSync(OUT_TXT, JSON.stringify({ peak: result.peak, seconds: result.seconds }));
  } catch (err) {
    fs.writeFileSync(OUT_TXT, `ERRO: ${err.message || err}`);
    app.exit(1);
  }
  win.destroy();
  app.exit(0);
});
