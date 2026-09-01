## Implemented

### Failure presentation

GPTViz is a single-user developer tool and fails loudly. Any catastrophic failure in an image action, Candidate View operation, command, refresh, or reload recovery is shown as a blocking full-screen error surface in the active Obsidian workspace. The surface identifies the failed operation, shows the error message and stack when available, and remains visible until the user taps a Clear/Dismiss button. Errors never auto-dismiss, time out, or disappear silently; they are also logged with `console.error()`.

### Runtime logging

Each plugin load appends a new run marker to the vault-root gptviz.log file: a blank line, the run date/time, and a blank line. Each reported error is appended with its timestamp, operation, message, and stack when available. Runtime log files are ignored by Git.

- **GPT connect** — verifies the configured OpenAI API connection.
- **GPT show prompt** — finds the current Markdown `Prompt` section and reports it.
- **GPTViz Image Integrity** — scans every Markdown file for `Images:`/`Photos:` references, Obsidian image embeds, Markdown image tags, and HTML image tags. It lists each Markdown file containing a reference that cannot be resolved to a file in the vault, along with the invalid references. Tapping a listed filename opens that Markdown file.
- **GPTViz Generate Image** — sends the current Markdown `Prompt` section, including any referenced images from an `Images:` line, to the OpenAI image-generation tool and writes a successful image result to a new candidate PNG. The exact prompt sent with the request is embedded in the returned PNG as UTF-8 metadata. When generation is started from Candidate View, it shows a view-local absolute progress overlay with a spinner, elapsed-time indicator, and Cancel button. The overlay has no backdrop and does not block the rest of the tab. Cancellation removes the overlay, prevents the result from being saved, and does not consume a candidate number. After a successful image is saved, it refreshes the persistent Candidate View and shows the new candidate.
- **GPTViz Review Images** — reveals the persistent Candidate View for the current Markdown file. The view includes Generate, the current candidate image and filename, Prev, Next, Keep, and Polish controls. Prev is disabled on the first image, Next is disabled on the last image, and Keep is disabled and reads Kept when the current image matches the root-level kept image. Keep promotes the selected candidate while preserving its creation and modification timestamps on the root-level image. If the root-level kept image is not represented in `candidates/`, GPTViz embeds the current initial Prompt into the kept image, preserves the kept image’s original creation and modification timestamps, and then creates a candidate copy with the updated image and those same timestamps. Polish is enabled for every candidate. It uses a persistent, non-modal in-view overlay over the candidate image. The overlay contains a scrollable text box and a single right-justified `Run` button; the text is cached in memory per main Markdown filename for the current plugin session. When the overlay is first opened, if that file’s cached text is blank, GPTViz immediately reads the vault-root `_polish.md` contents and places them into the text box and cache. The Polish button remains accessible above the overlay: tapping it while the overlay is visible hides the overlay without clearing the text, and tapping it again shows it. Before execution, every `[[self]]` token in the cached or entered text is replaced with the selected candidate source image filename. The resolved `Images:` line is parsed for image inputs; paths may include subdirectories such as `candidates/filename.png`, and names without an extension use `.png`. When no `Images:` line is present, the selected candidate is used as the source image. The resolved text without the `Images:` line is sent as the image prompt, without reading or parsing any Markdown Polish section. The generated candidate embeds only the original prompt found in the actual source image input; the entered Polish text is not embedded. If the source image has no embedded original prompt, GPTViz reports that condition and does not create a candidate. Polish uses the same progress overlay and cancellation behavior as Generate. The view can be toggled with the GPTViz ribbon button, which returns to the Markdown leaf that was active before the view was opened. Candidate View uses one workspace leaf, stores no viewing state or metadata, and refreshes when the active Markdown file changes without repeating a refresh when it already represents that file.
- **GPTViz Check Dependencies** — scans every Markdown file’s Prompt sections for `Images:` references. It compares each referenced image with the note’s root-level generated PNG and displays stale or missing dependencies in a scrollable modal. Tapping a listed note opens its companion Markdown file.

A prompt starts at a Markdown heading whose text begins with `Prompt`.

The section ends at the next heading of the same or higher level.

If no Prompt heading exists above the cursor, the first Prompt section in the file is used.

Successful image results are decoded from base64 and saved as PNG files under `candidates/`, using the current Markdown file’s base name and a number one greater than the highest existing PNG candidate number. Candidate numbering is derived only from files in `candidates/`; GPTViz stores no counter or candidate metadata.

If the API returns text instead of an image, including a refusal or other complaint, GPTViz displays that text in a modal and does not create a candidate file. Unexpected non-image responses are also displayed in the modal as readable JSON. A non-image response does not consume a candidate number.

An optional `Images:` line in the Prompt section contains comma-separated image names. Images are loaded from the project root; names without an extension use `.png`. Candidate paths under `candidates/` are also supported. The line is removed from the textual prompt, and supported images are sent as image inputs. GPTViz collects all missing, unreadable, or unsupported image warnings, displays them together in a modal, and does not show the spinner or send an image-generation request when any warning exists.

The Candidate View compares the candidate’s embedded prompt with the current initial Markdown prompt when Keep is tapped. If the candidate has no embedded prompt or its embedded prompt is blank, GPTViz embeds the current initial Markdown prompt into the candidate before keeping it, preserving the candidate’s timestamps. If a nonblank embedded prompt differs, GPTViz asks whether to align the Markdown prompt to the image prompt, with Yes, No, and Cancel choices. Yes replaces only the initial prompt text. No keeps the image without changing the Markdown file; Cancel aborts Keep.

A `Photos:` line is deprecated in favor of `Images:`. If a Prompt section contains `Photos:`, GPTViz displays a deprecation warning and does not send an image-generation request.

## Planned

### GPTCut integration (planned)

GPTViz will add a minimal cutout pipeline (gptcut) for generating derived PNG assets from source images.

Scope and intent:

- Keep authoring in Obsidian using plain Markdown.
- Reuse existing GPTViz AI infrastructure and Image Review workflow.
- Support rapid regenerate-and-recut loops while art is evolving.

Cut discovery:

- Scan configured `*.md` files.
- Detect each section header exactly matching `# Cut`.
- Each `# Cut` block defines one cut operation.
- Multiple `# Cut` blocks per file are allowed.

Cut block format v0:

- `Asset: <target-name>.png` (required)
- `Source: <source-name>.png` (optional)
- free-text extraction prompt body (required)

Default source rule:

- If `Source:` is omitted, use `<markdown-filename-without-extension>.png`.

AI and output behavior:

- GPTViz sends source image plus cut prompt to image-edit generation.
- Returned keyed image is post-processed automatically (key color removed to alpha).
- Final output is written as PNG to the `Asset:` path.
- Existing output is overwritten on successful regeneration.

v0 response policy:

- Single image is expected.
- If multiple images are returned, GPTViz uses the first and logs a warning.
- Optional strict mode may fail on multi-image response.

Regeneration behavior:

- Running cut operations can be scoped to all files, current file, or one selected block.
- When a source image is regenerated, GPTViz can rerun affected cuts and refresh outputs.

Error handling (fail loud):

- Missing `Asset:`
- empty prompt body
- unresolved source image
- duplicate output `Asset:` targets
- missing AI image payload
- post-process/write failures

Each error reports file path, `# Cut` block line, category, code, and clear fix guidance.

Non-goals for v0:

- user-authored cleanup directives
- multi-output syntax from one `# Cut` block
- advanced compositing DSL


## Principle

Obsidian is the editor and file selector.

GPTViz only needs to:

- read the current Prompt section
- load reference images
- generate candidate images
- browse candidates
- promote a chosen candidate
- check image dependencies
