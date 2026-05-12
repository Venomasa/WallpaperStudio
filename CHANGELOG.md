# Changelog

All notable changes to Wallpaper Studio are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.3.7] - 2026-05-12

### Added
- **Pexels API integration** — All discovery features (Discover tab, Discovery Slideshow, Daily Wallpaper) now support Pexels in addition to Unsplash. Set `PEXELS_API_KEY` at build time via `inject-env.js`. Both keys are embedded in `build-config.json`. Either key alone is sufficient; having both unlocks the "Both" source option. Pexels attribution is shown on all cards and in the Discovery Slideshow credit line, compliant with Pexels guidelines.
- **Per-feature Source selector** — Every API-dependent feature has a "Photo Source" dropdown: Discover tab (All / Unsplash / Pexels), Discovery Slideshow configuration (All / Unsplash / Pexels), Daily Wallpaper settings (Both / Unsplash / Pexels). The selector is hidden automatically when only one API key is configured.
- **Discover tab — Source filter tabs** — When both keys are present, "All / Unsplash / Pexels" tabs appear in the Discover toolbar. Results from both sources are interleaved card-by-card in the grid.
- **Discover cards — Source badge** — A small colour-coded badge (black for Unsplash, green for Pexels) appears next to the Set/Save/View buttons on each card, matching their height exactly. Replaces the old top-of-overlay badge position.
- **Discovery Slideshow — true randomness & no repeats** — Uses `GET /photos/random` for Unsplash (no-topic mode) and a random curated page for Pexels. Seen photo IDs are tracked with source-prefixed keys (`u_id` / `p_id`) so the same image never repeats within a session. Stopping and restarting resets the seen-ID set.
- **Discovery Slideshow — multi-source shuffle** — When "Both" sources are selected, each fetch batch merges Unsplash and Pexels photos and shuffles them together before queuing.
- **Discovery Slideshow — discovery interval now in hours** — Interval options are 30 min, 1 h (default), 2 h, 4 h, 6 h, 12 h, 24 h. Previous short debug intervals (15 s, 30 s, 1 min, 5 min, 10 min) removed.
- **Daily Wallpaper** — New scheduled-change feature (separate from Discovery Slideshow). Enable in Settings → Daily Wallpaper; configure a time (HH:MM), a photo source (Both/Unsplash/Pexels), and optional topics. A "Change Now" test button is available. Runs in the background even when the window is hidden; the tray menu shows the scheduled time and a "Change Wallpaper Now" item when enabled.
- **Startup & Background settings** — New Settings section: "Start with Windows" (sets login item via `app.setLoginItemSettings`) and "Start Minimized to Tray" (launches hidden when auto-started). Both are persisted in `app-settings.json`.
- **Minimize behaviour** — Pressing the OS `-` (minimize) button keeps the window in the taskbar as normal. The window is only fully hidden from the taskbar (via `mainWindow.hide()`) when a slideshow is actively running.
- **Close guard always asks** — The `×` button now always shows a confirmation dialog regardless of whether a slideshow is running: "Minimize to Tray / Close / Cancel" (no slideshow) or "Minimize to Tray / Stop & Close / Cancel" (slideshow running). Minimizing from the dialog hides to tray without quitting.
- **Tray — Start Slideshow submenu** — When no slideshow is running, "Start Slideshow" in the tray menu opens a submenu listing all configured folders. Clicking a folder starts the slideshow for that folder immediately, without opening the app window. Starting from the tray also stops any running Discovery Slideshow (and vice versa), preventing two simultaneous slideshows.
- **Tray — improved menu** — Header label "🖼 Wallpaper Studio" at top (disabled, for identification). Daily Wallpaper section in tray shows scheduled time and "Change Wallpaper Now (Daily)" when enabled. Quit item stops all timers cleanly.

### Fixed
- **Slideshow changed wallpaper immediately on Start** — `startSlideshow()` previously called `setAsWallpaper(arr[0])` before the first interval tick. It now starts the timer without changing the current wallpaper; the first change happens after one full interval.
- **Double slideshow bug** — Starting a slideshow from the tray submenu while one was already running (or vice versa) could run two timers simultaneously. All start paths now call `stopSlideshow()` / `stopDiscoverySlideshow()` before starting.
- **Discovery Slideshow credit showed hardcoded "Unsplash"** — Credit line now reads the `source` field from the tick payload and shows the correct service name (Unsplash or Pexels).
- **Sidebar folder + button removed** — The `+` button that appeared on hover for each folder in the sidebar has been removed. Use the "Add Images" button in the gallery toolbar instead.

### Changed
- `inject-env.js` now reads and embeds both `UNSPLASH_ACCESS_KEY` and `PEXELS_API_KEY`.
- Default `minimizeToTray` setting changed from `false` to `true`.
- `discoverySlideshowSeenIds` is reset to a new `Set()` on every `startDiscoverySlideshow` call and on `stopDiscoverySlideshow`.

---

## [0.3.6] - 2026-05-09

### Added
- **Per-folder "Add Image" button** — The global topbar "+ Add Image" button is replaced by a small `+` button that appears on hover for each folder in the sidebar. Clicking it opens a multi-file image picker and imports the selected images directly into that specific folder, bypassing the "current album" ambiguity. Supports selecting multiple images at once.
- **Slideshow source selector** — The Slideshow view now shows a dropdown of all current folders plus an "All Albums" option, replacing the read-only label that reflected the last-viewed album. The selected source is used directly when clicking Start, making the slideshow scope explicit and controllable regardless of which gallery view is open.
- **"Set" button in Discover** — Discovery cards now have a "Set" button alongside "Save". Clicking it downloads the image to the configured default save folder (see below) and immediately sets it as the desktop wallpaper — one click, no folder picker. Unsplash download compliance is maintained.
- **Default Save Folder setting** — A new "Discover" section in Settings lets you choose which folder discovery images are auto-saved to when using the "Set" button. Falls back to the first available folder if not configured. Stored in `app-settings.json` as `defaultSaveFolderId`.
- **Slideshow close warning** — When a slideshow is running and the user tries to close the app, a native dialog appears with three options: "Minimize to Background" (keeps the slideshow running), "Stop & Close" (stops the slideshow and exits), or "Cancel" (dismisses and returns to the app). No warning is shown when no slideshow is active.
- **Accent color wheel** — A circular color picker (`<input type="color">`) now appears alongside the preset swatches in Settings. Selecting a custom color deselects preset swatches and applies the custom color live. Picking a preset swatch syncs the wheel to that color. The darker variant (`--c-acc2`) is derived automatically by darkening the chosen color by 15%.
- **Spotlight refresh button** — A ↻ button appears in the topbar whenever the Spotlight view is active. Clicking it re-scans all Spotlight source paths and reloads the grid, so you can pull in newly downloaded images without leaving the view. The button spins while the scan is in progress and is hidden in all other views.

### Fixed
- **Spotlight images missing or feeling stale** — The spotlight scanner was checking three locations but missing several that Windows 11 actively uses for fresh images:
  - `LockScreen_` folders inside `SystemData` only matched `.jpg` and `.png`, silently skipping `.jpeg` and the extension-less files Windows writes there (same format the Assets folder has always used).
  - `DesktopSpotlight` subfolder (added in Windows 11 22H2) was not scanned at all — this is where the newest desktop Spotlight images land.
  - `IrisService` under `MicrosoftWindows.Client.CBS_cw5n1h2txyewy\LocalCache\Microsoft\` (the primary IrisService location on Windows 11 23H2+) was not scanned. Images there sit inside numbered subdirectories; the scanner now walks one level deep to find them regardless of what numeric ID Windows assigned.
  - `Windows\Web\Wallpaper\Spotlight` (static cached images written by Windows Update) was not scanned.
  All four sources now use a unified `scanFlatDir` helper that matches `.jpg`, `.jpeg`, `.png`, and extension-less files above 200 KB, sorted newest-first.

### Changed
- **Light mode redesign** — The light theme palette is replaced with a warmer, lavender-tinted scheme (`#f2f0f9` background, `#fdfcff` panels) that is less clinical and easier on the eyes. Text uses deep purple-gray tones (`#1b1730` / `#48446a`) instead of near-black. Borders use transparent purple-tinted values for subtle depth. Cards in light mode gain a soft box-shadow. Sidebar and panels receive distinct background tints for better spatial layering.
- Settings version label updated to **v0.3.6**.

### Removed
- **Global topbar "+ Add Image" button** — superseded by the per-folder add buttons. The DOM element is kept (hidden) for potential API compatibility.

---

## [0.3.5] - 2026-05-09

### Fixed
- **Spotlight favourite button silent no-op** — Clicking ★ on a Spotlight image previously called `toggleFavorite` with a `spotlight_…` ID that was never in `db.wallpapers`, so the toggle appeared to work but reset on next render. The star button is now hidden for Spotlight cards (Spotlight images are not stored in the DB and cannot be favourited; copy them to an album first). The "Remove from favourites" context menu item is also suppressed for Spotlight entries.
- **Duplicate wallpaper IDs after delete** — `addWallpaperFromPath`, `syncFromStorageDir`, `copy-to-album`, `copy-spotlight-to-album`, and `download-image-url` all used `'wp_' + db.wallpapers.length + N` for ID generation. After any delete, length shrinks and the next import re-uses an existing ID, causing `toggleFavorite` and `deleteImage` to silently target the wrong record. All ID generation now uses `'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2,7)`, consistent with the correct pattern already used in `scanWallpapersInFolder`.
- **"Show Image Names" setting had no effect** — The toggle was saved and loaded but `applySettings()` never read it, no CSS class was toggled, and `makeCard()` rendered no name element. Now: `applySettings` toggles `html.show-names`; `makeCard` appends a `.card-name` div with the file name; CSS shows `.card-name` only when `html.show-names` is active.
- **Slideshow cycled all albums regardless of selection** — `startSlideshow()` iterated all of `db.wallpapers` with no album filter. The renderer now passes `S.currentAlbumId` (when in album mode) to the `start-slideshow` IPC send; `startSlideshow(intervalMs, albumId)` filters the wallpaper list before cycling. The slideshow view shows a "Source" row indicating which album will be used.
- **Slideshow running-state desynced after app restart** — `S.slideshowRunning` was pure renderer memory and had no way to reflect whether the main-process timer was actually running. A new `get-slideshow-status` IPC handle returns `{ running, intervalMs, albumId }` from the main process. `navigateTo('slideshow')` now calls it to sync state before rendering the UI, so Start/Stop always reflects reality.
- **IPC event listeners accumulated on GPU crash / renderer reload** — `onRefresh` and `onSettingsUpdated` in the preload called `ipcRenderer.on()` with no cleanup. Each renderer reload (triggered by repeated GPU crashes) stacked an additional listener, causing settings-updated to fire multiple times per save and producing duplicate toasts and potential race conditions. Both handlers now call `ipcRenderer.removeAllListeners(channel)` before re-registering.

### Changed
- Slideshow Start toast now includes the source album name (e.g. "Slideshow started (Landscapes)") or "all albums" when no specific album is selected.
- `copy-spotlight-to-album` IPC handler ID generation fixed to use the same unique-random pattern as all other handlers (previously used `albumId` string as suffix, risking collisions).

---

## [0.3.4] - 2026-05-09

### Added
- **Settings page** — full in-app settings view with sticky Save / Discard footer; replaces the separate popup window
- **Slideshow page** — dedicated in-app slideshow controller with live status indicator (green dot when running), dynamic Start / Stop button swap, and interval selector
- **Discard button** in Settings — snapshots settings on view entry and re-applies them on cancel, restoring both the UI controls and the live CSS variables
- **Slideshow interval persistence** — chosen interval is now saved to `app-settings.json` on Start, consistent with all other settings
- **Live accent color preview** — clicking a swatch in Settings instantly updates the entire app's CSS variables without saving
- **Live theme preview** — selecting a theme in Settings instantly toggles `data-theme` on `<html>` before saving
- Slideshow and Settings nav items in the sidebar bottom section

### Changed
- **Single-window architecture** — the app now uses one `BrowserWindow`, one HTML file, and one preload file instead of three windows and four HTML files
- **App-shell layout** — topbar and sidebar are now in normal document flow (`flex-shrink: 0`) instead of `position: fixed`; eliminated `margin-top` / `margin-left` hacks on the main content area
- **Scroll architecture** — only `.view-scroll` scrolls per view; all shell containers are `overflow: hidden`; no nested scrollbars
- **Details panel** — now `position: absolute` inside `#content` (which is `position: relative`) instead of `position: fixed` on the viewport; panel slides in without causing any layout shift
- **View router** — `navigateTo(view, galleryMode, albumId)` is the single function responsible for switching views, updating active nav state, and running view-specific init
- `min-height: 0` applied to all flex children that must shrink, fixing layout clipping at non-100% DPI scaling on Windows
- Design tokens consolidated into a single `:root` block in `index.html`; no more duplication across multiple HTML files
- `slideshow-config.html` used `localStorage` for interval state — migrated to `app-settings.json` via IPC, matching all other settings

### Removed
- `src/settings.html` — replaced by `#view-settings` in `index.html`
- `src/settings-preload.js` — functionality absorbed into the single `preload.js`
- `src/slideshow-config.html` — replaced by `#view-slideshow` in `index.html`
- `src/slideshow-preload.js` — functionality absorbed into the single `preload.js`
- `open-settings` IPC handler in `main.js` — no longer needed
- `open-slideshow-config` IPC handler in `main.js` — no longer needed
- `settingsWin` and `slideshowWin` window variables in `main.js`
- `openSettings` and `openSlideshowConfig` from `preload.js`

### Fixed
- Layout clipping and content overflow at non-100% DPI scaling on Windows (caused by `position: fixed` offsets and missing `min-height: 0`)
- Settings window cramping when more options were added (fixed `height: 640px` window replaced by scrollable flex page)
- Nested scrollbar appearing inside the settings popup
- Slideshow interval not persisting between sessions (was stored in `localStorage` in the popup window, isolated from the main process)

---

## [0.3.3] - 2026-05-08

### Added
- Hardware acceleration toggle (disabled by default; restart notice shown when changed)
- Accent color picker with 8 color swatches; live preview applied to the settings window
- Thumbnail size selector (Small 160px / Medium 210px / Large 280px / Extra Large 340px)
- Show Image Names toggle
- Light / dark theme selector with live preview in settings window
- Settings persisted to `app-settings.json` in `%APPDATA%/wallpaper-studio/`
- `settings-updated` IPC event so the main window applies theme and accent changes live after settings are saved
- Slideshow default interval setting (15 s – 1 hr) inside the settings window
- Windows Spotlight image browser — scans `SystemData` lock screen and `ContentDeliveryManager` Assets folders; filters to landscape images ≥ 200 KB
- Discover view powered by Unsplash API (key embedded at build time via `UNSPLASH_ACCESS_KEY` env var)
- Category chips (Featured, Nature, Architecture, Space, Animals, Travel, Minimal, Abstract, City, Mountains)
- Unsplash search with Enter key support
- "Load more" pagination for Discover
- Unsplash API compliance: download endpoint triggered before saving; photographer attribution always shown; UTM parameters on all Unsplash links
- "View on Unsplash" icon button on Discover cards
- Lightbox with shimmer placeholder and photographer credit overlay
- Image Details side panel (name, dimensions, file size, date modified, full path)
- Copy to folder — copy any image to another album via picker modal
- Copy Spotlight image to album
- Context menu (⋮) on gallery cards: Copy to folder, Remove from favourites, Image Details, Delete image
- Favourite toggle (star button) on gallery cards; Favourites collection in sidebar
- Album picker modal for multi-album copy destinations
- Shimmer loading animation on all image thumbnails and lightbox
- IntersectionObserver lazy loading with 300 px root margin
- `contain: layout style paint` on gallery and discover cards for rendering performance
- Toast notifications (success and error variants)
- ESC key closes lightbox, details panel, context menu, and album picker
- Card remove animation (fade + scale out)
- Custom 5 px scrollbar styling
- `show: false` + `ready-to-show` window reveal to prevent white flash on GPU restart
- `backgroundColor` set from saved theme on window creation to prevent flash of wrong colour
- Hardware acceleration disabled before `app.ready` using synchronously loaded settings
- Windows 11 wallpaper fix: P/Invoke `SystemParametersInfo` via PowerShell inline C# with registry + RUNDLL32 fallback
- DB pruning (`pruneDbEntries`) removes entries whose files no longer exist on disk
- `syncFromStorageDir` on startup to pick up images added outside the app
- `scanWallpapersInFolder` on every `get-wallpapers` call to pick up new files in watched folders

### Changed
- Settings and slideshow configuration moved to separate child `BrowserWindow` popups (later refactored out in 0.3.4)
- Sidebar navigation uses `.nav-item` with `.active` class driven by `navigateTo()`

---

## [0.3.2] and earlier

Initial development versions — multi-folder album system, basic gallery, one-click wallpaper set, favourites, and local file import established.
