'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wp', {
  // Wallpapers
  getWallpapers:           ()                           => ipcRenderer.invoke('get-wallpapers'),
  getAllWallpapers:         ()                           => ipcRenderer.invoke('get-all-wallpapers'),
  getSpotlightImages:      ()                           => ipcRenderer.invoke('get-spotlight-images'),
  addWallpaper:            (path)                       => ipcRenderer.invoke('add-wallpaper', path),
  openFile:                ()                           => ipcRenderer.invoke('open-file'),
  openFileToAlbum:         (albumId)                   => ipcRenderer.invoke('open-file-to-album', albumId),
  setWallpaper:            (path)                      => ipcRenderer.invoke('set-wallpaper', path),
  deleteImage:             (path)                      => ipcRenderer.invoke('delete-image', path),
  getImageMetadata:        (path)                      => ipcRenderer.invoke('get-image-metadata', path),
  toggleFavorite:          (id)                        => ipcRenderer.invoke('toggle-favorite', id),
  copyToAlbum:             (p, id)                     => ipcRenderer.invoke('copy-to-album', p, id),
  copySpotlightToAlbum:    (p, id)                     => ipcRenderer.invoke('copy-spotlight-to-album', p, id),
  downloadAndSetWallpaper: (url, fn, dlLoc)            => ipcRenderer.invoke('download-and-set-wallpaper', url, fn, dlLoc),
  exportImage:             (path)                      => ipcRenderer.invoke('export-image', path),

  // Bulk operations
  bulkDelete:              (ids)                       => ipcRenderer.invoke('bulk-delete', ids),
  bulkFavorite:            (ids, state)               => ipcRenderer.invoke('bulk-favorite', ids, state),

  // Albums / folders
  getAlbums:               ()                          => ipcRenderer.invoke('get-albums'),
  getCurrentAlbumId:       ()                          => ipcRenderer.invoke('get-current-album'),
  setCurrentAlbum:         (id)                        => ipcRenderer.invoke('set-current-album', id),
  addAlbum:                (name, folder)              => ipcRenderer.invoke('add-album', name, folder),
  removeAlbum:             (id)                        => ipcRenderer.invoke('remove-album', id),
  renameAlbum:             (id, name)                  => ipcRenderer.invoke('rename-album', id, name),
  selectAlbumFolder:       ()                          => ipcRenderer.invoke('select-album-folder'),
  getAlbumName:            (folderPath)                => ipcRenderer.invoke('get-album-name', folderPath),
  selectFolder:            ()                          => ipcRenderer.invoke('select-folder'),

  // App settings
  getSettings:             ()                          => ipcRenderer.invoke('get-settings'),
  chooseStorageDir:        ()                          => ipcRenderer.invoke('choose-storage-dir'),
  getAppSettings:          ()                          => ipcRenderer.invoke('get-app-settings'),
  saveAppSettings:         (s)                         => ipcRenderer.invoke('save-app-settings', s),

  // Discover / Unsplash
  getUnsplashKey:          ()                          => ipcRenderer.invoke('get-unsplash-key'),
  getPexelsKey:            ()                          => ipcRenderer.invoke('get-pexels-key'),
  downloadImageUrl:        (url, fn, albumId, dlLoc)   => ipcRenderer.invoke('download-image-url', url, fn, albumId, dlLoc),

  // Local Slideshow
  startSlideshow:          (intervalMs, albumId, shuffle) => ipcRenderer.send('start-slideshow', intervalMs, albumId, shuffle),
  stopSlideshow:           ()                          => ipcRenderer.send('stop-slideshow'),
  getSlideshowStatus:      ()                          => ipcRenderer.invoke('get-slideshow-status'),

  // Discovery Slideshow
  startDiscoverySlideshow:     (intervalMs, topics, source) => ipcRenderer.send('start-discovery-slideshow', intervalMs, topics, source),
  stopDiscoverySlideshow:      ()                      => ipcRenderer.send('stop-discovery-slideshow'),
  getDiscoverySlideshowStatus: ()                      => ipcRenderer.invoke('get-discovery-slideshow-status'),
  discoverySlideshowChangeNow: ()                      => ipcRenderer.send('discovery-slideshow-change-now'),
  discoverySlideshowFavourite: ()                      => ipcRenderer.invoke('discovery-slideshow-favourite'),

  // Daily Wallpaper
  triggerDailyWallpaperNow:    ()        => ipcRenderer.invoke('trigger-daily-wallpaper-now'),
  rescheduleDailyWallpaper:    ()        => ipcRenderer.invoke('reschedule-daily-wallpaper'),

  // Startup
  setStartWithWindows:         (enabled) => ipcRenderer.invoke('set-start-with-windows', enabled),
  getStartWithWindows:         ()        => ipcRenderer.invoke('get-start-with-windows'),

  // Events from main → renderer
  onRefresh: (cb) => {
    ipcRenderer.removeAllListeners('refresh-gallery');
    ipcRenderer.on('refresh-gallery', (_e) => cb());
  },
  onSettingsUpdated: (cb) => {
    ipcRenderer.removeAllListeners('settings-updated');
    ipcRenderer.on('settings-updated', (_e, s) => cb(s));
  },
  onSlideshowTick: (cb) => {
    ipcRenderer.removeAllListeners('slideshow-tick');
    ipcRenderer.on('slideshow-tick', (_e, info) => cb(info));
  },
  onSlideshowStopped: (cb) => {
    ipcRenderer.removeAllListeners('slideshow-stopped');
    ipcRenderer.on('slideshow-stopped', (_e) => cb());
  },
  onDiscoverySlideshowTick: (cb) => {
    ipcRenderer.removeAllListeners('discovery-slideshow-tick');
    ipcRenderer.on('discovery-slideshow-tick', (_e, info) => cb(info));
  },
  onDiscoverySlideshowStatus: (cb) => {
    ipcRenderer.removeAllListeners('discovery-slideshow-status');
    ipcRenderer.on('discovery-slideshow-status', (_e, status) => cb(status));
  },
  onDiscoverySlideshowError: (cb) => {
    ipcRenderer.removeAllListeners('discovery-slideshow-error');
    ipcRenderer.on('discovery-slideshow-error', (_e, msg) => cb(msg));
  },
  onDiscoverySlideshowFavourited: (cb) => {
    ipcRenderer.removeAllListeners('discovery-slideshow-favourited');
    ipcRenderer.on('discovery-slideshow-favourited', (_e, info) => cb(info));
  },
  onDailyWallpaperChanged: (cb) => {
    ipcRenderer.removeAllListeners('daily-wallpaper-changed');
    ipcRenderer.on('daily-wallpaper-changed', (_e, info) => cb(info));
  },
});
