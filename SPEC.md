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
- The GPTViz failure surface includes a Copy action that copies operation + full error detail for sharing/debug.
- Each plugin load appends a run marker to `gptviz/gptviz.log`.
- Reported runtime errors append timestamp, operation, message, and stack (when available) to `gptviz/gptviz.log`.
- Reported runtime errors also overwrite `gptviz/_lastErr.log` with the latest failure payload, including project identity (`gptviz`), error type (`runtime`), timestamp, operation, and detail.
- Build emits `gptviz/runtime-code-map.json` (bundle line ranges -> source file ranges); runtime error reporting uses it to include mapped source file/line/column in `gptviz/_lastErr.log` when a bundle stack location is available.

### Commands and user-visible capabilities

- `GPT connect`: verifies configured OpenAI API connectivity.
- `GPT show prompt`: resolves and reports the active Prompt section.
- `GPTViz Image Integrity`: reports unresolved image references across markdown files.
- `GPTViz Generate Image`: generates a new candidate image from Prompt (+ optional `Images:` inputs), supports in-view progress + cancel, embeds exact sent prompt in PNG metadata, and refreshes Candidate View on success.
- `GPTViz Review Images`: opens persistent Candidate View with prev/next, a middle jump-to-kept control, keep, generate, polish, and markdown return controls; Markdown `MarkdownMode` (file-text), `ImageMode` (GPTViz Candidate View icon), `MovieMode`, and `DependsMode` are in `.mode-ribbon` (not `.view-actions`), and Candidate View `Return to note` (file-text icon) is also in `.mode-ribbon`; returning to Markdown from Candidate View reveals the note, waits for markdown view readiness, targets the selected section line (or current cursor line), then vertically pans the markdown scroller so that line lands a few lines below the top of the editor viewport (clamped at file top to avoid overscroll); keeps state lightweight and avoids duplicate action registrations.
- In Markdown and Candidate views, tapping `ImageMode` opens the same picker of Prompt/Extract asset headings from the active note (operation + asset label). Selecting an asset moves the markdown cursor to that heading section when needed, then opens/refreshes Candidate View targeted to that selected asset's candidate stream; when that stream has no candidates, Candidate View names that selected asset in the empty-state message.
- Candidate View Generate/Polish operations use the currently selected asset stream (numbering and output candidate filename prefix), not the markdown filename basename.
- `MovieMode` buttons are owned by gptviz in `.mode-ribbon` (Markdown + Candidate View) and request movie-view switching by dispatching `gptviz:movie-mode-request` (with command fallback to `movi-play-active-script` when no listener handles the event).
- In Markdown view, when the active note has no `Script` heading, tapping `MovieMode` first opens a picker of Prompt/Extract output assets from that note (labels include operation + asset, for example `Prompt Aeku.png`); when the cursor is inside one of those sections, that section is listed first. Picking an asset opens a second picker of script notes whose dependencies reference that selected asset (recursive through dependency chains), and picking a script opens its source note (it does not auto-enter MovieMode playback).
- In Candidate View, tapping `MovieMode` uses the currently selected candidate asset and opens the script-usage picker directly for that single asset, then opens script source on selection (no auto-playback).
- Dependency consumers share one graph-construction path: MovieMode fallback queries the same dependency graph dataset used by dependency validation (including `_config.json` scope/exclude behavior), rather than rebuilding a separate ad hoc graph.
- Candidate View provides a `.mode-ribbon` header container helper via `addModeButton(position, buttonEl)`: buttons are ordered by non-negative integer position, replacing any existing button at the same position; when a button with the same logical key is added again, the older instance is discarded and the new one is used.
- `.mode-ribbon` includes a `More Actions` button that proxies the built-in `.view-actions` options (vertical ellipsis) menu, so the options menu is reachable from Mode Ribbon.
- In Markdown view, header `.view-actions` is hidden; mode controls are provided through `.mode-ribbon`.
- Mode Ribbon controls are reconciled idempotently by one shared gptviz ribbon sync path for Markdown, Candidate, and movi Player views; button creation/placement is centralized in one implementation.
- Button enabled/disabled state is also centralized per view through one shared state-application path (not per-screen ad hoc toggles).
- `More Actions` is always present in `.mode-ribbon`; it proxies the live options action when available and is otherwise shown disabled.
- Mode Ribbon visuals are normalized in one shared path: the ribbon renders as one continuous segmented control with a single opaque surface, only outer corners rounded, and inner button dividers; button size matches live `.view-actions` icon-button size (with bounded fallback when unavailable).
- On lifecycle/reload sync, gptviz reconciles the same five Mode Ribbon buttons on Markdown, Candidate, and movi Player leaves: MarkdownMode, ImageMode, MovieMode, DependsMode, and More Actions.
- Plugin reload recovery does not steal focus or replace the active main view: GPTViz rebuilds/restores Candidate View only from already-restored candidate leaves, and only reveals it on reload when it was already the active leaf before reload.
- `GPTViz Check Dependencies`: reports stale/missing prompt-image dependencies.
- `GPTViz Validate Dependency Headings`: scans operation headings in either form (`Prompt|Extract|Mark|Script <name>` or `Prompt|Extract|Mark|Script: <name>`), validates naming/collision rules, treats default output extensions as optional for identity matching (`.png` for Prompt/Extract, `.marks.json` for Mark, `.ms` for Script), reads `canvid/_config.json` (paths relative to `canvid/`) with `source_dirs` entries (`{ dir, recurse }`) to define scan scope, applies `exclude_files` patterns (exact match with `*` wildcard support), fails loudly on malformed `_config.json` (invalid JSON or invalid schema), resolves declared/default dependencies (`Images:`/`Photos:`, `Source:`), resolves `Script` dependencies via Movi parser-reported `requiredAssets` (not `Depends:` declarations), reports unresolved dependencies, duplicate produced output targets, and dependency cycles, does not treat Mark names as colliding with Prompt target names, writes a human-readable report to `canvid/_deps.md`, and opens that report in an available Markdown leaf.
- Markdown `DependsMode` is a `.mode-ribbon` button (not `.view-actions`) that runs `GPTViz Validate Dependency Headings`. 
- `GPTViz Mark (v0)`: parses `# Mark` blocks, requests normalized point JSON, writes `<basename>.marks.json`, and overlays labeled points on the kept image.
- `GPTViz Extract (v0)`: parses `# Extract` blocks, runs image-edit generation using source image + extract prompt, removes keyed background color to alpha, and writes/overwrites each `Asset:` PNG target; from editor context, it runs only the block under the cursor when inside a `# Extract` block.

### Prompt, image input, and candidate contracts

- Prompt resolution:
  - starts at heading text beginning with `Prompt`
  - ends at next heading of same or higher level
  - if cursor is not inside a Prompt section, uses first Prompt section in file
- Candidate numbering is file-derived only: next number is max existing PNG index in `candidates/` + 1; no stored counter.
- Non-image API responses are shown to the user (text or readable JSON), do not save files, and do not consume candidate numbers.
- Prompt/Extract/Mark prompt bodies support include directives: `{#include path/to/file.md}` and `{#include path/to/file.md#Heading}`.
- Include resolution is recursive and in-place before model execution.
- For `Prompt`, `Extract`, and `Mark` execution, included content must not contain `Images:`; this is a hard error to prevent fragile shared includes.
- Heading includes resolve to content under the heading (until next same-or-higher heading).
- Include failures are fail-loud and block execution: missing file, missing heading, include cycle, or depth overflow.
- `Images:` supports comma-separated root paths and `candidates/` paths; extensionless names default to `.png`; warnings are aggregated and block request execution.
- `Photos:` in Prompt is deprecated and blocks generation with a deprecation warning.

### Keep and Polish contracts

- Keep preserves timestamps when promoting a candidate to the root kept image.
- If candidate prompt metadata is missing/blank, GPTViz embeds the current initial markdown prompt before keep.
- If candidate prompt metadata conflicts with current initial prompt, Keep asks: align prompt (Yes), keep without markdown change (No), or abort (Cancel).
- Polish uses a non-modal in-view overlay, caches text per markdown file for the plugin session, seeds from `canvid/_polish.md` on first open when cache is blank, replaces `[[self]]` with selected source filename, and does not embed polish text into generated output.
- Polish is non-blocking on missing source prompt metadata: if embedded prompt text is absent, GPTViz attempts companion-markdown prompt backfill+injection and always continues Polish; when backfill is unavailable, Polish still proceeds using the active Polish prompt context.

## Planned

### Prompt include resolution (planned)

GPTViz will support deterministic prompt include expansion before image generation.

Scope:
- applies to Prompt sections used by Generate/Polish flows
- does not change AGENTS loading behavior

Supported directives:
- `{#include path/to/file.md}`
- `{#include path/to/file.md#Heading}`

Resolution contract:
- resolve includes in-place before sending the prompt to the model
- heading form includes content under that heading until the next same-or-higher heading
- nested includes are supported
- preserve resolved order exactly as encountered

Safety and errors (fail loud):
- missing file => error with source file + line
- missing heading => error with source file + line
- include cycle => error showing include chain
- max include depth guard (configurable; default small)

Observability:
- on success, keep both raw prompt and fully resolved prompt available for review/debug
- warnings are not silent substitutions; unresolved includes must block generation

Non-goals for v0:
- implicit `Group:` expansion
- remote/network includes
- variable templating DSL

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
