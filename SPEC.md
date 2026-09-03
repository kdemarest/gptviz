## Overview

- Scope: this spec defines required gptviz behavior and tracks local implementation status.
- Workflow: keep changes minimal, preserve behavior unless requested, and record shipped work under Implemented.
- Constraint: update Implemented while implementing; do not edit Planned unless explicitly requested.
- Runtime priorities: deterministic prompt/candidate workflows, strict fail-loud error handling, and Android-compatible Obsidian operation.
- Use this doc to validate required behavior, current delivery state, and remaining planned surface.

## Usage

This spec is optimized for AI runtime context efficiency.

- Keep ## Implemented concise and contract-focused.
- Keep ## Planned detailed and design-focused.

Implemented update rules:

- Record capability-level outcomes, not implementation narrative/history.
- Include only behavior constraints/invariants needed to prevent regressions.
- Prefer short bullets over long prose.
- When helpful, include brief code pointers (file/function) instead of duplicating code behavior.
- Avoid restating behavior that is obvious from nearby code unless it is easy to regress.

Planned update rules:

- Keep full behavioral detail, data shapes, error expectations, and non-goals.
- Treat Planned as the authoritative intent for future implementation.

Goal: minimize token cost while preserving enough contract detail for safe future edits.

## Implemented

### Failure and logging contracts

- Catastrophic failures are fail-loud: GPTViz shows a blocking error surface and logs details to `console.error()`.
- Each plugin load appends a run marker to `gptviz.log`.
- Reported runtime errors append timestamp, operation, message, and stack (when available) to `gptviz.log`.

### Project-local watcher isolation

- Optional RunBash watcher is project-local to gptviz:
  - scripts: `gptviz/watch-runbash.sh`, `gptviz/start-watcher.sh`, `gptviz/stop-watcher.sh`
  - files: `gptviz/RunBash.ai`, `gptviz/RunBash.log`, `gptviz/RunBash.last.log`, `gptviz/.runbash-watcher.heartbeat`

### Commands and user-visible capabilities

- `GPT connect`: verifies configured OpenAI API connectivity.
- `GPT show prompt`: resolves and reports the active Prompt section.
- `GPTViz Image Integrity`: reports unresolved image references across markdown files.
- `GPTViz Generate Image`: generates a new candidate image from Prompt (+ optional `Images:` inputs), supports in-view progress + cancel, embeds exact sent prompt in PNG metadata, and refreshes Candidate View on success.
- `GPTViz Review Images`: opens persistent Candidate View with prev/next, keep, generate, polish, and markdown return controls; keeps state lightweight and avoids duplicate action registrations.
- `GPTViz Check Dependencies`: reports stale/missing prompt-image dependencies.
- `GPTViz Mark (v0)`: parses `# Mark` blocks, requests normalized point JSON, writes `<basename>.marks.json`, and overlays labeled points on the kept image.
- `GPTViz Extract (v0)`: parses `# Extract` blocks, runs image-edit generation using source image + extract prompt, removes keyed background color to alpha, and writes/overwrites each `Asset:` PNG target; from editor context, it runs only the block under the cursor when inside a `# Extract` block.

### Prompt, image input, and candidate contracts

- Prompt resolution:
  - starts at heading text beginning with `Prompt`
  - ends at next heading of same or higher level
  - if cursor is not inside a Prompt section, uses first Prompt section in file
- Candidate numbering is file-derived only: next number is max existing PNG index in `candidates/` + 1; no stored counter.
- Non-image API responses are shown to the user (text or readable JSON), do not save files, and do not consume candidate numbers.
- `Images:` supports comma-separated root paths and `candidates/` paths; extensionless names default to `.png`; warnings are aggregated and block request execution.
- `Photos:` in Prompt is deprecated and blocks generation with a deprecation warning.

### Keep and Polish contracts

- Keep preserves timestamps when promoting a candidate to the root kept image.
- If candidate prompt metadata is missing/blank, GPTViz embeds the current initial markdown prompt before keep.
- If candidate prompt metadata conflicts with current initial prompt, Keep asks: align prompt (Yes), keep without markdown change (No), or abort (Cancel).
- Polish uses a non-modal in-view overlay, caches text per markdown file for the plugin session, seeds from vault-root `_polish.md` on first open when cache is blank, replaces `[[self]]` with selected source filename, and does not embed polish text into generated output.

## Planned

### GPTExtract integration (planned)

GPTViz will add a minimal extraction pipeline (gptextract) for generating derived PNG assets from source images.

Scope and intent:

- Keep authoring in Obsidian using plain Markdown.
- Reuse existing GPTViz AI infrastructure and Image Review workflow.
- Support rapid regenerate-and-reextract loops while art is evolving.

Extract discovery:

- Scan configured `*.md` files.
- Detect each section header exactly matching `# Extract`.
- Each `# Extract` block defines one extract operation.
- Multiple `# Extract` blocks per file are allowed.

Extract block format v0:

- `Asset: <target-name>.png` (required)
- `Source: <source-name>.png` (optional)
- free-text extraction prompt body (required)

Default source rule:

- If `Source:` is omitted, use `<markdown-filename-without-extension>.png`.

AI and output behavior:

- GPTViz sends source image plus extract prompt to image-edit generation.
- Returned keyed image is post-processed automatically (key color removed to alpha).
- Final output is written as PNG to the `Asset:` path.
- Existing output is overwritten on successful regeneration.

v0 response policy:

- Single image is expected.
- If multiple images are returned, GPTViz uses the first and logs a warning.
- Optional strict mode may fail on multi-image response.

Regeneration behavior:

- Running extract operations can be scoped to all files, current file, or one selected block.
- When a source image is regenerated, GPTViz can rerun affected extracts and refresh outputs.

Error handling (fail loud):

- Missing `Asset:`
- empty prompt body
- unresolved source image
- duplicate output `Asset:` targets
- missing AI image payload
- post-process/write failures

Each error reports file path, `# Extract` block line, category, code, and clear fix guidance.

Non-goals for v0:

- user-authored cleanup directives
- multi-output syntax from one `# Extract` block
- advanced compositing DSL

### GPTMark integration (planned)

GPTViz will add a minimal point-target pipeline (gptmark) for extracting reusable target coordinates from images.

Scope and intent:

- Keep authoring in Obsidian using plain Markdown.
- Reuse existing GPTViz AI infrastructure and markdown-driven workflows.
- Provide deterministic, resolution-independent target points for downstream tools (for example movi zoom targets).

Mark discovery:

- Scan configured `*.md` files.
- Detect each section header exactly matching `# Mark`.
- Each `# Mark` block defines one target-point operation.
- Multiple `# Mark` blocks per file are allowed.

Mark block format v0:

- `Name: <target-name>` (required; for example `ring`)
- `Source: <source-name>.png` (optional)
- free-text location prompt body (required)

Default source rule:

- If `Source:` is omitted, use `<markdown-filename-without-extension>.png`.

AI and output behavior:

- GPTViz sends source image plus mark prompt to a vision-capable model.
- The model response must be strict JSON with normalized coordinates.
- Required output fields: `name`, `x`, `y`.
- Optional fields: `confidence`, `bbox`.
- Coordinates are normalized to full image dimensions, where `(0,0)` is top-left and `(1,1)` is bottom-right.

Persisted output:

- GPTViz writes/updates a sidecar JSON file named `<markdown-filename-without-extension>.marks.json` in the project root.
- Each successful mark write stores at minimum: `name`, `source`, `x`, `y`, and timestamp.

v0 response policy:

- Single JSON object is expected per `# Mark` block.
- If AI returns non-JSON or missing required fields, GPTViz fails that block and reports the error.
- Optional hardening: run the same mark block multiple times and store median `x,y` in a future mode.

Regeneration behavior:

- Running mark operations can be scoped to all files, current file, or one selected block.
- When a source image is regenerated, GPTViz can rerun affected marks and refresh sidecar outputs.

Error handling (fail loud):

- Missing `Name:`
- empty prompt body
- unresolved source image
- duplicate `Name:` targets in the same markdown file
- invalid JSON response
- missing `x`/`y` fields
- out-of-range coordinates (outside `0..1`)
- write failures

Each error reports file path, `# Mark` block line, category, code, and clear fix guidance.

Non-goals for v0:

- automatic object tracking across frames
- pixel-perfect segmentation masks
- temporal smoothing across shots
- coordinate editing UI (manual nudge/overlay may be added later)


## Principle

Obsidian is the editor and file selector.

GPTViz only needs to:

- read the current Prompt section
- load reference images
- generate candidate images
- browse candidates
- promote a chosen candidate
- check image dependencies
