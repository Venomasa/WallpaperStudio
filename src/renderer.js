'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  view: 'empty',        // 'empty'|'albums'|'favorites'|'spotlight'|'discover'
  currentAlbumId: null,
  albums: [],
  unsplashKey: localStorage.getItem('unsplash_api_key') || '',
  unsplashPage: 1,
  unsplashCatIdx: 0,
  unsplashQuery: '',
  unsplashLoading: false,
  discoverReady: false,
};

const CATS = [
  { label: '🌟 Featured',      query: null,                    topic: null },
  { label: '🌿 Nature',        query: 'nature landscape',       topic: 'nature' },
  { label: '🏙 Architecture',  query: 'architecture building',  topic: 'architecture-interior' },
  { label: '🌌 Space',         query: 'space galaxy stars',     topic: null },
  { label: '🐾 Animals',       query: 'animals wildlife',       topic: 'animals' },
  { label: '✈️ Travel',        query: 'travel landscape',       topic: 'travel' },
  { label: '⬜ Minimal',       query: 'minimalist wallpaper',   topic: null },
  { label: '🌊 Abstract',      query: 'abstract art wallpaper', topic: null },
  { label: '🌆 City',          query: 'city skyline night',     topic: null },
  { label: '🏔 Mountains',     query: 'mountains snow peaks',   topic: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// DOM cache
// ─────────────────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const D  = {};   // filled in DOMContentLoaded

// ─────────────────────────────────────────────────────────────────────────────
// Lazy image loading — IntersectionObserver
// ─────────────────────────────────────────────────────────────────────────────
function applyLazySrc(img) {
  if (!img.dataset.src) return;
  const src = img.dataset.src;
  img.removeAttribute('data-src');

  img.onload  = () => { img.classList.add('loaded'); img.onload = null; img.onerror = null; };
  img.onerror = () => { img.classList.add('loaded'); img.onerror = null; }; // hide shimmer even on error
  img.src = src;
}

const imgObs = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    applyLazySrc(entry.target);
    imgObs.unobserve(entry.target);
  });
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
  D.lbImg.onload  = () => { D.lbImg.classList.add('loaded'); };
  D.lbImg.onerror = () => { D.lbImg.classList.add('loaded'); };
  D.lbImg.src = src;
  D.lbCredit.textContent = credit || '';
  D.lbCredit.style.display = credit ? 'block' : 'none';
  D.lightbox.classList.add('on');
}
function closeLightbox() {
  D.lightbox.classList.remove('on');
  D.lbImg.src = '';
  D.lbImg.classList.remove('loaded');
  D.lbImg.onload  = null;
  D.lbImg.onerror = null;
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
      b.innerHTML = `<span>📁</span><span>${a.name}</span>`;
      b.title = a.folder || '';
      b.onclick = () => { D.apModal.classList.remove('on'); resolve(a); };
      D.apList.appendChild(b);
    });
    D.apCancel.onclick = () => { D.apModal.classList.remove('on'); resolve(null); };
    D.apModal.classList.add('on');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Details panel (replaces alert)
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
  } catch { /* ignore */ }
}
function closeDetails() { D.detPanel.classList.remove('on'); }

// ─────────────────────────────────────────────────────────────────────────────
// Shared context menu — one instance, populated per card
// ─────────────────────────────────────────────────────────────────────────────
let _ctx = null;

function showCtxMenu(e, data) {
  e.stopPropagation();
  _ctx = data;
  $('ctx-unfav').style.display   = (data.isFav || data.isSpot) ? 'flex' : 'none';
  $('ctx-sep').style.display     = (data.isFav || data.isSpot) ? 'block' : 'none';

  D.ctxMenu.classList.add('on');
  const mw = D.ctxMenu.offsetWidth, mh = D.ctxMenu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth - 8)  x = window.innerWidth  - mw - 8;
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
    toast(`✓ Copied to "${dest.name}"`);
  } catch (err) { toast('Copy failed', 'error'); }
}

async function ctxDelete() {
  hideCtxMenu();
  if (!confirm('Permanently delete this image from your system?')) return;
  try {
    await window.wp.deleteImage(_ctx.w.path);
    removeCard(_ctx.card);
    toast('Deleted');
  } catch (err) { toast('Delete failed', 'error'); }
}

async function ctxDetails() {
  hideCtxMenu();
  await openDetails(_ctx.w);
}

async function ctxUnfav() {
  hideCtxMenu();
  try {
    await window.wp.toggleFavorite(_ctx.w.id);
    _ctx.w.favorite = false;
    _ctx.favBtn.innerHTML = '☆';
    _ctx.favBtn.classList.remove('fav-on');
    if (S.view === 'favorites') removeCard(_ctx.card);
  } catch { toast('Failed', 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — build once, update active cheaply
// ─────────────────────────────────────────────────────────────────────────────
function buildFoldersList() {
  D.foldersList.innerHTML = '';
  S.albums.forEach(a => {
    const div = document.createElement('div');
    div.className = 'nav-item folder-item' + (S.view === 'albums' && S.currentAlbumId === a.id ? ' active' : '');
    div.dataset.id = a.id;

    const span = document.createElement('span');
    span.className = 'folder-name';
    span.textContent = a.name;
    span.title = a.folder || '';

    const del = document.createElement('button');
    del.className = 'folder-del';
    del.textContent = '✕';
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
        else if (S.view === 'albums' && !S.currentAlbumId) await navigateTo('albums', S.albums[0].id);
      } catch (err) { toast('Failed: ' + err.message, 'error'); }
    };

    div.appendChild(span);
    div.appendChild(del);
    div.onclick = async e => { if (e.target === del) return; await navigateTo('albums', a.id); };
    D.foldersList.appendChild(div);
  });
}

function updateActiveNav() {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (S.view === 'spotlight') $('nav-spot')?.classList.add('active');
  if (S.view === 'favorites') $('nav-fav')?.classList.add('active');
  if (S.view === 'discover')  $('nav-disc')?.classList.add('active');
  if (S.view === 'albums' && S.currentAlbumId) {
    D.foldersList.querySelector(`[data-id="${S.currentAlbumId}"]`)?.classList.add('active');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-bar context awareness
// ─────────────────────────────────────────────────────────────────────────────
function updateTopBar() {
  D.btnAddLocal.style.display  = S.view === 'discover' ? 'none' : 'inline-flex';
  D.btnSlideshow.style.display = S.view === 'albums'   ? 'inline-flex' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation — single entry point
// ─────────────────────────────────────────────────────────────────────────────
async function navigateTo(view, albumId) {
  // Close panels
  closeDetails();
  hideCtxMenu();

  S.view = view;
  if (albumId !== undefined) S.currentAlbumId = albumId;
  if (view === 'albums' && S.currentAlbumId) {
    await window.wp.setCurrentAlbum(S.currentAlbumId);
  }

  updateActiveNav();
  updateTopBar();

  // Show/hide panels
  D.emptyState.style.display   = view === 'empty'    ? 'flex'  : 'none';
  D.galleryWrap.style.display  = (view === 'albums' || view === 'favorites' || view === 'spotlight') ? 'block' : 'none';
  D.discoverWrap.style.display = view === 'discover' ? 'block' : 'none';

  if (view === 'discover') {
    if (!S.discoverReady && S.unsplashKey) { S.discoverReady = true; loadDiscover(); }
    return;
  }
  if (view !== 'empty') await renderGallery();
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery — DocumentFragment + lazy loading, no innerHTML re-write loop
// ─────────────────────────────────────────────────────────────────────────────
async function renderGallery() {
  imgObs.disconnect();

  let items = [];
  try {
    if (S.view === 'spotlight')       items = await window.wp.getSpotlightImages() || [];
    else if (S.view === 'favorites')  items = (await window.wp.getAllWallpapers() || []).filter(w => w.favorite);
    else if (S.view === 'albums' && S.currentAlbumId) items = await window.wp.getWallpapers() || [];
  } catch (err) { console.error('Gallery load error', err); }

  const frag = document.createDocumentFragment();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'gal-empty';
    const m = { spotlight: '🌟<br>No Spotlight images yet', favorites: '⭐<br>No favourites yet — click ☆ on any image', albums: '📂<br>This folder is empty' };
    empty.innerHTML = m[S.view] || '📂<br>No images';
    frag.appendChild(empty);
  } else {
    items.forEach(w => frag.appendChild(makeCard(w)));
  }

  // Swap off-screen to avoid layout thrashing during bulk DOM insert
  D.gallery.style.visibility = 'hidden';
  D.gallery.innerHTML = '';
  D.gallery.appendChild(frag);
  D.gallery.querySelectorAll('img[data-src]').forEach(img => imgObs.observe(img));
  // Re-enable visibility in next frame after layout is done
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

  const bar = document.createElement('div');
  bar.className = 'card-bar';

  const favBtn = document.createElement('button');
  favBtn.className = 'btn-icon' + (w.favorite ? ' fav-on' : '');
  favBtn.title = w.favorite ? 'Remove from favourites' : 'Add to favourites';
  favBtn.textContent = w.favorite ? '★' : '☆';
  favBtn.onclick = async e => {
    e.stopPropagation();
    try {
      await window.wp.toggleFavorite(w.id);
      w.favorite = !w.favorite;
      favBtn.textContent = w.favorite ? '★' : '☆';
      favBtn.classList.toggle('fav-on', w.favorite);
      if (S.view === 'favorites' && !w.favorite) removeCard(card);
    } catch { /* ignore */ }
  };

  const setBtn = document.createElement('button');
  setBtn.className = 'btn-set';
  setBtn.textContent = 'Set';
  setBtn.onclick = async e => {
    e.stopPropagation();
    await window.wp.setWallpaper(w.path);
    toast('✓ Wallpaper set!');
  };

  const moreBtn = document.createElement('button');
  moreBtn.className = 'btn-icon btn-more';
  moreBtn.textContent = '⋮';
  moreBtn.title = 'Options';
  moreBtn.onclick = e => {
    showCtxMenu(e, { w, card, favBtn, isFav: S.view === 'favorites', isSpot: S.view === 'spotlight' });
  };

  bar.appendChild(favBtn);
  bar.appendChild(setBtn);
  bar.appendChild(moreBtn);
  card.appendChild(img);
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
// Discover / Unsplash
// ─────────────────────────────────────────────────────────────────────────────
async function fetchUnsplash(q, topic, page) {
  if (!S.unsplashKey) return null;
  const pp = 24;
  let url;
  if (q)     url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${pp}&page=${page}&orientation=landscape`;
  else if (topic) url = `https://api.unsplash.com/topics/${topic}/photos?per_page=${pp}&page=${page}&orientation=landscape`;
  else       url = `https://api.unsplash.com/photos?per_page=${pp}&page=${page}&order_by=popular`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${S.unsplashKey}` } });
    if (res.status === 401) { toast('❌ Invalid Unsplash API key', 'error'); return null; }
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : (data.results ?? null);
  } catch { return null; }
}

function makeDiscCard(photo) {
  const card = document.createElement('div');
  card.className = 'disc-card';

  const img = document.createElement('img');
  img.className = 'disc-thumb';
  img.alt = photo.alt_description || '';
  img.dataset.src = photo.urls.small;
  // Click → full quality in lightbox
  img.onclick = () => openLightbox(photo.urls.full || photo.urls.regular, `Photo by ${photo.user.name} on Unsplash`);

  const over = document.createElement('div');
  over.className = 'disc-over';

  const credit = document.createElement('div');
  credit.className = 'disc-credit';
  credit.textContent = photo.user.name;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'disc-save';
  saveBtn.textContent = '⬇ Save';
  saveBtn.onclick = async e => {
    e.stopPropagation();
    saveBtn.disabled = true; saveBtn.textContent = '⏳';
    try {
      if (!S.albums?.length) { toast('Add a local folder first', 'error'); saveBtn.disabled = false; saveBtn.textContent = '⬇ Save'; return; }
      const dest = S.albums.length === 1 ? S.albums[0] : await pickAlbum(S.albums);
      if (!dest) { saveBtn.disabled = false; saveBtn.textContent = '⬇ Save'; return; }
      await window.wp.downloadImageUrl(photo.urls.full, photo.id + '.jpg', dest.id);
      saveBtn.textContent = '✓';
      saveBtn.style.cssText = 'background:#22c55e;color:#fff';
      toast(`✓ Saved to "${dest.name}"`);
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = '⬇ Save';
      toast('Save failed', 'error');
    }
  };

  over.appendChild(credit);
  over.appendChild(saveBtn);
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
    grid.innerHTML = '<div class="disc-loading">Loading…</div>';
  } else {
    S.unsplashPage++;
  }

  const cat    = CATS[S.unsplashCatIdx];
  const q      = S.unsplashQuery || cat.query;
  const topic  = S.unsplashQuery ? null : cat.topic;
  const photos = await fetchUnsplash(q, topic, S.unsplashPage);

  if (!more) grid.innerHTML = '';

  if (!photos || photos.length === 0) {
    if (!more) grid.innerHTML = '<div class="disc-empty">No results. Try a different search or check your API key.</div>';
  } else {
    const frag = document.createDocumentFragment();
    photos.forEach(p => frag.appendChild(makeDiscCard(p)));
    grid.appendChild(frag);
    grid.querySelectorAll('img[data-src]').forEach(img => imgObs.observe(img));
    if (moreBtn) moreBtn.style.display = 'flex';
  }

  S.unsplashLoading = false;
}

function initDiscover() {
  const keyIn  = $('disc-key');
  const keySave = $('disc-key-save');

  keyIn.value = S.unsplashKey;
  if (S.unsplashKey) { $('disc-setup').style.display = 'none'; $('disc-main').style.display = 'block'; }

  keySave.onclick = () => {
    const v = keyIn.value.trim();
    if (!v) { toast('Enter an API key', 'error'); return; }
    S.unsplashKey = v;
    localStorage.setItem('unsplash_api_key', v);
    $('disc-setup').style.display = 'none';
    $('disc-main').style.display  = 'block';
    S.discoverReady = true;
    loadDiscover();
  };
  keyIn.addEventListener('keydown', e => { if (e.key === 'Enter') keySave.click(); });
  $('disc-key-change').onclick = () => { $('disc-setup').style.display = 'block'; $('disc-main').style.display = 'none'; keyIn.focus(); };

  // Chips
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

  // Search
  const si = $('disc-search-in');
  const sb = $('disc-search-btn');
  const doSearch = () => {
    const q = si.value.trim();
    S.unsplashQuery = q;
    if (q) chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    loadDiscover();
  };
  sb.onclick = doSearch;
  si.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // Load more
  $('disc-more').onclick = () => loadDiscover(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded — wire everything up
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Cache DOM refs
  Object.assign(D, {
    gallery:     $('gallery'),
    galleryWrap: $('gallery-wrap'),
    discoverWrap:$('discover-wrap'),
    emptyState:  $('empty-state'),
    foldersList: $('folders-list'),
    lightbox:    $('lightbox'),
    lbImg:       $('lb-img'),
    lbCredit:    $('lb-credit'),
    ctxMenu:     $('ctx-menu'),
    apModal:     $('ap-modal'),
    apList:      $('ap-list'),
    apCancel:    $('ap-cancel'),
    detPanel:    $('det-panel'),
    detImg:      $('det-img'),
    detName:     $('det-name'),
    detPath:     $('det-path'),
    detDims:     $('det-dims'),
    detSize:     $('det-size'),
    detDate:     $('det-date'),
    btnAddLocal: $('btn-add-local'),
    btnSlideshow:$('btn-slideshow'),
  });

  // Lightbox
  $('lb-close').onclick = closeLightbox;
  D.lightbox.addEventListener('click', e => { if (e.target === D.lightbox) closeLightbox(); });

  // ESC closes everything
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeLightbox(); closeDetails(); hideCtxMenu(); D.apModal.classList.remove('on'); }
  });

  // Context menu actions
  $('ctx-copy').onclick    = ctxCopy;
  $('ctx-delete').onclick  = ctxDelete;
  $('ctx-details').onclick = ctxDetails;
  $('ctx-unfav').onclick   = ctxUnfav;

  // Details panel
  $('det-close').onclick   = closeDetails;
  $('det-set').onclick     = async () => { await window.wp.setWallpaper(_detPath); toast('✓ Wallpaper set!'); };
  $('det-copy').onclick    = async () => {
    if (!S.albums?.length) { toast('Add a folder first', 'error'); return; }
    const dest = S.albums.length === 1 ? S.albums[0] : await pickAlbum(S.albums);
    if (!dest) return;
    try { await window.wp.copyToAlbum(_detPath, dest.id); toast(`✓ Copied to "${dest.name}"`); }
    catch { toast('Copy failed', 'error'); }
  };

  // Sidebar static nav
  $('nav-spot').onclick = () => navigateTo('spotlight');
  $('nav-fav').onclick  = () => navigateTo('favorites');
  $('nav-disc').onclick = () => navigateTo('discover');

  // Add folder
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
      if (added) await navigateTo('albums', added.id);
    } catch (err) { toast('Failed: ' + err.message, 'error'); }
  };
  $('btn-add-folder').onclick   = addFolder;
  $('empty-add-folder').onclick = addFolder;

  // Top-bar
  D.btnAddLocal.onclick  = async () => { const e = await window.wp.openFile(); if (e) renderGallery(); };
  D.btnSlideshow.onclick = async () => { if (window.wp.openSlideshowConfig) await window.wp.openSlideshowConfig(); };

  // Discover init
  initDiscover();

  // Load albums → initial view
  S.albums = await window.wp.getAlbums() || [];
  buildFoldersList();

  if (S.albums.length === 0) await navigateTo('empty');
  else { S.currentAlbumId = S.albums[0].id; await navigateTo('albums', S.albums[0].id); }

  // IPC refresh
  if (window.wp.onRefresh) window.wp.onRefresh(() => renderGallery());
});
