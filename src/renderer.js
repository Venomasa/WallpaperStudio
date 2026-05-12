'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  view: 'empty',
  currentAlbumId: null,
  galleryMode: 'albums',
  albums: [],
  unsplashKey: '',
  pexelsKey: '',
  discoverSource: 'all',   // 'unsplash' | 'pexels' | 'all'
  unsplashPage: 1,
  pexelsPage: 1,
  unsplashCatIdx: 0,
  unsplashQuery: '',
  unsplashLoading: false,
  discoverReady: false,
  slideshowRunning: false,
  discoverySlideshowRunning: false,
  discoverySlideshowTopics: [],
  discoverySlideshowSource: 'all',  // 'unsplash' | 'pexels' | 'all'
  settingsSnapshot: null,
};

const CATS = [
  { label: 'Featured',     query: null,                    topic: null },
  { label: 'Nature',       query: 'nature landscape',      topic: 'nature' },
  { label: 'Architecture', query: 'architecture building', topic: 'architecture-interior' },
  { label: 'Space',        query: 'space galaxy stars',    topic: null },
  { label: 'Animals',      query: 'animals wildlife',      topic: 'animals' },
  { label: 'Travel',       query: 'travel landscape',      topic: 'travel' },
  { label: 'Minimal',      query: 'minimalist wallpaper',  topic: null },
  { label: 'Abstract',     query: 'abstract art wallpaper',topic: null },
  { label: 'City',         query: 'city skyline night',    topic: null },
  { label: 'Mountains',    query: 'mountains snow peaks',  topic: null },
];

const ACCENTS = [
  { name: 'Indigo', hex: '#6366f1', dark: '#4f46e5' },
  { name: 'Violet', hex: '#8b5cf6', dark: '#7c3aed' },
  { name: 'Blue',   hex: '#3b82f6', dark: '#2563eb' },
  { name: 'Cyan',   hex: '#06b6d4', dark: '#0891b2' },
  { name: 'Teal',   hex: '#14b8a6', dark: '#0d9488' },
  { name: 'Green',  hex: '#22c55e', dark: '#16a34a' },
  { name: 'Rose',   hex: '#f43f5e', dark: '#e11d48' },
  { name: 'Orange', hex: '#f97316', dark: '#ea580c' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Color utilities
// ─────────────────────────────────────────────────────────────────────────────
function darkenHex(hex, amount = 0.15) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16)        - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xFF) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xFF)        - Math.round(255 * amount));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}


const $ = id => document.getElementById(id);
const D = {};  // cached DOM references, filled in DOMContentLoaded

// ─────────────────────────────────────────────────────────────────────────────
// Settings helpers
// ─────────────────────────────────────────────────────────────────────────────
function applySettings(settings) {
  if (!settings) return;

  // Theme
  if (settings.theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;

  // Accent color
  if (settings.accentColor) {
    const r = document.documentElement;
    r.style.setProperty('--c-acc',  settings.accentColor);
    r.style.setProperty('--c-acc2', settings.accentColorDark || settings.accentColor);
  }

  // Thumbnail size
  if (settings.thumbnailSize) {
    const s = settings.thumbnailSize;
    document.documentElement.style.setProperty('--thumb-min', s + 'px');
    document.documentElement.style.setProperty('--thumb-h', Math.round(s * 0.66) + 'px');
  }

  // Show image names
  document.documentElement.classList.toggle('show-names', settings.showImageNames === true);
}

// Populate settings UI controls from a settings object
function populateSettingsUI(settings) {
  if (!settings) return;

  $('sel-theme').value     = settings.theme || 'dark';
  $('sel-thumbsize').value = String(settings.thumbnailSize || 210);
  $('chk-names').checked   = settings.showImageNames === true;
  $('ss-sel-interval').value = String(settings.slideshowInterval || 60000);

  // Startup settings
  const chkStartWindows = $('chk-start-windows');
  if (chkStartWindows) chkStartWindows.checked = settings.startWithWindows === true;
  const chkStartMin = $('chk-start-minimized');
  if (chkStartMin) chkStartMin.checked = settings.startMinimized === true;

  // Daily wallpaper settings
  const chkDaily = $('chk-daily-wallpaper');
  if (chkDaily) {
    chkDaily.checked = settings.dailyWallpaperEnabled === true;
    toggleDailyRows(chkDaily.checked);
  }
  const inpTime = $('inp-daily-time');
  if (inpTime) inpTime.value = settings.dailyWallpaperTime || '08:00';
  const inpTopics = $('inp-daily-topics');
  if (inpTopics) inpTopics.value = settings.dailyWallpaperTopics || '';
  const selDailySrc = $('sel-daily-source');
  if (selDailySrc) selDailySrc.value = settings.dailyWallpaperSource || 'all';
  // Hide source selector if only one source is available
  const rowDailySrc = $('row-daily-source');
  if (rowDailySrc) rowDailySrc.style.display = (S.unsplashKey && S.pexelsKey) ? '' : 'none';

  // Accent swatches + wheel
  const savedAccent = settings.accentColor || '#6366f1';
  let matchedSwatch = false;
  $('swatches').querySelectorAll('.swatch').forEach(sw => {
    const isActive = sw.dataset.hex === savedAccent;
    sw.classList.toggle('active', isActive);
    if (isActive) matchedSwatch = true;
  });
  const wheel = $('accent-wheel');
  if (wheel) wheel.value = savedAccent;

  // Default save folder dropdown
  const selFolder = $('sel-default-folder');
  if (selFolder) {
    selFolder.innerHTML = '<option value="">— No preference (uses first folder) —</option>';
    S.albums.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      selFolder.appendChild(opt);
    });
    selFolder.value = settings.defaultSaveFolderId || '';
  }
}

function toggleDailyRows(enabled) {
  ['row-daily-time', 'row-daily-source', 'row-daily-topics', 'row-daily-test'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', !enabled);
  });
}

// Collect current values from settings UI controls into an object
function collectSettingsUI(prev) {
  const activeSwatch = $('swatches').querySelector('.swatch.active');
  const wheel = $('accent-wheel');
  const accentHex  = activeSwatch ? activeSwatch.dataset.hex  : (wheel ? wheel.value : (prev.accentColor  || '#6366f1'));
  const accentDark = activeSwatch ? activeSwatch.dataset.dark : darkenHex(accentHex, 0.15);
  return {
    ...prev,
    theme:                  $('sel-theme').value,
    accentColor:            accentHex,
    accentColorDark:        accentDark,
    thumbnailSize:          parseInt($('sel-thumbsize').value, 10),
    showImageNames:         $('chk-names').checked,
    slideshowInterval:      parseInt($('ss-sel-interval').value, 10),
    defaultSaveFolderId:    $('sel-default-folder')?.value || prev.defaultSaveFolderId || '',
    startWithWindows:       $('chk-start-windows')?.checked ?? prev.startWithWindows ?? false,
    startMinimized:         $('chk-start-minimized')?.checked ?? prev.startMinimized ?? false,
    dailyWallpaperEnabled:  $('chk-daily-wallpaper')?.checked ?? prev.dailyWallpaperEnabled ?? false,
    dailyWallpaperTime:     $('inp-daily-time')?.value || prev.dailyWallpaperTime || '08:00',
    dailyWallpaperSource:   $('sel-daily-source')?.value || prev.dailyWallpaperSource || 'all',
    dailyWallpaperTopics:   $('inp-daily-topics')?.value ?? prev.dailyWallpaperTopics ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy image loading
// ─────────────────────────────────────────────────────────────────────────────
function applyLazySrc(img) {
  if (!img.dataset.src) return;
  const src = img.dataset.src;
  img.removeAttribute('data-src');
  img.onload  = () => { img.classList.add('loaded'); img.onload = img.onerror = null; };
  img.onerror = () => { img.classList.add('loaded'); img.onerror = null; };
  img.src = src;
}

const imgObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { applyLazySrc(e.target); imgObs.unobserve(e.target); } });
}, { rootMargin: '300px 0px' });

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' toast-err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('on');
    setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 320); }, 2700);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────────────────────────────────────
function openLightbox(src, credit) {
  D.lbImg.classList.remove('loaded');
  D.lbImg.onload  = () => D.lbImg.classList.add('loaded');
  D.lbImg.onerror = () => D.lbImg.classList.add('loaded');
  D.lbImg.src = src;
  D.lbCredit.innerHTML = credit || '';
  D.lbCredit.style.display = credit ? 'block' : 'none';
  D.lightbox.classList.add('on');
}
function closeLightbox() {
  D.lightbox.classList.remove('on');
  D.lbImg.src = '';
  D.lbImg.classList.remove('loaded');
  D.lbImg.onload = D.lbImg.onerror = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Album picker modal
// ─────────────────────────────────────────────────────────────────────────────
function pickAlbum(albums) {
  return new Promise(resolve => {
    D.apList.innerHTML = '';
    if (!albums?.length) { resolve(null); return; }
    albums.forEach(a => {
      const b = document.createElement('button');
      b.className = 'ap-item';
      b.innerHTML = `<span>&#128193;</span><span>${a.name}</span>`;
      b.title = a.folder || '';
      b.onclick = () => { D.apModal.classList.remove('on'); resolve(a); };
      D.apList.appendChild(b);
    });
    D.apCancel.onclick = () => { D.apModal.classList.remove('on'); resolve(null); };
    D.apModal.classList.add('on');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Details panel
// ─────────────────────────────────────────────────────────────────────────────
let _detPath = '';
async function openDetails(w) {
  _detPath = w.path;
  D.detImg.src = 'file://' + w.path;
  D.detName.textContent = w.name || '—';
  D.detPath.textContent = w.path;
  D.detDims.textContent = '…';
  D.detSize.textContent = '…';
  D.detDate.textContent = '…';
  D.detPanel.classList.add('on');
  try {
    const m = await window.wp.getImageMetadata(w.path);
    D.detDims.textContent = m.dimensions || '—';
    D.detSize.textContent = m.size ? (m.size / 1024).toFixed(1) + ' KB' : '—';
    D.detDate.textContent = m.date || '—';
  } catch {}
}
function closeDetails() { D.detPanel.classList.remove('on'); }

// ─────────────────────────────────────────────────────────────────────────────
// Context menu
// ─────────────────────────────────────────────────────────────────────────────
let _ctx = null;
function showCtxMenu(e, data) {
  e.stopPropagation();
  _ctx = data;
  $('ctx-unfav').style.display = data.isFav ? 'flex' : 'none';
  $('ctx-sep').style.display   = data.isFav ? 'block' : 'none';
  D.ctxMenu.classList.add('on');
  const mw = D.ctxMenu.offsetWidth, mh = D.ctxMenu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth  - 8) x = window.innerWidth  - mw - 8;
  if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
  D.ctxMenu.style.left = x + 'px';
  D.ctxMenu.style.top  = y + 'px';
  setTimeout(() => document.addEventListener('click', hideCtxMenu, { once: true }), 60);
}
function hideCtxMenu() { D.ctxMenu.classList.remove('on'); }

async function ctxCopy() {
  hideCtxMenu();
  const dest = S.albums.length === 1 ? S.albums[0] : await pickAlbum(S.albums);
  if (!dest) return;
  try {
    if (_ctx.isSpot) await window.wp.copySpotlightToAlbum(_ctx.w.path, dest.id);
    else             await window.wp.copyToAlbum(_ctx.w.path, dest.id);
    toast('Copied to "' + dest.name + '"');
  } catch { toast('Copy failed', 'error'); }
}

async function ctxDelete() {
  hideCtxMenu();
  if (!confirm('Permanently delete this image from your system?')) return;
  try {
    await window.wp.deleteImage(_ctx.w.path);
    removeCard(_ctx.card);
    toast('Deleted');
  } catch { toast('Delete failed', 'error'); }
}

async function ctxDetails() { hideCtxMenu(); await openDetails(_ctx.w); }

async function ctxUnfav() {
  hideCtxMenu();
  try {
    await window.wp.toggleFavorite(_ctx.w.id);
    _ctx.w.favorite = false;
    _ctx.favBtn.innerHTML = '&#9734;';
    _ctx.favBtn.classList.remove('fav-on');
    if (S.galleryMode === 'favorites') removeCard(_ctx.card);
  } catch { toast('Failed', 'error'); }
}

async function ctxExport() {
  hideCtxMenu();
  try {
    const dest = await window.wp.exportImage(_ctx.w.path);
    if (dest) toast('Exported to: ' + dest.split('\\').pop());
  } catch { toast('Export failed', 'error'); }
}

async function ctxSetWallpaper() {
  hideCtxMenu();
  try {
    await window.wp.setWallpaper(_ctx.w.path);
    toast('Wallpaper set!');
  } catch { toast('Failed to set wallpaper', 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────
function buildFoldersList() {
  D.foldersList.innerHTML = '';
  S.albums.forEach(a => {
    const div = document.createElement('div');
    div.className = 'nav-item folder-item' + (S.view === 'gallery' && S.galleryMode === 'albums' && S.currentAlbumId === a.id ? ' active' : '');
    div.dataset.id = a.id;

    const span = document.createElement('span');
    span.className = 'folder-name';
    span.textContent = a.name;
    span.title = a.folder || '';

    const del = document.createElement('button');
    del.className = 'folder-del';
    del.textContent = '\u2715';
    del.title = 'Remove folder';
    del.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`Remove "${a.name}" from app?\n\nFiles will NOT be deleted.`)) return;
      try {
        await window.wp.removeAlbum(a.id);
        S.albums = S.albums.filter(x => x.id !== a.id);
        if (S.currentAlbumId === a.id) S.currentAlbumId = null;
        buildFoldersList();
        if (!S.albums.length) await navigateTo('empty');
        else if (S.view === 'gallery' && S.galleryMode === 'albums' && !S.currentAlbumId) {
          await navigateTo('gallery', 'albums', S.albums[0].id);
        }
      } catch (err) { toast('Failed: ' + err.message, 'error'); }
    };

    div.appendChild(span);
    div.appendChild(del);
    div.onclick = async e => { if (e.target === del) return; await navigateTo('gallery', 'albums', a.id); };
    D.foldersList.appendChild(div);
  });
}

function updateActiveNav() {
  // Clear all
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  if (S.view === 'gallery') {
    if (S.galleryMode === 'spotlight') $('nav-spot')?.classList.add('active');
    if (S.galleryMode === 'favorites') $('nav-fav')?.classList.add('active');
    if (S.galleryMode === 'albums' && S.currentAlbumId) {
      D.foldersList.querySelector(`[data-id="${S.currentAlbumId}"]`)?.classList.add('active');
    }
  }
  if (S.view === 'discover')  $('nav-disc')?.classList.add('active');
  if (S.view === 'settings')  $('nav-settings')?.classList.add('active');
  if (S.view === 'slideshow') $('nav-slideshow')?.classList.add('active');

  // Show the Spotlight refresh button only when browsing Spotlight
  const spotRefresh = $('btn-spot-refresh');
  if (spotRefresh) spotRefresh.style.display = (S.view === 'gallery' && S.galleryMode === 'spotlight') ? '' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// View router
// ─────────────────────────────────────────────────────────────────────────────
// Views: 'empty' | 'gallery' | 'discover' | 'settings' | 'slideshow'
// galleryMode: 'albums' | 'favorites' | 'spotlight'
async function navigateTo(view, galleryMode, albumId) {
  closeDetails();
  hideCtxMenu();

  S.view = view;
  if (galleryMode !== undefined) S.galleryMode = galleryMode;
  if (albumId     !== undefined) S.currentAlbumId = albumId;
  if (view === 'gallery' && S.galleryMode === 'albums' && S.currentAlbumId) {
    await window.wp.setCurrentAlbum(S.currentAlbumId);
  }

  // Activate the right view panel
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const viewId = {
    empty:     'view-empty',
    gallery:   'view-gallery',
    discover:  'view-discover',
    settings:  'view-settings',
    slideshow: 'view-slideshow',
  }[view];
  if (viewId) $(viewId)?.classList.add('active');

  updateActiveNav();

  // View-specific init
  if (view === 'discover') {
    if (!S.discoverReady && (S.unsplashKey || S.pexelsKey)) { S.discoverReady = true; loadDiscover(); }
    return;
  }

  if (view === 'gallery') {
    // Show toolbar only for album mode (not spotlight/favorites)
    const toolbar = $('gallery-toolbar');
    const folderNameEl = $('gallery-folder-name');
    if (toolbar) {
      const isAlbum = (galleryMode || S.galleryMode) === 'albums' && S.currentAlbumId;
      toolbar.classList.toggle('visible', !!isAlbum);
      if (isAlbum && folderNameEl) {
        const album = S.albums.find(a => a.id === S.currentAlbumId);
        folderNameEl.textContent = album ? album.name : '';
      }
    }
    await renderGallery();
    return;
  }

  if (view === 'settings') {
    // Snapshot current settings so Discard works
    try {
      S.settingsSnapshot = await window.wp.getAppSettings();
      populateSettingsUI(S.settingsSnapshot);
    } catch {}
    return;
  }

  if (view === 'slideshow') {
    // Sync running state from main process (source of truth for the timer)
    try {
      const status = await window.wp.getSlideshowStatus();
      S.slideshowRunning = status.running;
      if (status.intervalMs) $('ss-sel-interval').value = String(status.intervalMs);
    } catch {
      // Fallback: populate interval from saved settings
      try {
        const cfg = await window.wp.getAppSettings();
        $('ss-sel-interval').value = String(cfg.slideshowInterval || 60000);
      } catch {}
    }
    // Populate source dropdown
    const srcSel = $('ss-source-sel');
    if (srcSel) {
      const prev = srcSel.value;
      srcSel.innerHTML = '<option value="">All Albums</option>';
      S.albums.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        srcSel.appendChild(opt);
      });
      // Restore previous selection if still valid, else default to current album
      if (prev && S.albums.find(a => a.id === prev)) srcSel.value = prev;
      else if (S.galleryMode === 'albums' && S.currentAlbumId) srcSel.value = S.currentAlbumId;
    }
    updateSlideshowUI();
    // Re-check Discovery Slideshow availability and repopulate selects
    initDiscoverySlideshow();
    populateDiscoverySaveFolderSelect();
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery
// ─────────────────────────────────────────────────────────────────────────────
async function renderGallery() {
  imgObs.disconnect();
  let items = [];
  try {
    if (S.galleryMode === 'spotlight')     items = await window.wp.getSpotlightImages() || [];
    else if (S.galleryMode === 'favorites') items = (await window.wp.getAllWallpapers() || []).filter(w => w.favorite);
    else if (S.galleryMode === 'albums' && S.currentAlbumId) items = await window.wp.getWallpapers() || [];
  } catch (err) { console.error('Gallery load error', err); }

  const frag = document.createDocumentFragment();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'gal-empty';
    const m = { spotlight: 'No Spotlight images found', favorites: 'No favourites yet — click the star on any image', albums: 'This folder is empty' };
    empty.textContent = m[S.galleryMode] || 'No images';
    frag.appendChild(empty);
  } else {
    items.forEach(w => frag.appendChild(makeCard(w)));
  }

  D.gallery.style.visibility = 'hidden';
  D.gallery.innerHTML = '';
  D.gallery.appendChild(frag);
  D.gallery.querySelectorAll('img[data-src]').forEach(img => imgObs.observe(img));
  requestAnimationFrame(() => { D.gallery.style.visibility = ''; });
}

function makeCard(w) {
  const card = document.createElement('div');
  card.className = 'card';

  const img = document.createElement('img');
  img.className = 'thumb';
  img.alt = w.name || '';
  img.dataset.src = 'file://' + w.path;
  img.onclick = () => openLightbox('file://' + w.path);

  // Image name label (visible only when show-names CSS class is active)
  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = w.name || '';

  const bar = document.createElement('div');
  bar.className = 'card-bar';

  const favBtn = document.createElement('button');
  // Spotlight images are not in the DB so favouriting them is not supported.
  // Hide the star button entirely for spotlight entries.
  const isSpotlightCard = !!w.isSpotlight;
  if (isSpotlightCard) {
    favBtn.style.display = 'none';
  } else {
    favBtn.className = 'btn-icon' + (w.favorite ? ' fav-on' : '');
    favBtn.title = w.favorite ? 'Remove from favourites' : 'Add to favourites';
    favBtn.innerHTML = w.favorite ? '&#9733;' : '&#9734;';
    favBtn.onclick = async e => {
      e.stopPropagation();
      try {
        await window.wp.toggleFavorite(w.id);
        w.favorite = !w.favorite;
        favBtn.innerHTML = w.favorite ? '&#9733;' : '&#9734;';
        favBtn.classList.toggle('fav-on', w.favorite);
        if (S.galleryMode === 'favorites' && !w.favorite) removeCard(card);
      } catch {}
    };
  }

  const setBtn = document.createElement('button');
  setBtn.className = 'btn-set';
  setBtn.textContent = 'Set';
  setBtn.onclick = async e => {
    e.stopPropagation();
    setBtn.disabled = true; setBtn.textContent = '...';
    try {
      await window.wp.setWallpaper(w.path);
      toast('Wallpaper set!');
    } catch (err) {
      toast('Failed to set wallpaper', 'error');
      console.error(err);
    } finally {
      setBtn.disabled = false; setBtn.textContent = 'Set';
    }
  };

  const moreBtn = document.createElement('button');
  moreBtn.className = 'btn-icon btn-more';
  moreBtn.textContent = '\u22EE';
  moreBtn.title = 'Options';
  moreBtn.onclick = e => {
    showCtxMenu(e, { w, card, favBtn, isFav: S.galleryMode === 'favorites', isSpot: S.galleryMode === 'spotlight' });
  };

  bar.appendChild(favBtn);
  bar.appendChild(setBtn);
  bar.appendChild(moreBtn);
  card.appendChild(img);
  card.appendChild(nameEl);
  card.appendChild(bar);
  return card;
}

function removeCard(card) {
  card.classList.add('removing');
  setTimeout(() => {
    card.remove();
    if (!D.gallery.querySelector('.card')) renderGallery();
  }, 280);
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery Slideshow UI
// ─────────────────────────────────────────────────────────────────────────────
function renderDiscoverySlideshowTopics() {
  const wrap = $('disc-ss-topics-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!S.discoverySlideshowTopics.length) {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:12px;color:var(--c-txt3);font-style:italic';
    hint.textContent = 'No topics — showing popular wallpapers';
    wrap.appendChild(hint);
    return;
  }
  S.discoverySlideshowTopics.forEach((topic, idx) => {
    const tag = document.createElement('span');
    tag.className = 'disc-ss-topic-tag';
    tag.innerHTML = `${topic}<button class="tag-rm" title="Remove">&#x2715;</button>`;
    tag.querySelector('.tag-rm').onclick = () => {
      S.discoverySlideshowTopics.splice(idx, 1);
      renderDiscoverySlideshowTopics();
    };
    wrap.appendChild(tag);
  });
}

function updateDiscoverySlideshowUI(running, loading) {
  const startBtn  = $('btn-disc-ss-start');
  const stopBtn   = $('btn-disc-ss-stop');
  const favBtn    = $('btn-disc-ss-fav');
  const nextBtn   = $('btn-disc-ss-next');
  const statusTxt = $('disc-ss-status-text');
  const dot       = $('disc-ss-dot');
  if (!startBtn) return;

  if (loading) {
    startBtn.style.display = 'none';
    stopBtn.style.display  = 'none';
    if (favBtn)  favBtn.style.display  = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (statusTxt) statusTxt.textContent = 'Fetching images…';
    if (dot) { dot.classList.remove('running'); }
    return;
  }
  startBtn.style.display = running ? 'none'        : 'inline-flex';
  stopBtn.style.display  = running ? 'inline-flex' : 'none';
  if (favBtn)  favBtn.style.display  = running ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = running ? 'inline-flex' : 'none';
  if (dot) dot.classList.toggle('running', running);
  if (statusTxt && !running) statusTxt.textContent = 'Discovery Slideshow is stopped';
}

function populateDiscoverySaveFolderSelect() {
  const sel = $('disc-ss-save-folder');
  if (!sel) return;
  // Keep first option (temp only)
  while (sel.options.length > 1) sel.remove(1);
  S.albums.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  });
  // Restore saved setting
  window.wp.getAppSettings().then(settings => {
    if (settings?.discoverySaveFolderId) sel.value = settings.discoverySaveFolderId;
  }).catch(() => {});
  sel.onchange = () => {
    window.wp.saveAppSettings({ discoverySaveFolderId: sel.value }).catch(() => {});
  };
}

function initDiscoverySlideshow() {
  const noKey = $('disc-ss-no-key');
  const ui    = $('disc-ss-ui');
  if (!S.unsplashKey && !S.pexelsKey) {
    if (noKey) noKey.style.display = '';
    if (ui)    ui.style.display    = 'none';
    return;
  }
  if (noKey) noKey.style.display = 'none';
  if (ui)    ui.style.display    = '';

  // Source selector — hide options for keys that aren't present
  const srcSel = $('disc-ss-source');
  const srcRow = $('row-disc-ss-source');
  if (srcSel) {
    if (!S.unsplashKey || !S.pexelsKey) {
      // Only one source available — hide selector, force to available source
      if (srcRow) srcRow.style.display = 'none';
      S.discoverySlideshowSource = S.unsplashKey ? 'unsplash' : 'pexels';
    } else {
      if (srcRow) srcRow.style.display = '';
      srcSel.value = S.discoverySlideshowSource;
      srcSel.onchange = () => { S.discoverySlideshowSource = srcSel.value; };
    }
  }

  renderDiscoverySlideshowTopics();
  populateDiscoverySaveFolderSelect();

  // Add topic
  $('btn-disc-ss-add-topic').onclick = () => {
    const inp = $('disc-ss-topic-in');
    const val = inp.value.trim();
    if (val && !S.discoverySlideshowTopics.includes(val)) {
      S.discoverySlideshowTopics.push(val);
      renderDiscoverySlideshowTopics();
    }
    inp.value = '';
    inp.focus();
  };
  $('disc-ss-topic-in').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-disc-ss-add-topic').click();
  });

  // Start
  $('btn-disc-ss-start').onclick = () => {
    const intervalMs = parseInt($('disc-ss-interval').value, 10) || 3600000;
    const topics = S.discoverySlideshowTopics.join(',');
    const source = S.discoverySlideshowSource || 'all';
    window.wp.startDiscoverySlideshow(intervalMs, topics, source);
    S.discoverySlideshowRunning = true;
    updateDiscoverySlideshowUI(true, true);
    toast('Discovery Slideshow starting…');
  };

  // Stop
  $('btn-disc-ss-stop').onclick = () => {
    window.wp.stopDiscoverySlideshow();
    S.discoverySlideshowRunning = false;
    updateDiscoverySlideshowUI(false, false);
    const thumb = $('disc-ss-thumb');
    if (thumb) { thumb.src = ''; thumb.classList.remove('visible'); }
    const credit = $('disc-ss-credit'); if (credit) credit.innerHTML = '';
    toast('Discovery Slideshow stopped');
  };

  // Skip to next
  const nextBtn = $('btn-disc-ss-next');
  if (nextBtn) nextBtn.onclick = () => {
    window.wp.discoverySlideshowChangeNow();
    toast('Loading next photo…');
  };

  // Favourite current
  const favBtn = $('btn-disc-ss-fav');
  if (favBtn) favBtn.onclick = async () => {
    favBtn.disabled = true;
    try {
      const ok = await window.wp.discoverySlideshowFavourite();
      toast(ok ? '★ Photo saved to favourites' : 'Nothing to favourite yet', ok ? 'info' : 'error');
    } catch { toast('Could not save photo', 'error'); }
    finally { favBtn.disabled = false; }
  };

  // ── Events from main ──────────────────────────────────────────────────────
  window.wp.onDiscoverySlideshowStatus(({ running, loading }) => {
    S.discoverySlideshowRunning = running;
    updateDiscoverySlideshowUI(running, loading);
  });

  window.wp.onDiscoverySlideshowTick(info => {
    const txt = $('disc-ss-status-text');
    if (txt) {
      if (info.isLoading) {
        txt.textContent = info.description || 'Waiting for download…';
      } else {
        txt.textContent = info.photographer ? 'Photo by ' + info.photographer : (info.description || 'Live wallpaper');
      }
    }
    const thumb = $('disc-ss-thumb');
    if (thumb && info.thumbUrl) { thumb.src = info.thumbUrl; thumb.classList.add('visible'); }
    const credit = $('disc-ss-credit');
    if (credit) {
      if (info.photographer && !info.isLoading) {
        const sourceLabel = info.source || 'Unsplash';
        const link = info.photoPageUrl
          ? `<a href="${info.photoPageUrl}" target="_blank">${info.photographer}</a>`
          : info.photographer;
        credit.innerHTML = `Photo by ${link} on ${sourceLabel}`;
      } else if (info.isLoading) {
        credit.innerHTML = '<em style="color:var(--c-txt3)">Downloading next…</em>';
      }
    }
  });

  window.wp.onDiscoverySlideshowError(msg => {
    S.discoverySlideshowRunning = false;
    updateDiscoverySlideshowUI(false, false);
    toast(msg, 'error');
  });

  if (window.wp.onDiscoverySlideshowFavourited) {
    window.wp.onDiscoverySlideshowFavourited(({ name }) => {
      toast(`★ Saved: ${name}`);
    });
  }

  if (window.wp.onDailyWallpaperChanged) {
    window.wp.onDailyWallpaperChanged(({ photographer }) => {
      toast(`📅 Daily wallpaper updated${photographer ? ' — ' + photographer : ''}`);
    });
  }

  // Sync status on (re)enter
  window.wp.getDiscoverySlideshowStatus().then(status => {
    if (status) {
      S.discoverySlideshowRunning = status.running;
      updateDiscoverySlideshowUI(status.running, false);
    }
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Slideshow UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function updateSlideshowUI() {
  const dot      = $('ss-dot');
  const txt      = $('ss-status-text');
  const startBtn = $('btn-ss-start');
  const stopBtn  = $('btn-ss-stop');
  if (S.slideshowRunning) {
    dot.classList.add('running');
    txt.textContent = 'Slideshow is running';
    startBtn.style.display = 'none';
    stopBtn.style.display  = 'inline-flex';
  } else {
    dot.classList.remove('running');
    txt.textContent = 'Slideshow is stopped';
    startBtn.style.display = 'inline-flex';
    stopBtn.style.display  = 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings UI wiring (called once on DOMContentLoaded)
// ─────────────────────────────────────────────────────────────────────────────
function initSettingsUI() {
  // Build accent swatches
  const container = $('swatches');
  ACCENTS.forEach(({ name, hex, dark }) => {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.style.background = hex;
    btn.title = name;
    btn.dataset.hex  = hex;
    btn.dataset.dark = dark;
    btn.onclick = () => {
      container.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      // Sync wheel to swatch color
      const wheel = $('accent-wheel');
      if (wheel) wheel.value = hex;
      // Live preview
      document.documentElement.style.setProperty('--c-acc',  hex);
      document.documentElement.style.setProperty('--c-acc2', dark);
    };
    container.appendChild(btn);
  });

  // Color wheel — custom accent picker
  const wheel = $('accent-wheel');
  if (wheel) {
    wheel.addEventListener('input', e => {
      const hex = e.target.value;
      // Deselect preset swatches
      container.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      // Live preview
      document.documentElement.style.setProperty('--c-acc',  hex);
      document.documentElement.style.setProperty('--c-acc2', darkenHex(hex, 0.15));
    });
  }

  // Theme live preview
  $('sel-theme').addEventListener('change', e => {
    if (e.target.value === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  });

  // Daily wallpaper toggle — show/hide sub-rows
  const chkDailyEl = $('chk-daily-wallpaper');
  if (chkDailyEl) {
    chkDailyEl.addEventListener('change', () => toggleDailyRows(chkDailyEl.checked));
  }

  // Daily test button
  const btnDailyTest = $('btn-daily-test');
  if (btnDailyTest) {
    btnDailyTest.onclick = async () => {
      btnDailyTest.disabled = true;
      btnDailyTest.textContent = 'Fetching…';
      try {
        // Save current settings first so triggerDailyWallpaper uses latest topics
        const cur = collectSettingsUI(S.settingsSnapshot || {});
        await window.wp.saveAppSettings(cur);
        await window.wp.triggerDailyWallpaperNow();
        toast('Daily wallpaper updated!');
      } catch { toast('Failed to change wallpaper', 'error'); }
      btnDailyTest.disabled = false;
      btnDailyTest.textContent = 'Change Now';
    };
  }

  // Save
  $('btn-settings-save').onclick = async () => {
    const next = collectSettingsUI(S.settingsSnapshot || {});
    try {
      await window.wp.saveAppSettings(next);
      S.settingsSnapshot = next;
      applySettings(next);
      toast('Settings saved');
    } catch { toast('Failed to save settings', 'error'); }
  };

  // Discard — re-apply snapshot and repopulate controls
  $('btn-settings-discard').onclick = () => {
    if (S.settingsSnapshot) {
      applySettings(S.settingsSnapshot);
      populateSettingsUI(S.settingsSnapshot);
    }
    toast('Changes discarded');
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discover — fetch helpers (Unsplash + Pexels)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchUnsplash(q, topic, page) {
  if (!S.unsplashKey) return [];
  const pp = 24;
  let url;
  if (q)          url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${pp}&page=${page}&orientation=landscape`;
  else if (topic) url = `https://api.unsplash.com/topics/${topic}/photos?per_page=${pp}&page=${page}&orientation=landscape`;
  else            url = `https://api.unsplash.com/photos?per_page=${pp}&page=${page}&order_by=popular`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${S.unsplashKey}` } });
    if (res.status === 401) { toast('Invalid Unsplash API key', 'error'); return []; }
    if (!res.ok) return [];
    const data = await res.json();
    const photos = Array.isArray(data) ? data : (data.results ?? []);
    return photos.map(p => ({ _src: 'unsplash', ...p }));
  } catch { return []; }
}

async function fetchPexels(q, page) {
  if (!S.pexelsKey) return [];
  const pp = 24;
  let url;
  if (q) url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${pp}&page=${page}&orientation=landscape`;
  else   url = `https://api.pexels.com/v1/curated?per_page=${pp}&page=${page}`;
  try {
    const res = await fetch(url, { headers: { Authorization: S.pexelsKey } });
    if (res.status === 401) { toast('Invalid Pexels API key', 'error'); return []; }
    if (!res.ok) return [];
    const data = await res.json();
    return (data.photos ?? []).map(p => ({ _src: 'pexels', ...p }));
  } catch { return []; }
}

// Build a normalised photo card for any source
function makeDiscCard(photo) {
  const isPexels = photo._src === 'pexels';

  // Normalise fields
  const thumbUrl   = isPexels ? (photo.src?.medium || photo.src?.small || '') : (photo.urls?.small || '');
  const fullUrl    = isPexels ? (photo.src?.original || photo.src?.large2x || photo.src?.large || '') : (photo.urls?.full || photo.urls?.regular || '');
  const pageUrl    = isPexels ? (photo.url || '') : (photo.links?.html || '');
  const dlLocation = isPexels ? null : photo.links?.download_location;
  const photographer = isPexels ? (photo.photographer || 'Unknown') : (photo.user?.name || 'Unknown');
  const photographerUrl = isPexels ? (photo.photographer_url || '') : (photo.user?.links?.html || '');
  const sourceName = isPexels ? 'Pexels' : 'Unsplash';
  const sourceUrl  = isPexels ? 'https://www.pexels.com' : 'https://unsplash.com';
  const altText    = photo.alt || photo.alt_description || '';
  const fileName   = (isPexels ? 'pexels_' : 'unsplash_') + photo.id + '.jpg';

  const card = document.createElement('div');
  card.className = 'disc-card';

  const img = document.createElement('img');
  img.className = 'disc-thumb';
  img.alt = altText;
  img.dataset.src = thumbUrl;
  img.onclick = () => {
    const creditHtml = `Photo by <a href="${photographerUrl}?utm_source=wallpaper_studio&utm_medium=referral" target="_blank" style="color:rgba(255,255,255,.8)">${photographer}</a> on <a href="${sourceUrl}/?utm_source=wallpaper_studio&utm_medium=referral" target="_blank" style="color:rgba(255,255,255,.8)">${sourceName}</a>`;
    openLightbox(fullUrl, creditHtml);
  };

  const over = document.createElement('div');
  over.className = 'disc-over';

  // Source badge
  const badge = document.createElement('span');
  badge.className = 'disc-source-badge disc-source-' + (isPexels ? 'pexels' : 'unsplash');
  badge.textContent = sourceName;

  const credit = document.createElement('div');
  credit.className = 'disc-credit';
  credit.innerHTML = `<a href="${photographerUrl}?utm_source=wallpaper_studio&utm_medium=referral" target="_blank" style="color:inherit;text-decoration:none">${photographer}</a> on ${sourceName}`;

  const rowBtns = document.createElement('div');
  rowBtns.style.cssText = 'display:flex;gap:6px;align-items:center;';

  const viewBtn = document.createElement('a');
  viewBtn.className = 'disc-view-btn';
  viewBtn.href = `${pageUrl}?utm_source=wallpaper_studio&utm_medium=referral`;
  viewBtn.target = '_blank';
  viewBtn.title = `View on ${sourceName}`;
  viewBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  viewBtn.onclick = e => e.stopPropagation();

  const saveBtn = document.createElement('button');
  saveBtn.className = 'disc-save';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = async e => {
    e.stopPropagation();
    saveBtn.disabled = true; saveBtn.textContent = '...';
    try {
      if (!S.albums?.length) { toast('Add a local folder first', 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save'; return; }
      const dest = S.albums.length === 1 ? S.albums[0] : await pickAlbum(S.albums);
      if (!dest) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; return; }
      await window.wp.downloadImageUrl(fullUrl, fileName, dest.id, dlLocation);
      saveBtn.textContent = 'Saved';
      saveBtn.style.cssText = 'background:#22c55e;color:#fff';
      toast('Saved to "' + dest.name + '"');
    } catch {
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
      toast('Save failed', 'error');
    }
  };

  const setBtn = document.createElement('button');
  setBtn.className = 'disc-set';
  setBtn.textContent = 'Set';
  setBtn.title = 'Save to default folder & set as wallpaper';
  setBtn.onclick = async e => {
    e.stopPropagation();
    if (!S.albums?.length) { toast('Add a local folder first', 'error'); return; }
    setBtn.disabled = true; setBtn.textContent = '...';
    try {
      const result = await window.wp.downloadAndSetWallpaper(fullUrl, fileName, dlLocation);
      setBtn.textContent = 'Set ✓';
      setBtn.style.cssText = 'background:var(--c-acc);color:#fff';
      toast('Wallpaper set! Saved to "' + result.albumName + '"');
    } catch (err) {
      setBtn.disabled = false; setBtn.textContent = 'Set';
      toast(err.message || 'Failed to set wallpaper', 'error');
    }
  };

  rowBtns.appendChild(badge);
  rowBtns.appendChild(viewBtn);
  rowBtns.appendChild(setBtn);
  rowBtns.appendChild(saveBtn);
  over.appendChild(credit);
  over.appendChild(rowBtns);
  card.appendChild(img);
  card.appendChild(over);
  return card;
}

async function loadDiscover(more = false) {
  if (S.unsplashLoading) return;
  S.unsplashLoading = true;

  const grid    = $('disc-grid');
  const moreBtn = $('disc-more');
  if (moreBtn) moreBtn.style.display = 'none';

  if (!more) {
    S.unsplashPage = 1;
    S.pexelsPage   = 1;
    grid.innerHTML = '<div class="disc-loading">Loading wallpapers…</div>';
  } else {
    S.unsplashPage++;
    S.pexelsPage++;
  }

  const cat   = CATS[S.unsplashCatIdx];
  const q     = S.unsplashQuery || cat.query;
  const topic = S.unsplashQuery ? null : cat.topic;

  // Fetch from active sources
  const src = S.discoverSource;
  const [unsplashPhotos, pexelsPhotos] = await Promise.all([
    (src === 'pexels') ? Promise.resolve([]) : fetchUnsplash(q, topic, S.unsplashPage),
    (src === 'unsplash') ? Promise.resolve([]) : fetchPexels(q, S.pexelsPage),
  ]);

  // Interleave results for a mixed feed
  const merged = [];
  const maxLen = Math.max(unsplashPhotos.length, pexelsPhotos.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < unsplashPhotos.length) merged.push(unsplashPhotos[i]);
    if (i < pexelsPhotos.length)   merged.push(pexelsPhotos[i]);
  }

  if (!more) grid.innerHTML = '';
  if (!merged.length) {
    if (!more) grid.innerHTML = '<div class="disc-empty">No results. Try a different search.</div>';
  } else {
    const frag = document.createDocumentFragment();
    merged.forEach(p => frag.appendChild(makeDiscCard(p)));
    grid.appendChild(frag);
    grid.querySelectorAll('img[data-src]').forEach(img => imgObs.observe(img));
    if (moreBtn) moreBtn.style.display = 'flex';
  }

  S.unsplashLoading = false;
}

function initDiscover() {
  const hasAnyKey = S.unsplashKey || S.pexelsKey;
  if (hasAnyKey) {
    $('disc-setup').style.display = 'none';
    $('disc-main').style.display  = 'block';
  }

  // Source filter tabs — only show if both keys present
  const srcTabs = $('disc-source-tabs');
  if (srcTabs) {
    if (S.unsplashKey && S.pexelsKey) {
      srcTabs.style.display = 'flex';
      srcTabs.querySelectorAll('[data-src]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.src === S.discoverSource);
        btn.onclick = () => {
          S.discoverSource = btn.dataset.src;
          srcTabs.querySelectorAll('[data-src]').forEach(b => b.classList.toggle('active', b.dataset.src === S.discoverSource));
          loadDiscover();
        };
      });
    } else {
      srcTabs.style.display = 'none';
    }
  }

  const chipsEl = $('disc-chips');
  CATS.forEach((cat, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (i === 0 ? ' active' : '');
    b.textContent = cat.label;
    b.onclick = () => {
      chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      b.classList.add('active');
      S.unsplashCatIdx = i;
      S.unsplashQuery  = '';
      $('disc-search-in').value = '';
      loadDiscover();
    };
    chipsEl.appendChild(b);
  });

  const si = $('disc-search-in');
  const sb = $('disc-search-btn');
  const doSearch = () => {
    S.unsplashQuery = si.value.trim();
    if (S.unsplashQuery) chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    loadDiscover();
  };
  sb.onclick = doSearch;
  si.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  $('disc-more').onclick = () => loadDiscover(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded — wire everything up
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Cache DOM
  Object.assign(D, {
    gallery:      $('gallery'),
    foldersList:  $('folders-list'),
    lightbox:     $('lightbox'),
    lbImg:        $('lb-img'),
    lbCredit:     $('lb-credit'),
    ctxMenu:      $('ctx-menu'),
    apModal:      $('ap-modal'),
    apList:       $('ap-list'),
    apCancel:     $('ap-cancel'),
    detPanel:     $('det-panel'),
    detImg:       $('det-img'),
    detName:      $('det-name'),
    detPath:      $('det-path'),
    detDims:      $('det-dims'),
    detSize:      $('det-size'),
    detDate:      $('det-date'),
  });

  // ── Load settings + apply before revealing body ──
  try {
    const settings = await window.wp.getAppSettings();
    applySettings(settings);
    S.settingsSnapshot = settings;
  } catch {}
  finally {
    document.body.style.visibility = '';
  }

  // ── Unsplash key ──
  try { S.unsplashKey = await window.wp.getUnsplashKey() || ''; } catch {}
  try { S.pexelsKey   = await window.wp.getPexelsKey()   || ''; } catch {}
  if (!S.discoverReady && (S.unsplashKey || S.pexelsKey)) { S.discoverReady = true; loadDiscover(); }

  // ── Live settings updates from main process ──
  window.wp.onSettingsUpdated(settings => { applySettings(settings); S.settingsSnapshot = settings; });

  // ── Global keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeLightbox(); closeDetails(); hideCtxMenu(); D.apModal.classList.remove('on'); }
  });

  // ── Lightbox ──
  $('lb-close').onclick = closeLightbox;
  D.lightbox.addEventListener('click', e => { if (e.target === D.lightbox) closeLightbox(); });

  // ── Context menu ──
  $('ctx-set').onclick     = ctxSetWallpaper;
  $('ctx-copy').onclick    = ctxCopy;
  $('ctx-export').onclick  = ctxExport;
  $('ctx-delete').onclick  = ctxDelete;
  $('ctx-details').onclick = ctxDetails;
  $('ctx-unfav').onclick   = ctxUnfav;

  // ── Details panel ──
  $('det-close').onclick = closeDetails;
  $('det-set').onclick   = async () => { await window.wp.setWallpaper(_detPath); toast('Wallpaper set!'); };
  $('det-copy').onclick  = async () => {
    if (!S.albums?.length) { toast('Add a folder first', 'error'); return; }
    const dest = S.albums.length === 1 ? S.albums[0] : await pickAlbum(S.albums);
    if (!dest) return;
    try { await window.wp.copyToAlbum(_detPath, dest.id); toast('Copied to "' + dest.name + '"'); }
    catch { toast('Copy failed', 'error'); }
  };

  // ── Sidebar static nav ──
  $('nav-spot').onclick      = () => navigateTo('gallery', 'spotlight');
  $('nav-fav').onclick       = () => navigateTo('gallery', 'favorites');
  $('nav-disc').onclick      = () => navigateTo('discover');
  $('nav-settings').onclick  = () => navigateTo('settings');
  $('nav-slideshow').onclick = () => navigateTo('slideshow');

  // ── Spotlight refresh button ──
  $('btn-spot-refresh').onclick = async () => {
    const btn = $('btn-spot-refresh');
    btn.classList.add('spinning');
    try { await renderGallery(); } finally { btn.classList.remove('spinning'); }
  };

  // ── Topbar Add Image button is hidden in v0.3.6; per-folder buttons are used instead ──
  // (kept in DOM for potential future use)
  // $('btn-add-local').onclick = ...;

  // ── Add folder (sidebar + empty state) ──
  const addFolder = async () => {
    try {
      const folder = await window.wp.selectAlbumFolder();
      if (!folder) return;
      const name = await window.wp.getAlbumName(folder);
      if (!name?.trim()) return;
      await window.wp.addAlbum(name.trim(), folder);
      S.albums = await window.wp.getAlbums() || [];
      buildFoldersList();
      const added = S.albums.find(a => a.folder === folder);
      if (added) await navigateTo('gallery', 'albums', added.id);
    } catch (err) { toast('Failed: ' + err.message, 'error'); }
  };
  $('btn-add-folder').onclick   = addFolder;
  $('empty-add-folder').onclick = addFolder;

  // ── Settings UI ──
  initSettingsUI();

  // ── Slideshow controls ──
  $('btn-ss-start').onclick = async () => {
    const intervalMs = parseInt($('ss-sel-interval').value, 10) || 60000;
    // Save interval to settings
    try {
      const cfg = await window.wp.getAppSettings();
      await window.wp.saveAppSettings({ ...cfg, slideshowInterval: intervalMs });
    } catch {}
    // Read selected source from dropdown
    const srcSel = $('ss-source-sel');
    const albumId = srcSel?.value || null;
    const shuffle = $('chk-ss-shuffle')?.checked || false;
    window.wp.startSlideshow(intervalMs, albumId, shuffle);
    S.slideshowRunning = true;
    updateSlideshowUI();
    const srcLabel = albumId ? (S.albums.find(a => a.id === albumId)?.name || 'selected album') : 'all albums';
    toast('Slideshow started (' + srcLabel + ')');
  };
  $('btn-ss-stop').onclick = () => {
    window.wp.stopSlideshow();
    S.slideshowRunning = false;
    updateSlideshowUI();
    toast('Slideshow stopped');
  };

  // ── Gallery: Add Images to current folder button ──
  $('btn-add-images-to-folder').onclick = async () => {
    if (!S.currentAlbumId) { toast('No folder selected', 'error'); return; }
    try {
      const results = await window.wp.openFileToAlbum(S.currentAlbumId);
      if (!results?.length) return;
      renderGallery();
      toast(results.length === 1 ? 'Image added' : results.length + ' images added');
    } catch { toast('Failed to add images', 'error'); }
  };

  // ── Discover ──
  initDiscover();

  // ── Discovery Slideshow ──
  initDiscoverySlideshow();

  // ── IPC refresh (after settings change etc.) ──
  if (window.wp.onRefresh) window.wp.onRefresh(() => { if (S.view === 'gallery') renderGallery(); });

  // ── Slideshow events from main process ──
  if (window.wp.onSlideshowTick) {
    window.wp.onSlideshowTick(info => {
      const txt = $('ss-status-text');
      if (txt && S.slideshowRunning) txt.textContent = 'Now: ' + (info.name || '—');
    });
  }
  if (window.wp.onSlideshowStopped) {
    window.wp.onSlideshowStopped(() => {
      S.slideshowRunning = false;
      updateSlideshowUI();
    });
  }

  // ── Initial load ──
  S.albums = await window.wp.getAlbums() || [];
  buildFoldersList();
  if (S.albums.length === 0) {
    await navigateTo('empty');
  } else {
    S.currentAlbumId = S.albums[0].id;
    await navigateTo('gallery', 'albums', S.albums[0].id);
  }
});
