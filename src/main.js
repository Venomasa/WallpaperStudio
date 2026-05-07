const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
// Disable GPU acceleration to mitigate GPU process crashes on some Windows drivers
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const wallpaper = require('wallpaper');
const fetch = require('node-fetch');

// Default storage directory for wallpapers (configurable at runtime)
const DEFAULT_WALLPAPER_DIR = path.join(app.getPath('userData'), 'wallpapers');
// Config file that stores runtime settings like custom storageDir
const CONFIG_FILE = path.join(app.getPath('userData'), 'wallpaper-config.json');
// DB is stored in a dedicated folder by default
const DB_DIR = DEFAULT_WALLPAPER_DIR;
const DB_PATH = path.join(DB_DIR, 'db.json');
// Albums: multi-folder albums (basic scaffolding)
const ALBUMS_FILE = path.join(app.getPath('userData'), 'albums.json');
async function ensureAlbums() {
  // Ensure albums file exists
  try {
    await fs.promises.access(ALBUMS_FILE);
  } catch {
    // initialize with empty albums (user adds folders/albums)
    const initial = { albums: [], currentAlbumId: null };
    await fs.promises.writeFile(ALBUMS_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function loadAlbums() {
  try {
    const data = await fs.promises.readFile(ALBUMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { albums: [], currentAlbumId: null };
  }
}

async function saveAlbums(obj) {
  await fs.promises.writeFile(ALBUMS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

async function getCurrentAlbum() {
  const alb = await loadAlbums();
  const id = alb.currentAlbumId;
  if (!id) return null;
  const a = (alb.albums || []).find((x) => x.id === id);
  return a || null;
}

async function setCurrentAlbum(albumId) {
  const alb = await loadAlbums();
  alb.currentAlbumId = albumId;
  await saveAlbums(alb);
}

async function addAlbum(name, folderPath) {
  const alb = await loadAlbums();
  const newId = 'alb_' + Date.now();
  alb.albums = alb.albums || [];
  alb.albums.push({ id: newId, name: name, folder: folderPath, createdAt: Date.now() });
  alb.currentAlbumId = newId;
  await saveAlbums(alb);
  console.log(`Added album: ${name} (${newId}) from ${folderPath}`);
  
  // Scan the folder for images and add them to the DB
  const added = await scanWallpapersInFolder(folderPath, newId);
  console.log(`Scanned ${added} images for new album`);
  
  return { id: newId, name: name, folder: folderPath };
}

let mainWindow;
let slideshowWin = null;
let slideshowTimer = null;
let slideshowIndex = 0;
let slideshowIntervalMs = 6000;

async function ensureDataDir() {
  const dir = await getStorageDir();
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
}

// Helpers to manage storage dir and db.json in a configurable location
async function ensureConfig() {
  try {
    await fs.promises.access(CONFIG_FILE);
  } catch {
    // create with default storage dir
    await fs.promises.mkdir(app.getPath('userData'), { recursive: true }).catch(() => {});
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify({ storageDir: DEFAULT_WALLPAPER_DIR }, null, 2), 'utf8');
  }
}

async function getStorageDir() {
  await ensureConfig();
  try {
    const cfg = JSON.parse(await fs.promises.readFile(CONFIG_FILE, 'utf8'));
    const dir = cfg.storageDir || DEFAULT_WALLPAPER_DIR;
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
    return dir;
  } catch {
    return DEFAULT_WALLPAPER_DIR;
  }
}

async function setStorageDir(dir) {
  await ensureConfig();
  let cfg = {};
  try {
    cfg = JSON.parse(await fs.promises.readFile(CONFIG_FILE, 'utf8'));
  } catch {
    cfg = {};
  }
  cfg.storageDir = dir;
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
  await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  // Also update default album folder if exists
  try {
    const alb = await loadAlbums();
    if (alb.albums && alb.albums.find((a) => a.id === DEFAULT_ALBUM_ID)) {
      const a = alb.albums.find((a) => a.id === DEFAULT_ALBUM_ID);
      a.folder = dir;
      await saveAlbums(alb);
    }
  } catch {
    // ignore
  }
}

async function getDbPath() {
  return DB_PATH;
}

async function loadDB() {
  try {
    const dbPath = await getDbPath();
    const data = await fsp.readFile(dbPath, 'utf8');
    const json = JSON.parse(data);
    if (Array.isArray(json.wallpapers)) {
      return json;
    }
  } catch (e) {
    // fall through to create new DB
  }
  return { wallpapers: [], settings: {} };
}

async function saveDB(db) {
const dbPath = await getDbPath();
await fsp.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8');
// Log after save
const albumCounts = {};
(db.wallpapers || []).forEach(w => {
if (!albumCounts[w.albumId]) albumCounts[w.albumId] = 0;
albumCounts[w.albumId]++;
});
console.log('DB saved - Total:', db.wallpapers ? db.wallpapers.length : 0, 'By album:', albumCounts);
}

async function scanWallpapersInFolder(folderPath, albumId) {
  const db = await loadDB();
  const files = await fs.promises.readdir(folderPath).catch(() => []);
  const images = files.filter((name) => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name));
  
  // Get existing wallpaper IDs for this album to avoid duplicates
  const existingPaths = new Set(
    (db.wallpapers || [])
      .filter(w => w.albumId === albumId)
      .map(w => w.path)
  );
  
  let added = 0;
  for (const name of images) {
    const fullPath = path.join(folderPath, name);
    if (!existingPaths.has(fullPath)) {
      const entry = {
        id: 'wp_' + Date.now() + '_' + added,
        path: fullPath,
        name: name,
        favorite: false,
        addedAt: Date.now(),
        albumId: albumId
      };
      db.wallpapers = db.wallpapers || [];
      db.wallpapers.push(entry);
      added++;
    }
  }
  if (added > 0) {
    await saveDB(db);
  }
  return added;
}

async function scanWallpapers() {
  const db = await loadDB();
  // If db has entries, trust it. Otherwise, scan storage dir for images.
  if (db.wallpapers.length > 0) return db;
  const dir = await getStorageDir();
  const files = await fs.promises.readdir(dir).catch(() => []);
  const images = files.filter((name) => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name));
  db.wallpapers = images.map((name, idx) => {
    return {
      id: 'wp_' + idx,
      path: path.join(dir, name),
      name: name,
      favorite: false,
      addedAt: Date.now()
    };
  });
  await saveDB(db);
  return db;
}

function getWallpaperList() {
  // helper to always return a consistent list
  return loadDB().then(async (db) => {
    if (!db.wallpapers || db.wallpapers.length === 0) {
      await scanWallpapers();
      db = await loadDB();
    }
    return db.wallpapers;
  });
}

async function addWallpaperFromPath(srcPath, albumIdArg) {
  await ensureDataDir();
  const ext = path.extname(srcPath) || '.jpg';
  const base = 'wallpaper_' + Date.now() + ext;
  // Determine album and target folder
  const albums = await loadAlbums();
  let albumId = albumIdArg;
  let folderDir = DEFAULT_WALLPAPER_DIR;
  if (albumId) {
    const a = (albums.albums || []).find((x) => x.id === albumId);
    if (a && a.folder) folderDir = a.folder;
  } else {
    const current = await getCurrentAlbum();
    albumId = current.id;
    if (current && current.folder) folderDir = current.folder;
  }
  const dest = path.join(folderDir, base);
  await fs.promises.copyFile(srcPath, dest);
  const db = await loadDB();
  const entry = {
    id: 'wp_' + (db.wallpapers.length + 1),
    path: dest,
    name: base,
    favorite: false,
    addedAt: Date.now()
    , albumId: albumId || DEFAULT_ALBUM_ID
  };
  db.wallpapers.push(entry);
  await saveDB(db);
  return entry;
}

async function setAsWallpaper(filePath) {
  await wallpaper.set(filePath);
}

async function toggleFavorite(id) {
  const db = await loadDB();
  const w = db.wallpapers.find((x) => x.id === id);
  if (w) {
    w.favorite = !w.favorite;
    await saveDB(db);
  }
  return w ? w.favorite : null;
}

function stopSlideshow() {
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
}

async function startSlideshow(intervalMs) {
  stopSlideshow();
  slideshowIntervalMs = intervalMs || 6000;
  const db = await loadDB();
  const imgs = db.wallpapers;
  if (!imgs || imgs.length === 0) return;
  slideshowIndex = 0;
  slideshowTimer = setInterval(async () => {
    const list = await loadDB();
    const arr = list.wallpapers;
    if (!arr || arr.length === 0) return;
    const w = arr[slideshowIndex % arr.length];
    if (w && w.path) {
      await setAsWallpaper(w.path);
    }
    slideshowIndex = (slideshowIndex + 1) % arr.length;
  }, slideshowIntervalMs);
}

// Image download removed: functionality deprecated per request

// Sync: ensure gallery reflects actual files on startup
async function syncFromStorageDir() {
  const dir = await getStorageDir();
  const db = await loadDB();
  const files = await fs.promises.readdir(dir).catch(() => []);
  const images = files.filter((name) => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name));
  const existing = new Set((db.wallpapers || []).map((w) => w.path));
  let added = 0;
  for (const name of images) {
    const fullPath = path.join(dir, name);
    if (!existing.has(fullPath)) {
      const entry = {
        id: 'wp_' + (db.wallpapers.length + added + 1),
        path: fullPath,
        name: name,
        favorite: false,
        addedAt: Date.now()
      };
      db.wallpapers = db.wallpapers || [];
      db.wallpapers.push(entry);
      added++;
    }
  }
  if (added > 0) await saveDB(db);
  return added;
}

// Utility: check if a file exists
async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Prune DB entries that point to non-existent files
async function pruneDbEntries() {
try {
const db = await loadDB();
if (!db.wallpapers || db.wallpapers.length === 0) return;
const kept = [];
for (const w of db.wallpapers) {
if (!w || !w.path) continue;
// Keep if file exists (regardless of which folder it's in)
if (await fileExists(w.path)) {
kept.push(w);
}
}
if (kept.length !== db.wallpapers.length) {
db.wallpapers = kept;
await saveDB(db);
console.log(`Pruned ${db.wallpapers.length - kept.length} missing files from DB`);
}
} catch (err) {
console.error('Error pruning DB:', err);
// ignore prune errors to avoid breaking UX
}
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  // Load HTML relative to this script's directory to ensure correct path
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await ensureDataDir();
  await ensureAlbums();
  // prune missing entries and sync with storage dir on startup
  try { await pruneDbEntries(); } catch {}
  try {
    // use current album's folder for sync
    await syncFromStorageDir();
  } catch {}
  // ensure DB exists
  try {
    await loadDB();
  } catch (e) {
    await saveDB({ wallpapers: [], settings: {} });
  }
  createWindow();
  // After the window finishes loading, request a fresh render
  mainWindow?.webContents?.on('did-finish-load', () => {
    mainWindow?.webContents.send('refresh-gallery');
  });
});

// Open slideshow config modal
ipcMain.handle('open-slideshow-config', async () => {
  if (slideshowWin) return true;
  slideshowWin = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 500,
    height: 400,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'slideshow-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  slideshowWin.loadFile(path.join(__dirname, 'slideshow-config.html'));
  slideshowWin.on('closed', () => { slideshowWin = null; });
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers
ipcMain.handle('get-albums', async () => {
  const alb = await loadAlbums();
  return alb.albums || [];
});
ipcMain.handle('get-current-album', async () => {
  const alb = await loadAlbums();
  return alb.currentAlbumId;
});
ipcMain.handle('set-current-album', async (e, id) => {
  await setCurrentAlbum(id);
  return true;
});
ipcMain.handle('add-album', async (e, name, folder) => {
  const a = await addAlbum(name, folder);
  // refresh albums cache
  return a;
});
ipcMain.handle('select-album-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (canceled || !filePaths || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('get-album-name', async (e, folderPath) => {
console.log('get-album-name received:', folderPath, 'type:', typeof folderPath);
// Use folder name as album name automatically
if (!folderPath || typeof folderPath !== 'string') {
console.log('Invalid folderPath, using default');
return 'New Folder';
}
// Use path.basename to get the folder name
const folderName = path.basename(folderPath) || 'New Folder';
console.log('Folder path:', folderPath, '-> Basename:', folderName);
return folderName;
});

ipcMain.handle('remove-album', async (e, id) => {
const alb = await loadAlbums();
// Remove album from list
alb.albums = (alb.albums || []).filter(a => a.id !== id);
// If this was the current album, clear current
if (alb.currentAlbumId === id) {
alb.currentAlbumId = null;
}
await saveAlbums(alb);

// Remove wallpapers associated with this album from DB
const db = await loadDB();
db.wallpapers = (db.wallpapers || []).filter(w => w.albumId !== id);
await saveDB(db);

console.log(`Removed album: ${id}`);
return true;
});

ipcMain.handle('delete-image', async (e, imagePath) => {
try {
// Remove file from system
await fs.promises.unlink(imagePath);

// Remove from database
const db = await loadDB();
db.wallpapers = (db.wallpapers || []).filter(w => w.path !== imagePath);
await saveDB(db);

console.log(`Deleted image: ${imagePath}`);
return true;
} catch (err) {
console.error('Error deleting image:', err);
throw err;
}
});

ipcMain.handle('get-image-metadata', async (e, imagePath) => {
try {
const stats = await fs.promises.stat(imagePath);
const ext = path.extname(imagePath).toLowerCase();
const size = stats.size;

// Simple dimension detection for common formats
let dimensions = { width: 0, height: 0 };
try {
const buffer = await fs.promises.readFile(imagePath);

// JPEG: starts with FF D8 FF
if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
let offset = 4;
while (offset < buffer.length - 10) {
if (buffer[offset] === 0xFF) {
if (buffer[offset + 1] >= 0xC0 && buffer[offset + 1] <= 0xC3) {
dimensions.height = buffer[offset + 5] * 256 + buffer[offset + 6];
dimensions.width = buffer[offset + 7] * 256 + buffer[offset + 8];
break;
}
offset += (buffer[offset + 1] === 0xFF ? 1 : (buffer[offset + 2] * 256 + buffer[offset + 3] + 2));
} else {
offset++;
}
}
}
// PNG: starts with 89 50 4E 47
else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
dimensions.width = buffer[16] * 256 * 256 + buffer[18] * 256 + buffer[19];
dimensions.height = buffer[20] * 256 * 256 + buffer[22] * 256 + buffer[23];
}
// GIF: starts with 47 49 46
else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
dimensions.width = buffer[6] + buffer[7] * 256;
dimensions.height = buffer[8] + buffer[9] * 256;
}
// WebP
else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
// VP8/VP9
if ((buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38) ||
(buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x39)) {
dimensions.width = buffer[26] + (buffer[27] << 8);
dimensions.height = buffer[28] + (buffer[29] << 8);
}
}
} catch {}

return {
size: size,
dimensions: dimensions.width && dimensions.height ? `${dimensions.width} x ${dimensions.height}` : 'Unknown',
format: ext.replace('.', '').toUpperCase(),
date: stats.mtime.toLocaleString()
};
} catch (err) {
console.error('Error getting metadata:', err);
return { size: 0, dimensions: 'Unknown', format: 'Unknown', date: 'Unknown' };
}
});

// Settings: change storage directory - removed
ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (canceled || !filePaths || filePaths.length === 0) return null;
  return filePaths[0];
});
ipcMain.handle('get-wallpapers', async (e, albumId) => {
// Ensure only existing files are shown
await pruneDbEntries();

let targetAlbumId = albumId;
if (!targetAlbumId) {
const alb = await getCurrentAlbum();
targetAlbumId = alb ? alb.id : null;
}

if (!targetAlbumId) {
return [];
}

// Get current album to derive folder
const albums = await loadAlbums();
const currentId = albumId || albums.currentAlbumId;
const album = (albums.albums || []).find((x) => x.id === currentId);

if (!album) {
return [];
}

// Scan the album folder for new images (don't re-add existing ones)
const added = await scanWallpapersInFolder(album.folder, targetAlbumId);
if (added > 0) {
console.log(`Scanned ${added} new images for album ${targetAlbumId} from ${album.folder}`);
}

// Return wallpapers filtered by album
const db = await loadDB();
const result = (db.wallpapers || []).filter((w) => w.albumId === targetAlbumId);
console.log(`Returning ${result.length} wallpapers for album ${targetAlbumId}`);
return result;
});

// Get all wallpapers from database (for favorites view)
ipcMain.handle('get-all-wallpapers', async () => {
try {
await pruneDbEntries();
const db = await loadDB();
const allWallpapers = db.wallpapers || [];

// Return all wallpapers with their paths verified
const validWallpapers = [];
for (const w of allWallpapers) {
if (w && w.path) {
try {
// Check if file exists
await fs.promises.access(w.path, fs.constants.F_OK);
validWallpapers.push(w);
} catch {
// File doesn't exist, but we'll keep it in DB for now
validWallpapers.push(w);
}
}
}
return validWallpapers;
} catch (err) {
console.error('Error getting all wallpapers:', err);
return [];
}
});

// Get Windows Spotlight images
ipcMain.handle('get-spotlight-images', async () => {
  try {
    const db = await loadDB();
    const spotlightImages = [];
    const seenPaths = new Set();

    // Also check for existing Spotlight images in DB
    const dbSpotlight = (db.wallpapers || []).filter(w => w.isSpotlight);
    dbSpotlight.forEach(img => {
      spotlightImages.push(img);
      seenPaths.add(img.path);
    });

// Helper function to check if file is landscape image
        const isLandscapeImage = async (filePath) => {
          try {
            const stats = await fs.promises.stat(filePath);
            if (stats.size < 200000) return false; // > 200KB
            
            // Check image dimensions to filter out portrait images
            try {
              const buffer = await fs.promises.readFile(filePath);
              let width = 0;
              let height = 0;
              
              // JPEG detection
              if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
                let offset = 4;
                while (offset < buffer.length - 10) {
                  if (buffer[offset] === 0xFF) {
                    if (buffer[offset + 1] >= 0xC0 && buffer[offset + 1] <= 0xC3) {
                      height = buffer[offset + 5] * 256 + buffer[offset + 6];
                      width = buffer[offset + 7] * 256 + buffer[offset + 8];
                      break;
                    }
                    offset += (buffer[offset + 1] === 0xFF ? 1 : (buffer[offset + 2] * 256 + buffer[offset + 3] + 2));
                  } else {
                    offset++;
                  }
                }
              }
              // PNG detection
              else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
                width = buffer[16] * 256 * 256 + buffer[18] * 256 + buffer[19];
                height = buffer[20] * 256 * 256 + buffer[22] * 256 + buffer[23];
              }
              // GIF detection
              else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
                width = buffer[6] + buffer[7] * 256;
                height = buffer[8] + buffer[9] * 256;
              }
              // WebP detection
              else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
                if ((buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38) ||
                    (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x39)) {
                  width = buffer[26] + (buffer[27] << 8);
                  height = buffer[28] + (buffer[29] << 8);
                }
              }
              
              // Filter out portrait images (height > width)
              if (height > width) {
                return false;
              }
              
              return width > 0 && height > 0;
            } catch {
              return false;
            }
          } catch {
            return false;
          }
        };

    // Helper to add image if valid and not duplicate
    const addImage = async (filePath, name, priority = 0) => {
      if (seenPaths.has(filePath)) return false;
      if (!(await isLandscapeImage(filePath))) return false;
      
      const stats = await fs.promises.stat(filePath);
      const existingId = 'spotlight_' + filePath.replace(/[\\\/]/g, '_');
      
      spotlightImages.push({
        id: existingId,
        path: filePath,
        name: name || 'Spotlight - ' + path.basename(filePath),
        favorite: false,
        addedAt: stats.mtime,
        isSpotlight: true,
        priority: priority
      });
      seenPaths.add(filePath);
      return true;
    };

    // 🥇 Step 1: Try SystemData (LockScreen images - highest priority)
    try {
      const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
      const systemDataPath = path.join(programData, 'Microsoft', 'Windows', 'SystemData');
      
      if (await fs.promises.access(systemDataPath).then(() => true).catch(() => false)) {
        const sidFolders = await fs.promises.readdir(systemDataPath);
        
        for (const sid of sidFolders) {
          const lockScreenPath = path.join(systemDataPath, sid, 'ReadOnly');
          try {
            await fs.promises.access(lockScreenPath);
            const lockFolders = await fs.promises.readdir(lockScreenPath);
            
            for (const lockFolder of lockFolders) {
              if (lockFolder.startsWith('LockScreen_')) {
                const fullPath = path.join(lockScreenPath, lockFolder);
                const files = await fs.promises.readdir(fullPath);
                
                // Prefer LockScreen___1920_1080.jpg or similar high-res versions
                const priorityFiles = files.filter(f => f.includes('1920') || f.includes('1080'));
                const allFiles = [...priorityFiles, ...files.filter(f => !priorityFiles.includes(f))];
                
                for (const file of allFiles) {
                  if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png')) {
                    const filePath = path.join(fullPath, file);
                    await addImage(filePath, `Lock Screen - ${file}`, 1);
                  }
                }
              }
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // SystemData not accessible, continue to Assets
    }

    // 🥈 Step 2: Assets folder (primary source)
    const assetsPaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy', 'LocalState', 'Assets'),
      path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_8wekyb3d8bbwe', 'LocalState', 'Assets')
    ];

    for (const assetsPath of assetsPaths) {
      try {
        await fs.promises.access(assetsPath);
        const files = await fs.promises.readdir(assetsPath);
        
        // Get all files with their stats, sort by mtime DESC
        const fileStats = [];
        for (const file of files) {
          const filePath = path.join(assetsPath, file);
          try {
            const stats = await fs.promises.stat(filePath);
            // Filter: > 200KB and no extension (Spotlight assets) or image extension
            const lower = file.toLowerCase();
            const hasImageExt = lower.endsWith('.jpg') || lower.endsWith('.png') || lower.endsWith('.jpeg');
            const hasNoExt = !lower.includes('.');
            
            if ((hasImageExt || hasNoExt) && stats.size > 200000) {
              fileStats.push({ path: filePath, mtime: stats.mtime, size: stats.size });
            }
          } catch {
            continue;
          }
        }
        
        // Sort by modification time DESC (newest first)
        fileStats.sort((a, b) => b.mtime - a.mtime);
        
        // Add all valid files
        for (const { path: filePath } of fileStats) {
          await addImage(filePath, `Spotlight - ${path.basename(filePath)}`, 2);
        }
      } catch {
        continue;
      }
    }

    // 🥉 Step 3: CachedFiles fallback
    const cachedPaths = [
      path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'CachedFiles'),
      path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes')
    ];

    for (const cachedPath of cachedPaths) {
      try {
        await fs.promises.access(cachedPath);
        const stats = await fs.promises.stat(cachedPath);
        
        if (stats.isDirectory()) {
          const files = await fs.promises.readdir(cachedPath);
          for (const file of files) {
            if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png')) {
              const filePath = path.join(cachedPath, file);
              await addImage(filePath, `Cached - ${file}`, 3);
            }
          }
        } else if (stats.isFile() && cachedPath.toLowerCase().endsWith('transcodedwallpaper')) {
          await addImage(cachedPath, 'Transcoded Wallpaper', 3);
        }
      } catch {
        continue;
      }
    }

    // Sort by priority, then by date
    spotlightImages.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(b.addedAt) - new Date(a.addedAt);
    });

    console.log(`Found ${spotlightImages.length} Spotlight images`);
    return spotlightImages;
  } catch (err) {
    console.error('Error getting spotlight images:', err);
    return [];
  }
});

ipcMain.handle('add-wallpaper', async (e, srcPath) => {
  if (!srcPath) throw new Error('No source path');
  // Determine current album to assign the image
  const alb = await getCurrentAlbum();
  const entry = await addWallpaperFromPath(srcPath, alb.id);
  return entry;
});

ipcMain.handle('open-file', async () => {
  // Open file dialog to pick an image and add to storage dir
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
  });
  if (canceled || !filePaths || filePaths.length === 0) return null;
  const entry = await addWallpaperFromPath(filePaths[0]);
  return entry;
});

ipcMain.handle('set-wallpaper', async (e, filePath) => {
  await setAsWallpaper(filePath);
  return true;
});

// Settings: choose storage directory for wallpapers
ipcMain.handle('choose-storage-dir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || !filePaths || filePaths.length === 0) return null;
  const newDir = filePaths[0];
  // Persist to config file
  await setStorageDir(newDir);
  return newDir;
});

// Expose to UI to fetch current settings (storageDir)
ipcMain.handle('get-settings', async () => {
  try {
    const cfg = JSON.parse(await fs.promises.readFile(CONFIG_FILE, 'utf8'));
    const dir = cfg.storageDir || DEFAULT_WALLPAPER_DIR;
    return { storageDir: dir };
  } catch {
    return { storageDir: DEFAULT_WALLPAPER_DIR };
  }
});

ipcMain.handle('copy-to-album', async (e, imagePath, albumId) => {
  const db = await loadDB();
  const srcStats = await fs.promises.stat(imagePath);
  const ext = path.extname(imagePath);
  const baseName = path.basename(imagePath, ext);
  const albums = await loadAlbums();
  const album = (albums.albums || []).find(a => a.id === albumId);
  if (!album) throw new Error('Album not found');
  const destName = `${baseName}_${Date.now()}${ext}`;
  const destPath = path.join(album.folder, destName);
  await fs.promises.copyFile(imagePath, destPath);
  const entry = {
    id: 'wp_' + Date.now() + '_' + albumId,
    path: destPath,
    name: destName,
    favorite: false,
    addedAt: Date.now(),
    albumId: albumId
  };
  db.wallpapers = db.wallpapers || [];
  db.wallpapers.push(entry);
  await saveDB(db);
  return entry;
});

ipcMain.handle('copy-spotlight-to-album', async (e, imagePath, albumId) => {
  const db = await loadDB();
  const ext = path.extname(imagePath);
  const baseName = path.basename(imagePath, ext);
  const albums = await loadAlbums();
  const album = (albums.albums || []).find(a => a.id === albumId);
  if (!album) throw new Error('Album not found');
  const destName = `${baseName}_${Date.now()}${ext}`;
  const destPath = path.join(album.folder, destName);
  await fs.promises.copyFile(imagePath, destPath);
  const entry = {
    id: 'wp_' + Date.now() + '_' + albumId,
    path: destPath,
    name: destName,
    favorite: false,
    addedAt: Date.now(),
    albumId: albumId
  };
  db.wallpapers = db.wallpapers || [];
  db.wallpapers.push(entry);
  await saveDB(db);
  return entry;
});

ipcMain.handle('toggle-favorite', async (e, id) => {
  return await toggleFavorite(id);
});

ipcMain.on('start-slideshow', (e, interval) => {
  startSlideshow(interval);
});

ipcMain.on('stop-slideshow', () => {
  stopSlideshow();
});

// download-from-url handler removed

// ─── Download image from URL and save to album ────────────────────────────────
ipcMain.handle('download-image-url', async (e, url, filename, albumId) => {
  try {
    const albums = await loadAlbums();
    const album = (albums.albums || []).find(a => a.id === albumId);
    if (!album) throw new Error('Album not found');

    // Fetch image bytes
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching image`);
    const buffer = await response.buffer();

    // Save to album folder
    const ext = path.extname(filename) || '.jpg';
    const baseName = 'unsplash_' + Date.now() + ext;
    const destPath = path.join(album.folder, baseName);
    await fs.promises.writeFile(destPath, buffer);

    // Add to DB
    const db = await loadDB();
    const entry = {
      id: 'wp_' + Date.now() + '_unsplash',
      path: destPath,
      name: baseName,
      favorite: false,
      addedAt: Date.now(),
      albumId: albumId
    };
    db.wallpapers = db.wallpapers || [];
    db.wallpapers.push(entry);
    await saveDB(db);

    console.log(`Downloaded Unsplash image to: ${destPath}`);
    return entry;
  } catch (err) {
    console.error('Error downloading image URL:', err);
    throw err;
  }
});
