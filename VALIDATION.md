# Validation notes

- Core tests cover exact original/revised reconstruction, independent paragraph selection, resolved paragraph presentation, sentence/paragraph split and merge labels, random edits, and a manuscript over 180,000 characters.
- HWP and HWPX output are real CFB/HWP 5 and ZIP/HWPX containers. Round-trip tests check Korean, supplementary Unicode, XML entities, tabs, soft breaks and blank paragraphs.
- Worker integration tests cover HWP + HWP, HWP + HWPX, HWPX + HWP, and HWPX + HWPX, including the automatic export format.
- The author's original HWP was read as 162 paragraphs / 14,793 characters and independently extracted with Python/OLE. The exported example HWPX preserves every original paragraph, including empty ones.
- Hancom GUI interoperability was not completed: Computer Use was stopped by the user. Native Hancom layout/open verification is still needed, especially for newly generated HWP files without cached line layout.
- Browser visual/click QA was not requested. No such QA is claimed. WebMCP has a mock registration contract test; a supported live WebMCP validation context was not used. WebMCP support is optional and safely ignored in other browsers.

This is a text-oriented comparison tool. It does not preserve document layout, figures or complex table formatting.

- Save/leave regression tests execute the real controller in a Node VM with mock DOM and download/worker boundaries. They cover home prompts, skip/continue, successful/failed/cancelled exports, edits after or during export, backup-only state, and Escape during generation. They do not verify browser dialogs visually or actual disk download completion.
- The saved marker is session-local and records a manuscript download request, not confirmation of the browser writing a file to disk.

- Saved-review tests verify metadata-only storage (no manuscript text), legacy records, sorting, malformed entries, blocked storage, escaped filenames, rejecting mismatched documents without overwriting choices, and restoring the matching record and last scene.

- Manual-edit tests cover text/paragraph/soft-break round trips, scene changes, retained unaffected choices, draft cancellation and failure recovery, updated fingerprints, invalid edit rollback, and revised/merged exports in HWP and HWPX. Worker requests run sequentially to keep edited and exported comparisons consistent.
