'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wp', {
  // Wallpapers
  getWallpapers:        ()                        => ipcRenderer.invoke('get-wallpapers'),
  getAllWallpapers:      ()                        => ipcRenderer.invoke('get-all-wallpapers'),
  getSpotlightImages:   ()                        => ipcRenderer.invoke('get-spotlight-images'),
  addWallpaper:         (path)                    => ipcRenderer.invoke('add-wallpaper', path),
  openFile:             ()                        => ipcRenderer.invoke('open-file'),
  setWallpaper:         (path)                    => ipcRenderer.invoke('set-wallpaper', path),
  deleteImage:          (path)                    => ipcRenderer.invoke('delete-image', path),
  getImageMetadata:     (path)                    => ipcRenderer.invoke('get-image-metadata', path),
  toggleFavorite:       (id)                      => ipcRenderer.invoke('toggle-favorite', id),
  copyToAlbum:          (p, id)                   => ipcRenderer.invoke('copy-to-album', p, id),
  copySpotlightToAlbum: (p, id)                   => ipcRenderer.invoke('copy-spotlight-to-album', p, id),

  // Albums / folders
  getAlbums:            ()                        => ipcRenderer.invoke('get-albums'),
  getCurrentAlbumId:    ()                        => ipcRenderer.invoke('get-current-album'),
  setCurrentAlbum:      (id)                      => ipcRenderer.invoke('set-current-album', id),
  addAlbum:             (name, folder)            => ipcRenderer.invoke('add-album', name, folder),
  removeAlbum:          (id)                      => ipcRenderer.invoke('remove-album', id),
  selectAlbumFolder:    ()                        => ipcRenderer.invoke('select-album-folder'),
  getAlbumName:         (folderPath)              => ipcRenderer.invoke('get-album-name', folderPath),
  selectFolder:         ()                        => ipcRenderer.invoke('select-folder'),

  // App settings
  getSettings:          ()                        => ipcRenderer.invoke('get-settings'),
  chooseStorageDir:     ()                        => ipcRenderer.invoke('choose-storage-dir'),
  getAppSettings:       ()                        => ipcRenderer.invoke('get-app-settings'),
  saveAppSettings:      (s)                       => ipcRenderer.invoke('save-app-settings', s),

  // Discover / Unsplash
  getUnsplashKey:       ()                        => ipcRenderer.invoke('get-unsplash-key'),
  downloadImageUrl:     (url, fn, albumId, dlLoc) => ipcRenderer.invoke('download-image-url', url, fn, albumId, dlLoc),

  // Slideshow (fire-and-forget IPC sends to main process timer)
  startSlideshow:       (intervalMs, albumId)     => ipcRenderer.send('start-slideshow', intervalMs, albumId),
  stopSlideshow:        ()                        => ipcRenderer.send('stop-slideshow'),
  getSlideshowStatus:   ()                        => ipcRenderer.invoke('get-slideshow-status'),

  // Events from main → renderer
  onRefresh:            (cb) => {
    ipcRenderer.removeAllListeners('refresh-gallery');
    ipcRenderer.on('refresh-gallery', (_e) => cb());
  },
  onSettingsUpdated:    (cb) => {
    ipcRenderer.removeAllListeners('settings-updated');
    ipcRenderer.on('settings-updated', (_e, s) => cb(s));
  },
});
