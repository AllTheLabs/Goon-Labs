# Goon Labs

A Windows desktop app for a personal photo and video library. Import media, tag it, browse it, and play it in full-screen labs. Trim, splice, time-dilate, or turn clips into GIFs without leaving the app.

Everything stays on this computer. There is no account, no cloud, and nothing is uploaded.

## Install

Run `Goon-Labs-Setup-<version>.exe`. The installer is per-user by default and can put shortcuts on the desktop and Start menu.

The library toolbar has an **Update** button (with the installed version beside it). Click it to check GitHub Releases. If a newer installer is up, the button lights up in the current theme; click again to download. A logo overlay fills from top to bottom while it downloads, then the new version installs silently and Goon Labs reopens with the GitHub release notes. You can also check from Settings.

Each GitHub release needs these files from `dist/` after `npm run dist`:

| File | Purpose |
| --- | --- |
| `Goon-Labs-Setup-<version>.exe` | Installer |
| `Goon-Labs-Setup-<version>.exe.blockmap` | Lets updates download only what changed |
| `latest.yml` | Tells the app which installer is current |

## First launch

The window opens **maximized**. Pick a **repository** folder. That folder is the library root. There is also an optional **Show Goon Labs on Discord** checkbox; it stays off unless you tick it. Goon Labs creates:

| Path | Purpose |
| --- | --- |
| `Pictures/` | Imported photos |
| `Videos/` | Imported videos |
| `.mediamanager/library.json` | Item ids, tags, and paths |
| `.mediamanager/previews/` | Small copies of videos for the Scroller |

Change the repository later from the sidebar.

## Library

The main window is a grid of everything in the repository. Search names and tags, filter by type or tag, and sort by newest, oldest, name, or size.

- **Import files** or **Import folder**, or drop files onto the window. Photos go to `Pictures`, videos to `Videos`. Names that already exist get ` (1)`, ` (2)`, and so on.
- **Import URL** (or Ctrl+V) downloads the media and adds it to the library. That covers direct file links, most video sites via yt-dlp, and X/Twitter posts (video is preferred over stills).
- Click an item to select it. Ctrl/Shift-click for several. The right-hand panel shows a preview, tags, size, and actions.
- Tags are lowercase. Filter the grid from the sidebar, or use **Untagged** to work through files that have none yet.
- **Enter** opens the viewer, **Delete** moves files to the Recycle Bin, **Export** copies the selection somewhere else.
- With one video selected, **Trim**, **Splice**, **Dilate**, and **GIF** on the selection bar (and in the details panel) open those utilities directly.

The gear in the sidebar opens **Settings**: default folder for lab recordings, whether labs should start recording / webcam on, **Discord Rich Presence** (off by default), a **Software window rendering** toggle (CPU draws the window; ffmpeg jobs such as Time Dilation still use the GPU), and a keybind guide. That display toggle needs a restart.

On first launch you can also turn Discord Rich Presence on from the welcome screen. When it is on and the Discord desktop app is running, friends see **Playing AllTheLabs**, whether you are idle or browsing media, which lab you are in, and how long that lab session has lasted. Labs show as **In Goon Session -** plus the lab name. A button links to the GitHub releases page. Library contents are not sent.

## Labs

Labs are full-screen players. They can show a webcam overlay (move and resize it from the control bar) and record the window to MP4.

**C** toggles the webcam, **R** starts or stops recording. You can also tick those on in the setup dialog, or set them as defaults in Settings.

### Scroller

Pick tags (or use every video) and play matching clips in a tiled, endlessly scrolling wall. Hover focus, overlay effects, tile size, and speed live on the bottom bar. Small preview copies are generated in the background so many videos can play at once.

### Beat Bar

Queue videos, then play them one at a time. A beat bar pulses along the bottom. Intensity runs Light → Medium → Heavy → Ludicrous, or a random mix. Endless desire loops the queue.

### Pixel Perfection (experimental)

**Labs → Pixel Perfection**. Queue videos the same way as Beat Bar, without the beat UI. An on-device detector pixelates regions while they play. Frames never leave this computer; the detector model is downloaded once into the app data folder on first use.

- **Faces** (**F**) — mosaic over the eyes and forehead. The mouth stays visible. Extra coverage above the eyes helps when the head moves.
- **NSFW** (**N**) — mosaic over exposed genitals and similar regions.
- **Skip dark** (**D**) — leave dark-skinned male genitalia unpixelated (sampled from the box; lighting can throw it off). On by default.
- **Pixelation** slider (Fine → Blocky, or **[** / **]**) — how coarse the mosaic is.
- Pixelation stays on the last boxes when you pause. Endless desire loops the queue.

Detection is local and imperfect — boxes can miss, sit slightly off the target, or (for Skip dark) misread tone. The sidebar marks this lab **Experimental**.

### Hypno Station

**Labs → Hypno Station**. Queue videos, then watch random snippets cut together on a loop until you exit. Each cut pulses. Audio runs through a wet reverb. A colour wash drifts from pink through magenta and purple over the picture. A dry **melodic rumble** (on by default) plays a dark synth arpeggio in time with the cuts, with the bass kick as the last note of each phrase, and stays out of the reverb — toggle it in setup or with **B** in the lab. Overlay effects from the Scroller are here too (**E**); the pink spiral starts on.

Cut speed is **Linger**, **Flash**, or **Strobe** (1 / 2 / 3 in the lab). The melody follows that speed. **→** jumps to the next snippet.

Recordings save to the folder you set in Settings (or Videos if that is unset). After you stop, Goon Labs encodes an H.264 MP4 so the file has a duration and can be seeked.

## Utilities

### Trimmer

**Utilities → Trimmer**. Pick a video (if one video is already selected in the library, it is highlighted). Drag the two handles on the timeline to keep only the span between them. Playback loops inside that span.

**Save trim** asks whether to:

- **Save as a new video** — writes `name (trimmed).mp4` next to the original
- **Replace the original** — overwrites that library item

Either way, the result **inherits the original tags**. Replacing a non-MP4 file stores an MP4 and updates the library path.

### Splicer

**Utilities → Splicer**. Pick a video the same way as the Trimmer. The timeline opens with two spans already on it — you need at least two. Drag the handles, add more spans with the control next to the timeline, and remove extras (two always stay). Playback skips the gaps so you hear the stitched result.

**Save splice** asks whether to:

- **Save as a new video** — writes `name (spliced).mp4` next to the original
- **Replace the original** — overwrites that library item

Either way, the result **inherits the original tags**. Everything outside the spans is dropped; the kept spans are stitched in timeline order.

### Time Dilation

**Utilities → Time Dilation**. Pick a video the same way as the Trimmer. Click the clock-and-plus control next to the timeline to drop a pair of handles. The span between them plays slower (video and audio). Choose **1.5×**, **2×**, or **2.5×** for the selected span; add as many spans as you want.

Playback in the preview slows inside those spans so you can hear the result before saving. On save, tick **Interpolate extra frames** if you want smoother slow motion — it fills in in-between frames, and it will increase render time a lot. Leave it off for a faster encode. The audio is always time-stretched (pitch kept) and mixed with a wet reverb.

**Save dilation** asks whether to:

- **Save as a new video** — writes `name (time dilated).mp4` next to the original
- **Replace the original** — overwrites that library item

Either way, the result **inherits the original tags** and adds **time dilated**.

### Goon Image Format (GIF)

**Utilities → Goon Image Format**. Pick a video, drag the timeline handles to keep a span, then set **quality** (Low → Ultra), **frame rate**, and whether the GIF **loops**. The preview plays that span; the saved file is a GIF in `Pictures/`.

**Save GIF** asks whether to:

- **Save as a new GIF** — writes `name.gif` into Pictures
- **Replace the original** — removes the video and keeps the GIF as that library item

Either way, the result **inherits the original tags** and adds **gif**. Long spans make large files; the encoder refuses anything over 60 seconds.

## Themes

The palette button next to Settings. Standard themes change colours only. Extra themes (Hypnotic, Blacked, Sissy) also change some labels and icons, including the caption on the webcam while a lab is recording.

## Shortcuts

Full tables live in Settings. The ones you will hit most:

| Where | Keys |
| --- | --- |
| Library | Ctrl+V import URL, Ctrl+A select all, Enter open, Delete, Esc |
| Scroller / Beat Bar / Pixel Perfection / Hypno Station | Space pause, C webcam, R record, Esc exit |
| Pixel Perfection | F faces, N NSFW, D skip dark, [ ] mosaic |
| Hypno Station | 1/2/3 cut speed, B rumble, E overlays, → next snippet |
| Trimmer / Splicer / Time Dilation / GIF | Space play/pause, Esc close |

## Privacy

Goon Labs is a local app. Media, tags, settings, and recordings stay in folders you choose on this machine. URL import talks to the sites you paste (and to yt-dlp’s GitHub releases when the downloader needs an update). Pixel Perfection downloads a local detector model on first use; video frames stay on this machine. On startup it checks GitHub Releases (`latest.yml`) for a newer installer; that only reads the public release list. After an update it also fetches those public release notes to show in the app. Discord Rich Presence, when you turn it on, talks only to the Discord desktop app on this machine so friends can see AllTheLabs is open — not your library. There is no analytics account and no Goon Labs server.

## Running from source

Needs Node.js and npm.

```bash
npm install
npm run dev
```

```bash
npm run typecheck
npm run dist
```

`npm run dist` builds a Windows installer under `dist/`, named `Goon-Labs-Setup-<version>.exe`.

Bump the version in `package.json` before a release (minor for features, patch for fixes).
