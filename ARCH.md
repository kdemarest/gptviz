# ARCH.md

GPTViz is a plain-JavaScript Obsidian plugin designed to run on Android.

Source files live directly in `vault/gptviz/`. The installed plugin lives in `vault/.obsidian/plugins/gptviz/`.

`build.sh` concatenates all source `.js` files into the installed `main.js` and copies `manifest.json`.

All source files must therefore be concatenation-safe and independent of filename order. Shared code uses the global `GPTViz` namespace. Do not use ES modules or local-file `require()` calls.

Use Obsidian APIs for vault access, HTTP requests, settings, and secrets. Avoid Node.js, Electron, and desktop-only APIs.

Keep major functions in separate source files, with `main.js` limited primarily to plugin startup and command registration.

