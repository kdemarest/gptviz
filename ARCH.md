## Overview

- Scope: this file defines architecture constraints for gptviz’s generation, candidate-view, and dependency workflows.
- Source of truth: Markdown prompt content and vault files drive generation and candidate selection behavior.
- Platform/build: plain JavaScript for Obsidian (Android-compatible), using the existing concat/copy build workflow.
- Core invariants: one logical Candidate View lifecycle path, explicit refresh/recovery entry points, and fail-loud runtime behavior.
- Use this doc for plugin boundaries, lifecycle contracts, and implementation invariants.


# ARCH.md

GPTViz is a plain-JavaScript Obsidian plugin designed to run on Android.

Source files live directly in `vault/gptviz/`. The installed plugin lives in `vault/.obsidian/plugins/gptviz/`.

`build.sh` concatenates all source `.js` files into the installed `main.js`, copies `manifest.json`, and writes a project-local `runtime-code-map.json` sidecar in `gptviz/` for bundle-line-to-source-line runtime mapping.

All source files must therefore be concatenation-safe and independent of filename order. Shared code uses the global `GPTViz` namespace. Do not use ES modules or local-file `require()` calls.

Use Obsidian APIs for vault access, HTTP requests, settings, and secrets. Avoid Node.js, Electron, and desktop-only APIs.

Keep major functions in separate source files, with `main.js` limited primarily to plugin startup and command registration.



## Candidate View lifecycle and refresh contract

The Candidate View is a single logical workspace view with type `gptviz-candidates`. Image-viewer bugs usually come from treating these as separate operations. Every entry point must converge on the same sequence: identify the Markdown file, reuse or create the one Candidate View leaf, reveal it when appropriate, assign the current plugin instance to the view, and call `view.refresh(preferredPath)`.

### State and selection rules

- The current Markdown file is obtained through `getCurrentMarkdownFile()`. The plugin also remembers `lastMarkdownFilePath` so reload recovery can identify the file even when no Markdown leaf is currently active.
- Candidate files are discovered from `candidates/`; no candidate-view state is stored in the view itself.
- Selection priority is: an explicitly supplied `preferredPath`, the remembered path for the current Markdown file, then the newest candidate.
- If the preferred or remembered path no longer exists, `CandidateView.refreshNow()` falls back to the newest available candidate.
- If there are no candidates, the view remains valid and displays Generate plus the no-candidates message.
- There must be only one Candidate View leaf. Any duplicates are detached before the surviving/new leaf is used.

### Case 1: plugin reload

`registerView()` runs during `onload()` before `onLayoutReady` recovery. `rebuildCandidateViewAfterReload()` then:

1. Finds any restored Candidate View leaves.
2. Reads the remembered candidate path for `lastMarkdownFilePath`.
3. Detaches duplicate or stale Candidate View leaves.
4. If Obsidian restored no Candidate View leaf, skip recreate during reload recovery so the active main view is never replaced.
5. Creates the view with `setViewState()`, reveals it only when the Candidate View was active before reload, assigns `view.plugin = this`, and performs a fresh refresh.
6. Does nothing when there is neither a restored Candidate View nor a remembered candidate.

This is intentionally separate from ordinary active-leaf refreshes: reload recovery must rebuild the view object because the old JavaScript view instance may no longer be usable after the plugin reload.

### Case 2: tapping the image action on a Markdown file

The Markdown view action calls `openCandidateView(null, sourceLeaf)`. The source leaf is used to record `previousMarkdownLeaf` and the Markdown file path. GPTViz then reuses the existing Candidate View, removes duplicates, or creates one with `setViewState()`, reveals it, assigns the plugin, and refreshes it for that Markdown file.

The source leaf must be passed whenever the action knows it. This prevents the viewer from using a different Markdown leaf when multiple notes are open.

### Case 3: after tapping Generate

Generation identifies the requested/current Markdown file first. It writes the PNG to `candidates/` completely before opening or refreshing the viewer. On successful creation it calls `openCandidateView(path)`, passing the newly written path as `preferredPath`.

That path has highest selection priority, so the newly generated image is displayed even if an older candidate was previously remembered. The viewer is reused or created through the same path as the Markdown action; generation must not manipulate Candidate View DOM or leaves directly.

### Case 4: ribbon button and Candidate View toggle

- If the active leaf is the Candidate View, the ribbon toggles back to `previousMarkdownLeaf` and removes the candidate-active mobile styling.
- Otherwise, the ribbon calls the normal open/reuse/refresh path.
- The toggle must not create a second Candidate View leaf.

### Case 5: changing the active Markdown file

`file-open` and `active-leaf-change` both trigger `refreshCandidateViews()`. Each existing Candidate View is refreshed through its queue, and `CandidateView.refreshNow()` reads the current Markdown file before discovering candidates. This keeps the image viewer synchronized when the user switches notes without reopening the viewer.

### Case 6: closing, hiding, or losing the Candidate View

`CandidateView.onClose()` clears its image URL and calls `setCandidateViewActive(false)`. If the view later needs to return, the normal open/reuse/refresh path creates a new view when necessary. No DOM or view instance should be retained as the source of truth.

### Implementation invariants

- `openCandidateView()` is the single entry point for opening, reusing, revealing, and refreshing the Candidate View after user actions or generation.
- `rebuildCandidateViewAfterReload()` is the single entry point for post-reload recovery.
- `refreshCandidateViews()` is the single entry point for refreshing already-existing Candidate Views after workspace/file changes.
- `CandidateView.refresh()` serializes refreshes with `refreshQueue`; callers may request refreshes without manipulating the view concurrently.
- Any future change to Candidate View behavior must specify which lifecycle case it affects and must preserve these entry-point boundaries.


### Failure policy: fail loudly

GPTViz is a single-user developer tool. A failure must never look like a no-op and must never be allowed to disappear automatically.

- Every asynchronous workspace action must have an explicit error boundary. This includes the Markdown image action, ribbon toggle, command callback, file/leaf-triggered refresh, and reload recovery.
- Errors must be reported through a blocking, full-screen error surface in the active Obsidian workspace. The surface must clearly identify the operation, display the error message, and include the stack when available.
- The full-screen error surface must remain visible until the user explicitly taps a Clear/Dismiss button. It must not auto-dismiss, time out, or be cleared by a subsequent refresh before the user acknowledges it.
- The Clear/Dismiss action must remove the visible error state and restore the underlying view only after the error has been acknowledged.
- Errors should also be sent to `console.error()` for deeper inspection.
- Operations must not silently return when an expected Candidate View leaf, view type, or refresh method is missing. These are programmer errors and must throw descriptive exceptions.
- Internal queue recovery may prevent a later refresh from being blocked by an earlier rejection, but it must not hide the original error from the user.
- A successful callback that produces no visible Candidate View is also a failure condition; the relevant entry point must validate the resulting view and report an error.
- Every plugin load starts a new run log entry in the vault-root `gptviz.log`, formatted as a blank line, the run date/time, and another blank line.
- Every reported error is appended to `gptviz.log` with its date/time, operation context, message, and stack when available. Failure to write the log is sent to `console.error()` and must not recursively trigger error reporting.
- Log files are runtime artifacts and must be ignored by Git.
