unit("movie-mode", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    async requestMovieMode(detail) {
        const payload = {
            source: detail && detail.source ? detail.source : "gptviz",
            filePath: detail && detail.filePath ? detail.filePath : null,
            requestedAt: new Date().toISOString()
        };

        const event = new CustomEvent("gptviz:movie-mode-request", {
            detail: payload,
            cancelable: true
        });
        const dispatchResult = window.dispatchEvent(event);

        if (dispatchResult === false) {
            return true;
        }

        new GPTViz.obsidian.Notice(
            "GPTViz: MovieMode is unavailable. Enable the movi plugin."
        );
        return false;
    },

    isMoviPlayerView(view) {
        return Boolean(view) && view.getViewType() === "movi-player-view";
    },

    getMovieSourceMarkdownPath(view) {
        if (view && view.movie && typeof view.movie.sourcePath === "string" && view.movie.sourcePath) {
            return view.movie.sourcePath;
        }
        return this.lastMarkdownFilePath || "";
    },

    resolveMovieSourceMarkdownFile(view) {
        const sourcePath = this.getMovieSourceMarkdownPath(view);
        if (!sourcePath) {
            return null;
        }

        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!file || file.extension !== "md") {
            return null;
        }

        return file;
    },

    async returnToMovieSourceNote(view) {
        const sourceFile = this.resolveMovieSourceMarkdownFile(view);
        if (!sourceFile) {
            throw new Error("No movie source Markdown file is available.");
        }

        const markdownLeaf = this.app.workspace
            .getLeavesOfType("markdown")
            .find(leaf => leaf.view && leaf.view.file && leaf.view.file.path === sourceFile.path);

        if (markdownLeaf) {
            await this.app.workspace.revealLeaf(markdownLeaf);
            return;
        }

        await this.app.workspace.getLeaf(true).openFile(sourceFile);
    },

    async openCandidateViewForMovieSource(view) {
        const sourceFile = this.resolveMovieSourceMarkdownFile(view);
        if (!sourceFile) {
            throw new Error("No movie source Markdown file is available.");
        }

        this.rememberMarkdownFile(sourceFile);
        await this.openCandidateView();
    },

    markdownFileHasScriptHeading(file) {
        if (!file || file.extension !== "md") {
            return false;
        }

        const cache = this.app.metadataCache.getFileCache(file);
        const headings = Array.isArray(cache?.headings)
            ? cache.headings
            : [];

        return headings.some(heading =>
            typeof heading?.heading === "string" &&
            heading.heading.trim().toLowerCase().startsWith("script")
        );
    },

    markdownFileHasPromptHeading(file) {
        if (!file || file.extension !== "md") {
            return false;
        }

        const cache = this.app.metadataCache.getFileCache(file);
        const headings = Array.isArray(cache?.headings)
            ? cache.headings
            : [];

        return headings.some(heading => GPTViz.isPromptHeading(`# ${heading.heading}`));
    },

    async getMovieModeAssetRowsForMarkdownFile(file) {
        if (!file || file.extension !== "md") {
            return [];
        }

        const text = await this.app.vault.cachedRead(file);
        const lines = String(text || "").split("\n");
        const rows = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const parsed = GPTViz.parseDependencyOperationHeading(lines[lineIndex]);
            if (!parsed) {
                continue;
            }

            if (parsed.operation !== "Prompt" && parsed.operation !== "Extract") {
                continue;
            }

            const assetPath = GPTViz.normalizeDependencyAssetPath(parsed.name, ".png");
            if (!assetPath) {
                continue;
            }

            const section = GPTViz.getHeadingSectionFromLines(lines, lineIndex);
            rows.push({
                operation: parsed.operation,
                assetPath,
                label: `${parsed.operation} ${assetPath}`,
                filePath: file.path,
                startLine: section ? section.startLine : lineIndex,
                endLine: section ? section.endLine : (lineIndex + 1)
            });
        }

        return rows;
    },

    getCursorLineForMovieMode(file, leaf) {
        if (!file || file.extension !== "md") {
            return -1;
        }

        const candidateViews = [];

        if (
            leaf &&
            leaf.view instanceof GPTViz.obsidian.MarkdownView &&
            leaf.view.file &&
            leaf.view.file.path === file.path &&
            leaf.view.editor
        ) {
            candidateViews.push(leaf.view);
        }

        const activeMarkdownView = this.app.workspace.getActiveViewOfType(
            GPTViz.obsidian.MarkdownView
        );
        if (
            activeMarkdownView &&
            activeMarkdownView.file &&
            activeMarkdownView.file.path === file.path &&
            activeMarkdownView.editor
        ) {
            candidateViews.push(activeMarkdownView);
        }

        if (candidateViews.length === 0) {
            return -1;
        }

        const line = Number(candidateViews[0].editor.getCursor().line);
        return Number.isFinite(line) ? line : -1;
    },

    prioritizeMovieModeAssetRowsByCursor(rows, cursorLine) {
        if (rows.length === 0) {
            return [];
        }

        if (!Number.isFinite(cursorLine) || cursorLine < 0) {
            return [...rows];
        }

        const preferredIndex = rows.findIndex(row =>
            Number.isFinite(row.startLine) &&
            Number.isFinite(row.endLine) &&
            cursorLine >= row.startLine &&
            cursorLine < row.endLine
        );

        if (preferredIndex <= 0) {
            return [...rows];
        }

        const ordered = [...rows];
        const [preferred] = ordered.splice(preferredIndex, 1);
        ordered.unshift(preferred);
        return ordered;
    },

    getCandidateAssetPathForMovieMode(view) {
        if (!this.isCandidateView(view)) {
            return "";
        }

        const index = Number(view.index);
        const candidates = view.candidates;
        const candidate = Number.isFinite(index) && index >= 0 && index < candidates.length
            ? candidates[index]
            : null;
        const name = candidate && candidate.file ? String(candidate.file.name || "") : "";
        const match = /^(.+)-\d+\.png$/i.exec(name);

        if (match && match[1]) {
            return `${match[1]}.png`;
        }

        return "";
    },

    // Lists the resources a note uses: its # Script assets (from the shared dependency
    // graph) and the Images: entries of every Prompt section (read the same way image
    // generation reads them). Picking one opens the note that produces it in the given leaf.
    async showNoteResources(noteFile, leaf) {
        const report = await GPTViz.buildDependencyHeadingReport(this.app);
        const records = report.graph.records;

        const producerByOutput = new Map();
        for (const record of records) {
            if (record.outputPath) {
                producerByOutput.set(record.outputPath.toLowerCase(), record);
            }
        }

        const assets = new Set();
        for (const record of records) {
            if (record.operation === "Script" && record.filePath === noteFile.path) {
                record.resolvedInputs.forEach(value => assets.add(String(value).toLowerCase()));
            }
        }

        const noteText = await this.app.vault.cachedRead(noteFile);
        for (const section of GPTViz.getPromptSectionsFromText(noteText)) {
            for (const imageName of GPTViz.getPromptParts(section).imageNames) {
                assets.add(GPTViz.normalizeDependencyAssetPath(imageName, ".png").toLowerCase());
            }
        }

        const notesByPath = new Map();
        const unresolvedAssets = [];

        for (const asset of [...assets].sort()) {
            const producer = producerByOutput.get(asset);
            let notePath = producer ? producer.filePath : "";

            if (!notePath) {
                const baseName = asset.split("/").pop().replace(/\.[^.]+$/, "");
                const sameNamePath = GPTViz.contentPath(`${baseName}.md`).toLowerCase();
                const sameNameNote = this.app.vault.getMarkdownFiles()
                    .find(file => file.path.toLowerCase() === sameNamePath);
                notePath = sameNameNote ? sameNameNote.path : "";
            }

            if (notePath === noteFile.path) {
                continue;
            }

            const resourceFile = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
            if (resourceFile && resourceFile.extension === "md") {
                notesByPath.set(resourceFile.path, resourceFile);
            } else {
                unresolvedAssets.push(asset);
            }
        }

        const noteFiles = [...notesByPath.values()]
            .sort((left, right) => left.basename.localeCompare(right.basename));

        new GPTViz.NoteResourcesModal(this.app, noteFile, noteFiles, unresolvedAssets, async resourceFile => {
            try {
                await leaf.openFile(resourceFile);
            } catch (error) {
                this.reportError("opening a script resource note", error);
            }
        }).open();
    },

    async showMovieScriptUsageForAssets(sourceFile, assetPaths, leaf) {
        const normalizedAssets = [...new Set(
            assetPaths
                .map(value => GPTViz.normalizeDependencyAssetPath(value, ""))
                .filter(Boolean)
        )];

        const rows = await this.findMovieScriptsUsingAssets(
            normalizedAssets,
            sourceFile && sourceFile.path ? sourceFile.path : "",
            { recursive: true }
        );

        const openScript = async row => {
            const scriptFile = this.app.vault.getAbstractFileByPath(row.path);
            if (!scriptFile || scriptFile.extension !== "md") {
                new GPTViz.obsidian.Notice(`GPTViz: script note not found: ${row.path}`);
                return;
            }

            const existingScriptLeaf = this.app.workspace
                .getLeavesOfType("markdown")
                .find(candidateLeaf =>
                    candidateLeaf.view &&
                    candidateLeaf.view.file &&
                    candidateLeaf.view.file.path === scriptFile.path
                );

            if (existingScriptLeaf) {
                await this.app.workspace.revealLeaf(existingScriptLeaf);
                return;
            }

            await this.app.workspace.getLeaf(true).openFile(scriptFile);
        };

        if (rows.length === 1) {
            await openScript(rows[0]);
            return;
        }

        new GPTViz.MovieScriptUsageModal(
            this.app,
            sourceFile,
            rows,
            openScript
        ).open();
    },

    assetDependsOnTargets(assetPath, targets, inputMap, visited) {
        const normalizedAsset = String(assetPath || "").toLowerCase();
        if (!normalizedAsset) {
            return false;
        }

        if (targets.has(normalizedAsset)) {
            return true;
        }

        const seen = visited || new Set();
        if (seen.has(normalizedAsset)) {
            return false;
        }
        seen.add(normalizedAsset);

        const inputs = inputMap.get(normalizedAsset);
        if (!inputs || inputs.size === 0) {
            return false;
        }

        for (const dep of inputs) {
            if (this.assetDependsOnTargets(dep, targets, inputMap, seen)) {
                return true;
            }
        }

        return false;
    },

    async findMovieScriptsUsingAssets(assetPaths, excludeFilePath, options) {
        const targets = new Set(
            assetPaths
                .map(value => String(value || "").toLowerCase())
                .filter(Boolean)
        );

        if (targets.size === 0) {
            return [];
        }

        const recursive = !options || options.recursive !== false;
        const dependencyReport = await GPTViz.buildDependencyHeadingReport(this.app);
        const records = dependencyReport.graph.records;

        const inputMap = new Map();
        for (const record of records) {
            const outputPath = record.outputPath.toLowerCase();
            if (!outputPath) {
                continue;
            }

            if (!inputMap.has(outputPath)) {
                inputMap.set(outputPath, new Set());
            }

            const bucket = inputMap.get(outputPath);
            for (const value of record.resolvedInputs) {
                const normalized = String(value || "").toLowerCase();
                if (normalized) {
                    bucket.add(normalized);
                }
            }
        }

        const rowsByPath = new Map();

        for (const record of records) {
            if (record.operation !== "Script") {
                continue;
            }

            if (excludeFilePath && record.filePath === excludeFilePath) {
                continue;
            }

            const matches = [];
            for (const dep of record.resolvedInputs) {
                const normalized = String(dep || "").toLowerCase();
                const isMatch = targets.has(normalized) || (
                    recursive && this.assetDependsOnTargets(normalized, targets, inputMap, new Set())
                );

                if (isMatch) {
                    matches.push(dep);
                }
            }

            if (matches.length === 0) {
                continue;
            }

            const existing = rowsByPath.get(record.filePath);
            if (!existing) {
                rowsByPath.set(record.filePath, {
                    name: record.fileName ? record.fileName.replace(/\.md$/i, "") : record.filePath,
                    path: record.filePath,
                    matches: [...new Set(matches)]
                });
                continue;
            }

            const merged = new Set([...(existing.matches || []), ...matches]);
            existing.matches = [...merged];
        }

        return [...rowsByPath.values()].sort((left, right) => left.name.localeCompare(right.name));
    },

    async handleMarkdownMovieModeRequest(file, leaf, options) {
        if (!file || file.extension !== "md") {
            await this.requestMovieMode({
                source: "markdown-view",
                filePath: file?.path || null
            });
            return;
        }

        if (this.markdownFileHasScriptHeading(file)) {
            await this.requestMovieMode({
                source: "markdown-view",
                filePath: file.path
            });
            return;
        }

        const preferredAssetPath = options && typeof options.preferredAssetPath === "string"
            ? options.preferredAssetPath
            : "";

        if (preferredAssetPath) {
            await this.showMovieScriptUsageForAssets(file, [preferredAssetPath], leaf);
            return;
        }

        const assetRows = await this.getMovieModeAssetRowsForMarkdownFile(file);
        const cursorLine = this.getCursorLineForMovieMode(file, leaf);
        const orderedRows = this.prioritizeMovieModeAssetRowsByCursor(assetRows, cursorLine);

        if (orderedRows.length === 1) {
            await this.showMovieScriptUsageForAssets(file, [orderedRows[0].assetPath], leaf);
            return;
        }

        new GPTViz.MovieAssetUsageModal(
            this.app,
            file,
            orderedRows,
            async row => {
                await this.showMovieScriptUsageForAssets(file, [row.assetPath], leaf);
            }
        ).open();
    }
});
});
