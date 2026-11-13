// Processo principal do MyPDF (Electron).
// Responsável por: janela, salvar arquivos no disco e converter documentos
// (.doc/.docx/.ppt/.pptx/...) em PDF usando o LibreOffice instalado (offline).
'use strict';

const { app, BrowserWindow, dialog, ipcMain, protocol, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST_DIR = path.join(__dirname, '..', 'dist');

// ---------------------------------------------------------------------------
// Protocolo app:// para servir a interface (evita limitações de file://)
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const { pathname } = new URL(request.url);
      let rel = decodeURIComponent(pathname);
      if (!rel || rel === '/') rel = '/index.html';
      const filePath = path.normalize(path.join(DIST_DIR, rel));
      if (!filePath.startsWith(DIST_DIR + path.sep)) {
        return new Response('Proibido', { status: 403 });
      }
      const data = await fsp.readFile(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, {
        headers: { 'content-type': type, 'content-security-policy': CSP },
      });
    } catch {
      return new Response('Não encontrado', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'MyPDF',
    backgroundColor: '#f6f7f9',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Nunca abrir janelas externas nem navegar para fora do app
  // (ex.: soltar um arquivo fora da área de soltar).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('app://');
    if (!allowed) event.preventDefault();
  });

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadURL('app://mypdf/index.html');
  }
}

// ---------------------------------------------------------------------------
// Utilidades de arquivo
// ---------------------------------------------------------------------------
function sanitizeName(name, fallback = 'arquivo.pdf') {
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return base || fallback;
}

function ensurePdfExt(name) {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

function toBuffer(bytes) {
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  throw new Error('Dados inválidos');
}

let lastSaveDir = null;
function defaultDir() {
  return lastSaveDir || app.getPath('documents');
}

// ---------------------------------------------------------------------------
// Configuração (caminho manual do LibreOffice)
// ---------------------------------------------------------------------------
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

// ---------------------------------------------------------------------------
// Localização do LibreOffice
// ---------------------------------------------------------------------------
function isExecutable(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function sofficeCandidates() {
  const list = [];
  const env = process.env;
  const pathDirs = (env.PATH || '').split(path.delimiter).filter(Boolean);

  if (process.platform === 'win32') {
    const roots = [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'];
    for (const root of roots.filter(Boolean)) {
      // soffice.com é a variante de console: espera a conversão terminar.
      list.push(path.join(root, 'LibreOffice', 'program', 'soffice.com'));
      list.push(path.join(root, 'LibreOffice', 'program', 'soffice.exe'));
    }
    for (const dir of pathDirs) {
      list.push(path.join(dir, 'soffice.com'), path.join(dir, 'soffice.exe'));
    }
  } else if (process.platform === 'darwin') {
    list.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else {
    // Linux: apt/deb, binários no PATH, /opt (pacote oficial), snap e flatpak.
    list.push('/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice', '/usr/local/bin/soffice');
    for (const dir of pathDirs) list.push(path.join(dir, 'soffice'), path.join(dir, 'libreoffice'));
    try {
      for (const d of fs.readdirSync('/opt')) {
        if (/^libreoffice/i.test(d)) list.push(path.join('/opt', d, 'program', 'soffice'));
      }
    } catch {
      /* sem /opt */
    }
    list.push('/snap/bin/libreoffice');
    list.push(path.join(os.homedir(), '.local/share/flatpak/exports/bin/org.libreoffice.LibreOffice'));
    list.push('/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice');
  }
  return [...new Set(list)];
}

function sofficeKind(p) {
  if (p.startsWith('/snap/')) return 'snap';
  if (p.includes('flatpak/exports/bin')) return 'flatpak';
  return 'native';
}

function findSoffice() {
  const cfg = readConfig();
  if (cfg.sofficePath && isExecutable(cfg.sofficePath)) {
    return { path: cfg.sofficePath, custom: true };
  }
  for (const c of sofficeCandidates()) {
    if (isExecutable(c)) return { path: c, custom: false };
  }
  return null;
}

function converterStatus() {
  const found = findSoffice();
  if (!found) return { available: false, platform: process.platform };
  return { available: true, path: found.path, custom: found.custom, kind: sofficeKind(found.path), platform: process.platform };
}

// Pastas de trabalho acessíveis pelo LibreOffice. Instalações snap/flatpak
// rodam isoladas e não enxergam /tmp nem pastas ocultas do usuário.
function workBaseFor(kind) {
  const home = os.homedir();
  if (kind === 'snap') return path.join(home, 'snap', 'libreoffice', 'common', 'mypdf');
  if (kind === 'flatpak') return path.join(home, '.var', 'app', 'org.libreoffice.LibreOffice', 'cache', 'mypdf');
  return path.join(app.getPath('userData'), 'libreoffice');
}

// ---------------------------------------------------------------------------
// Conversão (uma por vez, para não disputar o perfil do LibreOffice)
// ---------------------------------------------------------------------------
const CONVERTIBLE = new Set(['.doc', '.docx', '.ppt', '.pptx', '.pps', '.ppsx', '.odt', '.odp', '.rtf']);
let convertQueue = Promise.resolve();

function enqueue(task) {
  const run = convertQueue.then(task, task);
  convertQueue = run.catch(() => {});
  return run;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function waitForFile(p, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const st = await fsp.stat(p);
      if (st.size > 0) return true;
    } catch {
      /* ainda não existe */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function convertToPdf(originalName, bytes) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!CONVERTIBLE.has(ext)) {
    throw new Error(`Formato não suportado para conversão: ${ext || '(sem extensão)'}`);
  }
  const found = findSoffice();
  if (!found) {
    throw new Error('LibreOffice não encontrado. Instale o LibreOffice (gratuito) para converter documentos.');
  }

  const kind = sofficeKind(found.path);
  const base = workBaseFor(kind);
  const profileDir = path.join(base, 'perfil');
  const jobDir = path.join(base, 'trabalho', crypto.randomUUID());
  const outDir = path.join(jobDir, 'saida');
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.mkdir(profileDir, { recursive: true });

  const inputPath = path.join(jobDir, `documento${ext}`);
  const outputPath = path.join(outDir, 'documento.pdf');

  try {
    await fsp.writeFile(inputPath, toBuffer(bytes));
    const args = [
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--headless',
      '--invisible',
      '--nologo',
      '--nodefault',
      '--norestore',
      '--nolockcheck',
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      inputPath,
    ];
    let stderr = '';
    try {
      const res = await run(found.path, args, 180_000);
      stderr = res.stderr || '';
    } catch (err) {
      if (err.killed) throw new Error('A conversão demorou demais e foi cancelada.');
      stderr = err.stderr || err.message || '';
    }
    // No Windows o soffice.exe pode retornar antes de gravar o arquivo.
    const ok = await waitForFile(outputPath, 15_000);
    if (!ok) {
      const detail = String(stderr).trim().split('\n').slice(-3).join(' ');
      throw new Error(`O LibreOffice não conseguiu converter o arquivo.${detail ? ` Detalhe: ${detail}` : ''}`);
    }
    const pdf = await fsp.readFile(outputPath);
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  } finally {
    fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('file:save', async (_e, suggestedName, bytes) => {
    const name = ensurePdfExt(sanitizeName(suggestedName));
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar PDF',
      defaultPath: path.join(defaultDir(), name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return null;
    const finalPath = ensurePdfExt(filePath);
    await fsp.writeFile(finalPath, toBuffer(bytes));
    lastSaveDir = path.dirname(finalPath);
    return finalPath;
  });

  ipcMain.handle('file:saveMany', async (_e, files) => {
    if (!Array.isArray(files) || files.length === 0) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: `Escolha a pasta para salvar ${files.length} arquivo(s)`,
      defaultPath: defaultDir(),
      buttonLabel: 'Salvar aqui',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths || !filePaths[0]) return null;
    const dir = filePaths[0];
    let first = null;
    for (const f of files) {
      const target = await uniquePath(dir, ensurePdfExt(sanitizeName(f.name)));
      await fsp.writeFile(target, toBuffer(f.bytes));
      if (!first) first = target;
    }
    lastSaveDir = dir;
    return { folder: dir, firstFile: first };
  });

  ipcMain.handle('file:showInFolder', (_e, p) => {
    if (typeof p === 'string' && fs.existsSync(p)) {
      if (fs.statSync(p).isDirectory()) shell.openPath(p);
      else shell.showItemInFolder(p);
    }
  });

  ipcMain.handle('convert:status', () => converterStatus());

  ipcMain.handle('convert:pick', async () => {
    const isWin = process.platform === 'win32';
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Localize o executável do LibreOffice (soffice)',
      defaultPath: isWin ? 'C:\\Program Files\\LibreOffice\\program' : '/usr/bin',
      properties: ['openFile'],
      filters: isWin ? [{ name: 'soffice', extensions: ['exe', 'com'] }] : undefined,
    });
    if (!canceled && filePaths && filePaths[0]) {
      const cfg = readConfig();
      cfg.sofficePath = filePaths[0];
      writeConfig(cfg);
    }
    return converterStatus();
  });

  ipcMain.handle('convert:download', () => shell.openExternal('https://www.libreoffice.org/download/download-libreoffice/'));

  ipcMain.handle('convert:toPdf', (_e, name, bytes) => enqueue(() => convertToPdf(name, bytes)));
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (!DEV_URL) {
      registerAppProtocol();
      Menu.setApplicationMenu(null);
    }
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
