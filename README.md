# Wallpaper Studio

A modern, desktop wallpaper manager for Windows, built with Electron.
Manage local wallpaper collections and discover high-quality photos from Unsplash — from a clean, polished single-window UI.

![Version](https://img.shields.io/badge/version-0.3.5-blueviolet)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)
![Electron](https://img.shields.io/badge/electron-27-47848f)

---

## Features

- **Multi-folder Albums** — Add any local folder as a wallpaper album
- **Favourites** — Star images to keep them in a quick-access collection
- **Spotlight** — Browse Windows Spotlight images automatically
- **Discover** — Fetch high-quality wallpapers from Unsplash (API key required at build time)
- **One-click Set** — Apply any wallpaper instantly as your desktop background (Windows 10 and 11)
- **Slideshow** — Auto-rotate wallpapers on a configurable schedule; scoped to the current album or all albums
- **Details Panel** — View image metadata (dimensions, size, date)
- **Settings Page** — Hardware acceleration, light/dark mode, accent color, thumbnail size, image name labels — all in-app, no popup
- **Dark and Light UI** — Toggle via the Settings page

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for full version history.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later
- npm (comes with Node.js)

### Installation

#### Option 1: Standalone Exe (Recommended)

Download the latest `.exe` installer from [Releases](https://github.com/Venomasa/WallpaperStudio/releases).

#### Option 2: Build from Source

```bash
git clone https://github.com/Venomasa/WallpaperStudio.git
cd WallpaperStudio
npm install
npm start
```

To enable Discover (Unsplash), set your API key before running or building:

```bash
# Windows (PowerShell)
$env:UNSPLASH_ACCESS_KEY = "your_access_key_here"
npm start

# Build with embedded key
$env:UNSPLASH_ACCESS_KEY = "your_access_key_here"
npm run build
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close lightbox / details panel / context menu |

---

## Windows Wallpaper Notes

The app uses P/Invoke (`SystemParametersInfo` via PowerShell inline C#) to set wallpapers on Windows 10/11, bypassing the `wallpaper` npm package which fails silently on Windows 11. A registry+RUNDLL32 fallback is included.

---

## Project Structure

```
WallpaperStudio/
├── src/
│   ├── index.html          # Single-window app shell + all views
│   ├── main.js             # Electron main process
│   ├── preload.js          # Context bridge (one file for the one window)
│   └── renderer.js         # All UI logic: router, gallery, settings, slideshow, discover
├── scripts/
│   └── inject-env.js       # Embeds UNSPLASH_ACCESS_KEY at build time
├── icon.png
└── package.json
```

---

## Unsplash API Compliance

- Photos are hotlinked via official Unsplash CDN URLs (not re-hosted)
- The Unsplash download endpoint is triggered before saving (API requirement)
- Photographer name and "on Unsplash" attribution is always shown
- UTM parameters are included on all Unsplash links

---