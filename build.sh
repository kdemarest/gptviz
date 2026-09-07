#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

DEST="../.obsidian/plugins/gptviz"
BUNDLE_PATH="$DEST/main.js"
MAP_PATH="runtime-code-map.json"

mkdir -p "$DEST"

mapfile -t JS_FILES < <(find . -maxdepth 1 -type f -name '*.js' | sort)

if [ "${#JS_FILES[@]}" -eq 0 ]; then
  echo "Build failed: no source .js files found in $(pwd)" >&2
  exit 1
fi

: > "$BUNDLE_PATH"
CURRENT_LINE=1
MAP_ENTRIES=""

for FILE in "${JS_FILES[@]}"; do
  SOURCE_LINES=$(awk 'END { print NR + 0 }' "$FILE")
  START_LINE=$CURRENT_LINE

  cat "$FILE" >> "$BUNDLE_PATH"
  printf '\n' >> "$BUNDLE_PATH"

  if [ "$SOURCE_LINES" -gt 0 ]; then
    END_LINE=$((START_LINE + SOURCE_LINES - 1))
  else
    END_LINE=$START_LINE
  fi

  RELATIVE_FILE=${FILE#./}
  SOURCE_PATH="gptviz/$RELATIVE_FILE"
  ESCAPED_SOURCE_PATH=$(printf '%s' "$SOURCE_PATH" | sed 's/\\/\\\\/g; s/"/\\"/g')

  ENTRY=$(cat <<EOF
    {
      "sourcePath": "$ESCAPED_SOURCE_PATH",
      "sourceStartLine": 1,
      "bundleStartLine": $START_LINE,
      "bundleEndLine": $END_LINE
    }
EOF
)

  if [ -n "$MAP_ENTRIES" ]; then
    MAP_ENTRIES+=$',\n'
    MAP_ENTRIES+="$ENTRY"
  else
    MAP_ENTRIES="$ENTRY"
  fi

  CURRENT_LINE=$((CURRENT_LINE + SOURCE_LINES + 1))
done

GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$MAP_PATH" <<EOF
{
  "project": "gptviz",
  "generatedAt": "$GENERATED_AT",
  "bundlePath": ".obsidian/plugins/gptviz/main.js",
  "entries": [
$MAP_ENTRIES
  ]
}
EOF

cp manifest.json "$DEST/manifest.json"

# Tell Obsidian Hot Reload to watch this plugin.
touch "$DEST/.hotreload"

echo "Built GPTViz and wrote $MAP_PATH"

