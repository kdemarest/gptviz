## Dependency Identification Design (Sketch)

## Goals
- Use one explicit heading unit per operation (Prompt, Extract, Mark, Script).
- Make heading text human-readable and deterministic for parsing.
- Build a reliable dependency graph with clear producer/consumer identity.
- Support stale/out-of-date detection without requiring one file per block.

## Block Identity and Shape (Required)
Each operation is exactly one heading block.

Parsed operation heading pattern (any markdown heading level H1–H6):
- `#... Prompt: <name-or-output>`
- `#... Extract: <name-or-output>`
- `#... Mark: <name-or-output>`
- `#... Script: <name-or-output>`

Where `#...` means one or more `#` characters followed by a space.

Notes:
- Headings in documents may be anything; only recognized operation headings are parsed as dependency units.
- Non-operation headings are ignored by dependency parsing.

Rules:
- Heading suffix is required (explicit identity every time).
- Heading level does not matter for identity; only operation type + heading suffix matter.
- Spaces after `:` are permitted in source headings but stripped during canonicalization.
- `# Prompt [[self]]` style is not allowed.
- One heading block = one unit of work (no multiple marks/extracts/scripts inside one block).
- Duplicate identities in the same file are a hard error.

## Dependency Declaration Surfaces
- Prompt blocks:
  - Declared dependencies from `Images:`.
  - Primary produced asset is identified by heading suffix.
  - In `Prompt: <targetfile>`, the `<targetfile>` extension is optional in authoring (for example, `Prompt: hero` and `Prompt: hero.png` are both valid declarations).
- Extract blocks:
  - Declared dependency from `Source:` if present.
  - Default dependency when omitted: `<markdown-filename>.png`.
  - Output is defined by the heading suffix (no `Asset:` field).
- Mark blocks:
  - Declared dependency from `Source:` if present.
  - Default dependency when omitted: `<markdown-filename>.png`.
  - Output target can be derived from heading suffix by convention.
- Script blocks:
  - Declared dependencies should reference required assets/blocks explicitly.

Extension policy:
- Image outputs must always use `.PNG`.
- Image inputs may use `.png`, `.jpg`, or `.jpeg`.
- When a target extension is optional and omitted in source, that omission is valid and is not a warning.

## Core Model
- Graph nodes are block-level (not just file-level).
- Node identity:
  - `filePath + blockType + headingSuffix`
- Maintain both:
  - `declaredDeps` (author text)
  - `resolvedDeps` (effective runtime deps after defaults/path resolution)
- During parse/resolve, accumulate an error list keyed by:
  - `<relative/path/filename.ext>#<id>`
  - `<id>` is `<Operation>:<headingSuffix>` to avoid ambiguity across operation types.
  - Canonicalization:
    - Accept `### Prompt:targetfile` and `### Prompt: targetfile` in source.
    - Strip spaces after `:` when constructing canonical ids.
  - Examples:
    - `### Prompt: targetfile` => id `Prompt:targetfile`
    - `### Mark: targetfile` => id `Mark:targetfile`.
- Output artifacts are first-class (png/json/video assets).

## Two-Phase Build
- Phase A: Parse
  - Scan markdown files.
  - Parse supported headings and required heading suffix.
  - Parse fields/body and capture file + line range.
- Phase B: Resolve
  - Resolve default source behavior.
  - Normalize asset paths/extensions.
  - Build edges producer/asset -> consumer block.
  - Build reverse index for invalidation.

## Stale Detection (Block-Level)
A block is stale when any is true:
- Block content hash changed.
- Any resolved dependency changed.
- Any required input is missing/unresolved.
- Any declared output is missing.
- Tool/generator version stamp changed (recommended).

## Propagation and Execution
- On change, mark direct consumers stale via reverse index.
- Propagate transitively through downstream nodes.
- Execute stale subgraph in topological order.

## Failure and Diagnostics (Fail Loud)
Hard errors:
- Missing heading suffix identity.
- Unsupported parsed operation heading form (including `# Prompt [[self]]` and missing `:` between operation and identity).
- Illegal target name token (must match `^[A-Za-z0-9_]+$`).
- Duplicate Prompt names anywhere in the project.
- Duplicate Extract names anywhere in the project.
- Any Prompt/Extract name collision.
- Mark name collision with any Prompt target name.
- Duplicate Mark names on the same image/source.
- Duplicate block identity in same file.
- Unresolved dependencies.
- Duplicate output targets where not allowed.
- Dependency cycles.

Warnings:
- Duplicate Mark names in different files/images (allowed but flagged).

Error reports should include:
- key: `<relative/path/filename.ext>#<Operation>:<headingSuffix>`
- file path
- line number (display only)
- block identity
- category/code
- concrete fix guidance

Human-readable report line format:
- `[[relative/path/File.md#Operation: target|File.md]] line <n>: <message>`
- Example: `[[Aeku.md#Prompt: hero|Aeku.md]] line 24: duplicate prompt target "hero"`
- The link target uses heading text (`Operation: target`) for navigation.
- Do not inject heading IDs solely for diagnostics.

## Companion Metadata (Sidecar)
- Keep authoring in markdown.
- Maintain one machine-owned sidecar per source note (example: `Aeku.gptviz.json`) with:
  - block hashes
  - resolved dependency snapshots
  - outputs
  - last success timestamps
  - status/error + tool/version stamp

## Minimal v1 Scope
- Implement heading-based parse/validation first.
- Implement graph build + stale detection second.
- Keep execution controls simple:
  - run block under cursor
  - run current file
  - run downstream from changed block
