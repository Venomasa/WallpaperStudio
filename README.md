# Wallpaper Studio

A modern, offline-first desktop wallpaper manager for Windows, built with Electron.
Manage local wallpaper collections and discover high-quality photos from Unsplash - from a clean, polished UI.

![Version](https://img.shields.io/badge/version-0.3.3-blueviolet)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)
![Electron](https://img.shields.io/badge/electron-27-47848f)


---

## Features

- **Multi-folder Albums** - Add any local folder as a wallpaper album
- **Favorites** - Star images to keep them in a quick-access collection
- **Spotlight** - Browse Windows Spotlight images automatically
- **Discover** - Fetch high-quality wallpapers from Unsplash (API key required at build time)
- **One-click Set** - Apply any wallpaper instantly as your desktop background (Windows 10 and 11)
- **Slideshow** - Auto-rotate wallpapers on a configurable schedule
- **Details Panel** - View image metadata (dimensions, size, date)
- **Settings** - Hardware acceleration toggle, light/dark mode, accent color, thumbnail size
- **Dark and Light UI** - Toggle via the Settings panel

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later
- npm (comes with Node.js)

### Installation

#### Option 1: Standalone Exe (Recommended)

Download the latest `.exe` installer from [Releases](https://github.com/Venomasa/WallpaperStudio/releases).
No additional software required - just download and run.

#### Option 2: Build from Source

```bash
git clone https://github.com/Venomasa/WallpaperStudio.git
cd WallpaperStudio
npm install
npm start
```

To enable Discover (Unsplash), set your API key as an environment variable before running or building:

```bash
# Windows (PowerShell)
$env:UNSPLASH_ACCESS_KEY = "your_access_key_here"
npm start

# Build with embedded key
$env:UNSPLASH_ACCESS_KEY = "your_access_key_here"
npm run build
```

The key is embedded into the packaged exe at build time and is **not committed to source control**.

### First Use

1. Click **Add Folder** to add a local folder containing your wallpapers
2. Browse your images in the gallery
3. Click **Set** on any image to apply it as your desktop wallpaper
4. Open **Settings** (gear icon in the top bar) to configure appearance and performance

---

## Project Structure

```
WallpaperStudio/
|-- src/
|   |-- main.js                 # Electron main process (IPC, wallpaper API, settings)
|   |-- renderer.js             # UI logic (gallery, navigation, Unsplash)
|   |-- preload.js              # Secure bridge between main and renderer
|   |-- index.html              # Main app window (HTML + CSS)
|   |-- settings.html           # Settings window
|   |-- settings-preload.js     # Preload for settings window
|   |-- slideshow-config.html   # Slideshow settings window
|   `-- slideshow-preload.js    # Preload for slideshow window
|-- icon.png
|-- package.json
`-- README.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Electron](https://www.electronjs.org/) 27 |
| Wallpaper API | Win32 SystemParametersInfo via PowerShell (Windows 10/11 compatible) |
| Online Images | [Unsplash API](https://unsplash.com/developers) |
| HTTP (main) | [node-fetch](https://www.npmjs.com/package/node-fetch) |
| Storage | JSON flat files (albums, DB, config, app-settings) |

---

## Unsplash API Compliance

This application follows the [Unsplash API Guidelines](https://unsplash.com/documentation#guidelines):

- Photos are hotlinked to original Unsplash image URLs
- The Unsplash download endpoint is triggered when a photo is saved by the user
- Photographer name and Unsplash are attributed on every photo card and in the lightbox
- The app is visually distinct from Unsplash and does not use the Unsplash logo or name

### Setting Up the API Key (Developers)

1. Go to [https://unsplash.com/developers](https://unsplash.com/developers)
2. Create a free account and register a new application
3. Copy your **Access Key**
4. Set it as the `UNSPLASH_ACCESS_KEY` environment variable before building

The key is **never stored in source code or committed to Git**.

---

## Changelog

### v0.3.3

- **Hardware acceleration off by default** - Default changed from `true` to `false` while stability issues are investigated. Existing users who previously toggled the setting are unaffected; new installs will start with acceleration disabled and can opt in from Settings.
- **Discover: View on Unsplash button** - Each photo card in the Discover tab now has a small icon button (↗) that opens the photo's page on Unsplash in the default browser. Correct UTM attribution parameters are included as required by Unsplash API guidelines.

### v0.3.2 - Bug Fixes

- **Bug 1** - Fixed Unsplash Discover tab being disabled in built releases — the API key is now embedded at build time via a prebuild script (scripts/inject-env.js) instead of being read from the shell environment, which is unavailable in packaged executables
- **Bug 2** - Fixed flash of unstyled content on startup — the window is now hidden until saved theme and accent color preferences are applied, preventing the brief flicker to default styles on launch
- **Bug 3** - Fixed incorrect image dimensions being reported for PNG files — the parser was skipping byte 17 of the width/height fields and using the wrong multiplier for the high byte, causing wrong metadata display and broken Spotlight landscape detection
- **bug 4** - Fixed potential duplicate wallpaper IDs when scanning folders containing multiple images — IDs are now unique regardless of how fast the scan runs

### v0.3.1

- **Settings layout fix** - Replaced fixed-height scroll body with a flex-column layout (header + scrollable area + footer) so all settings sections always display correctly regardless of window size
- **Accent color now works** - Selecting an accent color in Settings shows a live preview in the settings window itself and correctly applies the chosen color and its hover variant across the full app on save
- **Accent hover variant** - Each accent color now ships with a matched darker shade for hover/active states (was previously using the same color for both)
- **Hardware acceleration defaults to ON** - The toggle now correctly shows enabled by default for new installs
- **Settings window is resizable** - Minimum height enforced at 520px so no sections are ever clipped
- **Toggle markup fixed** - Track and thumb elements are now sibling spans (not nested) so CSS transitions work correctly across Electron's Chromium version

### v0.3.0

- **Windows 11 wallpaper fix** - Replaced the `wallpaper` npm package with a direct Win32 P/Invoke call via PowerShell, fixing the issue where the Set button had no effect on Windows 11
- **Settings panel** - New settings window accessible from the gear icon in the top bar, with:
  - Hardware acceleration on/off (requires restart)
  - Dark / Light mode toggle
  - Accent color picker (8 colors)
  - Slideshow default interval
  - Thumbnail size (small/medium/large)
  - Show/hide image names
- **Unsplash API compliance** - Photographer attribution shown on every card and in the lightbox; download endpoint triggered on save; photos hotlinked to Unsplash URLs
- **Environment-based API key** - Unsplash key is now set via `UNSPLASH_ACCESS_KEY` environment variable at build time, keeping it out of source control while embedding it in the packaged exe
- **Logo in title bar** - App icon displayed in the top bar with rounded corners
- **Light mode** - Full light theme support across all panels and windows
- **App icon** - Icon applied to window title bar and taskbar

### v0.2.0 - Performance and UX Polish

- Shimmer skeleton loading cards
- Lightbox shimmer while full image loads
- Improved IntersectionObserver (300px rootMargin)
- Gallery render optimization using DocumentFragment
- Standalone exe build

### v0.1.0 - Initial Release

- Multi-album local folder management
- Favorites, Spotlight, and Discover views
- One-click wallpaper setting
- Slideshow support
- Unsplash integration
- Details panel with image metadata

---

## Windows Notes

- Wallpaper setting uses Win32 `SystemParametersInfo` called via an inline PowerShell C# snippet, with a registry-based fallback - compatible with Windows 10 and Windows 11
- Spotlight images are read from `%LOCALAPPDATA%\Packages\Microsoft.Windows.ContentDeliveryManager_*`
- Hardware acceleration can be toggled in Settings; the change requires an app restart
- App settings (theme, accent, thumbnail size) are stored in `%APPDATA%\wallpaper-studio\app-settings.json`
