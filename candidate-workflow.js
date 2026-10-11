unit("candidate-workflow", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    setCandidateViewActive(active) {
        document.body.classList.toggle(
            "gptviz-candidate-active",
            active
        );
    },

    // The note whose Prompt produces this png (a kept image, or a candidate of one), found via
    // Obsidian's heading index: a Prompt named for the asset, or a note's unnamed Prompt for
    // <note>.png. Null for images no Prompt produces.
    findPromptNoteForImage(file) {
        if (!GPTViz.isContentFile(file)) {
            return null;
        }

        const contentRelativePath = file.path.slice(GPTViz.contentPath("").length);
        const candidateMatch = /^candidates\/(.+)-\d+\.png$/i.exec(contentRelativePath);
        const asset = candidateMatch ? `${candidateMatch[1]}.png` : contentRelativePath;
        const target = asset.toLowerCase();

        for (const note of this.app.vault.getMarkdownFiles().filter(GPTViz.isContentFile)) {
            const headings = this.app.metadataCache.getFileCache(note)?.headings ?? [];
            for (const { heading } of headings) {
                const line = `# ${heading}`;
                if (!GPTViz.isPromptHeading(line)) {
                    continue;
                }
                const parsed = GPTViz.parseDependencyOperationHeading(line);
                const produces = parsed
                    ? GPTViz.normalizeDependencyAssetPath(parsed.name, ".png")
                    : `${note.basename}.png`;
                if (produces.toLowerCase() === target) {
                    return { note, asset: produces, isCandidate: Boolean(candidateMatch) };
                }
            }
        }

        return null;
    },

    // Opening a generated png shows it in the Candidate View (that exact candidate, or the kept
    // image) instead of Obsidian's image viewer, whose tab is then closed.
    async openImageInCandidateView(file) {
        const match = this.findPromptNoteForImage(file);
        if (!match) {
            return;
        }

        const imageLeaf = this.app.workspace.getLeavesOfType("image")
            .find(leaf => leaf.view.file?.path === file.path);

        await this.openAssetInCandidateView(match.note, match.asset, match.isCandidate ? file.path : null);

        if (imageLeaf) {
            imageLeaf.detach();
        }
    },

    // Candidate View on a note's asset, showing candidatePath, or the kept image when null.
    async openAssetInCandidateView(note, asset, candidatePath) {
        this.setSelectedCandidateAssetPath(note.path, asset);
        await this.openCandidateView({ file: note, asset, candidate: candidatePath, kept: !candidatePath });
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
            return;
        }

        this.selectedCandidateAssetPathsByMarkdown[markdownPath] = normalized;
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
            new GPTViz.obsidian.Notice("GPTViz: ImageMode needs a note.");
            return;
        }

        const assetRows = await this.getMovieModeAssetRowsForMarkdownFile(file);
        if (assetRows.length === 0) {
            await this.openCandidateView({ file, sourceLeaf: leaf });
            return;
        }

        const cursorLine = this.getCursorLineForMovieMode(file, leaf);
        const orderedRows = this.prioritizeMovieModeAssetRowsByCursor(assetRows, cursorLine);

        const selectRow = async row => {
            this.setSelectedCandidateAssetPath(file.path, row.assetPath);

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
            await this.openCandidateView({
                file,
                asset: row.assetPath,
                candidate: preferredCandidatePath || null,
                sourceLeaf: leaf
            });
        };

        if (orderedRows.length === 1) {
            await selectRow(orderedRows[0]);
            return;
        }

        new GPTViz.PickListModal(
            this.app,
            `Prompts in ${file.basename}`,
            orderedRows.map(row => ({ label: row.label, value: row })),
            `No Prompt/Extract headings in ${file.basename}.`,
            async row => {
                try {
                    await selectRow(row);
                } catch (error) {
                    this.reportError("opening a prompt in Candidate View", error);
                }
            }
        ).open();
    },

    isCandidateView(view) {
        // Class check, not type name: a tab Obsidian hasn't loaded yet holds a placeholder
        // view that reports this type but has none of the Candidate View's methods.
        return view instanceof GPTViz.CandidateView;
    },

    getCandidateView() {
        const leaf = this.app.workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        )[0];
        return leaf && this.isCandidateView(leaf.view)
            ? leaf.view
            : null;
    },

    // After a plugin reload, the restored Candidate View leaf is rebuilt from its saved state.
    async rebuildCandidateViewAfterReload() {
        const workspace = this.app.workspace;
        const candidateLeaves = workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
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
            state: leaf.getViewState().state,
            active: wasActive
        });
        await leaf.loadIfDeferred();

        if (wasActive) {
            await workspace.revealLeaf(leaf);
            this.setCandidateViewActive(true);
        }

        if (!this.isCandidateView(leaf.view)) {
            throw new Error(`Candidate View rebuild produced a ${leaf.view.getViewType()} view.`);
        }
    },

    // Shows exactly target in the Candidate View: { file (the note), asset (defaults to the
    // note's selected or same-named asset), candidate (a candidate path; defaults to the one
    // last viewed), kept (show the kept image), sourceLeaf (the Markdown leaf it came from) }.
    async openCandidateView(target) {
        const file = target && target.file;
        if (!file || file.extension !== "md") {
            new GPTViz.obsidian.Notice("GPTViz: the Candidate View needs a note.");
            return;
        }

        this.recordBackPlace();
        const workspace = this.app.workspace;
        const sourceLeaf = target.sourceLeaf || workspace.getActiveViewOfType(GPTViz.obsidian.MarkdownView)?.leaf;
        if (sourceLeaf && sourceLeaf.view instanceof GPTViz.obsidian.MarkdownView && sourceLeaf.view.file === file) {
            this.previousMarkdownLeaf = sourceLeaf;
        }

        const candidateLeaves = workspace.getLeavesOfType(
            GPTViz.CANDIDATE_VIEW_TYPE
        );
        const leaf = candidateLeaves[0] || workspace.getLeaf("tab");

        for (const duplicateLeaf of candidateLeaves.slice(1)) {
            duplicateLeaf.detach();
        }

        await leaf.setViewState({
            type: GPTViz.CANDIDATE_VIEW_TYPE,
            state: {
                file: file.path,
                asset: target.asset || this.getActiveCandidateAssetPath(file),
                candidate: target.candidate || null,
                kept: Boolean(target.kept)
            },
            active: true
        });
        await workspace.revealLeaf(leaf);
        this.setCandidateViewActive(true);

        if (!this.isCandidateView(leaf.view)) {
            throw new Error(
                `Candidate View leaf has unexpected view type: ${leaf.view?.getViewType?.() || "<none>"}`
            );
        }
    }
});
});
