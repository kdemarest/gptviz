unit("movie-mode", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    async requestMovieMode(detail) {
        this.recordBackPlace();
        const payload = {
            source: detail && detail.source ? detail.source : "gptviz",
            filePath: detail && detail.filePath ? detail.filePath : null,
            scriptLine: detail && Number.isInteger(detail.scriptLine) ? detail.scriptLine : null,
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
        // movi's class isn't visible here, so also require a loaded tab: an unloaded one holds a
        // placeholder view that reports this type without being the player.
        return Boolean(view) && view.getViewType() === "movi-player-view" && !view.leaf.isDeferred;
    },

    getMovieSourceMarkdownPath(view) {
        if (view && view.movie && typeof view.movie.sourcePath === "string" && view.movie.sourcePath) {
            return view.movie.sourcePath;
        }
        return "";
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

        await this.openNote(sourceFile);
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

    // The Script headings in a note, as { label, line } with a 0-based line, matched the way
    // movi's parser finds them.
    async getScriptHeadingsForMarkdownFile(file) {
        const text = await this.app.vault.cachedRead(file);
        const headings = [];
        String(text || "").split("\n").forEach((line, index) => {
            const heading = GPTViz.parseHeading(line);
            if (heading && /^Script\b/i.test(heading.text.trim())) {
                headings.push({ label: heading.text.trim(), line: index });
            }
        });
        return headings;
    },

    // The image assets a note specifies: its Prompt and Extract outputs, plus the image each
    // of its Marks sits on (scripts reference marks only through that image).
    async getNoteSpecifiedAssets(file) {
        const report = await GPTViz.buildDependencyHeadingReport(this.app);
        const assets = new Set();
        for (const record of report.graph.records) {
            if (record.filePath !== file.path) {
                continue;
            }
            const asset = record.operation === "Mark" ? record.source : record.outputPath;
            if (asset) {
                assets.add(asset.toLowerCase());
            }
        }
        return { assets, records: report.graph.records };
    },

    // The Script notes that show at least one of the note's assets, sorted by name.
    async findScriptNotesUsingNote(file) {
        const { assets, records } = await this.getNoteSpecifiedAssets(file);
        const notesByPath = new Map();

        for (const record of records) {
            if (record.operation !== "Script" || record.filePath === file.path) {
                continue;
            }
            const usesAsset = record.resolvedInputs.some(value => assets.has(String(value).toLowerCase()));
            const note = usesAsset ? this.app.vault.getAbstractFileByPath(record.filePath) : null;
            if (note) {
                notesByPath.set(note.path, note);
            }
        }

        return [...notesByPath.values()].sort((left, right) => left.basename.localeCompare(right.basename));
    },

    // MovieMode on a note (Markdown or Candidate View). A note with Script headings plays one,
    // asking which when there are several. Otherwise it jumps to the Script note that uses the
    // note's assets, asking which when there are several.
    async handleMarkdownMovieModeRequest(file) {
        if (!file || file.extension !== "md") {
            await this.requestMovieMode({
                source: "markdown-view",
                filePath: file?.path || null
            });
            return;
        }

        const scriptHeadings = await this.getScriptHeadingsForMarkdownFile(file);
        const playScript = async heading => {
            await this.requestMovieMode({
                source: "markdown-view",
                filePath: file.path,
                scriptLine: heading.line
            });
        };

        if (scriptHeadings.length === 1) {
            await playScript(scriptHeadings[0]);
            return;
        }

        if (scriptHeadings.length > 1) {
            new GPTViz.PickListModal(
                this.app,
                `Play which script in ${file.basename}?`,
                scriptHeadings.map(heading => ({ label: heading.label, value: heading })),
                "",
                async heading => {
                    try {
                        await playScript(heading);
                    } catch (error) {
                        this.reportError("playing a script", error);
                    }
                }
            ).open();
            return;
        }

        const scriptNotes = await this.findScriptNotesUsingNote(file);
        if (scriptNotes.length === 1) {
            await this.openNote(scriptNotes[0]);
            return;
        }

        new GPTViz.PickListModal(
            this.app,
            `Scripts using ${file.basename}`,
            scriptNotes.map(note => ({ label: note.basename, value: note })),
            `No script uses an asset from ${file.basename}.`,
            async note => {
                try {
                    await this.openNote(note);
                } catch (error) {
                    this.reportError("opening a script note", error);
                }
            }
        ).open();
    }
});
});
