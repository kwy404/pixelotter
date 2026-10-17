# Changelog

All notable changes to pixelotter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-17

### Added

- A tool cursor over the canvas: the brush outline at its real size and zoom, with a crosshair for small brushes and a precise crosshair with Caps Lock, for mouse, pen and touch.
- Text layers you can edit again: click or double click the text, type, use Enter, arrows and Backspace, change font, size, color, bold, italic and alignment from the options bar, and keep the text editable through `.pxo` and PSD files saved by pixelotter.
- Tooltips with a name, a line on what it does, a tip and the shortcut for tools, menus and controls, in English and Portuguese; a hint for the current tool in the status bar and the options bar.
- Live presence: a name and color asked before the first session, smooth friend cursors with their tool, brush size and what they are doing, their selections, a dot on the layer they work on, and a people list with tool, layer, microphone, camera, follow and go to cursor.
- The tour has Back, Escape and the arrow keys, follows window resizes and only points at what is on screen.
- A full keyboard set: Delete removes the selected pixels or the layer, paste in place, Ctrl+Y redo, F2 rename, Alt+[ and ] to walk the layers, Shift+[ and ] for hardness, 0 to 9 for opacity; every shortcut shows in the menus, the tooltips and Help, and can be changed from Settings.
- The system clipboard: copy writes a PNG other apps can paste and keeps an exact copy that pastes back at the same place; paste takes images, image files (PSD and TIFF ask how), images in copied web pages, text as a text layer and hex colors as the foreground; paste in place, paste into the selection, a new document from the clipboard, and drag and drop that works the same.
- Pictures pasted in a live session travel as PNG in chunks, below 4096 px, with progress in the status bar.
- The Activity panel: who did what and when, in plain words, shared in live sessions, with a filter by person, a click to select the layer and an export as text; history steps carry their author.

### Fixed

- Brush strokes had a dotted grey ring along their edge: the tip now falls off smoothly and every dab lands at its exact sub pixel position.
- Tool overlays (selection drags, crop frame, transform handles, gradient line) were never drawn.
- The tour card was misplaced after its first step and pointed at hidden parts.
- Brush, eraser, clone, healing, dodge and blur tools had no keyboard shortcut.
- Tab hid the panels even when a button had the focus, so the keyboard could not move between controls.
- The keyboard shortcuts dialog failed to open.
- Levels, curves, color balance, channel mixer and gradient map failed to preview or apply.
- Quick select never found the subject.
- Content aware fill with everything selected failed; it now explains that some pixels must stay outside the selection.
- The blend mode list looked empty and the angle label was cut off in Portuguese.
- Joining a room could fail on a busy machine when the connection opened before its session description was ready.
- Ctrl+Shift+E exported instead of merging the visible layers, and Ctrl+Y now redoes (proof colors moved to Ctrl+Alt+Y).

## [0.1.0] - 2026-10-16

### Added

- The editor workspace: menu bar, options bar, tool strip, docked panels (layers, channels, properties, adjustments, history, color, swatches, paths, actions, info), document tabs and a Quick mode.
- Layers with groups, blend modes, masks, clipping, adjustment and fill layers and layer styles.
- Selections: marquee, ellipse, lasso, polygon lasso, magic wand and quick select, with modify, refine and channels as selections.
- Tools: brushes, eraser, clone, heal, dodge, burn, sponge, smudge, gradient, bucket, text, shapes, pen, crop and free transform.
- A filter library with levels and curves, liquify, content aware fill and an on device cutout model.
- Unlimited undo with a history panel, autosave and recovery.
- Files: layered PSD and PSB, TIFF with CMYK, PNG and APNG, JPEG, WebP, AVIF where supported, GIF, BMP, ICO, TGA, PDF and the `.pxo` project; HDR, EXR, Netpbm and camera raw previews read only.
- An approximate CMYK soft proof, gamut warning and CMYK TIFF export.
- Live rooms for up to five friends: invites by six words, QR code or link, live cursors, layer locks, roles, chat, voice with noise suppression, cameras, screen sharing and device pickers.
- A context menu for the canvas, layers, chat and people, by right click, long press, the Menu key or Shift+F10.
- The darkroom landing page, Otto the otter, icons and illustrations.
