unit("plugin", [], () => {
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

        this.lastGenerationDurationMs = null;
        this.previousMarkdownLeaf = null;
        // Identifies ribbons built by this load, so a plugin reload rebuilds them once.
        this.modeRibbonLoadId = `${Date.now()}-${Math.random()}`;
        this.installModeRibbonStyle();
        this.errorModal = null;
        this.polishPromptCache = {};
        this.modeRibbonStateRefreshTimer = null;

        this.registerView(
            GPTViz.CANDIDATE_VIEW_TYPE,
            leaf => new GPTViz.CandidateView(leaf, this)
        );

        this.registerEvent(
            this.app.workspace.on("file-open", file => {
                this.traceCandidate(`file-open ${file?.path}`); // TEMP
                this.syncAllModeRibbons();

                if (file && file.extension === "png") {
                    this.openImageInCandidateView(file).catch(error => {
                        this.reportError(`showing ${file.path} in Candidate View`, error);
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", leaf => {
                this.traceCandidate(`active-leaf-change ${leaf?.view?.getViewType?.()} ${leaf?.view?.file?.path}`); // TEMP
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
                this.scheduleModeRibbonButtonStateRefresh();
            })
        );

        this.registerEvent(
            this.app.metadataCache.on("changed", file => {
                if (file && file.extension === "md") {
                    this.updateModeRibbonButtonStates();
                }
            })
        );

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
            callback: async () => {
                try {
                    await this.generateActiveMarkdown(this.getCurrentMarkdownFile());
                } catch (error) {
                    this.reportError("generating an image", error);
                }
            }
        });

        this.addCommand({
            id: "gpt-review-images",
            name: "GPTViz Review Images",
            callback: async () => {
                try {
                    await this.openCandidateView({ file: this.getCurrentMarkdownFile() });
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
            this.syncAllModeRibbons();
            this.rebuildCandidateViewAfterReload().catch(error => {
            this.reportError("recovering Candidate View after plugin reload", error);
            });
        });
    }

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign(
            {},
            GPTViz.DEFAULT_SETTINGS,
            data
        );
        // No longer saved: the Candidate View keeps its note in its own view state.
        delete this.settings.lastMarkdownFilePath;
        this.lastCandidatePaths = data?.lastCandidatePaths || {};
    }

    async saveSettings() {
        await this.saveData({
            ...this.settings,
            lastCandidatePaths: this.lastCandidatePaths
        });
    }

    onunload() {
        this.removeAllModeRibbons();
        this.setCandidateViewActive(false);

        if (this.modeRibbonStateRefreshTimer) {
            window.clearTimeout(this.modeRibbonStateRefreshTimer);
            this.modeRibbonStateRefreshTimer = null;
        }

        if (this.errorModal) {
            this.errorModal.close();
            this.errorModal = null;
        }

        if (this.candidateViewStyle) {
            this.candidateViewStyle.remove();
            this.candidateViewStyle = null;
        }
    }

    // The note the user is working on: the active Markdown view's, else the active Candidate
    // View's. Null when neither is active.
    getCurrentMarkdownFile() {
        const workspace = this.app.workspace;
        const markdownView = workspace.getActiveViewOfType(GPTViz.obsidian.MarkdownView);
        if (markdownView && markdownView.file) {
            return markdownView.file;
        }

        const activeView = workspace.getMostRecentLeaf()?.view;
        return this.isCandidateView(activeView) ? activeView.activeFile : null;
    }

    // Shows file in its existing tab, loading the tab if Obsidian deferred it, or in a new tab.
    // Unloaded tabs have no view.file, so they are matched by their saved state.
    async openNote(file) {
        this.recordBackPlace();
        const workspace = this.app.workspace;
        let leaf = workspace.getLeavesOfType("markdown")
            .find(candidate => candidate.getViewState().state?.file === file.path);

        if (leaf) {
            await workspace.revealLeaf(leaf);
            await leaf.loadIfDeferred();
        } else {
            leaf = workspace.getLeaf(true);
            await leaf.openFile(file);
        }

        return leaf;
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
};

module.exports = GPTViz.Plugin;
});
