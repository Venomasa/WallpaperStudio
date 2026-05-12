'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const fetch = require('node-fetch');

// ─── Load app settings BEFORE ready ──────────────────────────────────────────
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
  return {
    theme: 'dark',
    accentColor: '#6366f1',
    minimizeToTray: true,
    startWithWindows: false,
    startMinimized: false,
    thumbnailSize: 210,
    showImageNames: false,
    slideshowInterval: 60000,
    discoverySaveFolderId: '',
    dailyWallpaperEnabled: false,
    dailyWallpaperTopics: '',
    dailyWallpaperTime: '08:00',
  };
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

// ─── Disable hardware acceleration ────────────────────────────────────────────
app.disableHardwareAcceleration();

// ─── Unsplash API key ─────────────────────────────────────────────────────────
let UNSPLASH_ACCESS_KEY = '';
let PEXELS_API_KEY = '';
try {
  const buildConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-config.json'), 'utf8'));
  UNSPLASH_ACCESS_KEY = buildConfig.unsplashKey || '';
  PEXELS_API_KEY      = buildConfig.pexelsKey   || '';
} catch {
  UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
  PEXELS_API_KEY      = process.env.PEXELS_API_KEY      || '';
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const DEFAULT_WALLPAPER_DIR = path.join(app.getPath('userData'), 'wallpapers');
const CONFIG_FILE  = path.join(app.getPath('userData'), 'wallpaper-config.json');
const DB_PATH      = path.join(DEFAULT_WALLPAPER_DIR, 'db.json');
const ALBUMS_FILE  = path.join(app.getPath('userData'), 'albums.json');

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
let tray = null;
let slideshowTimer = null, slideshowIndex = 0, slideshowIntervalMs = 60000;

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
const USER_DB_PATH = path.join(app.getPath('userData'), 'db.json');

async function loadDB() {
  for (const p of [USER_DB_PATH, DB_PATH]) {
    try {
      const data = await fsp.readFile(p, 'utf8');
      const json = JSON.parse(data);
      if (Array.isArray(json.wallpapers)) return json;
    } catch {}
  }
  return { wallpapers: [], settings: {} };
}
async function saveDB(db) { await fsp.writeFile(USER_DB_PATH, JSON.stringify(db, null, 2), 'utf8'); }

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

// ─── Windows wallpaper setter ─────────────────────────────────────────────────
async function setAsWallpaper(filePath) {
  if (process.platform !== 'win32') {
    try { const wp = require('wallpaper'); await wp.set(filePath); } catch (e) { console.error('Wallpaper set failed:', e); }
    return;
  }

  const normalizedPath = path.resolve(filePath).replace(/\//g, '\\');
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
        const { exec } = require('child_process');
        exec(
          `reg add "HKCU\\Control Panel\\Desktop" /v Wallpaper /t REG_SZ /d "${normalizedPath}" /f && RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters 1, True`,
          { timeout: 8000 },
          (err) => { resolve(); }
        );
      } else {
        resolve();
      }
    });
    ps.on('error', () => resolve());
  });
}

async function toggleFavorite(id) {
  const db = await loadDB();
  const w = db.wallpapers.find(x => x.id === id);
  if (w) { w.favorite = !w.favorite; await saveDB(db); }
  return w ? w.favorite : null;
}

// ─── Local Slideshow ──────────────────────────────────────────────────────────
let slideshowAlbumId = null;
let slideshowShuffle = false;
let slideshowHistory = [];
let slideshowCurrentId = null;
let slideshowCurrentPath = null;

function stopSlideshow() {
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
  // Don't touch wallpaper — keep whatever is currently displayed
  slideshowHistory = [];
  slideshowCurrentId = null;
  slideshowCurrentPath = null;
}

async function startSlideshow(intervalMs, albumId, shuffle = false) {
  stopSlideshow();
  slideshowIntervalMs = intervalMs || 60000;
  slideshowAlbumId = albumId || null;
  slideshowShuffle = shuffle;
  slideshowIndex = 0;
  slideshowHistory = [];

  const db = await loadDB();
  const arr = slideshowAlbumId
    ? (db.wallpapers || []).filter(w => w.albumId === slideshowAlbumId)
    : (db.wallpapers || []);
  if (!arr.length) return;

  // DON'T change the wallpaper immediately — keep whatever is on screen now.
  // Just notify renderer of current state without setting anything.
  mainWindow?.webContents?.send('slideshow-tick', { id: null, name: '' });

  slideshowTimer = setInterval(async () => {
    const list = await loadDB();
    let arr2 = slideshowAlbumId
      ? (list.wallpapers || []).filter(w => w.albumId === slideshowAlbumId)
      : (list.wallpapers || []);
    if (!arr2.length) return;

    let w;
    if (slideshowShuffle) {
      const available = arr2.filter(x => !slideshowHistory.includes(x.id));
      const pool = available.length > 0 ? available : arr2;
      w = pool[Math.floor(Math.random() * pool.length)];
      slideshowHistory.push(w.id);
      if (slideshowHistory.length > Math.min(10, arr2.length - 1)) slideshowHistory.shift();
    } else {
      slideshowIndex = slideshowIndex % arr2.length;
      w = arr2[slideshowIndex];
      slideshowIndex++;
    }

    if (w?.path) {
      await setAsWallpaper(w.path);
      slideshowCurrentId = w.id;
      slideshowCurrentPath = w.path;
      mainWindow?.webContents?.send('slideshow-tick', { id: w.id, name: w.name });
      rebuildTrayMenu();
    }
  }, slideshowIntervalMs);
}

// ─── Discovery Slideshow state ────────────────────────────────────────────────
let discoverySlideshowTimer = null;
let discoverySlideshowIntervalMs = 3600000;
let discoverySlideshowQueue = [];
let discoverySlideshowTopics = '';
let discoverySlideshowSource = 'all'; // 'unsplash' | 'pexels' | 'all'
let discoverySlideshowPage = 1;
let discoverySlideshowFetching = false;
let discoverySlideshowCurrentPhoto = null;
let discoverySlideshowCurrentPath = null;
let discoverySlideshowSeenIds = new Set();

// ─── Discovery Slideshow helpers ──────────────────────────────────────────────
async function fetchDiscoveryPhotos(query) {
  const results = [];
  const src = discoverySlideshowSource || 'all';

  // ── Unsplash ──────────────────────────────────────────────────────────────
  if (UNSPLASH_ACCESS_KEY && src !== 'pexels') {
    try {
      const pp = 20;
      let url;
      if (query) {
        const randomPage = Math.floor(Math.random() * 5) + 1;
        url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${pp}&page=${randomPage}&orientation=landscape&order_by=relevant`;
      } else {
        url = `https://api.unsplash.com/photos/random?count=${pp}&orientation=landscape`;
      }
      const res = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
      if (res.ok) {
        const data = await res.json();
        const photos = Array.isArray(data) ? data : (data.results ?? []);
        photos.filter(p => p.id && !discoverySlideshowSeenIds.has('u_' + p.id))
              .forEach(p => results.push({ _src: 'unsplash', ...p }));
      }
    } catch {}
  }

  // ── Pexels ────────────────────────────────────────────────────────────────
  if (PEXELS_API_KEY && src !== 'unsplash') {
    try {
      const pp = 20;
      let url;
      if (query) {
        const randomPage = Math.floor(Math.random() * 5) + 1;
        url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${pp}&page=${randomPage}&orientation=landscape`;
      } else {
        url = `https://api.pexels.com/v1/curated?per_page=${pp}&page=${Math.floor(Math.random() * 100) + 1}`;
      }
      const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
      if (res.ok) {
        const data = await res.json();
        (data.photos ?? [])
          .filter(p => p.id && !discoverySlideshowSeenIds.has('p_' + p.id))
          .forEach(p => results.push({ _src: 'pexels', ...p }));
      }
    } catch {}
  }

  // Shuffle merged results
  return results.sort(() => Math.random() - 0.5);
}

async function downloadDiscoveryPhoto(photo, saveFolder) {
  let url;
  if (photo._src === 'pexels') {
    // Pexels: trigger attribution download event (guidelines compliance)
    if (photo.url) {
      fetch(`https://api.pexels.com/v1/photos/${photo.id}`, { headers: { Authorization: PEXELS_API_KEY } }).catch(() => {});
    }
    url = photo.src?.original || photo.src?.large2x || photo.src?.large;
  } else {
    // Unsplash: trigger required download event
    if (photo.links?.download_location && UNSPLASH_ACCESS_KEY) {
      fetch(photo.links.download_location, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } }).catch(() => {});
    }
    url = photo.urls?.full || photo.urls?.regular;
  }

  if (!url) throw new Error('No URL for photo');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.buffer();

  const prefix = photo._src === 'pexels' ? 'pexels' : 'unsplash';
  let destPath;
  if (saveFolder) {
    await fsp.mkdir(saveFolder, { recursive: true }).catch(() => {});
    const baseName = `${prefix}_${photo.id || Date.now()}.jpg`;
    destPath = path.join(saveFolder, baseName);
    await fsp.writeFile(destPath, buffer);

    try {
      const albums = await loadAlbums();
      const album = (albums.albums || []).find(a => a.folder === saveFolder);
      if (album) {
        const db = await loadDB();
        const exists = (db.wallpapers || []).some(w => w.path === destPath);
        if (!exists) {
          db.wallpapers = db.wallpapers || [];
          db.wallpapers.push({
            id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            path: destPath, name: path.basename(destPath),
            favorite: false, addedAt: Date.now(), albumId: album.id
          });
          await saveDB(db);
        }
      }
    } catch {}
  } else {
    const tmpDir = app.getPath('temp');
    destPath = path.join(tmpDir, `discovery_slide_${Date.now()}.jpg`);
    await fsp.writeFile(destPath, buffer);
  }

  return destPath;
}

async function replenishDiscoveryQueue() {
  if (discoverySlideshowFetching || discoverySlideshowQueue.length >= 5) return;
  discoverySlideshowFetching = true;
  try {
    // If multiple topics, pick one randomly each fetch
    let query = discoverySlideshowTopics;
    if (query && query.includes(',')) {
      const parts = query.split(',').map(t => t.trim()).filter(Boolean);
      query = parts[Math.floor(Math.random() * parts.length)];
    }
    const photos = await fetchDiscoveryPhotos(query);
    if (photos.length) {
      // Shuffle the fetched batch for extra randomness
      const shuffled = photos.sort(() => Math.random() - 0.5);
      discoverySlideshowQueue.push(...shuffled);
      discoverySlideshowPage++;
    }
  } catch {}
  discoverySlideshowFetching = false;
}

function getDiscoverySaveFolder() {
  const settings = loadAppSettingsSync();
  if (settings.discoverySaveFolderId) {
    // Resolve folder path synchronously — we need it inline
    try {
      const albumsRaw = fs.readFileSync(ALBUMS_FILE, 'utf8');
      const albums = JSON.parse(albumsRaw).albums || [];
      const album = albums.find(a => a.id === settings.discoverySaveFolderId);
      if (album?.folder) return album.folder;
    } catch {}
  }
  return null; // null = use temp, don't save permanently
}

function stopDiscoverySlideshow() {
  if (discoverySlideshowTimer) { clearInterval(discoverySlideshowTimer); discoverySlideshowTimer = null; }
  discoverySlideshowQueue = [];
  discoverySlideshowPage = 1;
  discoverySlideshowFetching = false;
  discoverySlideshowCurrentPhoto = null;
  discoverySlideshowCurrentPath = null;
  discoverySlideshowSeenIds = new Set(); // reset seen IDs on stop
  // Clean up temp files only (not saved ones)
  const tmpDir = app.getPath('temp');
  fsp.readdir(tmpDir).then(files => {
    files.filter(f => f.startsWith('discovery_slide_')).forEach(f => {
      fsp.unlink(path.join(tmpDir, f)).catch(() => {});
    });
  }).catch(() => {});
}

async function discoverySlideshowAdvance() {
  // Replenish if running low
  if (discoverySlideshowQueue.length <= 2) replenishDiscoveryQueue();

  const photo = discoverySlideshowQueue.shift();
  if (!photo) {
    // Queue temporarily empty — stay on current wallpaper, try to fetch more
    mainWindow?.webContents?.send('discovery-slideshow-tick', {
      photographer: discoverySlideshowCurrentPhoto?.user?.name || '',
      description: 'Fetching next image…',
      photoUrl: discoverySlideshowCurrentPhoto?.links?.html || '',
      thumbUrl: discoverySlideshowCurrentPhoto?.urls?.small || '',
      isLoading: true,
    });
    await replenishDiscoveryQueue();
    // Try once more — if still empty, skip this tick (keep current wallpaper)
    if (!discoverySlideshowQueue.length) return;
    return discoverySlideshowAdvance();
  }

  const saveFolder = getDiscoverySaveFolder();
  try {
    const tmpPath = await downloadDiscoveryPhoto(photo, saveFolder);
    await setAsWallpaper(tmpPath);
    discoverySlideshowCurrentPhoto = photo;
    discoverySlideshowCurrentPath = tmpPath;
    // Mark as seen with source-prefixed ID to avoid cross-source collisions
    if (photo.id) discoverySlideshowSeenIds.add((photo._src === 'pexels' ? 'p_' : 'u_') + photo.id);

    // Build normalized info for renderer — works for both sources
    const isPexels      = photo._src === 'pexels';
    const photographer  = isPexels ? (photo.photographer || 'Unknown') : (photo.user?.name || 'Unknown');
    const photographerUrl = isPexels ? (photo.photographer_url || '') : (photo.user?.links?.html || '');
    const photoPageUrl  = isPexels ? (photo.url || '') : (photo.links?.html || '');
    const thumbUrl      = isPexels ? (photo.src?.medium || photo.src?.small || '') : (photo.urls?.small || '');
    const source        = isPexels ? 'Pexels' : 'Unsplash';

    const info = {
      photographer, photographerUrl, photoPageUrl, thumbUrl, source,
      description: photo.alt || photo.alt_description || photo.description || '',
      isLoading: false,
    };
    mainWindow?.webContents?.send('discovery-slideshow-tick', info);
    rebuildTrayMenu();
  } catch (err) {
    console.error('Discovery slideshow advance failed:', err);
    const curP = discoverySlideshowCurrentPhoto;
    const curIsPexels = curP?._src === 'pexels';
    mainWindow?.webContents?.send('discovery-slideshow-tick', {
      photographer: curIsPexels ? (curP?.photographer || '') : (curP?.user?.name || ''),
      photographerUrl: '',
      photoPageUrl: '',
      thumbUrl: curIsPexels ? (curP?.src?.medium || '') : (curP?.urls?.small || ''),
      source: curIsPexels ? 'Pexels' : 'Unsplash',
      description: 'Download failed — retrying next tick…',
      isLoading: true,
    });
    discoverySlideshowQueue.unshift(photo);
  }
}

async function startDiscoverySlideshow(intervalMs, topics, source) {
  stopDiscoverySlideshow();
  if (!UNSPLASH_ACCESS_KEY && !PEXELS_API_KEY) {
    mainWindow?.webContents?.send('discovery-slideshow-error', 'No API key configured (Unsplash or Pexels).');
    return;
  }
  discoverySlideshowIntervalMs = intervalMs || 3600000;
  discoverySlideshowTopics = topics || '';
  discoverySlideshowSource = source || 'all';
  discoverySlideshowPage = 1;
  discoverySlideshowQueue = [];
  discoverySlideshowSeenIds = new Set();

  mainWindow?.webContents?.send('discovery-slideshow-status', { running: false, loading: true });
  await replenishDiscoveryQueue();
  if (!discoverySlideshowQueue.length) {
    mainWindow?.webContents?.send('discovery-slideshow-error', 'No images found. Try a different topic.');
    return;
  }

  // Show first image immediately
  await discoverySlideshowAdvance();
  mainWindow?.webContents?.send('discovery-slideshow-status', { running: true, loading: false });
  rebuildTrayMenu();

  discoverySlideshowTimer = setInterval(() => discoverySlideshowAdvance(), discoverySlideshowIntervalMs);
}

// ─── Favourite current Discovery photo ───────────────────────────────────────
async function favouriteCurrentDiscoveryPhoto() {
  if (!discoverySlideshowCurrentPhoto || !discoverySlideshowCurrentPath) return false;
  // Save to the configured folder (or first available album)
  const saveFolder = getDiscoverySaveFolder();
  let targetFolder = saveFolder;
  if (!targetFolder) {
    const albums = await loadAlbums();
    const first = (albums.albums || [])[0];
    if (!first?.folder) return false;
    targetFolder = first.folder;
  }
  // If already saved there (permanent save enabled), just mark favorite in DB
  const db = await loadDB();
  const existing = (db.wallpapers || []).find(w => w.path === discoverySlideshowCurrentPath);
  if (existing) {
    existing.favorite = true;
    await saveDB(db);
    mainWindow?.webContents?.send('discovery-slideshow-favourited', { name: existing.name });
    return true;
  }
  // Otherwise copy from temp to folder
  const baseName = `discovery_fav_${Date.now()}.jpg`;
  const destPath = path.join(targetFolder, baseName);
  await fsp.copyFile(discoverySlideshowCurrentPath, destPath);
  const albums = await loadAlbums();
  const album = (albums.albums || []).find(a => a.folder === targetFolder);
  const entry = {
    id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    path: destPath, name: baseName,
    favorite: true, addedAt: Date.now(),
    albumId: album?.id || null,
  };
  db.wallpapers = db.wallpapers || [];
  db.wallpapers.push(entry);
  await saveDB(db);
  mainWindow?.webContents?.send('discovery-slideshow-favourited', { name: baseName });
  return true;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────
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

// ─── System tray ─────────────────────────────────────────────────────────────
function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const settings = loadAppSettingsSync();

  const items = [
    {
      label: '🖼  Wallpaper Studio',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Wallpaper Studio',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
  ];

  // Local slideshow
  if (slideshowTimer) {
    items.push({ label: '▶  Slideshow Running', enabled: false });
    items.push({
      label: 'Change Photo Now',
      click: async () => {
        const list = await loadDB();
        let arr = slideshowAlbumId
          ? (list.wallpapers || []).filter(w => w.albumId === slideshowAlbumId)
          : (list.wallpapers || []);
        if (!arr.length) return;
        const available = arr.filter(x => !slideshowHistory.includes(x.id));
        const pool = available.length > 0 ? available : arr;
        const w = pool[Math.floor(Math.random() * pool.length)];
        if (w?.path) {
          await setAsWallpaper(w.path);
          slideshowCurrentId = w.id;
          slideshowCurrentPath = w.path;
          mainWindow?.webContents?.send('slideshow-tick', { id: w.id, name: w.name });
        }
      }
    });
    items.push({
      label: 'Stop Slideshow',
      click: () => {
        stopSlideshow();
        mainWindow?.webContents?.send('slideshow-stopped');
        rebuildTrayMenu();
      }
    });
  } else if (discoverySlideshowTimer) {
    items.push({ label: '🌐  Discovery Slideshow Running', enabled: false });
    items.push({
      label: 'Change Photo Now',
      click: () => discoverySlideshowAdvance(),
    });
    items.push({
      label: '★  Favourite Current Photo',
      click: async () => {
        const ok = await favouriteCurrentDiscoveryPhoto();
        if (!ok) mainWindow?.webContents?.send('discovery-slideshow-error', 'No photo to favourite yet.');
      }
    });
    items.push({
      label: 'Stop Discovery Slideshow',
      click: () => {
        stopDiscoverySlideshow();
        mainWindow?.webContents?.send('discovery-slideshow-status', { running: false, loading: false });
        rebuildTrayMenu();
      }
    });
  } else {
    // Build submenu of available folders
    let albumsForMenu = [];
    try {
      const albumsRaw = fs.readFileSync(ALBUMS_FILE, 'utf8');
      albumsForMenu = JSON.parse(albumsRaw).albums || [];
    } catch {}

    if (albumsForMenu.length > 0) {
      const folderSubmenu = albumsForMenu.map(a => ({
        label: a.name || 'Unnamed Folder',
        click: () => {
          // Stop any running slideshow first to prevent double-start bug
          stopSlideshow();
          stopDiscoverySlideshow();
          startSlideshow(slideshowIntervalMs, a.id, true);
          rebuildTrayMenu();
        }
      }));

      items.push({
        label: 'Start Slideshow',
        submenu: folderSubmenu,
      });
    } else {
      items.push({
        label: 'Start Slideshow',
        enabled: false,
      });
    }
  }

  // Daily wallpaper status
  if (settings.dailyWallpaperEnabled) {
    items.push({ type: 'separator' });
    items.push({ label: `📅  Daily Wallpaper at ${settings.dailyWallpaperTime || '08:00'}`, enabled: false });
    items.push({
      label: 'Change Wallpaper Now (Daily)',
      click: async () => { await triggerDailyWallpaper(); }
    });
  }

  items.push({ type: 'separator' });
  items.push({
    label: 'Quit',
    click: () => {
      stopSlideshow();
      stopDiscoverySlideshow();
      stopDailyWallpaperTimer();
      tray?.destroy();
      app.quit();
    }
  });

  const { Menu: M } = require('electron');
  tray.setContextMenu(M.buildFromTemplate(items));
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'icon.png');
  try {
    const icon = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('Wallpaper Studio');
    rebuildTrayMenu();

    // Single click also restores window
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
  } catch (e) {
    console.error('Tray creation failed:', e);
  }
}

// ─── Create main window ───────────────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(null);
  const iconPath = path.join(__dirname, '..', 'icon.png');

  const savedTheme = appSettings.theme || 'dark';
  const backgroundColor = savedTheme === 'light' ? '#f5f5f7' : '#0d0d10';

  mainWindow = new BrowserWindow({
    width: 1000, height: 700,
    minWidth: 760, minHeight: 500,
    show: false,
    backgroundColor,
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  let shown = false;
  const showWindow = () => {
    if (!shown) {
      shown = true;
      const settings = loadAppSettingsSync();
      if (settings.startMinimized) {
        mainWindow?.hide();
      } else {
        mainWindow?.show();
      }
    }
  };
  mainWindow.once('ready-to-show', showWindow);
  setTimeout(showWindow, 500);

  // Minimize-to-tray: hide to tray only when window is visible (titlebar - button)
  // We intercept 'minimize' but keep it in taskbar — use hide() which removes from taskbar only when we want
  mainWindow.on('minimize', (e) => {
    // Don't prevent default — let OS minimize normally (stays in taskbar)
    // Only hide completely to tray if a slideshow is running
    const anySlideshowRunning = slideshowTimer !== null || discoverySlideshowTimer !== null;
    if (anySlideshowRunning) {
      e.preventDefault();
      mainWindow.hide(); // truly hides from taskbar when slideshow is running
    }
    // Otherwise: normal minimize behavior (stays in taskbar minimized)
  });

  // Close guard: always ask on X button
  mainWindow.on('close', async (e) => {
    e.preventDefault();
    const anySlideshowRunning = slideshowTimer !== null || discoverySlideshowTimer !== null;

    if (anySlideshowRunning) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Slideshow is Running',
        message: 'A slideshow is currently running.',
        detail: 'Closing will stop the slideshow. Minimize to tray to keep it running.',
        buttons: ['Minimize to Tray', 'Stop & Close', 'Cancel'],
        defaultId: 0, cancelId: 2,
      });
      if (response === 0) { mainWindow.hide(); }
      else if (response === 1) {
        stopSlideshow();
        stopDiscoverySlideshow();
        stopDailyWallpaperTimer();
        mainWindow.destroy();
        app.quit();
      }
      // response === 2 → Cancel, do nothing
    } else {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Close Wallpaper Studio',
        message: 'Close Wallpaper Studio?',
        detail: 'The app will stop running. Minimize to tray to keep it in the background.',
        buttons: ['Minimize to Tray', 'Close', 'Cancel'],
        defaultId: 0, cancelId: 2,
      });
      if (response === 0) { mainWindow.hide(); }
      else if (response === 1) {
        stopDailyWallpaperTimer();
        mainWindow.destroy();
        app.quit();
      }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await ensureDataDir();
  await ensureAlbums();
  try { await pruneDbEntries(); } catch {}
  try { await syncFromStorageDir(); } catch {}
  try { await loadDB(); } catch { await saveDB({ wallpapers: [], settings: {} }); }

  // Check if launched as hidden (startup with tray)
  const launchHidden = process.argv.includes('--hidden') || appSettings.startMinimized;
  if (launchHidden) appSettings._startHidden = true;

  createWindow();
  createTray();
  scheduleDailyWallpaper();

  mainWindow?.webContents?.on('did-finish-load', () => {
    mainWindow?.webContents.send('refresh-gallery');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── IPC: App settings ────────────────────────────────────────────────────────
ipcMain.handle('get-app-settings', async () => loadAppSettingsSync());
ipcMain.handle('save-app-settings', async (e, newSettings) => {
  const merged = { ...loadAppSettingsSync(), ...newSettings };
  saveAppSettingsSync(merged);

  // Handle startWithWindows
  if (typeof newSettings.startWithWindows === 'boolean') {
    app.setLoginItemSettings({
      openAtLogin: newSettings.startWithWindows,
      openAsHidden: merged.startMinimized !== false,
      args: ['--hidden'],
    });
  }

  // Reschedule daily wallpaper if relevant settings changed
  if ('dailyWallpaperEnabled' in newSettings || 'dailyWallpaperTime' in newSettings) {
    scheduleDailyWallpaper();
    rebuildTrayMenu();
  }

  mainWindow?.webContents?.send('settings-updated', merged);
  return merged;
});

// ─── IPC: Unsplash ────────────────────────────────────────────────────────────
ipcMain.handle('get-unsplash-key', async () => UNSPLASH_ACCESS_KEY);
ipcMain.handle('get-pexels-key',  async () => PEXELS_API_KEY);

// ─── IPC: Albums ──────────────────────────────────────────────────────────────
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
ipcMain.handle('rename-album', async (e, id, newName) => {
  const alb = await loadAlbums();
  const album = (alb.albums || []).find(a => a.id === id);
  if (!album) throw new Error('Album not found');
  album.name = newName;
  await saveAlbums(alb);
  return true;
});

// ─── IPC: Images ─────────────────────────────────────────────────────────────
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

// ─── IPC: Spotlight ───────────────────────────────────────────────────────────
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

    const scanFlatDir = async (dirPath, label, priority) => {
      try {
        await fsp.access(dirPath);
        const fileStats = [];
        for (const file of await fsp.readdir(dirPath)) {
          const fp = path.join(dirPath, file); const lower = file.toLowerCase();
          try {
            const s = await fsp.stat(fp);
            if (s.isFile() && s.size > 200000 && (/\.(jpg|jpeg|png)$/i.test(lower) || !lower.includes('.'))) {
              fileStats.push({ path: fp, mtime: s.mtime, name: file });
            }
          } catch { continue; }
        }
        fileStats.sort((a, b) => b.mtime - a.mtime);
        for (const { path: fp, name } of fileStats) await addImage(fp, `${label} - ${name}`, priority);
      } catch {}
    };

    try {
      const sdPath = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft', 'Windows', 'SystemData');
      if (await fsp.access(sdPath).then(() => true).catch(() => false)) {
        for (const sid of await fsp.readdir(sdPath)) {
          const lsp = path.join(sdPath, sid, 'ReadOnly');
          try {
            for (const lf of await fsp.readdir(lsp)) {
              if (lf.startsWith('LockScreen_')) {
                const fp = path.join(lsp, lf);
                const fileStats = [];
                for (const file of await fsp.readdir(fp)) {
                  const lower = file.toLowerCase();
                  try {
                    const s = await fsp.stat(path.join(fp, file));
                    if (s.isFile() && s.size > 200000 && (/\.(jpg|jpeg|png)$/i.test(lower) || !lower.includes('.'))) {
                      fileStats.push({ path: path.join(fp, file), mtime: s.mtime, name: file });
                    }
                  } catch { continue; }
                }
                fileStats.sort((a, b) => b.mtime - a.mtime);
                for (const { path: filePath, name } of fileStats) await addImage(filePath, `Lock Screen - ${name}`, 1);
              }
            }
          } catch { continue; }
        }
      }
    } catch {}

    for (const ap of [
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy', 'LocalState', 'Assets'),
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_8wekyb3d8bbwe', 'LocalState', 'Assets')
    ]) { await scanFlatDir(ap, 'Spotlight', 2); }

    for (const dsp of [
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy', 'LocalState', 'DesktopSpotlight'),
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_8wekyb3d8bbwe', 'LocalState', 'DesktopSpotlight')
    ]) { await scanFlatDir(dsp, 'Desktop Spotlight', 2); }

    for (const isp of [
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy', 'LocalState', 'IrisService'),
      path.join(process.env.LOCALAPPDATA||'', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_8wekyb3d8bbwe', 'LocalState', 'IrisService')
    ]) { await scanFlatDir(isp, 'Spotlight', 2); }

    try {
      const cbsIris = path.join(process.env.LOCALAPPDATA||'', 'Packages', 'MicrosoftWindows.Client.CBS_cw5n1h2txyewy', 'LocalCache', 'Microsoft', 'IrisService');
      await fsp.access(cbsIris);
      for (const entry of await fsp.readdir(cbsIris)) {
        const sub = path.join(cbsIris, entry);
        try {
          if ((await fsp.stat(sub)).isDirectory()) await scanFlatDir(sub, 'Spotlight', 2);
        } catch { continue; }
      }
    } catch {}

    await scanFlatDir(
      path.join(process.env.WINDIR || 'C:\\Windows', 'Web', 'Wallpaper', 'Spotlight'),
      'Spotlight', 3
    );

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

ipcMain.handle('open-file-to-album', async (e, albumId) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif','bmp'] }],
  });
  if (canceled || !filePaths?.length) return null;
  const results = [];
  for (const fp of filePaths) results.push(await addWallpaperFromPath(fp, albumId));
  return results;
});

ipcMain.handle('download-and-set-wallpaper', async (e, url, filename, downloadLocation) => {
  const appSet = loadAppSettingsSync();
  const albums = await loadAlbums();
  const allAlbums = albums.albums || [];
  if (!allAlbums.length) throw new Error('No folders added yet. Add a folder first.');
  let album = allAlbums.find(a => a.id === appSet.defaultSaveFolderId) || allAlbums[0];

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
  const entry = { id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), path: destPath, name: baseName, favorite: false, addedAt: Date.now(), albumId: album.id };
  db.wallpapers = db.wallpapers || []; db.wallpapers.push(entry); await saveDB(db);
  await setAsWallpaper(destPath);
  return { entry, albumName: album.name };
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

ipcMain.on('start-slideshow', (e, interval, albumId, shuffle) => {
  stopDiscoverySlideshow(); // stop discovery if running
  startSlideshow(interval, albumId, shuffle);
});
ipcMain.on('stop-slideshow', () => stopSlideshow());
ipcMain.handle('get-slideshow-status', () => ({
  running: slideshowTimer !== null,
  intervalMs: slideshowIntervalMs,
  albumId: slideshowAlbumId,
  shuffle: slideshowShuffle,
}));

ipcMain.handle('download-image-url', async (e, url, filename, albumId, downloadLocation) => {
  try {
    const albums = await loadAlbums();
    const album = (albums.albums||[]).find(a => a.id === albumId);
    if (!album) throw new Error('Album not found');

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
    return entry;
  } catch (err) { console.error('Error downloading image URL:', err); throw err; }
});

// ─── IPC: Bulk operations ─────────────────────────────────────────────────────
ipcMain.handle('bulk-delete', async (e, ids) => {
  const db = await loadDB();
  let deleted = 0;
  for (const id of ids) {
    const w = (db.wallpapers || []).find(x => x.id === id);
    if (!w) continue;
    try { await fsp.unlink(w.path); } catch {}
    db.wallpapers = db.wallpapers.filter(x => x.id !== id);
    deleted++;
  }
  await saveDB(db);
  return deleted;
});

ipcMain.handle('bulk-favorite', async (e, ids, state) => {
  const db = await loadDB();
  for (const id of ids) {
    const w = (db.wallpapers || []).find(x => x.id === id);
    if (w) w.favorite = state;
  }
  await saveDB(db);
  return true;
});

ipcMain.handle('export-image', async (e, imagePath) => {
  const ext = path.extname(imagePath);
  const defaultName = 'wallpaper_export_' + Date.now() + ext;
  const { canceled, filePath: dest } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif','bmp'] }],
  });
  if (canceled || !dest) return null;
  await fsp.copyFile(imagePath, dest);
  return dest;
});

// ─── IPC: Discovery Slideshow ─────────────────────────────────────────────────
ipcMain.on('start-discovery-slideshow', (e, intervalMs, topics, source) => {
  stopSlideshow();
  startDiscoverySlideshow(intervalMs, topics, source);
});
ipcMain.on('stop-discovery-slideshow', () => {
  stopDiscoverySlideshow();
  mainWindow?.webContents?.send('discovery-slideshow-status', { running: false, loading: false });
  rebuildTrayMenu();
});
ipcMain.handle('get-discovery-slideshow-status', () => ({
  running: discoverySlideshowTimer !== null,
  intervalMs: discoverySlideshowIntervalMs,
  topics: discoverySlideshowTopics,
  hasKey: !!UNSPLASH_ACCESS_KEY,
}));
ipcMain.on('discovery-slideshow-change-now', () => discoverySlideshowAdvance());
ipcMain.handle('discovery-slideshow-favourite', async () => {
  return favouriteCurrentDiscoveryPhoto();
});

// ─── Daily Wallpaper (scheduled) ─────────────────────────────────────────────
let dailyWallpaperTimer = null;

function stopDailyWallpaperTimer() {
  if (dailyWallpaperTimer) { clearTimeout(dailyWallpaperTimer); dailyWallpaperTimer = null; }
}

async function triggerDailyWallpaper() {
  const settings = loadAppSettingsSync();
  if (!UNSPLASH_ACCESS_KEY && !PEXELS_API_KEY) return;

  const topics = settings.dailyWallpaperTopics || '';
  let query = topics;
  if (query && query.includes(',')) {
    const parts = query.split(',').map(t => t.trim()).filter(Boolean);
    query = parts[Math.floor(Math.random() * parts.length)];
  }

  // Pick source based on setting (and key availability)
  const srcPref = settings.dailyWallpaperSource || 'all';
  const sources = [];
  if (UNSPLASH_ACCESS_KEY && srcPref !== 'pexels')  sources.push('unsplash');
  if (PEXELS_API_KEY      && srcPref !== 'unsplash') sources.push('pexels');
  if (!sources.length) return; // no matching key for chosen source
  const source = sources[Math.floor(Math.random() * sources.length)];

  try {
    let photoUrl, photographer, pageUrl;

    if (source === 'unsplash') {
      const qParam = query ? `&query=${encodeURIComponent(query)}` : '';
      const res = await fetch(
        `https://api.unsplash.com/photos/random?orientation=landscape${qParam}`,
        { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } }
      );
      if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}`);
      const photo = await res.json();
      photoUrl     = photo.urls?.full || photo.urls?.regular;
      photographer = photo.user?.name || 'Unknown';
      pageUrl      = photo.links?.html || '';
      if (photo.links?.download_location) {
        fetch(photo.links.download_location, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } }).catch(() => {});
      }
    } else {
      // Pexels
      let url;
      if (query) {
        url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&page=${Math.floor(Math.random() * 20) + 1}&orientation=landscape`;
      } else {
        url = `https://api.pexels.com/v1/curated?per_page=1&page=${Math.floor(Math.random() * 500) + 1}`;
      }
      const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
      if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
      const data = await res.json();
      const photo = (data.photos ?? [])[0];
      if (!photo) throw new Error('No photos returned from Pexels');
      photoUrl     = photo.src?.original || photo.src?.large2x || photo.src?.large;
      photographer = photo.photographer || 'Unknown';
      pageUrl      = photo.url || '';
    }

    if (!photoUrl) throw new Error('No URL in response');

    const response2 = await fetch(photoUrl);
    if (!response2.ok) throw new Error(`Download HTTP ${response2.status}`);
    const buffer = await response2.buffer();
    const tmpDir = app.getPath('temp');
    const tmpPath = path.join(tmpDir, `daily_wallpaper_${Date.now()}.jpg`);
    await fsp.writeFile(tmpPath, buffer);
    await setAsWallpaper(tmpPath);

    mainWindow?.webContents?.send('daily-wallpaper-changed', { photographer, pageUrl, source });
    rebuildTrayMenu();
  } catch (err) {
    console.error('Daily wallpaper failed:', err);
  }
}

function scheduleDailyWallpaper() {
  stopDailyWallpaperTimer();
  const settings = loadAppSettingsSync();
  if (!settings.dailyWallpaperEnabled) return;

  const timeStr = settings.dailyWallpaperTime || '08:00';
  const [hh, mm] = timeStr.split(':').map(Number);

  function scheduleNext() {
    const now = new Date();
    const next = new Date();
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const msUntil = next - now;
    dailyWallpaperTimer = setTimeout(async () => {
      await triggerDailyWallpaper();
      scheduleNext();
    }, msUntil);
  }
  scheduleNext();
}

ipcMain.handle('trigger-daily-wallpaper-now', async () => {
  await triggerDailyWallpaper();
  return true;
});

ipcMain.handle('reschedule-daily-wallpaper', async () => {
  scheduleDailyWallpaper();
  return true;
});

// ─── IPC: App startup / login item ───────────────────────────────────────────
ipcMain.handle('set-start-with-windows', async (e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ['--hidden'] });
  return true;
});
ipcMain.handle('get-start-with-windows', async () => app.getLoginItemSettings().openAtLogin);
