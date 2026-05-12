# Wallpaper Studio

A simple desktop wallpaper manager for Windows, built with Electron.
Manage your local wallpaper collections and discover photos from Unsplash.

![Version](https://img.shields.io/badge/version-0.3.7-blueviolet)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)

---

## Features

- **Albums** — Organize wallpapers in folders
- **Discover** — Find wallpapers from the internet
- **Set Wallpaper** — Apply any image as desktop background
- **Slideshow** — Auto-rotate wallpapers
- **Favourites** — Save your favorite images
- **Tray Controls** — Control from system tray

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later

### Installation

#### Option 1: Download Exe

Download the latest installer from [Releases](https://github.com/Venomasa/WallpaperStudio/releases).

#### Option 2: Run from Source

1. Clone the repository
2. Run `npm install`
3. Run `npm start`

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
$env:PEXELS_API_KEY= "your_access_key_here"
npm start

# Build with embedded key
$env:UNSPLASH_ACCESS_KEY = "your_access_key_here"
$env:PEXELS_API_KEY= "your_access_key_here"
npm run build
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close lightbox / details panel / context menu |

---

## Windows Wallpaper Notes

The app uses P/Invoke (`SystemParametersInfo` via PowerShell inline C#) to set wallpapers on Windows 10/11, bypassing the `wallpaper` npm package which fails silently on Windows 11. A registry + RUNDLL32 fallback is included for cases where PowerShell is restricted.

Hardware acceleration is disabled unconditionally. Chromium's GPU process crashes on a significant number of Windows configurations (driver bugs, Hyper-V, older integrated GPUs, strict sandbox policies) and offers no benefit for a static image gallery. This is not a setting — it is the correct default for this category of app.

---

## Project Structure

```
WallpaperStudio/
├── src/
│   ├── index.html      # Single-window app shell + all views
│   ├── main.js         # Electron main process
│   ├── preload.js      # Context bridge
│   └── renderer.js     # All UI logic: router, gallery, settings, slideshow, discover
├── scripts/
│   └── inject-env.js   # Embeds UNSPLASH_ACCESS_KEY at build time
├── icon.png
├── CHANGELOG.md
└── package.json
```

---

## Unsplash API Compliance

- Photos are fetched via official Unsplash CDN URLs
- The Unsplash download endpoint is triggered before saving (API requirement)
- Photographer name and "on Unsplash" attribution is always shown
- UTM parameters are included on all Unsplash links
