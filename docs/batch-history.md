# Phase 03-A — Batch history architecture

## Scope

Phase 03-A adds the transaction infrastructure. Phase 03-B exposes sequence palette statistics and the all-frame editing UI. Existing single-frame tools, quick palette, output palette, and Phase 02 preview cancellation remain available.

## Contract

- `commitSequenceColors(journal, mapping, availability, transactionId)` prepares all changed frames using the existing simultaneous RGB remapper, then returns a complete immutable journal. It rejects the entire edit if any required frame is unconverted or the workspace is playing, converting, waiting for reconversion resolution, or displaying a pending preview. No-match frames remain unchanged; invalid/no-op mappings never write history.
- A batch is one journal entry containing a transaction ID, the changed frame IDs, exact before/after ImageData references, and the retained-byte charge. References share existing immutable history buffers; no duplicate permanent transaction snapshots are needed.
- `movePixelEntry` checks each participating frame's exact adjacent snapshots and current history position before moving any frame. No partial success. Local Undo/Redo uses the same path when it reaches a batch. A newer participating edit blocks crossing that batch; unrelated local edits remain independent.
- Single-pixel history entries also identify their exact after snapshot, preventing a global action from undoing an unrelated newer edit by frame ID alone.
- App publishes the whole frame array and both journal stacks together. Phase 03-B uses `handleApplySequenceColors`, the internal entry point. Its structured result exposes failure reasons, changed pixels and retired transaction count.

## Limits and checkpoint policy

- 40 per-frame slots including the conversion baseline; 40 global undo entries; 64 MiB retained batch snapshot budget across Undo and Redo. Each batch is charged the sum of its before/after RGBA buffer byte lengths, conservatively even if references are shared. The limit is NOT total browser memory; preparing a transaction may allocate temporary buffers. A single oversized batch is rejected without changing anything.
- Before a per-frame trim would remove a batch boundary, the global journal would drop a batch, or the budget would be exceeded, retire existing applied batches together. On each participant retain the latest retired batch result as a protected manual checkpoint, discard unreachable older history, and preserve newer history subject to the existing per-frame cap. The current pixels never change due to retirement. An undone batch fork discards its redo branch across all participants, not only the newly edited frame.
- Reconvert/config changes, adding/deleting/restoring frames (membership can alter shared palettes), and resetting a participating frame use conservative whole-batch retirement before invalidating the baseline. Reordering does not invalidate batch identity. Resetting an unrelated frame does not retire batches; clearing all manual edits intentionally clears all pixel history. An in-app localized notice announces retirement or a blocked history step. This policy deliberately does not promise undo across conversion/membership changes.
- IndexedDB continues to save only current manual pixels, not session Undo/Redo. An optional `manualEditCheckpoint` flag prevents a reopened atomic result from acquiring an independent per-frame Undo to conversion. Existing version-1 workspaces remain readable. Explicit reset can still discard a manual checkpoint.

## Validation

`npm test`, `npm run lint`, and `npm run build` run in CI. Core regression tests cover exact frame identity, interleaved edits, undo/redo blocking, branch forks, structural retirement, both history caps, memory rejection, special states, transparency, and a 120-frame 256×256 sequence (60 MiB charged batch history). Source-level integration tests complement real browser interaction testing. Phase 03 browser and manual verification was completed and confirmed by the project owner on 2026-11-26.

## Phase 03-B — Sequence palette workflow

- The document palette defaults to the current frame. With multiple frames, choose All frames to aggregate the actual effective committed pixels from every converted frame (including manual edits), independent of the conversion shared-palette switch. Transparent pixels do not participate.
- Each sequence swatch displays HEX, total pixels, and the number of frames containing the color. Open its information button to see frame numbers and names. The counts are union statistics, not the sum of per-frame unique color counts.
- Single replacement, manual merge, and complete-link OKLab automatic merge use the same simultaneous mapping and existing representative-color rules. The 256-color automatic limit applies to the union palette; manual merging is not subject to that limit.
- Before applying, the UI shows expected union color count, changed pixels, affected frames, and conservative before/after snapshot charge. A transaction exceeding 64 MiB is disabled; the journal still checks the limit independently. Unconverted/failed conversion, pending reconversion, playback, and an unrelated preview cannot be bypassed.
- Live sequence preview retains only the mapping and its committed frame-array/config/view identity. The canvas renders the currently selected frame on demand; scrub paused frames to compare. The timeline, original output swatches, exports and IndexedDB continue using committed pixels. Playback, scope changes, membership/reorder, committed edits, configuration or view changes discard stale preview. Apply can consume only the matching current sequence draft; Ctrl+Z/Esc cancel the whole draft without moving history.
- Apply creates one atomic batch through Phase 03-A. The all-frame palette's Undo/Redo buttons follow global journal order (including other edit types); current-frame tools retain local semantics. No automatic merge or deployment is performed.

Phase 03-A and Phase 03-B browser and manual verification is complete, as confirmed by the project owner on 2026-11-26. All 80 automated tests, TypeScript checks, and the production build passed in CI. CI tests cover aggregate frequency, frame membership, affected-frame bytes, scrub preview isolation, exact mapping checks, cross-frame manual/auto merge, one-step batch Undo/Redo and existing 120-frame stress cases.
