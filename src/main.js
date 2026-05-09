const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const fetch = require('node-fetch');

// ─── Load app settings BEFORE ready (hardware accel must be set early) ────────
const SETTINGS_FILE_PATH = path.join(
  process.env.APPDATA || os.homedir(),
  'wallpaper-studio',
  'app-settings.json'
);

function loadAppSettingsSync() {
  try {
    const dir = path.dirname(SETTINGS_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
    }
  } catch {}
  return { hardwareAcceleration: false, theme: 'dark', accentColor: '#6366f1', minimizeToTray: false, startWithWindows: false };
}

function saveAppSettingsSync(settings) {
  try {
    const dir = path.dirname(SETTINGS_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save app settings:', e);
  }
}

const appSettings = loadAppSettingsSync();

// Apply hardware acceleration BEFORE app ready
if (!appSettings.hardwareAcceleration) {
  app.disableHardwareAcceleration();
}

// ─── Unsplash API key ─────────────────────────────────────────────────────────
// For `npm start` (dev): read from the shell environment variable directly.
// For `npm run build` (packaged exe): the "prebuild" script (scripts/inject-env.js)
//   reads the env var and writes it to src/build-config.json, which gets bundled
//   into the asar. process.env is NOT available in a packaged exe, so we must
//   read the embedded file instead.
let UNSPLASH_ACCESS_KEY = '';
try {
  const buildConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-config.json'), 'utf8'));
  UNSPLASH_ACCESS_KEY = buildConfig.unsplashKey || '';
} catch {
  // build-config.json not present → development mode, fall back to env var
  UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const DEFAULT_WALLPAPER_DIR = path.join(app.getPath('userData'), 'wallpapers');
const CONFIG_FILE = path.join(app.getPath('userData'), 'wallpaper-config.json');
const DB_PATH = path.join(DEFAULT_WALLPAPER_DIR, 'db.json');
const ALBUMS_FILE = path.join(app.getPath('userData'), 'albums.json');

// ─── Albums helpers ───────────────────────────────────────────────────────────
async function ensureAlbums() {
  try { await fsp.access(ALBUMS_FILE); } catch {
    await fsp.writeFile(ALBUMS_FILE, JSON.stringify({ albums: [], currentAlbumId: null }, null, 2), 'utf8');
  }
}
async function loadAlbums() {
  try { return JSON.parse(await fsp.readFile(ALBUMS_FILE, 'utf8')); } catch { return { albums: [], currentAlbumId: null }; }
}
async function saveAlbums(obj) { await fsp.writeFile(ALBUMS_FILE, JSON.stringify(obj, null, 2), 'utf8'); }
async function getCurrentAlbum() {
  const alb = await loadAlbums();
  return (alb.albums || []).find(x => x.id === alb.currentAlbumId) || null;
}
async function setCurrentAlbum(albumId) { const alb = await loadAlbums(); alb.currentAlbumId = albumId; await saveAlbums(alb); }
async function addAlbum(name, folderPath) {
  const alb = await loadAlbums();
  const newId = 'alb_' + Date.now();
  alb.albums = alb.albums || [];
  alb.albums.push({ id: newId, name, folder: folderPath, createdAt: Date.now() });
  alb.currentAlbumId = newId;
  await saveAlbums(alb);
  const added = await scanWallpapersInFolder(folderPath, newId);
  console.log(`Scanned ${added} images for new album`);
  return { id: newId, name, folder: folderPath };
}

// ─── Windows ──────────────────────────────────────────────────────────────────
let mainWindow;
let slideshowTimer = null, slideshowIndex = 0, slideshowIntervalMs = 6000;

// ─── Config/Storage helpers ───────────────────────────────────────────────────
async function ensureConfig() {
  try { await fsp.access(CONFIG_FILE); } catch {
    await fsp.mkdir(app.getPath('userData'), { recursive: true }).catch(() => {});
    await fsp.writeFile(CONFIG_FILE, JSON.stringify({ storageDir: DEFAULT_WALLPAPER_DIR }, null, 2), 'utf8');
  }
}
async function getStorageDir() {
  await ensureConfig();
  try {
    const cfg = JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8'));
    const dir = cfg.storageDir || DEFAULT_WALLPAPER_DIR;
    await fsp.mkdir(dir, { recursive: true }).catch(() => {});
    return dir;
  } catch { return DEFAULT_WALLPAPER_DIR; }
}
async function setStorageDir(dir) {
  await ensureConfig();
  let cfg = {};
  try { cfg = JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8')); } catch {}
  cfg.storageDir = dir;
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
async function ensureDataDir() { const dir = await getStorageDir(); await fsp.mkdir(dir, { recursive: true }).catch(() => {}); }

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function loadDB() {
  try {
    const data = await fsp.readFile(DB_PATH, 'utf8');
    const json = JSON.parse(data);
    if (Array.isArray(json.wallpapers)) return json;
  } catch {}
  return { wallpapers: [], settings: {} };
}
async function saveDB(db) { await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8'); }

async function scanWallpapersInFolder(folderPath, albumId) {
  const db = await loadDB();
  const files = await fsp.readdir(folderPath).catch(() => []);
  const images = files.filter(n => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(n));
  const existingPaths = new Set((db.wallpapers || []).filter(w => w.albumId === albumId).map(w => w.path));
  let added = 0;
  for (const name of images) {
    const fullPath = path.join(folderPath, name);
    if (!existingPaths.has(fullPath)) {
      db.wallpapers = db.wallpapers || [];
      db.wallpapers.push({ id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), path: fullPath, name, favorite: false, addedAt: Date.now(), albumId });
      added++;
    }
  }
  if (added > 0) await saveDB(db);
  return added;
}

async function addWallpaperFromPath(srcPath, albumIdArg) {
  await ensureDataDir();
  const ext = path.extname(srcPath) || '.jpg';
  const base = 'wallpaper_' + Date.now() + ext;
  const albums = await loadAlbums();
  let albumId = albumIdArg, folderDir = DEFAULT_WALLPAPER_DIR;
  if (albumId) {
    const a = (albums.albums || []).find(x => x.id === albumId);
    if (a && a.folder) folderDir = a.folder;
  } else {
    const current = await getCurrentAlbum();
    albumId = current ? current.id : null;
    if (current && current.folder) folderDir = current.folder;
  }
  const dest = path.join(folderDir, base);
  await fsp.copyFile(srcPath, dest);
  const db = await loadDB();
  const entry = { id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), path: dest, name: base, favorite: false, addedAt: Date.now(), albumId };
  db.wallpapers.push(entry);
  await saveDB(db);
  return entry;
}

// ─── Windows 11 wallpaper fix ─────────────────────────────────────────────────
// The wallpaper npm package v3 fails silently on Windows 11 due to a SystemParametersInfo
// timing issue. We bypass it entirely and call the Win32 API directly via PowerShell.
async function setAsWallpaper(filePath) {
  if (process.platform !== 'win32') {
    try { const wp = require('wallpaper'); await wp.set(filePath); } catch (e) { console.error('Wallpaper set failed:', e); }
    return;
  }

  const normalizedPath = path.resolve(filePath).replace(/\//g, '\\');

  // Primary: P/Invoke SystemParametersInfo via PowerShell inline C#
  const psScript = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WallpaperHelper {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfo(uint uAction, uint uParam, string lpvParam, uint fuWinIni);
  public const uint SPI_SETDESKWALLPAPER = 0x0014;
  public const uint SPIF_UPDATEINIFILE = 0x0001;
  public const uint SPIF_SENDCHANGE = 0x0002;
}
'@
[WallpaperHelper]::SystemParametersInfo([WallpaperHelper]::SPI_SETDESKWALLPAPER, 0, '${normalizedPath.replace(/'/g, "''")}', [WallpaperHelper]::SPIF_UPDATEINIFILE -bor [WallpaperHelper]::SPIF_SENDCHANGE)`;

  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript], { timeout: 12000 });
    let stderr = '';
    ps.stderr.on('data', d => { stderr += d.toString(); });
    ps.on('close', (code) => {
      if (code !== 0) {
        console.error('PowerShell wallpaper failed, trying registry fallback. stderr:', stderr);
        // Fallback: registry + RUNDLL32
        const { exec } = require('child_process');
        exec(
          `reg add "HKCU\\Control Panel\\Desktop" /v Wallpaper /t REG_SZ /d "${normalizedPath}" /f && RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters 1, True`,
          { timeout: 8000 },
          (err) => {
            if (err) console.error('Registry fallback also failed:', err);
            else console.log('Wallpaper set via registry fallback');
            resolve();
          }
        );
      } else {
        console.log('Wallpaper set via P/Invoke:', normalizedPath);
        resolve();
      }
    });
    ps.on('error', () => resolve()); // never reject — worst case wallpaper just doesn't change
  });
}

async function toggleFavorite(id) {
  const db = await loadDB();
  const w = db.wallpapers.find(x => x.id === id);
  if (w) { w.favorite = !w.favorite; await saveDB(db); }
  return w ? w.favorite : null;
}

let slideshowAlbumId = null; // album currently being slideshowed (null = all)

function stopSlideshow() { if (slideshowTimer) { clearInterval(slideshowTimer); slideshowTimer = null; } }

async function startSlideshow(intervalMs, albumId) {
  stopSlideshow();
  slideshowIntervalMs = intervalMs || 6000;
  slideshowAlbumId = albumId || null;
  const db = await loadDB();
  const initialArr = slideshowAlbumId
    ? (db.wallpapers || []).filter(w => w.albumId === slideshowAlbumId)
    : (db.wallpapers || []);
  if (!initialArr.length) return;
  slideshowIndex = 0;
  slideshowTimer = setInterval(async () => {
    const list = await loadDB();
    const arr = slideshowAlbumId
      ? (list.wallpapers || []).filter(w => w.albumId === slideshowAlbumId)
      : (list.wallpapers || []);
    if (!arr.length) return;
    const w = arr[slideshowIndex % arr.length];
    if (w?.path) await setAsWallpaper(w.path);
    slideshowIndex = (slideshowIndex + 1) % arr.length;
  }, slideshowIntervalMs);
}

async function syncFromStorageDir() {
  const dir = await getStorageDir();
  const db = await loadDB();
  const files = await fsp.readdir(dir).catch(() => []);
  const images = files.filter(n => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(n));
  const existing = new Set((db.wallpapers || []).map(w => w.path));
  let added = 0;
  for (const name of images) {
    const fullPath = path.join(dir, name);
    if (!existing.has(fullPath)) {
      db.wallpapers = db.wallpapers || [];
      db.wallpapers.push({ id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), path: fullPath, name, favorite: false, addedAt: Date.now() });
      added++;
    }
  }
  if (added > 0) await saveDB(db);
  return added;
}

async function fileExists(filePath) {
  try { await fsp.access(filePath, fs.constants.F_OK); return true; } catch { return false; }
}

async function pruneDbEntries() {
  try {
    const db = await loadDB();
    if (!db.wallpapers?.length) return;
    const kept = [];
    for (const w of db.wallpapers) { if (w?.path && await fileExists(w.path)) kept.push(w); }
    if (kept.length !== db.wallpapers.length) { db.wallpapers = kept; await saveDB(db); }
  } catch (err) { console.error('Error pruning DB:', err); }
}

// ─── Create main window ───────────────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(null);
  const iconPath = path.join(__dirname, '..', 'icon.png');

  // Match window background to saved theme so the native frame never shows a
  // white or mismatched colour while the renderer is loading.
  // This also fixes the blank-frame flash caused by the GPU process crashing
  // and restarting (exit_code=-1073740791): show:false keeps the window hidden
  // at OS level until ready-to-show fires after the first successful paint,
  // regardless of how many GPU restarts occurred before it.
  const savedTheme = appSettings.theme || 'dark';
  const backgroundColor = savedTheme === 'light' ? '#f5f5f7' : '#0d0d10';

  mainWindow = new BrowserWindow({
    width: 1000, height: 700,
    show: false,
    backgroundColor,
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show only after first paint. 300ms fallback ensures the window always
  // appears even if ready-to-show never fires (repeated GPU crashes etc).
  let shown = false;
  const showWindow = () => { if (!shown) { shown = true; mainWindow?.show(); } };
  mainWindow.once('ready-to-show', showWindow);
  setTimeout(showWindow, 300);

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await ensureDataDir();
  await ensureAlbums();
  try { await pruneDbEntries(); } catch {}
  try { await syncFromStorageDir(); } catch {}
  try { await loadDB(); } catch { await saveDB({ wallpapers: [], settings: {} }); }
  createWindow();
  mainWindow?.webContents?.on('did-finish-load', () => { mainWindow?.webContents.send('refresh-gallery'); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });



// ─── IPC: App settings (hardware accel, theme, accent) ───────────────────────
ipcMain.handle('get-app-settings', async () => loadAppSettingsSync());
ipcMain.handle('save-app-settings', async (e, newSettings) => {
  const merged = { ...loadAppSettingsSync(), ...newSettings };
  saveAppSettingsSync(merged);
  // Notify main window so it can apply theme/accent changes live
  mainWindow?.webContents?.send('settings-updated', merged);
  return merged;
});

// ─── IPC: Unsplash key (embedded via env at build time) ───────────────────────
ipcMain.handle('get-unsplash-key', async () => UNSPLASH_ACCESS_KEY);

// ─── IPC: Album management ────────────────────────────────────────────────────
ipcMain.handle('get-albums', async () => { const alb = await loadAlbums(); return alb.albums || []; });
ipcMain.handle('get-current-album', async () => { const alb = await loadAlbums(); return alb.currentAlbumId; });
ipcMain.handle('set-current-album', async (e, id) => { await setCurrentAlbum(id); return true; });
ipcMain.handle('add-album', async (e, name, folder) => addAlbum(name, folder));
ipcMain.handle('select-album-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return canceled || !filePaths?.length ? null : filePaths[0];
});
ipcMain.handle('get-album-name', async (e, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return 'New Folder';
  return path.basename(folderPath) || 'New Folder';
});
ipcMain.handle('remove-album', async (e, id) => {
  const alb = await loadAlbums();
  alb.albums = (alb.albums || []).filter(a => a.id !== id);
  if (alb.currentAlbumId === id) alb.currentAlbumId = null;
  await saveAlbums(alb);
  const db = await loadDB();
  db.wallpapers = (db.wallpapers || []).filter(w => w.albumId !== id);
  await saveDB(db);
  return true;
});

// ─── IPC: Image management ────────────────────────────────────────────────────
ipcMain.handle('delete-image', async (e, imagePath) => {
  try {
    await fsp.unlink(imagePath);
    const db = await loadDB();
    db.wallpapers = (db.wallpapers || []).filter(w => w.path !== imagePath);
    await saveDB(db);
    return true;
  } catch (err) { console.error('Error deleting image:', err); throw err; }
});

ipcMain.handle('get-image-metadata', async (e, imagePath) => {
  try {
    const stats = await fsp.stat(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    let dimensions = { width: 0, height: 0 };
    try {
      const buffer = await fsp.readFile(imagePath);
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        let offset = 4;
        while (offset < buffer.length - 10) {
          if (buffer[offset] === 0xFF) {
            if (buffer[offset+1] >= 0xC0 && buffer[offset+1] <= 0xC3) {
              dimensions.height = buffer[offset+5]*256 + buffer[offset+6];
              dimensions.width  = buffer[offset+7]*256 + buffer[offset+8];
              break;
            }
            offset += (buffer[offset+1] === 0xFF ? 1 : (buffer[offset+2]*256 + buffer[offset+3] + 2));
          } else { offset++; }
        }
      } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        dimensions.width  = buffer[16]*16777216 + buffer[17]*65536 + buffer[18]*256 + buffer[19];
        dimensions.height = buffer[20]*16777216 + buffer[21]*65536 + buffer[22]*256 + buffer[23];
      } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        dimensions.width  = buffer[6] + buffer[7]*256;
        dimensions.height = buffer[8] + buffer[9]*256;
      }
    } catch {}
    return {
      size: stats.size,
      dimensions: dimensions.width && dimensions.height ? `${dimensions.width} x ${dimensions.height}` : 'Unknown',
      format: ext.replace('.', '').toUpperCase(),
      date: stats.mtime.toLocaleString()
    };
  } catch { return { size: 0, dimensions: 'Unknown', format: 'Unknown', date: 'Unknown' }; }
});

ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return canceled || !filePaths?.length ? null : filePaths[0];
});

ipcMain.handle('get-wallpapers', async (e, albumId) => {
  await pruneDbEntries();
  let targetAlbumId = albumId;
  if (!targetAlbumId) { const alb = await getCurrentAlbum(); targetAlbumId = alb?.id || null; }
  if (!targetAlbumId) return [];
  const albums = await loadAlbums();
  const album = (albums.albums || []).find(x => x.id === targetAlbumId);
  if (!album) return [];
  await scanWallpapersInFolder(album.folder, targetAlbumId);
  const db = await loadDB();
  return (db.wallpapers || []).filter(w => w.albumId === targetAlbumId);
});

ipcMain.handle('get-all-wallpapers', async () => {
  try { await pruneDbEntries(); const db = await loadDB(); return db.wallpapers || []; } catch { return []; }
});

// ─── IPC: Windows Spotlight images ────────────────────────────────────────────
ipcMain.handle('get-spotlight-images', async () => {
  try {
    const db = await loadDB();
    const spotlightImages = [];
    const seenPaths = new Set();
    (db.wallpapers || []).filter(w => w.isSpotlight).forEach(img => { spotlightImages.push(img); seenPaths.add(img.path); });

    const isLandscapeImage = async (filePath) => {
      try {
        const stats = await fsp.stat(filePath);
        if (stats.size < 200000) return false;
        const buffer = await fsp.readFile(filePath);
        let width = 0, height = 0;
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
          let offset = 4;
          while (offset < buffer.length - 10) {
            if (buffer[offset] === 0xFF) {
              if (buffer[offset+1] >= 0xC0 && buffer[offset+1] <= 0xC3) { height = buffer[offset+5]*256+buffer[offset+6]; width = buffer[offset+7]*256+buffer[offset+8]; break; }
              offset += (buffer[offset+1] === 0xFF ? 1 : (buffer[offset+2]*256+buffer[offset+3]+2));
            } else { offset++; }
          }
        } else if (buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4E&&buffer[3]===0x47) {
          width=buffer[16]*16777216+buffer[17]*65536+buffer[18]*256+buffer[19]; height=buffer[20]*16777216+buffer[21]*65536+buffer[22]*256+buffer[23];
        } else if (buffer[0]===0x47&&buffer[1]===0x49&&buffer[2]===0x46) {
          width=buffer[6]+buffer[7]*256; height=buffer[8]+buffer[9]*256;
        }
        return width > 0 && height > 0 && width >= height;
      } catch { return false; }
    };

    const addImage = async (filePath, name, priority = 0) => {
      if (seenPaths.has(filePath) || !(await isLandscapeImage(filePath))) return false;
      const stats = await fsp.stat(filePath);
      spotlightImages.push({ id: 'spotlight_' + filePath.replace(/[\\/]/g, '_'), path: filePath, name: name || 'Spotlight - ' + path.basename(filePath), favorite: false, addedAt: stats.mtime, isSpotlight: true, priority });
      seenPaths.add(filePath);
      return true;
    };

    // SystemData (lock screen)
    try {
      const sdPath = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft', 'Windows', 'SystemData');
      if (await fsp.access(sdPath).then(() => true).catch(() => false)) {
        for (const sid of await fsp.readdir(sdPath)) {
          const lsp = path.join(sdPath, sid, 'ReadOnly');
          try {
            for (const lf of await fsp.readdir(lsp)) {
              if (lf.startsWith('LockScreen_')) {
                const fp = path.join(lsp, lf);
                for (const file of await fsp.readdir(fp)) {
                  if (/\.(jpg|png)$/i.test(file)) await addImage(path.join(fp, file), `Lock Screen - ${file}`, 1);
                }
              }
            }
          } catch { continue; }
        }
      }
    } catch {}

    // Assets folder
    for (const ap of [
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy', 'LocalState', 'Assets'),
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_8wekyb3d8bbwe', 'LocalState', 'Assets')
    ]) {
      try {
        await fsp.access(ap);
        const fileStats = [];
        for (const file of await fsp.readdir(ap)) {
          const fp = path.join(ap, file); const lower = file.toLowerCase();
          try {
            const s = await fsp.stat(fp);
            if (s.size > 200000 && (/\.(jpg|png|jpeg)$/i.test(lower) || !lower.includes('.'))) fileStats.push({ path: fp, mtime: s.mtime });
          } catch { continue; }
        }
        fileStats.sort((a, b) => b.mtime - a.mtime);
        for (const { path: fp } of fileStats) await addImage(fp, `Spotlight - ${path.basename(fp)}`, 2);
      } catch { continue; }
    }

    spotlightImages.sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : new Date(b.addedAt) - new Date(a.addedAt));
    return spotlightImages;
  } catch (err) { console.error('Error getting spotlight images:', err); return []; }
});

ipcMain.handle('add-wallpaper', async (e, srcPath) => {
  if (!srcPath) throw new Error('No source path');
  const alb = await getCurrentAlbum();
  return addWallpaperFromPath(srcPath, alb?.id || null);
});

ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif','bmp'] }] });
  if (canceled || !filePaths?.length) return null;
  return addWallpaperFromPath(filePaths[0]);
});

ipcMain.handle('set-wallpaper', async (e, filePath) => { await setAsWallpaper(filePath); return true; });

ipcMain.handle('choose-storage-dir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (canceled || !filePaths?.length) return null;
  await setStorageDir(filePaths[0]);
  return filePaths[0];
});

ipcMain.handle('get-settings', async () => {
  try { const cfg = JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8')); return { storageDir: cfg.storageDir || DEFAULT_WALLPAPER_DIR }; }
  catch { return { storageDir: DEFAULT_WALLPAPER_DIR }; }
});

ipcMain.handle('copy-to-album', async (e, imagePath, albumId) => {
  const db = await loadDB();
  const ext = path.extname(imagePath); const baseName = path.basename(imagePath, ext);
  const albums = await loadAlbums(); const album = (albums.albums||[]).find(a => a.id === albumId);
  if (!album) throw new Error('Album not found');
  const destName = `${baseName}_${Date.now()}${ext}`, destPath = path.join(album.folder, destName);
  await fsp.copyFile(imagePath, destPath);
  const entry = { id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), path: destPath, name: destName, favorite: false, addedAt: Date.now(), albumId };
  db.wallpapers = db.wallpapers || []; db.wallpapers.push(entry); await saveDB(db);
  return entry;
});

// copy-spotlight-to-album: Spotlight images are plain files on disk; copy logic is
// identical to copy-to-album. Kept as a separate handle for preload API stability.
ipcMain.handle('copy-spotlight-to-album', async (e, imagePath, albumId) => {
  const db = await loadDB();
  const ext = path.extname(imagePath); const baseName = path.basename(imagePath, ext);
  const albums = await loadAlbums(); const album = (albums.albums||[]).find(a => a.id === albumId);
  if (!album) throw new Error('Album not found');
  const destName = `${baseName}_${Date.now()}${ext}`, destPath = path.join(album.folder, destName);
  await fsp.copyFile(imagePath, destPath);
  const entry = { id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), path: destPath, name: destName, favorite: false, addedAt: Date.now(), albumId };
  db.wallpapers = db.wallpapers || []; db.wallpapers.push(entry); await saveDB(db);
  return entry;
});

ipcMain.handle('toggle-favorite', async (e, id) => toggleFavorite(id));
ipcMain.on('start-slideshow', (e, interval, albumId) => startSlideshow(interval, albumId));
ipcMain.on('stop-slideshow', () => stopSlideshow());
ipcMain.handle('get-slideshow-status', () => ({
  running: slideshowTimer !== null,
  intervalMs: slideshowIntervalMs,
  albumId: slideshowAlbumId,
}));

// ─── IPC: Download Unsplash image (with API compliance) ───────────────────────
ipcMain.handle('download-image-url', async (e, url, filename, albumId, downloadLocation) => {
  try {
    const albums = await loadAlbums();
    const album = (albums.albums||[]).find(a => a.id === albumId);
    if (!album) throw new Error('Album not found');

    // Trigger Unsplash download endpoint BEFORE saving (API compliance)
    if (downloadLocation && UNSPLASH_ACCESS_KEY) {
      fetch(downloadLocation, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } })
        .catch(err => console.error('Unsplash download trigger failed:', err));
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.buffer();
    const ext = path.extname(filename) || '.jpg';
    const baseName = 'unsplash_' + Date.now() + ext;
    const destPath = path.join(album.folder, baseName);
    await fsp.writeFile(destPath, buffer);

    const db = await loadDB();
    const entry = { id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), path: destPath, name: baseName, favorite: false, addedAt: Date.now(), albumId };
    db.wallpapers = db.wallpapers || []; db.wallpapers.push(entry); await saveDB(db);
    console.log(`Downloaded Unsplash image to: ${destPath}`);
    return entry;
  } catch (err) { console.error('Error downloading image URL:', err); throw err; }
});
