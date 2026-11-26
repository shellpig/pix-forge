# Phase 04-A — Canvas source-color picking

The existing document palette has a dedicated **Pick from canvas** control in Single replacement and Manual merge. It is independent of the brush eyedropper and brush quick swatches.

- Starting the picker switches to Pixel Editing, clears any rendered preview (without applying it), and leaves the brush's tool and color unchanged.
- Single replacement: click one visible source pixel. Its exact RGB/HEX becomes the selected source and initial target, the palette reveals its page/swatches, and picking ends.
- Manual merge: click multiple source colors. Repeated clicks on the same color are idempotent; use palette swatches to deselect. The first color initializes the target if no selection exists. In All frames scope, switch paused frames to add colors from their committed pixels. Finish picking to restore the existing live-preview behavior.
- While picking, the canvas shows committed pixels, not recolored preview pixels; drawing/erasing/filling and apply are blocked. Fully transparent pixels are ignored. Coordinates are measured against the actual rendered canvas content rather than its bordered parent, so zoom/pan and edge clicks use the correct pixel. Touch uses the same pointer-coordinate path.
- Escape, Ctrl+Z/Redo, or Cancel picking discard the draft before touching committed history. Finishing selection does not commit; the existing Apply action creates one history entry (or one batch transaction). Scope changes, frame changes in current-frame mode, configuration/committed frame changes, and leaving Pixel Editing cancel the picking session.
- The original brush eyedropper remains a brush-color tool. No changes to remapping, OKLab clustering or batch history algorithms.

The implementation includes core coordinate/RGB/selection tests and source-level integration coverage. Interactive browser verification (including narrow-screen layout) is separate. Phase 04-C will compact the brush Color Picker.

## Phase 04-B — Direct toolbar entry and navigation

- **Replace color** starts a fresh single-source canvas-picking draft using the current frame/all-frames scope, with no pixel or history changes until Apply. It closes the brush color picker without changing the brush color or tool. If picking is already active, the button reveals the palette instead of resetting the selection.
- **Document palette**, next to the brush quick colors, reveals the existing document palette (including scope selector) without changing any mode, selection, brush setting, or preview. The link remains outside the horizontally scrolling swatch strip.
- On desktop, both shortcuts scroll the right control panel independently of the canvas. On narrow screens, the navigation-only shortcut scrolls to the panel; starting a source pick keeps the canvas in view until the user chooses a color. Browser verification of actual scroll positioning and mobile layout is still outstanding.
- Unavailable or converting frames disable direct replacement according to the same guards as Phase 04-A. The original brush eyedropper and quick swatch behavior are preserved.
