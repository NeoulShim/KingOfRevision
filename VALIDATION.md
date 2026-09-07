# Validation notes

- Core tests cover exact original/revised reconstruction, independent paragraph selection, resolved paragraph presentation, sentence/paragraph split and merge labels, random edits, and a manuscript over 180,000 characters.
- HWP and HWPX output are real CFB/HWP 5 and ZIP/HWPX containers. Round-trip tests check Korean, supplementary Unicode, XML entities, tabs, soft breaks and blank paragraphs.
- Worker integration tests cover HWP + HWP, HWP + HWPX, HWPX + HWP, and HWPX + HWPX, including the automatic export format.
- The author's original HWP was read as 162 paragraphs / 14,793 characters and independently extracted with Python/OLE. The exported example HWPX preserves every original paragraph, including empty ones.
- Hancom GUI interoperability was not completed: Computer Use was stopped by the user. Native Hancom layout/open verification is still needed, especially for newly generated HWP files without cached line layout.
- Chrome click QA verified example loading, the storage usage display, and restoring the last scene and four paragraph choices through one-click resume after a reload. WebMCP has a mock registration contract test; a supported live WebMCP validation context was not used. WebMCP support is optional and safely ignored in other browsers.

This is a text-oriented comparison tool. It does not preserve document layout, figures or complex table formatting.

- Save/leave regression tests execute the real controller in a Node VM with mock DOM and download/worker boundaries. They cover home prompts, skip/continue, successful/failed/cancelled exports, edits after or during export, backup-only state, and Escape during generation. They do not verify browser dialogs visually or actual disk download completion.
- The saved marker is session-local and records a manuscript download request, not confirmation of the browser writing a file to disk.

- Legacy saved-review tests verify metadata-only localStorage records (manuscript text now lives separately in IndexedDB), legacy records, sorting, malformed entries, blocked storage, escaped filenames, rejecting mismatched documents without overwriting choices, and restoring the matching record and last scene.

- Manual-edit tests cover text/paragraph/soft-break round trips, scene changes, retained unaffected choices, draft cancellation and failure recovery, updated fingerprints, invalid edit rollback, and revised/merged exports in HWP and HWPX. Worker requests run sequentially to keep edited and exported comparisons consistent.

- IndexedDB tests verify manuscript persistence across reopening, review updates, atomic rollback on failed writes, and targeted deletion without affecting other records. Controller tests cover one-click resume and deletion boundaries.


- Cloudflare Web Analytics is restricted to the public GitHub Pages app path. Tests verify duplicate prevention, exclusion of local/private/other project URLs, and that the supplied beacon configuration contains only the public site identifier and page-load mode. The app never passes manuscript text, filenames, editor input, or paragraph decisions to analytics.

- Version 1.1 tests cover DOCX OOXML round trips, split runs and hyperlinks, table paragraph order, tracked-revision rejection, TXT UTF-8/UTF-16/CP949 decoding and line endings, all 16 input format pairs, allowed output formats, direct edits and restored snapshots. DOCX/DOCX exports are restricted to DOCX/TXT in both the UI and worker.

- Independently generated python-docx files were parsed successfully; exported DOCX paragraphs, tabs and soft breaks were read back by python-docx. Chrome verified the patchnotes route and updated file picker labels. Browser automated file selection was blocked by the extension file-URL permission, so this run does not claim a completed browser upload/download flow or native Word/Hancom verification.
