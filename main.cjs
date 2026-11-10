const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
let window;
// A software-rendered UI avoids startup failures seen with the Windows GPU driver.
if (process.platform === 'win32') app.disableHardwareAcceleration();
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
});
const allowedAudio = new Set();
const isAudio = file => /\.(mp3|wav|ogg|flac|m4a)$/i.test(file);
const audioDescriptor = file => ({ path: file, name: path.basename(file) });

if (primaryInstance) app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1440, height: 950, minWidth: 950, minHeight: 650,
    backgroundColor: '#101218', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'warning', buttons: ['Offen lassen', 'Programm schliessen'], defaultId: 0, cancelId: 0, title: 'Vorstellung aktiv', message: 'Das Soundboard ist im Vorstellungsmodus oder spielt Audio. Wirklich schliessen?' });
    if (choice === 1) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('audio:pick', async () => {
  const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }] });
  if (result.canceled) return [];
  result.filePaths.forEach(file => allowedAudio.add(file));
  return result.filePaths.map(audioDescriptor);
});
ipcMain.handle('audio:read', async (_, file) => {
  if (!allowedAudio.has(file)) throw new Error('Audiodatei ist nicht freigegeben. Bitte erneut zuordnen.');
  return await fs.readFile(file);
});
ipcMain.handle('audio:check', async (_, file) => {
  if (!allowedAudio.has(file)) throw new Error('Audiodatei ist nicht freigegeben.');
  const info = await fs.stat(file);
  if (!info.isFile() || !info.size) throw new Error('Audiodatei fehlt oder ist leer.');
  await fs.access(file, require('node:fs').constants.R_OK);
  return true;
});
ipcMain.handle('project:save', async (_, project, portable) => {
  if (!Array.isArray(project?.cues)) throw new Error('Ungueltiges Projekt.');
  if (portable) for (const cue of project.cues) {
    if (!cue.path || !allowedAudio.has(path.resolve(cue.path))) throw new Error('Audio fehlt oder ist nicht freigegeben: ' + cue.title);
    await fs.access(path.resolve(cue.path));
  }
  const result = await dialog.showSaveDialog(window, { title: portable ? 'Projekt mit Audiodateien exportieren' : 'Projekt speichern', defaultPath: 'Auffuehrung.theater.json', filters: [{ name: 'Theaterprojekt', extensions: ['json'] }] });
  if (result.canceled) return null;
  const directory = path.dirname(result.filePath);
  const copy = structuredClone(project);
  if (!Array.isArray(copy.cues)) throw new Error('Ungültiges Projekt.');
  const assetFolder = path.basename(result.filePath, '.json') + '-audio-' + require('node:crypto').randomUUID().slice(0, 8);
  for (const [index, cue] of copy.cues.entries()) {
    if (!cue.path) continue;
    const source = path.resolve(cue.path);
    if (!allowedAudio.has(source)) throw new Error('Audiodatei ist nicht freigegeben: ' + cue.title);
    if (portable) {
      await fs.mkdir(path.join(directory, assetFolder), { recursive: true });
      const name = String(index + 1).padStart(3, '0') + '-' + path.basename(source);
      const target = path.join(directory, assetFolder, name);
      if (source !== target) await fs.copyFile(source, target);
      cue.path = path.posix.join(assetFolder, name);
    } else cue.path = path.relative(directory, source).split(path.sep).join('/');
  }
  const temporary = result.filePath + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(copy, null, 2), 'utf8');
  await fs.rename(temporary, result.filePath);
  return result.filePath;
});
ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Theaterprojekt', extensions: ['json'] }] });
  if (result.canceled) return null;
  const filename = result.filePaths[0];
  const project = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (project.version !== 1 || !Array.isArray(project.cues) || project.cues.length > 1000) throw new Error('Ungültiges Projektformat.');
  for (const cue of project.cues) {
    if (typeof cue.path === 'string' && cue.path) {
      cue.path = path.resolve(path.dirname(filename), cue.path.replace(/\\/g, '/'));
      if (!isAudio(cue.path)) throw new Error('Ungültige Audiodatei im Projekt.');
      allowedAudio.add(cue.path);
    }
  }
  return project;
});
ipcMain.handle('draft:save', async (_, draft) => {
  await fs.writeFile(path.join(app.getPath('userData'), 'draft.json'), JSON.stringify(draft), 'utf8');
});
ipcMain.handle('draft:load', async () => {
  try {
    const draft = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'draft.json'), 'utf8'));
    if (draft.version !== 1 || !Array.isArray(draft.cues)) return null;
    for (const cue of draft.cues) if (typeof cue.path === 'string' && isAudio(cue.path)) allowedAudio.add(cue.path);
    return draft;
  } catch { return null; }
});
