import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileSessionStore, atomicWrite } from './store.mjs';
import { parseSession, sessionCsv, sessionColumns, sessionRecords, csvTable } from '../dist-desktop/session.js';

app.setName('Ainogo');
const dataRoot = process.env.AINOGO_DATA_DIR
  ? resolve(process.env.AINOGO_DATA_DIR) : join(app.getPath('appData'), 'Ainogo');
app.setPath('userData', dataRoot);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window;
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    let store;
    try { store = new FileSessionStore(join(dataRoot, 'sessions'), parseSession, { sessionColumns, sessionRecords, csvTable }); }
    catch (error) { dialog.showErrorBox('Cannot open session data folder', error.message); app.quit(); }
    if (store) {
      const entry = join(app.getAppPath(), 'dist-desktop', 'ui', 'index.html');
      const entryUrl = pathToFileURL(entry).href;
      window = new BrowserWindow({ width: 1040, height: 900, minWidth: 480, minHeight: 500, show: false,
        autoHideMenuBar: true,
        webPreferences: { preload: join(app.getAppPath(), 'desktop', 'preload.cjs'),
          contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (url !== entryUrl) event.preventDefault(); });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
      const verify = event => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entryUrl) {
          throw new Error('Untrusted session request.');
        }
      };
      const fail = error => ({ ok: false, message: error.message, code: error.code ?? 'STORAGE_ERROR' });
      for (const [channel, operation] of [
        ['sessions:list', () => store.listKeys()],
        ['sessions:get', key => store.getItem(key)],
        ['sessions:save', (key, raw) => store.setItem(key, raw)],
        ['sessions:info', () => store.info()],
      ]) {
        ipcMain.on(channel, (event, ...args) => {
          try { verify(event); event.returnValue = { ok: true, value: operation(...args) }; }
          catch (error) { event.returnValue = fail(error); }
        });
      }
      ipcMain.handle('sessions:export', async (event, raw) => {
        try {
          verify(event);
          if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Invalid export.');
          const session = parseSession(raw);
          if (!session) throw new Error('Session validation failed.');
          const result = await dialog.showSaveDialog(window, {
            title: `Export CSV — session ${session.sessionId} only`, defaultPath: join(app.getPath('documents'), `ainogo-${session.sessionId}.csv`),
            filters: [{ name: 'CSV file', extensions: ['csv'] }],
          });
          if (result.canceled || !result.filePath) return { ok: true, value: { canceled: true } };
          atomicWrite(result.filePath, sessionCsv(session));
          return { ok: true, value: { canceled: false } };
        } catch (error) { return fail(error); }
      });
      ipcMain.handle('sessions:open-folder', async event => {
        try { verify(event); const error = await shell.openPath(store.collection?.directory ?? store.directory); if (error) throw new Error(error); return { ok: true }; }
        catch (error) { return fail(error); }
      });
      window.once('ready-to-show', () => window.show());
      await window.loadFile(entry);
      app.on('window-all-closed', () => app.quit());
    }
  }).catch(error => { dialog.showErrorBox('Ainogo could not start', error.message); app.quit(); });
}
