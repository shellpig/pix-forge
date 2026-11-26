# Phase 03-A — Batch history architecture

## Scope

This phase adds the transaction infrastructure only. Phase 03-B will expose sequence palette statistics and the all-frame editing UI. Existing single-frame tools, quick palette, output palette, and Phase 02 preview cancellation remain available.

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

`npm test`, `npm run lint`, and `npm run build` run in CI. Core regression tests cover exact frame identity, interleaved edits, undo/redo blocking, branch forks, structural retirement, both history caps, memory rejection, special states, transparency, and a 120-frame 256×256 sequence (60 MiB charged batch history). Source-level integration tests do not replace real browser interaction tests. Phase 03-B will add the actual sequence palette UI; browser testing of that UI is intentionally deferred.
