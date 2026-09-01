# AGENTS.md

Before editing GPTViz, read:

- `SPEC.md` for required behavior.
    
- `ARCH.md` for architecture and implementation constraints.
    

Rules:

- Make only the requested change.
    
- Preserve existing behavior unless the change requires otherwise.
    
- Keep the implementation simple.
    
- Do not introduce dependencies, frameworks, TypeScript, npm, Node tooling, or new build systems unless explicitly requested.
    
- Keep all code Android-compatible with Obsidian mobile.
    
- Use Obsidian APIs rather than Node/Electron APIs.
    
- Never expose, log, or store API keys outside Obsidian `SecretStorage`.
    
- Do not modify `ARCH.md` unless explicitly requested.

- As you implement,edit `SPEC.md` Implemented section as needed, but never the Planned section unless explicitly requested.

Vault visibility:

- The vault view does not include anything under `.obsidian/`. Do not assume installed-plugin files there can be read, searched, or verified through the vault tools.


## Coding Practices

Before and after every code edit:

- Use insertion operations for additions; use exact, narrowly scoped replacements for changes. Never replace a surrounding method signature or command registration unintentionally.
- Re-read the complete affected file after multi-step edits. Check braces, class boundaries, method signatures, and duplicated top-level blocks.
- Keep namespace and API initialization before any class or function that references them.
- When adding commands, verify that all existing command registrations remain present.
- Keep declaration and use consistent; if code uses `this.someElement`, declare and assign `this.someElement`.
- Prefer simple regular expressions and inspect escaping carefully, especially when writing regexes through an edit tool.
- After each structural edit, verify the source is syntactically organized before making further changes.


## Vault tooling note

The root `.gitignore` is known to contain `*.log`. The vault tools cannot read or edit that hidden file reliably. If inspecting or changing `.gitignore` ever becomes essential, ask the user to do that work.
