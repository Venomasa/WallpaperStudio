# 🖼️ Wallpaper Studio

A modern, offline-first desktop wallpaper manager built with Electron.  
Manage your local wallpaper collections and discover new ones from Unsplash — all from a clean, dark UI.

![Version](https://img.shields.io/badge/version-0.2.0-blueviolet)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Electron](https://img.shields.io/badge/electron-27-47848f)

---

## ✨ Features

- 📁 **Multi-folder Albums** — Add any local folder as a wallpaper album
- ⭐ **Favorites** — Star images to keep them in a quick-access collection
- 🌟 **Spotlight** — Browse Windows Spotlight images automatically
- 🔍 **Discover** — Fetch high-quality wallpapers from Unsplash (API key required)
- 🖥️ **One-click Set** — Apply any wallpaper instantly as your desktop background
- 🎞️ **Slideshow** — Auto-rotate wallpapers on a configurable schedule
- 🗂️ **Details Panel** — View image metadata (dimensions, size, date)
- 🌙 **Dark UI** — Easy on the eyes, always

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later
- npm (comes with Node.js)

### Installation

#### Option 1: Standalone Exe (Recommended)

Download the latest `.exe` installer from [Releases](https://github.com/Venomasa/WallpaperStudio/releases).  
No additional software required — just download and run!

#### Option 2: Build from Source

For developers or advanced users:

```bash
git clone https://github.com/Venomasa/WallpaperStudio.git
cd WallpaperStudio
npm install
npm start
```

### First Use

1. Click **"Add Folder"** to add a local folder containing your wallpapers
2. Browse your images in the gallery
3. Click **"Set"** on any image to apply it as your wallpaper
4. Optionally, go to **Discover** and enter an [Unsplash API key](https://unsplash.com/developers) to browse online wallpapers

---

## 📦 Project Structure

```
WallpaperStudio/
├── src/
│   ├── main.js              # Electron main process (IPC, file system, wallpaper API)
│   ├── renderer.js          # UI logic (gallery, lazy loading, navigation)
│   ├── preload.js           # Secure bridge between main and renderer
│   ├── index.html           # Main app window (HTML + CSS)
│   ├── slideshow-config.html  # Slideshow settings window
│   └── slideshow-preload.js   # Preload for slideshow window
├── package.json
└── README.md
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Electron](https://www.electronjs.org/) 27 |
| Wallpaper API | [wallpaper](https://www.npmjs.com/package/wallpaper) npm package |
| Online Images | [Unsplash API](https://unsplash.com/developers) |
| HTTP (main) | [node-fetch](https://www.npmjs.com/package/node-fetch) |
| Storage | JSON flat files (albums, DB, config) |

---

## 📋 Changelog

### v0.2.0 — Performance & UX Polish
- **Shimmer skeleton loading** — Cards now show an animated shimmer effect while images load, eliminating the broken-image flash that appeared when opening folders
- **Lightbox shimmer** — Preview overlay also shows a smooth shimmer while the full-resolution image loads
- **Improved IntersectionObserver** — `rootMargin` tuned to 300px for a better preload balance; `onload`/`onerror` handlers properly remove the shimmer once the image is ready (or fails silently)
- **Gallery render optimization** — DOM is hidden during bulk card insertion to avoid layout thrashing, then revealed in the next animation frame for a smoother folder-switch experience
- **Cleaner lightbox reset** — Closing the preview now fully resets loading state to prevent stale shimmer on the next open
- **Standalone Exe** — Available as a packaged `.exe` for easy installation without Node.js

### v0.1.0 — Initial Release
- Multi-album local folder management
- Favorites, Spotlight, and Discover views
- One-click wallpaper setting
- Slideshow support
- Unsplash integration
- Details panel with image metadata

---

## 🔑 Unsplash API Key

To use the **Discover** tab:

1. Go to [https://unsplash.com/developers](https://unsplash.com/developers)
2. Create a free account and register a new application
3. Copy your **Access Key**
4. Paste it in the Discover tab inside the app

Your key is stored locally in `localStorage` — it never leaves your machine.

---

## 🪟 Windows Notes

- Wallpaper setting uses the `wallpaper` npm package which calls native Windows APIs
- Spotlight images are read from `%LOCALAPPDATA%\Packages\Microsoft.Windows.ContentDeliveryManager_*`
- Hardware acceleration is disabled by default to prevent GPU crashes on some drivers

---

