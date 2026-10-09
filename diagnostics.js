unit("diagnostics", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    async appendLog(text) {
        const path = "gptviz/gptviz.log";
        const adapter = this.app.vault.adapter;

        if (await adapter.exists(path)) {
            await adapter.append(path, text);
        } else {
            await adapter.write(path, text);
        }
    },

    async appendRunLog() {
        await this.appendLog(`\n${new Date().toISOString()}\n\n`);
    },

    extractBundlePositionFromErrorDetail(detail) {
        const text = String(detail || "");
        const match = /main\.js:(\d+):(\d+)/.exec(text);

        if (!match) {
            return null;
        }

        const line = Number(match[1]);
        const column = Number(match[2]);

        if (!Number.isFinite(line) || !Number.isFinite(column)) {
            return null;
        }

        return {
            line,
            column
        };
    },

    async loadRuntimeCodeMap() {
        if (this.runtimeCodeMapLoaded) {
            return this.runtimeCodeMap;
        }

        this.runtimeCodeMapLoaded = true;
        this.runtimeCodeMap = null;

        const path = "gptviz/runtime-code-map.json";
        const adapter = this.app.vault.adapter;

        try {
            if (!(await adapter.exists(path))) {
                return null;
            }

            const text = await adapter.read(path);
            const parsed = JSON.parse(text);

            if (!parsed || !Array.isArray(parsed.entries)) {
                return null;
            }

            const entries = parsed.entries
                .map(entry => ({
                    sourcePath: typeof entry?.sourcePath === "string" ? entry.sourcePath : "",
                    sourceStartLine: Number(entry?.sourceStartLine),
                    bundleStartLine: Number(entry?.bundleStartLine),
                    bundleEndLine: Number(entry?.bundleEndLine)
                }))
                .filter(entry =>
                    entry.sourcePath &&
                    Number.isFinite(entry.sourceStartLine) &&
                    Number.isFinite(entry.bundleStartLine) &&
                    Number.isFinite(entry.bundleEndLine)
                )
                .sort((left, right) => left.bundleStartLine - right.bundleStartLine);

            this.runtimeCodeMap = {
                path,
                entries
            };

            return this.runtimeCodeMap;
        } catch (mapError) {
            console.error("GPTViz could not load runtime-code-map.json", mapError);
            return null;
        }
    },

    resolveSourceLocationFromBundle(bundleLine, bundleColumn, codeMap) {
        if (!codeMap || !Array.isArray(codeMap.entries)) {
            return null;
        }

        const line = Number(bundleLine);
        const column = Number(bundleColumn);

        if (!Number.isFinite(line) || !Number.isFinite(column)) {
            return null;
        }

        for (const entry of codeMap.entries) {
            if (line < entry.bundleStartLine || line > entry.bundleEndLine) {
                continue;
            }

            const lineOffset = line - entry.bundleStartLine;
            return {
                sourcePath: entry.sourcePath,
                sourceLine: entry.sourceStartLine + lineOffset,
                sourceColumn: column,
                mapPath: codeMap.path
            };
        }

        return null;
    },

    async writeLastRuntimeError(context, detail, now) {
        const bundlePosition = this.extractBundlePositionFromErrorDetail(detail);
        let bundleLocation = "Bundle location: unavailable";
        let sourceLocation = "Source location: unresolved";

        if (bundlePosition) {
            bundleLocation = `Bundle location: .obsidian/plugins/gptviz/main.js:${bundlePosition.line}:${bundlePosition.column}`;
            const codeMap = await this.loadRuntimeCodeMap();
            const source = this.resolveSourceLocationFromBundle(
                bundlePosition.line,
                bundlePosition.column,
                codeMap
            );

            if (source) {
                sourceLocation = `Source location: ${source.sourcePath}:${source.sourceLine}:${source.sourceColumn} (map: ${source.mapPath})`;
            } else if (codeMap) {
                sourceLocation = `Source location: unresolved (map: ${codeMap.path})`;
            }
        }

        const lastErrorPayload = [
            "GPTViz failure",
            `Project: gptviz`,
            `Error type: runtime`,
            `Generated: ${now}`,
            `Operation: ${context}`,
            bundleLocation,
            sourceLocation,
            "",
            detail
        ].join("\n");

        await this.app.vault.adapter.write("gptviz/_lastErr.log", `${lastErrorPayload}\n`);
    },

    reportError(context, error) {
        const detail = error instanceof Error
            ? error.stack || error.message
            : String(error);
        const now = new Date().toISOString();
        const message = `GPTViz ${context} failed: ${detail}`;
        console.error(message, error);

        const logPayload = `ERROR [${now}] ${context}\n${detail}\n\n`;
        this.appendLog(logPayload).catch(logError => {
            console.error("GPTViz could not write gptviz.log", logError);
        });

        this.writeLastRuntimeError(context, detail, now).catch(writeError => {
            console.error("GPTViz could not write _lastErr.log", writeError);
        });

        if (this.errorModal) {
            this.errorModal.setError(context, error);
            return;
        }

        this.errorModal = new GPTViz.ErrorModal(
            this.app,
            this,
            context,
            error
        );
        this.errorModal.open();
    }
});
});
