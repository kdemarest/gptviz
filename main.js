globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");

GPTViz.Plugin = class extends GPTViz.obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        await this.appendRunLog();

        this.candidateViewStyle = document.createElement("style");
        this.candidateViewStyle.textContent = `
            .gptviz-candidate-active .mobile-navbar {
                display: none !important;
            }
        `;
        document.head.appendChild(this.candidateViewStyle);

        this.setCandidateViewActive(false);

        this.dependencyOverlayStyle = document.createElement("style");
        this.dependencyOverlayStyle.textContent = `
            .gptviz-dependency-overlay {
                position: fixed;
                left: 50%;
                bottom: 1rem;
                transform: translateX(-50%);
                max-width: min(92vw, 860px);
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 10px;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
                z-index: calc(var(--layer-modal) - 1);
                padding: 0.65rem 0.8rem;
                display: flex;
                align-items: center;
                gap: 0.7rem;
            }

            .gptviz-dependency-overlay.is-hidden {
                display: none;
            }

            .gptviz-dependency-overlay__text {
                flex: 1;
                min-width: 0;
                font-size: 0.9em;
                line-height: 1.35;
                word-break: break-word;
            }

            .gptviz-dependency-overlay__dismiss {
                white-space: nowrap;
            }
        `;
        document.head.appendChild(this.dependencyOverlayStyle);
        this.dependencyOverlayEl = null;
        this.dependencyOverlayTextEl = null;
        this.latestDependencyOverlayText = "";
        this.pendingDependencyOverlayText = "";

        this.lastGenerationDurationMs = null;
        this.lastMarkdownFilePath =
            this.lastMarkdownFilePath ||
            this.app.workspace.getActiveFile()?.path || null;
        this.previousMarkdownLeaf = null;
        this.markdownReviewActions = new WeakSet();
        this.markdownReviewActionClass = "gptviz-review-images-action";
        this.markdownMovieModeActionClass = "gptviz-movie-mode-action";
        this.markdownDependencyActionClass = "gptviz-dependency-check-action";
        this.sharedReviewActionClass = "gptviz-shared-review-action";
        this.sharedDependencyActionClass = "gptviz-shared-dependency-action";
        this.errorModal = null;
        this.polishPromptCache = {};
        this.openCandidateViewPromise = null;
        this.markdownReviewActionRefreshTimer = null;

        this.registerView(
            GPTViz.CANDIDATE_VIEW_TYPE,
            leaf => new GPTViz.CandidateView(leaf, this)
        );

        this.registerEvent(
            this.app.workspace.on("file-open", file => {
                this.syncAllModeRibbons();
                this.maybeShowPendingDependencyOverlay(file);

                if (file && file.extension === "md") {
                    this.rememberMarkdownFile(file);
                    this.refreshCandidateViews().catch(error => {
                        this.reportError("refreshing Candidate View after opening a Markdown file", error);
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", leaf => {
                const isMarkdownView =
                    leaf && leaf.view instanceof GPTViz.obsidian.MarkdownView;

                if (isMarkdownView) {
                    this.rememberMarkdownFile(leaf.view.file);
                    this.syncAllModeRibbons();
                    this.refreshCandidateViews().catch(error => {
                        this.reportError("refreshing Candidate View after activating a Markdown file", error);
                    });
                }

                this.syncAllModeRibbons();
                this.setCandidateViewActive(
                    this.isCandidateView(leaf && leaf.view)
                );
            })
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", () => {
                this.syncAllModeRibbons();
            })
        );

        this.registerEvent(
            this.app.workspace.on("editor-change", () => {
                this.scheduleMarkdownReviewActionStateRefresh();
            })
        );

        this.registerEvent(
            this.app.metadataCache.on("changed", file => {
                if (file && file.extension === "md") {
                    this.updateMarkdownReviewActionStates();
                }
            })
        );

        this.registerDomEvent(document, "click", event => {
            this.handleDependencyReportClick(event);
        });

        this.syncAllModeRibbons();

        this.addSettingTab(
            new GPTViz.SettingTab(this.app, this)
        );

        this.addCommand({
            id: "gpt-check-dependencies",
            name: "GPTViz Check Dependencies",
            callback: async () => await this.checkDependencies()
        });

        this.addCommand({
            id: "gpt-validate-dependency-headings",
            name: "GPTViz Validate Dependency Headings",
            callback: async () => await this.validateDependencyHeadings()
        });

        this.addCommand({
            id: "gpt-image-integrity",
            name: "GPTViz Image Integrity",
            callback: async () => await this.checkImageIntegrity()
        });

        this.addCommand({
            id: "gpt-generate",
            name: "GPTViz Generate Image",
            editorCallback: async editor => await this.generate(editor)
        });

        this.addCommand({
            id: "gpt-review-images",
            name: "GPTViz Review Images",
            callback: async () => {
                try {
                    await this.openCandidateView();
                } catch (error) {
                    this.reportError("opening Candidate View from the command", error);
                }
            }
        });

        this.addCommand({
            id: "gpt-extract",
            name: "GPTViz Extract",
            callback: async () => {
                try {
                    await this.extractActiveMarkdown();
                } catch (error) {
                    this.reportError("running Extract blocks", error);
                }
            },
            editorCallback: async editor => {
                try {
                    await this.extractActiveMarkdown(null, null, { editor });
                } catch (error) {
                    this.reportError("running Extract blocks", error);
                }
            }
        });

        this.app.workspace.onLayoutReady(() => {
            this.debug("onLayoutReady fired.");
            this.syncAllModeRibbons();
            this.rebuildCandidateViewAfterReload().catch(error => {
            this.reportError("recovering Candidate View after plugin reload", error);
            });
        });
    }

    debug() {}

    async appendLog(text) {
        const path = "gptviz/gptviz.log";
        const adapter = this.app.vault.adapter;

        if (await adapter.exists(path)) {
            await adapter.append(path, text);
        } else {
            await adapter.write(path, text);
        }
    }

    async appendRunLog() {
        await this.appendLog(`\n${new Date().toISOString()}\n\n`);
    }

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
    }

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
    }

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
    }

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
    }

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

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign(
            {},
            GPTViz.DEFAULT_SETTINGS,
            data
        );
        this.lastMarkdownFilePath = data?.lastMarkdownFilePath || null;
        this.lastCandidatePaths = data?.lastCandidatePaths || {};
    }

    async saveSettings() {
        await this.saveData({
            ...this.settings,
            lastMarkdownFilePath: this.lastMarkdownFilePath,
            lastCandidatePaths: this.lastCandidatePaths
        });
    }

    setCandidateViewActive(active) {
        document.body.classList.toggle(
            "gptviz-candidate-active",
            active
        );
    }

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

        const executeCommand = this.app?.commands?.executeCommandById;
        if (typeof executeCommand === "function") {
            const commandResult = await Promise.resolve(
                executeCommand.call(this.app.commands, "movi-play-active-script")
            );
            if (commandResult === true) {
                return true;
            }
        }

        new GPTViz.obsidian.Notice(
            "GPTViz: MovieMode is unavailable. Enable the movi plugin."
        );
        return false;
    }

    ensureDependencyOverlay() {
        if (this.dependencyOverlayEl) {
            return;
        }

        const overlay = document.createElement("div");
        overlay.className = "gptviz-dependency-overlay is-hidden";

        const textEl = document.createElement("div");
        textEl.className = "gptviz-dependency-overlay__text";

        const dismissButton = document.createElement("button");
        dismissButton.className = "gptviz-dependency-overlay__dismiss";
        dismissButton.textContent = "Dismiss";
        dismissButton.addEventListener("click", () => {
            this.hideDependencyErrorOverlay();
        });

        overlay.appendChild(textEl);
        overlay.appendChild(dismissButton);
        document.body.appendChild(overlay);

        this.dependencyOverlayEl = overlay;
        this.dependencyOverlayTextEl = textEl;
    }

    showDependencyErrorOverlay(text) {
        // Disabled by request.
        return;
    }

    hideDependencyErrorOverlay() {
        // Disabled by request.
        return;
    }

    formatDependencyIssueOverlayText(issue) {
        // Disabled by request.
        return "";
    }

    maybeShowPendingDependencyOverlay(file) {
        // Disabled by request.
        return;
    }

    handleDependencyReportClick(event) {
        // Disabled by request.
        return;
    }

    onunload() {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            if (!(view instanceof GPTViz.obsidian.MarkdownView)) {
                continue;
            }

            const viewActionsEl = view.containerEl.querySelector(".view-actions");
            if (viewActionsEl) {
                viewActionsEl.style.display = "";
            }
        }

        this.removeMarkdownReviewActions();
        this.removeMarkdownMovieModeActions();
        this.removeMarkdownDependencyActions();
        this.setCandidateViewActive(false);

        if (this.markdownReviewActionRefreshTimer) {
            window.clearTimeout(this.markdownReviewActionRefreshTimer);
            this.markdownReviewActionRefreshTimer = null;
        }

        if (this.errorModal) {
            this.errorModal.close();
            this.errorModal = null;
        }

        if (this.candidateViewStyle) {
            this.candidateViewStyle.remove();
            this.candidateViewStyle = null;
        }

        if (this.dependencyOverlayEl) {
            this.dependencyOverlayEl.remove();
            this.dependencyOverlayEl = null;
            this.dependencyOverlayTextEl = null;
        }

        if (this.dependencyOverlayStyle) {
            this.dependencyOverlayStyle.remove();
            this.dependencyOverlayStyle = null;
        }
    }

    rememberMarkdownFile(file) {
        if (!file || file.extension !== "md") {
            return;
        }

        this.lastMarkdownFilePath = file.path;
        this.saveData({
            ...this.settings,
            lastMarkdownFilePath: this.lastMarkdownFilePath,
            lastCandidatePaths: this.lastCandidatePaths
        }).catch(error => this.reportError("saving GPTViz settings", error));
    }

    getLastCandidatePath(markdownPath) {
        return this.lastCandidatePaths[markdownPath] || null;
    }

    rememberCandidate(markdownPath, candidatePath) {
        if (!markdownPath || !candidatePath) {
            return;
        }

        this.lastCandidatePaths[markdownPath] = candidatePath;
        this.saveData({
            ...this.settings,
            lastMarkdownFilePath: this.lastMarkdownFilePath,
            lastCandidatePaths: this.lastCandidatePaths
        }).catch(error => this.reportError("saving GPTViz settings", error));
    }

    getSelectedCandidateAssetPath(markdownPath) {
        if (!this.selectedCandidateAssetPathsByMarkdown) {
            this.selectedCandidateAssetPathsByMarkdown = {};
        }
        return this.selectedCandidateAssetPathsByMarkdown[markdownPath] || "";
    }

    setSelectedCandidateAssetPath(markdownPath, assetPath) {
        if (!markdownPath) {
            return;
        }

        if (!this.selectedCandidateAssetPathsByMarkdown) {
            this.selectedCandidateAssetPathsByMarkdown = {};
        }

        const normalized = GPTViz.normalizeDependencyAssetPath(assetPath, ".png");
        if (!normalized) {
            delete this.selectedCandidateAssetPathsByMarkdown[markdownPath];
            if (this.selectedCandidateAssetSectionsByMarkdown) {
                delete this.selectedCandidateAssetSectionsByMarkdown[markdownPath];
            }
            return;
        }

        this.selectedCandidateAssetPathsByMarkdown[markdownPath] = normalized;
    }

    getSelectedCandidateAssetSection(markdownPath) {
        if (!this.selectedCandidateAssetSectionsByMarkdown || !markdownPath) {
            return null;
        }

        const section = this.selectedCandidateAssetSectionsByMarkdown[markdownPath];
        if (!section || !Number.isFinite(Number(section.startLine))) {
            return null;
        }

        return {
            startLine: Number(section.startLine),
            endLine: Number(section.endLine),
            assetPath: typeof section.assetPath === "string" ? section.assetPath : ""
        };
    }

    setSelectedCandidateAssetSection(markdownPath, section) {
        if (!markdownPath) {
            return;
        }

        if (!this.selectedCandidateAssetSectionsByMarkdown) {
            this.selectedCandidateAssetSectionsByMarkdown = {};
        }

        const startLine = Number(section && section.startLine);
        const endLine = Number(section && section.endLine);
        const assetPath = GPTViz.normalizeDependencyAssetPath(
            section && section.assetPath ? section.assetPath : "",
            ".png"
        );

        if (!Number.isFinite(startLine) || startLine < 0) {
            delete this.selectedCandidateAssetSectionsByMarkdown[markdownPath];
            return;
        }

        this.selectedCandidateAssetSectionsByMarkdown[markdownPath] = {
            startLine,
            endLine: Number.isFinite(endLine) ? endLine : startLine + 1,
            assetPath
        };
    }

    getActiveCandidateAssetPath(file) {
        if (!file || file.extension !== "md") {
            return "";
        }

        const selected = this.getSelectedCandidateAssetPath(file.path);
        if (selected) {
            return selected;
        }

        return `${file.basename}.png`;
    }

    findLatestCandidatePathForAsset(file, assetPath) {
        if (!file || file.extension !== "md") {
            return "";
        }

        const normalized = GPTViz.normalizeDependencyAssetPath(assetPath, ".png");
        if (!normalized) {
            return "";
        }

        const candidates = GPTViz.getImageCandidates(this.app, file, normalized);
        if (candidates.length === 0) {
            return "";
        }

        return candidates[candidates.length - 1].file.path;
    }

    getCurrentMarkdownFile() {
        const activeView = this.app.workspace.getActiveViewOfType(
            GPTViz.obsidian.MarkdownView
        );

        if (activeView && activeView.file) {
            this.lastMarkdownFilePath = activeView.file.path;
            return activeView.file;
        }

        if (this.lastMarkdownFilePath) {
            const file = this.app.vault.getAbstractFileByPath(
                this.lastMarkdownFilePath
            );
            if (file && file.extension === "md") {
                return file;
            }
        }

        const recentLeaf = this.app.workspace.getMostRecentLeaf();
        if (
            recentLeaf &&
            recentLeaf.view instanceof GPTViz.obsidian.MarkdownView &&
            recentLeaf.view.file
        ) {
            this.rememberMarkdownFile(recentLeaf.view.file);
            return recentLeaf.view.file;
        }

        return null;
    }

    getMarkdownEditor(file) {
        if (!file) {
            return null;
        }

        if (
            this.previousMarkdownLeaf &&
            this.previousMarkdownLeaf.view instanceof GPTViz.obsidian.MarkdownView &&
            this.previousMarkdownLeaf.view.file.path === file.path
        ) {
            return this.previousMarkdownLeaf.view.editor;
        }

        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            if (
                leaf.view instanceof GPTViz.obsidian.MarkdownView &&
                leaf.view.file.path === file.path
            ) {
                return leaf.view.editor;
            }
        }

        return null;
    }

    async getCurrentPromptForFile(file) {
        const editor = this.getMarkdownEditor(file);
        if (!editor) {
            return null;
        }

        const section = GPTViz.getPromptSection(editor);

        if (!section) {
            return null;
        }

        const resolvedSectionText = await GPTViz.expandIncludesInText(
            this.app,
            section.text,
            file && file.path ? file.path : "",
            [file && file.path ? file.path : "<inline>"],
            8,
            { disallowIncludedImagesTag: true }
        );

        return GPTViz.getPromptParts({
            text: resolvedSectionText
        }).text;
    }

    async alignMarkdownPrompt(file, savedPrompt) {
        const editor = this.getMarkdownEditor(file);
        if (!editor) {
            throw new Error(
                this.describeMarkdownEditorFailure(file)
            );
        }

        const section = GPTViz.getPromptSection(editor);
        if (!section) {
            throw new Error("No Prompt section found in the Markdown file.");
        }

        const sectionLines = section.text.split("\n");
        const imageLines = sectionLines.filter(
            line => /^[ \t]*Images:[ \t]*(.*)$/i.test(line)
        );
        const savedLines = savedPrompt.split("\n");
        const savedHeading = GPTViz.parseHeading(savedLines[0]);
        const alignedLines = [
            sectionLines[0],
            ...imageLines,
            ...(savedHeading ? savedLines.slice(1) : savedLines)
        ];
        const endLine = section.endLine - 1;
        const endChar = editor.getLine(endLine).length;

        editor.replaceRange(
            alignedLines.join("\n"),
            { line: section.startLine, ch: 0 },
            { line: endLine, ch: endChar }
        );
    }

    getCurrentMarkdownEditor() {
        return this.getMarkdownEditor(this.getCurrentMarkdownFile());
    }

    isMoviPlayerView(view) {
        return view && typeof view.getViewType === "function" &&
            view.getViewType() === "movi-player-view";
    }

    getMovieSourceMarkdownPath(view) {
        if (view && view.movie && typeof view.movie.sourcePath === "string" && view.movie.sourcePath) {
            return view.movie.sourcePath;
        }
        return this.lastMarkdownFilePath || "";
    }

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
    }

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
    }

    async openCandidateViewForMovieSource(view) {
        const sourceFile = this.resolveMovieSourceMarkdownFile(view);
        if (!sourceFile) {
            throw new Error("No movie source Markdown file is available.");
        }

        this.rememberMarkdownFile(sourceFile);
        await this.openCandidateView();
    }

    markdownFileHasPromptHeading(file) {
        if (!file || file.extension !== "md") {
            return false;
        }

        const cache = this.app.metadataCache.getFileCache(file);
        const headings = Array.isArray(cache?.headings)
            ? cache.headings
            : [];

        return headings.some(heading =>
            typeof heading?.heading === "string" &&
            heading.heading.trim().toLowerCase().startsWith("prompt")
        );
    }


    getCandidateAssetPathsForMarkdownFile(file) {
        if (!file || file.extension !== "md") {
            return [];
        }

        const assets = new Set();
        assets.add(`${file.basename}.png`);

        const selectedAssetPath = this.getSelectedCandidateAssetPath(file.path);
        if (selectedAssetPath) {
            assets.add(selectedAssetPath);
        }

        const cache = this.app.metadataCache.getFileCache(file);
        const headings = Array.isArray(cache?.headings)
            ? cache.headings
            : [];

        for (const heading of headings) {
            const text = typeof heading?.heading === "string"
                ? heading.heading.trim()
                : "";
            if (!text) {
                continue;
            }

            const match = /^(Prompt|Extract)(?:[ \t]*:[ \t]*|[ \t]+)(.+)$/i.exec(text);
            if (!match) {
                continue;
            }

            const assetPath = GPTViz.normalizeDependencyAssetPath(match[2], ".png");
            if (assetPath) {
                assets.add(assetPath);
            }
        }

        return [...assets];
    }

    markdownFileHasKeptImage(file) {
        if (!file || file.extension !== "md") {
            return false;
        }

        const assetPaths = this.getCandidateAssetPathsForMarkdownFile(file);
        for (const assetPath of assetPaths) {
            const keptFile = this.app.vault.getAbstractFileByPath(GPTViz.contentPath(assetPath));
            if (keptFile && keptFile.extension === "png") {
                return true;
            }
        }

        return false;
    }

    markdownFileHasAnyCandidate(file) {
        if (!file || file.extension !== "md") {
            return false;
        }

        const prefixes = this.getCandidateAssetPathsForMarkdownFile(file)
            .map(assetPath => {
                const name = String(assetPath || "").split("/").pop() || "";
                const baseName = name.replace(/\.[^./]+$/, "");
                return baseName ? `${baseName}-` : "";
            })
            .filter(Boolean);

        if (prefixes.length === 0) {
            return false;
        }

        for (const vaultFile of this.app.vault.getFiles()) {
            if (
                !vaultFile.path.startsWith(GPTViz.contentPath("candidates/")) ||
                vaultFile.extension !== "png"
            ) {
                continue;
            }

            for (const prefix of prefixes) {
                if (!vaultFile.name.startsWith(prefix)) {
                    continue;
                }

                const numberText = vaultFile.name.slice(prefix.length, -4);
                if (/^[0-9]+$/.test(numberText)) {
                    return true;
                }
            }
        }

        return false;
    }

    markdownFileCanOpenCandidateView(file) {
        return this.markdownFileHasPromptHeading(file) ||
            this.markdownFileHasKeptImage(file) ||
            this.markdownFileHasAnyCandidate(file);
    }

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
    }

    async getProducedTargetAssetsForMarkdownFile(file) {
        if (!file || file.extension !== "md") {
            return [];
        }

        const text = await this.app.vault.cachedRead(file);
        const lines = String(text || "").split("\n");
        const outputs = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const parsed = GPTViz.parseDependencyOperationHeading(lines[lineIndex]);
            if (!parsed) {
                continue;
            }

            if (parsed.operation === "Prompt" || parsed.operation === "Extract") {
                const outputPath = GPTViz.normalizeDependencyAssetPath(parsed.name, ".png");
                if (outputPath) {
                    outputs.push(outputPath);
                }
                continue;
            }

            if (parsed.operation === "Mark") {
                const outputPath = GPTViz.normalizeDependencyAssetPath(parsed.name, ".marks.json");
                if (outputPath) {
                    outputs.push(outputPath);
                }
            }
        }

        return [...new Set(outputs.map(value => String(value).toLowerCase()))];
    }

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
    }

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
    }

    prioritizeMovieModeAssetRowsByCursor(rows, cursorLine) {
        if (!Array.isArray(rows) || rows.length === 0) {
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
    }

    getCandidateAssetPathForMovieMode(view) {
        if (!this.isCandidateView(view)) {
            return "";
        }

        const index = Number(view.index);
        const candidates = Array.isArray(view.candidates) ? view.candidates : [];
        const candidate = Number.isFinite(index) && index >= 0 && index < candidates.length
            ? candidates[index]
            : null;
        const name = candidate && candidate.file ? String(candidate.file.name || "") : "";
        const match = /^(.+)-\d+\.png$/i.exec(name);

        if (match && match[1]) {
            return `${match[1]}.png`;
        }

        return "";
    }

    async showMovieScriptUsageForAssets(sourceFile, assetPaths, leaf) {
        const normalizedAssets = [...new Set(
            (Array.isArray(assetPaths) ? assetPaths : [])
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
    }

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
    }

    async findMovieScriptsUsingAssets(assetPaths, excludeFilePath, options) {
        const targets = new Set(
            (Array.isArray(assetPaths) ? assetPaths : [])
                .map(value => String(value || "").toLowerCase())
                .filter(Boolean)
        );

        if (targets.size === 0) {
            return [];
        }

        const recursive = !options || options.recursive !== false;
        const dependencyReport = await GPTViz.buildDependencyHeadingReport(this.app);
        const records = Array.isArray(dependencyReport?.graph?.records)
            ? dependencyReport.graph.records
            : [];

        const inputMap = new Map();
        for (const record of records) {
            const outputPath = String(record?.outputPath || "").toLowerCase();
            if (!outputPath) {
                continue;
            }

            if (!inputMap.has(outputPath)) {
                inputMap.set(outputPath, new Set());
            }

            const bucket = inputMap.get(outputPath);
            for (const value of Array.isArray(record?.resolvedInputs) ? record.resolvedInputs : []) {
                const normalized = String(value || "").toLowerCase();
                if (normalized) {
                    bucket.add(normalized);
                }
            }
        }

        const rowsByPath = new Map();

        for (const record of records) {
            if (!record || record.operation !== "Script") {
                continue;
            }

            if (excludeFilePath && record.filePath === excludeFilePath) {
                continue;
            }

            const matches = [];
            for (const dep of Array.isArray(record.resolvedInputs) ? record.resolvedInputs : []) {
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
    }

    async handleMarkdownImageModeRequest(file, leaf) {
        if (!file || file.extension !== "md") {
            await this.openCandidateView(null, leaf);
            return;
        }

        const assetRows = await this.getMovieModeAssetRowsForMarkdownFile(file);
        if (assetRows.length === 0) {
            await this.openCandidateView(null, leaf);
            return;
        }

        const cursorLine = this.getCursorLineForMovieMode(file, leaf);
        const orderedRows = this.prioritizeMovieModeAssetRowsByCursor(assetRows, cursorLine);

        const selectRow = async row => {
            this.setSelectedCandidateAssetPath(file.path, row.assetPath);
            this.setSelectedCandidateAssetSection(file.path, {
                startLine: row.startLine,
                endLine: row.endLine,
                assetPath: row.assetPath
            });

            const editor = this.getMarkdownEditor(file);
            if (editor) {
                const currentLine = Number(editor.getCursor().line);
                const inSection = Number.isFinite(currentLine) &&
                    currentLine >= row.startLine &&
                    currentLine < row.endLine;
                if (!inSection) {
                    editor.setCursor({ line: row.startLine, ch: 0 });
                }
            }

            const preferredCandidatePath = this.findLatestCandidatePathForAsset(
                file,
                row.assetPath
            );
            await this.openCandidateView(preferredCandidatePath || null, leaf);
        };

        if (orderedRows.length === 1) {
            await selectRow(orderedRows[0]);
            return;
        }

        new GPTViz.MovieAssetUsageModal(
            this.app,
            file,
            orderedRows,
            selectRow
        ).open();
    }

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

    isCandidateView(view) {
        return view && typeof view.getViewType === "function" &&
            view.getViewType() === GPTViz.CANDIDATE_VIEW_TYPE;
    }

    getCandidateView() {
        const leaf = this.app.workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        )[0];
        return leaf && this.isCandidateView(leaf.view)
            ? leaf.view
            : null;
    }

    async rebuildCandidateViewAfterReload() {
        const workspace = this.app.workspace;
        const candidateLeaves = workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        );
        const rememberedPath = this.getLastCandidatePath(
            this.lastMarkdownFilePath
        );

        this.debug(`reload recovery: candidate leaf count=${candidateLeaves.length}`);
        for (const candidateLeaf of candidateLeaves) {
            const view = candidateLeaf.view;
            this.debug(
                `old leaf: viewType=${typeof view?.getViewType === "function" ? view.getViewType() : "<none>"}, ` +
                `constructor=${view?.constructor?.name || "<none>"}, ` +
                `hasRefresh=${typeof view?.refresh === "function"}`
            );
        }

        if (candidateLeaves.length === 0) {
            this.debug(
                `reload recovery: no restored candidate leaf; skipping recreate to avoid replacing the active main view (rememberedPath=${rememberedPath || "<none>"}).`
            );
            return;
        }

        const wasActive = candidateLeaves.some(
            leaf => workspace.activeLeaf === leaf
        );
        this.debug(`reload recovery: wasActive=${wasActive}, rememberedPath=${rememberedPath || "<none>"}`);

        const leaf = candidateLeaves[0];

        for (const duplicateLeaf of candidateLeaves.slice(1)) {
            duplicateLeaf.detach();
        }
        if (candidateLeaves.length > 1) {
            this.debug("reload recovery: duplicate candidate leaves detached.");
        }

        await leaf.setViewState({
            type: GPTViz.CANDIDATE_VIEW_TYPE,
            active: wasActive
        });
        this.debug(
            `reload recovery: rebuilt leaf viewType=${typeof leaf.view?.getViewType === "function" ? leaf.view.getViewType() : "<none>"}, ` +
            `constructor=${leaf.view?.constructor?.name || "<none>"}, ` +
            `hasRefresh=${typeof leaf.view?.refresh === "function"}`
        );

        if (wasActive) {
            await workspace.revealLeaf(leaf);
            this.setCandidateViewActive(true);
            this.debug("reload recovery: rebuilt leaf revealed.");
        }

        if (
            this.isCandidateView(leaf.view) &&
            typeof leaf.view.refresh === "function"
        ) {
            leaf.view.plugin = this;
            this.debug("reload recovery: starting fresh view refresh.");
            await leaf.view.refresh(rememberedPath);
            this.debug("reload recovery: fresh view refresh completed.");
        } else {
            this.debug("reload recovery: rebuilt leaf is not refreshable.");
        }
    }

    async refreshCandidateViews(preferredPath) {
        const currentFile = this.getCurrentMarkdownFile();
        const currentPath = currentFile ? currentFile.path : null;

        for (const leaf of this.app.workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        )) {
            if (
                this.isCandidateView(leaf.view) &&
                typeof leaf.view.refresh === "function"
            ) {
                if (
                    !preferredPath &&
                    leaf.view.activeFile &&
                    leaf.view.activeFile.path === currentPath
                ) {
                    continue;
                }

                leaf.view.plugin = this;
                await leaf.view.refresh(preferredPath);
            }
        }
    }

    describeMarkdownEditorFailure(file) {
        const workspace = this.app.workspace;
        const activeLeaf = workspace.activeLeaf;
        const activeView = activeLeaf && activeLeaf.view;
        const markdownLeaves = workspace.getLeavesOfType("markdown");
        const requestedPath = file ? file.path : "<none>";
        const activeViewType = activeView && typeof activeView.getViewType === "function"
            ? activeView.getViewType()
            : activeView?.constructor?.name || "<none>";
        const activeViewFile = activeView?.file?.path || "<none>";
        const leafDetails = markdownLeaves.length === 0
            ? "  <none>"
            : markdownLeaves.map((leaf, index) => {
                const view = leaf.view;
                const viewFile = view?.file?.path || "<none>";
                const isMarkdownView = view instanceof GPTViz.obsidian.MarkdownView;
                const hasEditor = Boolean(view?.editor);
                return `  ${index + 1}. file=${viewFile}; ` +
                    `isMarkdownView=${isMarkdownView}; hasEditor=${hasEditor}; ` +
                    `isActive=${workspace.activeLeaf === leaf}`;
            }).join("\n");

        const reasons = [];
        if (!file) {
            reasons.push("No Markdown file could be resolved for the generation request.");
        } else if (markdownLeaves.length === 0) {
            reasons.push("The workspace returned no leaves of type 'markdown'.");
        } else {
            const matchingLeaves = markdownLeaves.filter(leaf =>
                leaf.view?.file?.path === file.path
            );
            if (matchingLeaves.length === 0) {
                reasons.push(`No Markdown leaf is showing the requested file: ${file.path}.`);
            } else if (!matchingLeaves.some(leaf => Boolean(leaf.view?.editor))) {
                reasons.push(`A Markdown leaf matches ${file.path}, but none exposes an editor.`);
            }
        }

        return [
            "No active Markdown editor was found.",
            `Reason: ${reasons.join(" ")}`,
            `Requested file: ${requestedPath}`,
            `Remembered Markdown file: ${this.lastMarkdownFilePath || "<none>"}`,
            `Active leaf view type: ${activeViewType}`,
            `Active view file: ${activeViewFile}`,
            `Markdown leaf count: ${markdownLeaves.length}`,
            "Markdown leaves:",
            leafDetails
        ].join("\n");
    }

    async generateActiveMarkdown(file, progressView) {
        const requestedFile = file || this.getCurrentMarkdownFile();
        const editor = this.getMarkdownEditor(requestedFile);

        if (!editor) {
            throw new Error(
                this.describeMarkdownEditorFailure(requestedFile)
            );
        }

        await this.generate(editor, requestedFile, progressView);
    }

    async openCandidateView(preferredPath, sourceLeaf) {
        if (this.openCandidateViewPromise) {
            return this.openCandidateViewPromise;
        }

        this.openCandidateViewPromise = this.openCandidateViewNow(
            preferredPath,
            sourceLeaf
        );

        try {
            return await this.openCandidateViewPromise;
        } finally {
            this.openCandidateViewPromise = null;
        }
    }

    async openCandidateViewNow(preferredPath, sourceLeaf) {
        const workspace = this.app.workspace;
        const markdownView = sourceLeaf &&
            sourceLeaf.view instanceof GPTViz.obsidian.MarkdownView
            ? sourceLeaf.view
            : workspace.getActiveViewOfType(
                GPTViz.obsidian.MarkdownView
            );

        if (markdownView && markdownView.leaf) {
            this.previousMarkdownLeaf = markdownView.leaf;
            this.lastMarkdownFilePath = markdownView.file.path;
        }

        const candidateLeaves = workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        );
        let leaf = candidateLeaves[0];

        for (const duplicateLeaf of candidateLeaves.slice(1)) {
            duplicateLeaf.detach();
        }

        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({
                type: GPTViz.CANDIDATE_VIEW_TYPE,
                active: true
            });
        }

        await workspace.revealLeaf(leaf);
        this.setCandidateViewActive(true);

        if (this.isCandidateView(leaf.view)) {
            leaf.view.plugin = this;
            const rememberedPath = markdownView && markdownView.file
                ? this.getLastCandidatePath(markdownView.file.path)
                : this.getLastCandidatePath(this.lastMarkdownFilePath);
            const targetPath = markdownView && markdownView.file
                ? markdownView.file.path
                : this.lastMarkdownFilePath;
            const targetFile = targetPath
                ? this.app.vault.getAbstractFileByPath(targetPath)
                : null;
            const targetAssetPath = targetFile && targetFile.extension === "md"
                ? this.getActiveCandidateAssetPath(targetFile)
                : "";
            const currentAssetPath = GPTViz.normalizeDependencyAssetPath(
                leaf.view.assetPath || "",
                ".png"
            );
            const needsRefresh = Boolean(preferredPath) ||
                !leaf.view.activeFile ||
                leaf.view.activeFile.path !== targetPath ||
                (Boolean(targetAssetPath) && currentAssetPath !== targetAssetPath);

            if (needsRefresh) {
                await leaf.view.refresh(preferredPath || rememberedPath);
            }
        } else {
            throw new Error(
                `Candidate View leaf has unexpected view type: ${leaf.view?.getViewType?.() || "<none>"}`
            );
        }
    }

    async toggleCandidateView() {
        const activeLeaf = this.app.workspace.activeLeaf;

        if (
            activeLeaf &&
            this.isCandidateView(activeLeaf.view)
        ) {
            if (this.previousMarkdownLeaf) {
                await this.app.workspace.revealLeaf(
                    this.previousMarkdownLeaf
                );
                this.setCandidateViewActive(false);
            }
            return;
        }

        await this.openCandidateView();
    }

    async connect() {
        try {
            const secretName = this.settings.apiKeySecret;

            if (!secretName) {
                new GPTViz.obsidian.Notice(
                    "GPTViz: API key not configured."
                );
                return;
            }

            const apiKey =
                this.app.secretStorage.getSecret(secretName);

            if (!apiKey) {
                new GPTViz.obsidian.Notice(
                    "GPTViz: API key not found."
                );
                return;
            }

            const result =
                await GPTViz.testOpenAIConnection(apiKey);

            new GPTViz.obsidian.Notice(`GPTViz: ${result}`);
        } catch (error) {
            this.reportError("connecting to OpenAI", error);
        }
    }

    async checkDependencies() {
        try {
            const rows = await GPTViz.findStaleDependencies(this.app);

            if (rows.length === 0) {
                new GPTViz.obsidian.Notice(
                    "GPTViz: no stale image dependencies found."
                );
                return;
            }

            new GPTViz.DependencyModal(this.app, rows).open();
        } catch (error) {
            this.reportError("checking image dependencies", error);
        }
    }

    async checkImageIntegrity() {
        try {
            const rows = await GPTViz.findInvalidImageReferences(this.app);

            if (rows.length === 0) {
                new GPTViz.obsidian.Notice(
                    "GPTViz: no invalid image references found."
                );
                return;
            }

            new GPTViz.ImageIntegrityModal(this.app, rows).open();
        } catch (error) {
            this.reportError("checking image integrity", error);
        }
    }

    async validateDependencyHeadings() {
        try {
            const report = await GPTViz.buildDependencyHeadingReport(this.app);
            const reportPath = GPTViz.contentPath("_deps.md");
            await this.app.vault.adapter.write(reportPath, report.markdown);

            const reportFile = this.app.vault.getAbstractFileByPath(reportPath);
            if (reportFile) {
                const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
                const existingLeaf = markdownLeaves.find(leaf =>
                    leaf?.view instanceof GPTViz.obsidian.MarkdownView &&
                    leaf.view.file &&
                    leaf.view.file.path === reportFile.path
                );

                if (existingLeaf) {
                    await this.app.workspace.revealLeaf(existingLeaf);
                } else {
                    const resultLeaf = markdownLeaves[0] || this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(false);
                    if (resultLeaf && typeof resultLeaf.openFile === "function") {
                        await resultLeaf.openFile(reportFile);
                    }
                }
            }

            // Dependency bottom-overlay surfacing disabled by request.

            const summary = `GPTViz: dependency validation wrote ${reportPath} (${report.errors.length} error${report.errors.length === 1 ? "" : "s"}, ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}).`;
            new GPTViz.obsidian.Notice(summary);
        } catch (error) {
            this.reportError("validating dependency headings", error);
        }
    }

    async resolveCompanionPromptForImagePath(imagePath, fallbackMarkdownFile) {
        const normalizedImagePath = String(imagePath || "").trim();

        const companionCandidates = [];

        if (fallbackMarkdownFile && fallbackMarkdownFile.path) {
            companionCandidates.push(fallbackMarkdownFile.path);
        }

        if (normalizedImagePath) {
            if (normalizedImagePath.startsWith(GPTViz.contentPath("candidates/")) && fallbackMarkdownFile && fallbackMarkdownFile.path) {
                companionCandidates.push(fallbackMarkdownFile.path);
            }

            const imageDirIndex = normalizedImagePath.lastIndexOf("/");
            const imageDir = imageDirIndex === -1
                ? ""
                : normalizedImagePath.slice(0, imageDirIndex + 1);
            const imageName = imageDirIndex === -1
                ? normalizedImagePath
                : normalizedImagePath.slice(imageDirIndex + 1);
            const baseName = imageName.replace(/\.[^./]+$/, "");

            if (baseName) {
                companionCandidates.push(`${imageDir}${baseName}.md`);
                companionCandidates.push(GPTViz.contentPath(`${baseName}.md`));
            }
        }

        const uniqueCandidates = [...new Set(companionCandidates.filter(Boolean))];

        for (const companionPath of uniqueCandidates) {
            const companionFile = this.app.vault.getAbstractFileByPath(companionPath);
            if (!companionFile || companionFile.extension !== "md") {
                continue;
            }

            const text = await this.app.vault.cachedRead(companionFile);
            const promptSections = GPTViz.getPromptSectionsFromText(text);
            if (promptSections.length === 0) {
                continue;
            }

            const resolvedSectionText = await GPTViz.expandIncludesInText(
                this.app,
                promptSections[0].text,
                companionFile.path,
                [companionFile.path],
                8,
                { disallowIncludedImagesTag: true }
            );
            const prompt = GPTViz.getPromptParts({ text: resolvedSectionText }).text;

            if (prompt && prompt.trim() !== "") {
                return {
                    prompt,
                    companionPath: companionFile.path
                };
            }
        }

        return null;
    }

    async polishActiveMarkdown(file, progressView, promptText) {
        const activeFile = file || this.getCurrentMarkdownFile();

        if (!activeFile) {
            new GPTViz.obsidian.Notice(
                "GPTViz: no active Markdown file."
            );
            return;
        }

        const candidate = progressView && progressView.candidates
            ? progressView.candidates[progressView.index]
            : null;
        if (!candidate || !candidate.file) {
            throw new Error("No candidate image is selected.");
        }

        if (typeof promptText !== "string") {
            throw new Error("No Polish prompt text was supplied.");
        }

        this.polishPromptCache[activeFile.basename] = promptText;
        const executionPrompt = promptText.replaceAll(
            "[[self]]",
            candidate.file.name
        );

        const secretName = this.settings.apiKeySecret;
        const apiKey = secretName
            ? this.app.secretStorage.getSecret(secretName)
            : "";

        if (!apiKey) {
            new GPTViz.obsidian.Notice(
                secretName
                    ? "GPTViz: API key not found."
                    : "GPTViz: API key not configured."
            );
            return;
        }

        let progressOwner = progressView || this.getCandidateView();
        let cancelled = false;
        let generationStartedAt = 0;

        try {
            let sourceBinary = await this.app.vault.readBinary(candidate.file);
            let selectedCandidatePrompt = GPTViz.extractPromptFromPng(sourceBinary);
            const promptParts = GPTViz.getPromptPartsFromText(executionPrompt);
            const imageNames = promptParts.imageNames.length > 0
                ? promptParts.imageNames
                : [candidate.file.path];
            let loadedImages = await GPTViz.loadPromptImages(
                this.app,
                imageNames
            );

            if (loadedImages.warnings.length > 0) {
                new GPTViz.ResponseModal(
                    this.app,
                    loadedImages.warnings.join("\n")
                ).open();
                return;
            }

            let sourcePrompt = loadedImages.sourcePrompts.find(
                item => item.prompt !== null && item.prompt.trim() !== ""
            );
            let originalPrompt = sourcePrompt
                ? sourcePrompt.prompt
                : selectedCandidatePrompt;

            if (originalPrompt === null || originalPrompt.trim() === "") {
                const primarySourcePath = sourcePrompt
                    ? sourcePrompt.path
                    : (promptParts.imageNames.length > 0
                        ? loadedImages.sourcePrompts[0]?.path
                        : candidate.file.path);
                const companionPrompt = await this.resolveCompanionPromptForImagePath(
                    primarySourcePath,
                    activeFile
                );

                if (companionPrompt && companionPrompt.prompt) {
                    const primarySourceFile = primarySourcePath
                        ? this.app.vault.getAbstractFileByPath(primarySourcePath)
                        : null;

                    if (primarySourceFile && primarySourceFile.extension) {
                        let primaryBinary = await this.app.vault.readBinary(primarySourceFile);
                        primaryBinary = GPTViz.embedPromptInPng(
                            primaryBinary,
                            companionPrompt.prompt
                        );
                        await this.app.vault.modifyBinary(primarySourceFile, primaryBinary);

                        if (primarySourcePath === candidate.file.path) {
                            sourceBinary = primaryBinary;
                            selectedCandidatePrompt = companionPrompt.prompt;
                        }
                    }

                    loadedImages = {
                        ...loadedImages,
                        sourcePrompts: loadedImages.sourcePrompts.map(item => {
                            if (item.path === primarySourcePath) {
                                return {
                                    ...item,
                                    prompt: companionPrompt.prompt
                                };
                            }
                            return item;
                        })
                    };
                }

                sourcePrompt = loadedImages.sourcePrompts.find(
                    item => item.prompt !== null && item.prompt.trim() !== ""
                );
                originalPrompt = sourcePrompt
                    ? sourcePrompt.prompt
                    : selectedCandidatePrompt;
            }

            if (originalPrompt === null || originalPrompt.trim() === "") {
                originalPrompt = promptParts.text;
            }

            const targetAssetPath = progressView && progressView.assetPath
                ? GPTViz.normalizeDependencyAssetPath(progressView.assetPath, ".png")
                : this.getActiveCandidateAssetPath(activeFile);
            const targetAssetName = targetAssetPath.split("/").pop() || `${activeFile.basename}.png`;
            const targetAssetBaseName = targetAssetName.replace(/\.[^./]+$/, "");

            const existingCandidates = GPTViz.getImageCandidates(
                this.app,
                activeFile,
                targetAssetPath
            );
            const predictedNumber = existingCandidates.length > 0
                ? existingCandidates[existingCandidates.length - 1].number + 1
                : 1;
            const predictedCandidateName =
                `${targetAssetBaseName}-${predictedNumber}.png`;

            generationStartedAt = Date.now();
            const estimatedDurationMs =
                this.lastGenerationDurationMs || 60000;

            progressOwner = progressOwner || this.getCandidateView();
            if (progressOwner && typeof progressOwner.showProgressOverlay === "function") {
                progressOwner.showProgressOverlay(() => {
                    cancelled = true;
                    progressOwner.hideProgressOverlay();
                    new GPTViz.obsidian.Notice(
                        "GPTViz: polishing cancelled."
                    );
                }, estimatedDurationMs, predictedCandidateName);
            }

            const result = await GPTViz.generateOpenAIResponse(
                apiKey,
                promptParts.text,
                loadedImages.imageInputs
            );

            if (cancelled) {
                return;
            }

            if (progressOwner && typeof progressOwner.hideProgressOverlay === "function") {
                progressOwner.hideProgressOverlay();
            }

            if (!result.imageBase64) {
                new GPTViz.ResponseModal(
                    this.app,
                    result.text || "The API returned no image."
                ).open();
                return;
            }

            this.lastGenerationDurationMs =
                Date.now() - generationStartedAt;

            await GPTViz.ensureFolder(this.app, GPTViz.contentPath("candidates"));

            const candidates = GPTViz.getImageCandidates(
                this.app,
                activeFile,
                targetAssetPath
            );
            const number = candidates.length > 0
                ? candidates[candidates.length - 1].number + 1
                : 1;
            const candidatePath =
                GPTViz.contentPath(`candidates/${targetAssetBaseName}-${number}.png`);
            const binary = atob(result.imageBase64);
            const bytes = new Uint8Array(binary.length);

            for (let index = 0; index < binary.length; index++) {
                bytes[index] = binary.charCodeAt(index);
            }

            const pngWithPrompt = GPTViz.embedPromptInPng(
                bytes.buffer,
                originalPrompt
            );

            await this.app.vault.createBinary(
                candidatePath,
                pngWithPrompt
            );

            await this.openCandidateView(candidatePath);

            new GPTViz.obsidian.Notice(
                `GPTViz: wrote ${candidatePath}`
            );
        } catch (error) {
            if (progressOwner && typeof progressOwner.hideProgressOverlay === "function") {
                progressOwner.hideProgressOverlay();
            }

            if (cancelled) {
                return;
            }

            this.reportError("polishing an image", error);
        }
    }

    async generate(editor, requestedFile, progressView) {
        const section = GPTViz.getPromptSection(editor);

        if (!section) {
            new GPTViz.obsidian.Notice(
                "GPTViz: no Prompt section found."
            );
            return;
        }

        const secretName = this.settings.apiKeySecret;
        const apiKey = secretName
            ? this.app.secretStorage.getSecret(secretName)
            : "";

        if (!apiKey) {
            new GPTViz.obsidian.Notice(
                secretName
                    ? "GPTViz: API key not found."
                    : "GPTViz: API key not configured."
            );
            return;
        }

        const activeFile = requestedFile || this.getCurrentMarkdownFile();

        if (!activeFile) {
            new GPTViz.obsidian.Notice(
                "GPTViz: no active Markdown file."
            );
            return;
        }

        const targetAssetPath = this.getActiveCandidateAssetPath(activeFile);
        const targetAssetName = targetAssetPath.split("/").pop() || `${activeFile.basename}.png`;
        const targetAssetBaseName = targetAssetName.replace(/\.[^./]+$/, "");
        const candidates = GPTViz.getImageCandidates(
            this.app,
            activeFile,
            targetAssetPath
        );
        const number = candidates.length > 0
            ? candidates[candidates.length - 1].number + 1
            : 1;
        const candidateName = `${targetAssetBaseName}-${number}.png`;

        let progressOwner = progressView || this.getCandidateView();
        let cancelled = false;
        let generationStartedAt = 0;

        try {
            const resolvedPromptSectionText = await GPTViz.expandIncludesInText(
                this.app,
                section.text,
                activeFile.path,
                [activeFile.path],
                8,
                { disallowIncludedImagesTag: true }
            );
            const promptParts = GPTViz.getPromptParts({
                text: resolvedPromptSectionText
            });
            const loadedImages = await GPTViz.loadPromptImages(
                this.app,
                promptParts.imageNames
            );

            if (loadedImages.warnings.length > 0) {
                new GPTViz.ResponseModal(
                    this.app,
                    loadedImages.warnings.join("\n")
                ).open();
                return;
            }

            const imageInputs = loadedImages.imageInputs;
            generationStartedAt = Date.now();
            const estimatedDurationMs =
                this.lastGenerationDurationMs || 60000;

            progressOwner = progressOwner || this.getCandidateView();
            if (progressOwner && typeof progressOwner.showProgressOverlay === "function") {
                progressOwner.showProgressOverlay(() => {
                    cancelled = true;
                    progressOwner.hideProgressOverlay();
                    new GPTViz.obsidian.Notice(
                        "GPTViz: generation cancelled."
                    );
                }, estimatedDurationMs, candidateName);
            }

            const result =
                await GPTViz.generateOpenAIResponse(
                    apiKey,
                    promptParts.text,
                    imageInputs
                );

            if (cancelled) {
                return;
            }

            if (progressOwner && typeof progressOwner.hideProgressOverlay === "function") {
                progressOwner.hideProgressOverlay();
            }

            if (!result.imageBase64) {
                new GPTViz.ResponseModal(
                    this.app,
                    result.text || "The API returned no image."
                ).open();
                return;
            }

            this.lastGenerationDurationMs =
                Date.now() - generationStartedAt;

            await GPTViz.ensureFolder(this.app, GPTViz.contentPath("candidates"));

            const saveCandidates = GPTViz.getImageCandidates(
                this.app,
                activeFile,
                targetAssetPath
            );
            const saveNumber = saveCandidates.length > 0
                ? saveCandidates[saveCandidates.length - 1].number + 1
                : 1;
            const candidatePath = GPTViz.contentPath(`candidates/${targetAssetBaseName}-${saveNumber}.png`);
            const binary = atob(result.imageBase64);
            const bytes = new Uint8Array(binary.length);

            for (let index = 0; index < binary.length; index++) {
                bytes[index] = binary.charCodeAt(index);
            }

            const pngWithPrompt = GPTViz.embedPromptInPng(
                bytes.buffer,
                promptParts.text
            );

            await this.app.vault.createBinary(
                candidatePath,
                pngWithPrompt
            );

            await this.openCandidateView(candidatePath);

            new GPTViz.obsidian.Notice(
                `GPTViz: wrote ${candidatePath}`
            );
        } catch (error) {
            if (progressOwner && typeof progressOwner.hideProgressOverlay === "function") {
                progressOwner.hideProgressOverlay();
            }

            if (cancelled) {
                return;
            }

            this.reportError("generating an image", error);
        }
    }

    extractFirstJsonObject(text) {
        const raw = String(text || "").trim();
        if (!raw) {
            throw new Error("Empty model response.");
        }

        try {
            return JSON.parse(raw);
        } catch (error) {}

        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) {
            throw new Error(`Model response did not contain JSON: ${raw}`);
        }

        const jsonText = raw.slice(start, end + 1);
        return JSON.parse(jsonText);
    }

    parseMarkModelResponse(text, expectedName, filePath, line) {
        const parsed = this.extractFirstJsonObject(text);
        const name = String(parsed.name || expectedName || "").trim();
        const x = Number(parsed.x);
        const y = Number(parsed.y);

        if (!name) {
            throw new Error(
                `Mark parse error at ${filePath}:${line} - Model response missing 'name'.`
            );
        }

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(
                `Mark parse error at ${filePath}:${line} - Model response missing numeric x/y.`
            );
        }

        if (x < 0 || x > 1 || y < 0 || y > 1) {
            throw new Error(
                `Mark parse error at ${filePath}:${line} - Coordinates out of range (x=${x}, y=${y}). Expected 0..1.`
            );
        }

        const out = {
            name,
            x,
            y
        };

        if (parsed.confidence !== undefined) {
            const confidence = Number(parsed.confidence);
            if (Number.isFinite(confidence)) {
                out.confidence = confidence;
            }
        }

        if (parsed.bbox && typeof parsed.bbox === "object") {
            const bbox = {
                x: Number(parsed.bbox.x),
                y: Number(parsed.bbox.y),
                w: Number(parsed.bbox.w),
                h: Number(parsed.bbox.h)
            };
            if (
                Number.isFinite(bbox.x) &&
                Number.isFinite(bbox.y) &&
                Number.isFinite(bbox.w) &&
                Number.isFinite(bbox.h)
            ) {
                out.bbox = bbox;
            }
        }

        return out;
    }

    async getMarkBlocksForFile(file) {
        const text = await this.app.vault.cachedRead(file);
        return GPTViz.parseMarkBlocksFromText(text, file.path);
    }

    async hasMarkBlocksForFile(file) {
        const blocks = await this.getMarkBlocksForFile(file);
        return blocks.length > 0;
    }

    async getExtractBlocksForFile(file) {
        const text = await this.app.vault.cachedRead(file);
        return GPTViz.parseExtractBlocksFromText(text, file.path);
    }

    async hasExtractBlocksForFile(file) {
        const blocks = await this.getExtractBlocksForFile(file);
        return blocks.length > 0;
    }

    async ensureParentFolders(path) {
        const segments = String(path || "").split("/").filter(Boolean);
        if (segments.length <= 1) {
            return;
        }

        let current = "";
        for (let index = 0; index < segments.length - 1; index++) {
            current = current
                ? `${current}/${segments[index]}`
                : segments[index];
            await GPTViz.ensureFolder(this.app, current);
        }
    }

    async writeBinaryOverwrite(path, binary) {
        const existing = this.app.vault.getAbstractFileByPath(path);

        if (existing && existing.extension) {
            await this.app.vault.modifyBinary(existing, binary);
            return;
        }

        await this.app.vault.createBinary(path, binary);
    }

    async extractActiveMarkdown(file, candidateView, options) {
        const activeFile = file || this.getCurrentMarkdownFile();
        if (!activeFile) {
            throw new Error("No active Markdown file for Extract operation.");
        }

        const secretName = this.settings.apiKeySecret;
        const apiKey = secretName
            ? this.app.secretStorage.getSecret(secretName)
            : "";

        if (!apiKey) {
            new GPTViz.obsidian.Notice(
                secretName
                    ? "GPTViz: API key not found."
                    : "GPTViz: API key not configured."
            );
            return;
        }

        const blocks = await this.getExtractBlocksForFile(activeFile);
        if (blocks.length === 0) {
            new GPTViz.obsidian.Notice("GPTViz: no # Extract sections found.");
            return;
        }

        let blocksToRun = blocks;
        const editor = options && options.editor;

        if (editor && typeof editor.getCursor === "function") {
            const cursorLine = editor.getCursor().line;
            const blockAtCursor = blocks.find(block =>
                cursorLine >= block.startLine &&
                cursorLine < block.endLine
            );

            if (blockAtCursor) {
                blocksToRun = [blockAtCursor];
            }
        }

        let progressOwner = candidateView || this.getCandidateView();
        let cancelled = false;
        const estimatedDurationMs = Math.max(10000, blocksToRun.length * 14000);
        const progressName = blocksToRun.length === 1
            ? blocksToRun[0].asset
            : `${activeFile.basename}.extract`;

        if (progressOwner && typeof progressOwner.showProgressOverlay === "function") {
            progressOwner.showProgressOverlay(() => {
                cancelled = true;
                progressOwner.hideProgressOverlay();
                new GPTViz.obsidian.Notice("GPTViz: extract cancelled.");
            }, estimatedDurationMs, progressName);
        }

        try {
            const writtenAssets = [];

            for (const block of blocksToRun) {
                if (cancelled) {
                    return;
                }

                const sourceName = block.source || `${activeFile.basename}.png`;
                const loaded = await GPTViz.loadPromptImages(this.app, [sourceName]);

                if (loaded.warnings.length > 0 || loaded.imageInputs.length === 0) {
                    throw new Error(
                        `Extract source error at ${activeFile.path}:${block.line} - ${loaded.warnings[0] || `Could not load source image ${sourceName}`}`
                    );
                }

                const resolvedExtractPrompt = await GPTViz.expandIncludesInText(
                    this.app,
                    block.prompt,
                    activeFile.path,
                    [`${activeFile.path}#Extract:${block.asset}`],
                    8,
                    { disallowIncludedImagesTag: true }
                );

                const response = await GPTViz.generateOpenAIImageResponseDetailed(
                    apiKey,
                    resolvedExtractPrompt,
                    loaded.imageInputs
                );

                if (cancelled) {
                    return;
                }

                if (!response.imageBase64s || response.imageBase64s.length === 0) {
                    throw new Error(
                        `Extract generation error at ${activeFile.path}:${block.line} - missing AI image payload.`
                    );
                }

                if (response.imageBase64s.length > 1) {
                    new GPTViz.obsidian.Notice(
                        `GPTViz: multiple images returned for ${block.asset}; using the first.`
                    );
                }

                const rawPng = GPTViz.base64ToArrayBuffer(response.imageBase64s[0]);
                const outputPng = await GPTViz.removeKeyColorFromPng(rawPng);

                await this.ensureParentFolders(GPTViz.contentPath(block.asset));
                await this.writeBinaryOverwrite(GPTViz.contentPath(block.asset), outputPng);
                writtenAssets.push(block.asset);
            }

            if (writtenAssets.length > 0) {
                const summary = writtenAssets.length <= 3
                    ? writtenAssets.join(", ")
                    : `${writtenAssets.slice(0, 3).join(", ")} +${writtenAssets.length - 3} more`;
                new GPTViz.obsidian.Notice(
                    `GPTViz: wrote ${writtenAssets.length} extract${writtenAssets.length === 1 ? "" : "s"}: ${summary}`
                );
            }
        } finally {
            if (progressOwner && typeof progressOwner.hideProgressOverlay === "function") {
                progressOwner.hideProgressOverlay();
            }
        }
    }

    async markActiveMarkdown(file, candidateView) {
        const activeFile = file || this.getCurrentMarkdownFile();
        if (!activeFile) {
            throw new Error("No active Markdown file for Mark operation.");
        }

        const secretName = this.settings.apiKeySecret;
        const apiKey = secretName
            ? this.app.secretStorage.getSecret(secretName)
            : "";

        if (!apiKey) {
            new GPTViz.obsidian.Notice(
                secretName
                    ? "GPTViz: API key not found."
                    : "GPTViz: API key not configured."
            );
            return;
        }

        const blocks = await this.getMarkBlocksForFile(activeFile);
        if (blocks.length === 0) {
            new GPTViz.obsidian.Notice("GPTViz: no # Mark sections found.");
            return;
        }

        let progressOwner = candidateView || this.getCandidateView();
        let cancelled = false;
        const estimatedDurationMs = Math.max(10000, blocks.length * 12000);

        if (progressOwner && typeof progressOwner.showProgressOverlay === "function") {
            progressOwner.showProgressOverlay(() => {
                cancelled = true;
                progressOwner.hideProgressOverlay();
                new GPTViz.obsidian.Notice("GPTViz: marking cancelled.");
            }, estimatedDurationMs, `${activeFile.basename}.marks.json`);
        }

        try {
            const marks = [];

            for (const block of blocks) {
                if (cancelled) {
                    return;
                }

                const sourceName = block.source || `${activeFile.basename}.png`;
                const loaded = await GPTViz.loadPromptImages(this.app, [sourceName]);
                if (loaded.warnings.length > 0 || loaded.imageInputs.length === 0) {
                    throw new Error(
                        `Mark source error at ${activeFile.path}:${block.line} - ${loaded.warnings[0] || `Could not load source image ${sourceName}`}`
                    );
                }

                const resolvedMarkPrompt = await GPTViz.expandIncludesInText(
                    this.app,
                    block.prompt,
                    activeFile.path,
                    [`${activeFile.path}#Mark:${block.name}`],
                    8,
                    { disallowIncludedImagesTag: true }
                );

                const prompt = [
                    "Find one target point in the image.",
                    `Target name: ${block.name}`,
                    "Return only strict JSON with this exact shape:",
                    '{"name":"<name>","x":0.5,"y":0.5,"confidence":0.0,"bbox":{"x":0.0,"y":0.0,"w":0.0,"h":0.0}}',
                    "Rules:",
                    "- x and y are normalized coordinates from 0 to 1.",
                    "- (0,0) is top-left, (1,1) is bottom-right.",
                    "- Use the exact target name.",
                    "Task:",
                    resolvedMarkPrompt
                ].join("\n");

                const responseText = await GPTViz.generateOpenAITextResponse(
                    apiKey,
                    prompt,
                    loaded.imageInputs
                );

                if (cancelled) {
                    return;
                }

                const point = this.parseMarkModelResponse(
                    responseText,
                    block.name,
                    activeFile.path,
                    block.line
                );

                marks.push({
                    name: point.name,
                    source: sourceName,
                    x: point.x,
                    y: point.y,
                    confidence: point.confidence,
                    bbox: point.bbox,
                    line: block.line,
                    prompt: block.prompt
                });
            }

            const payload = {
                file: activeFile.path,
                updatedAt: new Date().toISOString(),
                marks
            };
            const sidecarPath = GPTViz.contentPath(`${activeFile.basename}.marks.json`);
            await this.app.vault.adapter.write(
                sidecarPath,
                JSON.stringify(payload, null, 2)
            );

            if (candidateView && typeof candidateView.setMarks === "function") {
                await candidateView.setMarks(marks);
            }

            new GPTViz.obsidian.Notice(
                `GPTViz: wrote ${marks.length} mark${marks.length === 1 ? "" : "s"} to ${sidecarPath}`
            );
        } finally {
            if (progressOwner && typeof progressOwner.hideProgressOverlay === "function") {
                progressOwner.hideProgressOverlay();
            }
        }
    }

    showPrompt(editor) {
        const section = GPTViz.getPromptSection(editor);

        if (!section) {
            new GPTViz.obsidian.Notice(
                "GPTViz: no Prompt section found."
            );
            return;
        }

        const firstLine =
            section.text.split("\n")[0] || "# Prompt";
        new GPTViz.obsidian.Notice(
            `GPTViz: found "${firstLine}" (${section.text.length} characters)`
        );
    }
};

module.exports = GPTViz.Plugin;



