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
        this.lastMarkdownFilePath =
            this.lastMarkdownFilePath ||
            this.app.workspace.getActiveFile()?.path || null;
        this.previousMarkdownLeaf = null;
        // Identifies ribbons built by this load, so a plugin reload rebuilds them once.
        this.modeRibbonLoadId = `${Date.now()}-${Math.random()}`;
        this.installModeRibbonStyle();
        this.errorModal = null;
        this.polishPromptCache = {};
        this.openCandidateViewPromise = null;
        this.modeRibbonStateRefreshTimer = null;

        this.registerView(
            GPTViz.CANDIDATE_VIEW_TYPE,
            leaf => new GPTViz.CandidateView(leaf, this)
        );

        this.registerEvent(
            this.app.workspace.on("file-open", file => {
                this.syncAllModeRibbons();

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
};

module.exports = GPTViz.Plugin;
});
