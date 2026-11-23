# PixForge — Browser-Based Pixel Art Studio

[繁體中文](README.md) | **English**

PixForge is a **React + TypeScript + Vite** application for converting ordinary images into pixel art with adjustable resolution, palette size, and edge treatment. Edit individual pixels, build frame-by-frame animations, and export game-ready assets.

**Conversion, editing, and export all run locally in the browser**, with no account or image-processing backend required. The website may load external static resources (such as Google Fonts), but does not upload your source images to a backend for conversion.

## Features

- **Downsampling styles:** Clean Sprite (color clustering), LAB Separation, K-Centroid Sharp, and Soft Area downscaling.
- **Size and crop:** Custom 8–256 pixel dimensions, common presets, rectangular output, and interactive cropping.
- **Image controls:** Smoothing, outline preservation, pre-sharpening, contrast, saturation, and alpha threshold.
- **Color controls:** Auto-extracted 4–64 color palettes, classic presets, or original colors; optional Bayer 4×4 or Floyd–Steinberg dithering; isolated-pixel cleanup (Off / Light / Strong, Light by default).
- **Comparison and editing:** Side-by-side, split comparison, pixel-only view, grid, zoom, pencil, eraser, eyedropper, fill, magic wand, and undo/redo.
- **Animation workflow:** Multi-file upload with natural filename sorting, add/delete/reorder frames, optional shared Oklab palette, and 1–30 FPS playback.
- **Export formats:** PNG, Sprite Sheet PNG, looping GIF, and ZIP of individual PNG frames at 1×, 4×, 8×, or 16× scale.

Accepted image files: PNG, JPEG, WebP, and GIF. **Importing one animated GIF does not automatically split it into animation frames**; use an image sequence instead.

## Getting Started

Requirements: **Node.js 22 (22.12+ recommended)** and npm. The repository contains `.node-version`.

```bash
git clone https://github.com/shellpig/pix-forge.git
cd pix-forge
npm ci
npm run dev
```

Development URL: `http://localhost:3000`.

| Command | Purpose |
| --- | --- |
| `npm test` | Run regression tests |
| `npm run lint` | TypeScript check |
| `npm run build` | Build `dist/` |
| `npm run preview` | Preview the production build |
| `npm run clean` | Remove `dist/` |

## How to Use

1. **Upload Image** starts a new workspace. Use **Append Frame** in the animation timeline to retain existing frames, or paste an image with Ctrl+V.
2. Set the output dimensions, crop, algorithm, palette size, and dithering in the right-hand panel. Compare the results with the available views.
3. Use **Pixel Editing** mode to refine individual pixels with editing tools and undo/redo.
4. Switch to **Animation** mode, add at least two frames, drag to reorder them, and choose a playback speed.
5. Export a PNG, Sprite Sheet, GIF, or ZIP. When conversion changes could affect edited frames, the UI lets you keep manual changes or apply the new conversion.

The current UI labels are primarily in Traditional Chinese.

### Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Paste image | Ctrl+V (system paste shortcut on macOS) |
| Pencil / Eraser / Eyedropper | B / E / I |
| Fill / Magic Wand | G / W |
| Undo / Redo | Ctrl+Z / Ctrl+Y (Command supported on macOS) |
| Pick a color temporarily | Alt + click |
| Play / Pause | Space |
| Previous / Next frame | Left / Right arrow |
| Edit a frame | Double-click its timeline thumbnail |

Open the keyboard icon in the toolbar for in-app help.

## Sprite Sheet and Performance Notes

Sprite Sheets use an **approximately square grid** by default (columns ≈ `Math.ceil(Math.sqrt(frameCount))`), with manual column and single-row options. Before allocating a Canvas, PixForge applies conservative export limits of **16,384 pixels per side** and **16,000,000 total pixels**. Reduce the scale or adjust columns if an export exceeds them. Actual browser limits may be lower.

Isolated-pixel cleanup runs after palette quantization, including support for isolated opaque specks and transparent pinholes. Light mode protects high-contrast highlights; Strong mode can erase intentional single-pixel highlights. Bayer/Floyd dithering temporarily disables cleanup, and your previous setting returns when dithering is turned off.

Larger images, more frames, and higher export scales use more memory. Batch processing prefers a browser Web Worker, with a main-thread fallback.

## Project Layout

- `src/App.tsx`: App state, frame management, export actions.
- `src/components/`: Canvas, control panel, pixel editor, timeline.
- `src/lib/pixelEngine.ts`: Image downsampling and quantization.
- `src/lib/palettes.ts`: Built-in palettes and Oklab calculations.
- `src/lib/frameHistory.ts`: Editing history and undo/redo.
- `src/lib/animationExport.ts` and `spriteSheetLayout.ts`: Animation exports and size guards.
- `src/workers/pixelConversion.worker.ts`: Background frame processing.
- `tests/`: Regression tests.

## Deploy to Cloudflare Workers

PixForge is a **static frontend**. `wrangler.jsonc` serves `./dist` as static assets and needs no server-side `main` entrypoint. The browser Web Worker is unrelated to the Cloudflare Workers runtime.

```bash
npm ci
npm run build
npx --no-install wrangler deploy --dry-run
npx --no-install wrangler deploy
```

The final command requires Cloudflare authentication and project permissions. For Git-connected builds, use **Build command: `npm run build`**, **Deploy command: `npx wrangler deploy`**. The Cloudflare Workers project name must match `pix-forge` in the configuration.

## Acknowledgments and Algorithm References

Thanks to the researchers and open-source authors who share their work:

- **[PixelOE — KohakuBlueleaf](https://github.com/KohakuBlueleaf/PixelOE)**: *Detail-Oriented Pixelization based on Contrast-Aware Outline Expansion*. Its research on contrast-aware outline expansion, downsampling, and fine-detail preservation is an important reference.
- **[K-Centroid — Astropulse](https://github.com/Astropulse/K-Centroid-Aseprite)**: Local K-means clustering and representative-color selection inspired PixForge's two-cluster downsampling option. See also [Pixel Detector](https://github.com/Astropulse/pixeldetector).
- **[Oklab — Björn Ottosson](https://bottosson.github.io/posts/oklab/)**: *A perceptual color space for image processing* (2020). PixForge uses Oklab concepts for perceptual color-distance comparisons and palette quantization.

**Implementation note:** PixForge has its own TypeScript/Canvas pipeline. Its **LAB Separation** and **K-Centroid Sharp** modes are **not official ports or endorsements** of the referenced projects. These acknowledgments recognize research, concepts, and inspiration.

## License

This repository currently **does not include a `LICENSE` file**. Crediting upstream projects does not grant PixForge their licenses. Add a project license before releasing it as open source. Bugs and suggestions are welcome via GitHub Issues.
