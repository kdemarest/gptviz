#!/data/data/com.termux/files/usr/bin/bash
set -e

DEST="../.obsidian/plugins/gptviz"

mkdir -p "$DEST"

cat ./*.js > "$DEST/main.js"
cp manifest.json "$DEST/manifest.json"

# Tell Obsidian Hot Reload to watch this plugin.
touch "$DEST/.hotreload"

echo "Built GPTViz"

