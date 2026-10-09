unit("candidate-workflow", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    setCandidateViewActive(active) {
        document.body.classList.toggle(
            "gptviz-candidate-active",
            active
        );
    },

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
    },

    getLastCandidatePath(markdownPath) {
        return this.lastCandidatePaths[markdownPath] || null;
    },

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
    },

    getSelectedCandidateAssetPath(markdownPath) {
        if (!this.selectedCandidateAssetPathsByMarkdown) {
            this.selectedCandidateAssetPathsByMarkdown = {};
        }
        return this.selectedCandidateAssetPathsByMarkdown[markdownPath] || "";
    },

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
    },

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
    },

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
    },

    getActiveCandidateAssetPath(file) {
        if (!file || file.extension !== "md") {
            return "";
        }

        const selected = this.getSelectedCandidateAssetPath(file.path);
        if (selected) {
            return selected;
        }

        return `${file.basename}.png`;
    },

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
    },

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
    },

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
    },

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
    },

    markdownFileCanOpenCandidateView(file) {
        return this.markdownFileHasPromptHeading(file) ||
            this.markdownFileHasKeptImage(file) ||
            this.markdownFileHasAnyCandidate(file);
    },

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
    },

    isCandidateView(view) {
        return Boolean(view) && view.getViewType() === GPTViz.CANDIDATE_VIEW_TYPE;
    },

    getCandidateView() {
        const leaf = this.app.workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        )[0];
        return leaf && this.isCandidateView(leaf.view)
            ? leaf.view
            : null;
    },

    async rebuildCandidateViewAfterReload() {
        const workspace = this.app.workspace;
        const candidateLeaves = workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        );
        const rememberedPath = this.getLastCandidatePath(
            this.lastMarkdownFilePath
        );

        // No restored Candidate View leaf: don't create one, it would replace the active main view.
        if (candidateLeaves.length === 0) {
            return;
        }

        const wasActive = candidateLeaves.some(
            leaf => workspace.activeLeaf === leaf
        );

        const leaf = candidateLeaves[0];

        for (const duplicateLeaf of candidateLeaves.slice(1)) {
            duplicateLeaf.detach();
        }

        await leaf.setViewState({
            type: GPTViz.CANDIDATE_VIEW_TYPE,
            active: wasActive
        });

        if (wasActive) {
            await workspace.revealLeaf(leaf);
            this.setCandidateViewActive(true);
        }

        if (!this.isCandidateView(leaf.view)) {
            throw new Error(`Candidate View rebuild produced a ${leaf.view.getViewType()} view.`);
        }
        leaf.view.plugin = this;
        await leaf.view.refresh(rememberedPath);
    },

    async refreshCandidateViews(preferredPath) {
        const currentFile = this.getCurrentMarkdownFile();
        const currentPath = currentFile ? currentFile.path : null;

        for (const leaf of this.app.workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        )) {
            if (this.isCandidateView(leaf.view)) {
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
    },

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
    },

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
    },

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
});
});
