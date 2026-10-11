## Overview

- Scope: this file defines architecture constraints for gptviz’s generation, candidate-view, and dependency workflows.
- Source of truth: Markdown prompt content and vault files drive generation and candidate selection behavior.
- Platform/build: plain JavaScript for Obsidian (Android-compatible), using the existing concat/copy build workflow.
- Core invariants: one Candidate View whose view state alone decides what it shows, one open entry point, and fail-loud runtime behavior.
- Use this doc for plugin boundaries, lifecycle contracts, and implementation invariants.


# ARCH.md

GPTViz is a plain-JavaScript Obsidian plugin designed to run on Android.

Source files live directly in `vault/gptviz/`. The installed plugin lives in `vault/.obsidian/plugins/gptviz/`.

`build.sh` concatenates all source `.js` files into the installed `main.js`, copies `manifest.json`, and writes a project-local `runtime-code-map.json` sidecar in `gptviz/` for bundle-line-to-source-line runtime mapping.

All source files must therefore be concatenation-safe and independent of filename order. Shared code uses the global `GPTViz` namespace. Do not use ES modules or local-file `require()` calls.

Use Obsidian APIs for vault access, HTTP requests, settings, and secrets. Avoid Node.js, Electron, and desktop-only APIs.

Keep major functions in separate source files, with `main.js` limited primarily to plugin startup and command registration.



## Candidate View lifecycle and state contract

The Candidate View is a single workspace view with type `gptviz-candidates`. Like Obsidian's own Markdown view, it shows exactly its view state and nothing else:

```
{ file, asset, candidate, kept }
```

- `file`: vault path of the note.
- `asset`: the image being reviewed (content-relative, e.g. `Vid-M01-01.png`). It defaults to the note's selected asset, else `<note>.png`.
- `candidate`: the candidate path to show. It defaults to the one last viewed for the note, else the newest.
- `kept`: show the kept image instead. It is used only when `candidate` is absent.

The view never asks which note is "current", and it does not listen to `file-open` or `active-leaf-change`. Earlier versions derived the note from a global "last Markdown file" that workspace events kept updating. Stray events, such as Obsidian firing `file-open` for its last file when a fileless view activates, and queued refreshes reading changed globals, made the view jump to the wrong note. Do not reintroduce that.

### Entry points

- `openCandidateView({ file, asset, candidate, kept, sourceLeaf })` is the only way to show something in the Candidate View. Callers pass the exact target. It reuses the one leaf (detaching duplicates) or creates one, calls `setViewState` with the target, and reveals it. `sourceLeaf` (or the active Markdown leaf showing the same note) becomes `previousMarkdownLeaf`, so the right editor is used when several tabs show one note.
- `CandidateView.setState()` stores the target and calls `render()`. Obsidian also calls it when restoring the layout, so the view survives restarts and plugin reloads with its state. `getState()` returns the current target, and moving between candidates updates `candidate`.
- `render()` draws the target. Each render takes a new id; after every await, a render that a newer one has superseded stops before touching the DOM. There is no refresh queue.
- `rebuildCandidateViewAfterReload()` recreates a restored Candidate View leaf after a plugin reload from that leaf's saved state. It never creates a leaf that was not restored.

### Callers

- ImageMode on a note picks the asset (asking when the note has several) and opens it with its newest candidate.
- Opening a generated png (file explorer, quick switcher) opens its note and asset, with that candidate or the kept image, then closes the image tab.
- Generation writes the PNG to `candidates/` first, then opens the Candidate View on it.
- DependsMode in the Candidate View or movie player opens the picked dependency's image (its kept image). The ribbon's meaning per view is in `Spec-ModeRibbon.md`.
- `getCurrentMarkdownFile()`, used by commands, is the active Markdown view's note, else the active Candidate View's note. It holds no state of its own.

### Other rules

- If there are no candidates, the view stays valid and shows Generate plus the no-candidates message.
- `CandidateView.onClose()` clears its image URL and calls `setCandidateViewActive(false)`.
- Content changes the view makes itself (keep, marks) redraw in place. Nothing outside the view triggers a redraw except `openCandidateView`.

### Failure policy: fail loudly

GPTViz is a single-user developer tool. A failure must never look like a no-op and must never be allowed to disappear automatically.

- Every asynchronous workspace action must have an explicit error boundary. This includes the Markdown image action, ribbon buttons, command callbacks, png interception, and reload recovery.
- Errors must be reported through a blocking, full-screen error surface in the active Obsidian workspace. The surface must clearly identify the operation, display the error message, and include the stack when available.
- The full-screen error surface must remain visible until the user explicitly taps a Clear/Dismiss button. It must not auto-dismiss, time out, or be cleared by a subsequent refresh before the user acknowledges it.
- The Clear/Dismiss action must remove the visible error state and restore the underlying view only after the error has been acknowledged.
- Errors should also be sent to `console.error()` for deeper inspection.
- Operations must not silently return when an expected Candidate View leaf or view type is missing. These are programmer errors and must throw descriptive exceptions.
- A successful callback that produces no visible Candidate View is also a failure condition; the relevant entry point must validate the resulting view and report an error.
- Every plugin load starts a new run log entry in `gptviz/gptviz.log`, formatted as a blank line, the run date/time, and another blank line.
- Every reported error is appended to `gptviz/gptviz.log` with its date/time, operation context, message, and stack when available. Failure to write the log is sent to `console.error()` and must not recursively trigger error reporting.
- Log files are runtime artifacts and must be ignored by Git.
