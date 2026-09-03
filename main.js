var GPTViz = GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");

GPTViz.DependencyModal = class extends GPTViz.obsidian.Modal {
    constructor(app, rows) {
        super(app);
        this.app = app;
        this.rows = rows;
    }

    onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();
        this.titleEl.textContent = "GPTViz image dependencies";

        const list = contentEl.createEl("div");
        list.style.maxHeight = "60vh";
        list.style.overflowY = "auto";

        for (const row of this.rows) {
            const item = list.createEl("div");
            item.style.display = "grid";
            item.style.gridTemplateColumns = "1fr 1fr";
            item.style.gap = "1em";
            item.style.padding = "0.6em 0";
            item.style.borderBottom = "1px solid var(--background-modifier-border)";

            const outputButton = item.createEl("button", {
                text: row.outputName
            });
            outputButton.style.textAlign = "left";
            outputButton.addEventListener("click", async () => {
                const companion = this.app.vault.getAbstractFileByPath(
                    row.companionPath
                );

                if (companion) {
                    await this.app.workspace.getLeaf(true).openFile(companion);
                    this.close();
                } else {
                    new GPTViz.obsidian.Notice(
                        `GPTViz: companion note not found: ${row.companionPath}`
                    );
                }
            });

            item.createEl("div", {
                text: row.dependencies.join(", ")
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
};

GPTViz.findStaleDependencies = async function(app) {
    const rows = [];

    for (const markdownFile of app.vault.getMarkdownFiles()) {
        const content = await app.vault.cachedRead(markdownFile);
        const imageNames = [];

        for (const section of GPTViz.getPromptSectionsFromText(content)) {
            imageNames.push(...GPTViz.getPromptParts(section).imageNames);
        }

        if (imageNames.length === 0) {
            continue;
        }

        const newerDependencies = [];
        const outputFile = app.vault.getAbstractFileByPath(
            `${markdownFile.basename}.png`
        );

        for (const imageName of imageNames) {
            const dependencyPath = /\.[^./]+$/.test(imageName)
                ? imageName
                : `${imageName}.png`;
            const dependencyFile =
                app.vault.getAbstractFileByPath(dependencyPath);
            const displayName = dependencyPath.replace(/\.[^./]+$/, "");

            if (!dependencyFile || !dependencyFile.stat) {
                newerDependencies.push(`${displayName} (missing)`);
            } else if (
                !outputFile ||
                !outputFile.stat ||
                dependencyFile.stat.mtime > outputFile.stat.mtime
            ) {
                newerDependencies.push(displayName);
            }
        }

        if (newerDependencies.length > 0) {
            rows.push({
                outputName: markdownFile.basename,
                companionPath: markdownFile.path,
                dependencies: newerDependencies
            });
        }
    }

    return rows;
};

GPTViz.ImageIntegrityModal = class extends GPTViz.obsidian.Modal {
    constructor(app, rows) {
        super(app);
        this.app = app;
        this.rows = rows;
    }

    onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();
        this.titleEl.textContent = "GPTViz image integrity";

        const list = contentEl.createEl("div");
        list.style.maxHeight = "60vh";
        list.style.overflowY = "auto";

        for (const row of this.rows) {
            const item = list.createEl("div");
            item.style.display = "grid";
            item.style.gridTemplateColumns = "1fr 1fr";
            item.style.gap = "1em";
            item.style.padding = "0.6em 0";
            item.style.borderBottom = "1px solid var(--background-modifier-border)";

            const fileButton = item.createEl("button", {
                text: row.fileName
            });
            fileButton.style.textAlign = "left";
            fileButton.addEventListener("click", async () => {
                const file = this.app.vault.getAbstractFileByPath(
                    row.filePath
                );

                if (file) {
                    await this.app.workspace.getLeaf(true).openFile(file);
                    this.close();
                } else {
                    new GPTViz.obsidian.Notice(
                        `GPTViz: Markdown file not found: ${row.filePath}`
                    );
                }
            });

            item.createEl("div", {
                text: row.invalidImages.join(", ")
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
};

GPTViz.getImageTagReferences = function(text) {
    const references = [];
    const addReference = value => {
        const reference = value.trim()
            .replace(/^<|>$/g, "")
            .split("|")[0]
            .split("#")[0]
            .trim();

        if (
            reference &&
            !/^(?:https?:|app:|data:|mailto:)/i.test(reference)
        ) {
            references.push(reference);
        }
    };

    for (const match of text.matchAll(/!\[\[([^\]]+)\]\]/g)) {
        addReference(match[1]);
    }

    for (const match of text.matchAll(/!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g)) {
        addReference(match[1]);
    }

    for (const match of text.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        addReference(match[1]);
    }

    for (const match of text.matchAll(/^[ \t]*(?:Images|Photos):[ \t]*(.*)$/gim)) {
        for (const value of match[1].split(",")) {
            addReference(value);
        }
    }

    return [...new Set(references)];
};

GPTViz.findInvalidImageReferences = async function(app) {
    const rows = [];

    for (const markdownFile of app.vault.getMarkdownFiles()) {
        const content = await app.vault.cachedRead(markdownFile);
        const invalidImages = [];

        for (const imageReference of GPTViz.getImageTagReferences(content)) {
            let decodedReference = imageReference;

            try {
                decodedReference = decodeURIComponent(imageReference);
            } catch (error) {
                // Keep the original path when the link contains malformed escapes.
            }

            const resolvedFile = app.metadataCache.getFirstLinkpathDest(
                decodedReference,
                markdownFile.path
            );

            if (!resolvedFile || !resolvedFile.stat) {
                invalidImages.push(imageReference);
            }
        }

        if (invalidImages.length > 0) {
            rows.push({
                fileName: markdownFile.basename,
                filePath: markdownFile.path,
                invalidImages: invalidImages
            });
        }
    }

    return rows;
};

GPTViz.PromptAlignmentModal = class extends GPTViz.obsidian.Modal {
    constructor(app, resolve) {
        super(app);
        this.resolveChoice = resolve;
        this.choiceMade = false;
    }

    onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();
        contentEl.createEl("p", {
            text: "Align the .md file's image prompt to be equal to the prompt used for this image?"
        });

        const buttons = contentEl.createEl("div");
        buttons.style.display = "flex";
        buttons.style.gap = "0.5em";

        for (const choice of ["Yes", "No", "Cancel"]) {
            const button = buttons.createEl("button", {
                text: choice
            });
            button.addEventListener("click", () => {
                this.choiceMade = true;
                this.resolveChoice(choice);
                this.close();
            });
        }
    }

    onClose() {
        if (!this.choiceMade) {
            this.choiceMade = true;
            this.resolveChoice("Cancel");
        }
        this.contentEl.empty();
    }
};

GPTViz.confirmPromptAlignment = function(app) {
    return new Promise(resolve => {
        new GPTViz.PromptAlignmentModal(app, resolve).open();
    });
};

GPTViz.ResponseModal = class extends GPTViz.obsidian.Modal {
    constructor(app, text) {
        super(app);
        this.text = text;
    }

    onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();
        contentEl.createEl("h2", { text: "GPTViz response" });
        contentEl.createEl("pre", { text: this.text });

        const closeButton = contentEl.createEl("button", {
            text: "Close"
        });
        closeButton.addEventListener("click", () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
};

GPTViz.ErrorModal = class extends GPTViz.obsidian.Modal {
    constructor(app, plugin, context, error) {
        super(app);
        this.plugin = plugin;
        this.context = context;
        this.error = error;
    }

    setError(context, error) {
        this.context = context;
        this.error = error;

        if (this.contentEl) {
            this.render();
        }
    }

    render() {
        const detail = this.error instanceof Error
            ? this.error.stack || this.error.message
            : String(this.error);
        const contentEl = this.contentEl;
        contentEl.empty();
        contentEl.style.display = "flex";
        contentEl.style.flexDirection = "column";
        contentEl.style.gap = "1em";
        contentEl.style.height = "100%";
        contentEl.style.boxSizing = "border-box";
        contentEl.style.padding = "2em";

        contentEl.createEl("h2", { text: "GPTViz failure" });
        contentEl.createEl("p", {
            text: `Operation: ${this.context}`
        });
        contentEl.createEl("pre", {
            text: detail
        }).style.whiteSpace = "pre-wrap";

        const clearButton = contentEl.createEl("button", {
            text: "Clear"
        });
        clearButton.style.alignSelf = "flex-start";
        clearButton.addEventListener("click", () => this.close());
    }

    onOpen() {
        this.modalEl.style.position = "fixed";
        this.modalEl.style.inset = "0";
        this.modalEl.style.width = "100vw";
        this.modalEl.style.height = "100vh";
        this.modalEl.style.maxWidth = "none";
        this.modalEl.style.maxHeight = "none";
        this.modalEl.style.margin = "0";
        this.modalEl.style.padding = "0";
        this.modalEl.style.borderRadius = "0";
        this.modalEl.style.zIndex = "var(--layer-modal)";
        this.modalEl.classList.add("gptviz-error-modal");
        this.render();
    }

    onClose() {
        if (this.plugin.errorModal === this) {
            this.plugin.errorModal = null;
        }
        this.contentEl.empty();
    }
};

GPTViz.getImageCandidates = function(app, activeFile) {
    const prefix = `${activeFile.basename}-`;
    const candidates = [];

    for (const file of app.vault.getFiles()) {
        if (
            file.path.startsWith("candidates/") &&
            file.extension === "png" &&
            file.name.startsWith(prefix)
        ) {
            const numberText = file.name.slice(prefix.length, -4);

            if (/^[0-9]+$/.test(numberText)) {
                candidates.push({
                    file: file,
                    number: Number(numberText)
                });
            }
        }
    }

    return candidates.sort((left, right) => left.number - right.number);
};

GPTViz.binaryEqual = function(left, right) {
    if (left.byteLength !== right.byteLength) {
        return false;
    }

    const leftBytes = new Uint8Array(left);
    const rightBytes = new Uint8Array(right);

    for (let index = 0; index < leftBytes.length; index++) {
        if (leftBytes[index] !== rightBytes[index]) {
            return false;
        }
    }

    return true;
};
GPTViz.fileTimestampOptions = function(file) {
    if (!file || !file.stat) {
        return {};
    }

    return {
        ctime: file.stat.ctime,
        mtime: file.stat.mtime
    };
};

GPTViz.ensureKeptImageCandidate = async function(app, activeFile) {
    const keptFile = app.vault.getAbstractFileByPath(
        `${activeFile.basename}.png`
    );
    const candidates = GPTViz.getImageCandidates(app, activeFile);

    if (!keptFile || !keptFile.extension) {
        return candidates;
    }

    const keptBinary = await app.vault.readBinary(keptFile);

    for (const candidate of candidates) {
        const candidateBinary = await app.vault.readBinary(candidate.file);

        if (GPTViz.binaryEqual(keptBinary, candidateBinary)) {
            return candidates;
        }
    }

    let candidateBinary = keptBinary;
    const keptTimestamps = GPTViz.fileTimestampOptions(keptFile);
    const markdownContent = await app.vault.cachedRead(activeFile);
    const promptSections = GPTViz.getPromptSectionsFromText(markdownContent);

    if (promptSections.length > 0) {
        const promptParts = GPTViz.getPromptParts(promptSections[0]);
        candidateBinary = GPTViz.embedPromptInPng(
            keptBinary,
            promptParts.text
        );
        await app.vault.modifyBinary(
            keptFile,
            candidateBinary,
            keptTimestamps
        );
    }

    await app.vault.createFolder("candidates").catch(() => {});

    const number = candidates.length > 0
        ? candidates[candidates.length - 1].number + 1
        : 1;
    const path = `candidates/${activeFile.basename}-${number}.png`;

    try {
        await app.vault.createBinary(
            path,
            candidateBinary,
            keptTimestamps
        );
    } catch (error) {
        const refreshedCandidates = GPTViz.getImageCandidates(
            app,
            activeFile
        );

        for (const candidate of refreshedCandidates) {
            const refreshedCandidateBinary = await app.vault.readBinary(candidate.file);

            if (GPTViz.binaryEqual(candidateBinary, refreshedCandidateBinary)) {
                return refreshedCandidates;
            }
        }

        throw error;
    }

    return GPTViz.getImageCandidates(app, activeFile);
};

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
        this.markdownReviewActions = new WeakSet();
        this.markdownReviewActionClass = "gptviz-review-images-action";
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
                this.addMarkdownReviewActions();

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
                    this.addMarkdownReviewActions();
                    this.refreshCandidateViews().catch(error => {
                        this.reportError("refreshing Candidate View after activating a Markdown file", error);
                    });
                }
                this.setCandidateViewActive(
                    this.isCandidateView(leaf && leaf.view)
                );
            })
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", () => {
                this.addMarkdownReviewActions();
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

        this.addMarkdownReviewActions();


        this.addSettingTab(
            new GPTViz.SettingTab(this.app, this)
        );

        this.addCommand({
            id: "gpt-check-dependencies",
            name: "GPTViz Check Dependencies",
            callback: async () => await this.checkDependencies()
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
            this.rebuildCandidateViewAfterReload().catch(error => {
            this.reportError("recovering Candidate View after plugin reload", error);
            });
        });
    }

    debug() {}

    async appendLog(text) {
        const path = "gptviz.log";
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

    reportError(context, error) {
        const detail = error instanceof Error
            ? error.stack || error.message
            : String(error);
        const message = `GPTViz ${context} failed: ${detail}`;
        console.error(message, error);
        this.appendLog(
            `ERROR [${new Date().toISOString()}] ${context}\n${detail}\n\n`
        ).catch(logError => {
            console.error("GPTViz could not write gptviz.log", logError);
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

    onunload() {
        this.removeMarkdownReviewActions();
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
        }).catch(() => {});
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
        }).catch(() => {});
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

    getCurrentPromptForFile(file) {
        const editor = this.getMarkdownEditor(file);
        if (!editor) {
            return null;
        }

        const section = GPTViz.getPromptSection(editor);
        return section ? GPTViz.getPromptParts(section).text : null;
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

    removeMarkdownReviewActions() {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;

            if (!(view instanceof GPTViz.obsidian.MarkdownView)) {
                continue;
            }

            view.containerEl
                .querySelectorAll(`.${this.markdownReviewActionClass}`)
                .forEach(action => action.remove());

            view.containerEl
                .querySelectorAll('[aria-label="Review images"], [title="Review images"], [aria-label="GPTViz Candidate View"], [title="GPTViz Candidate View"]')
                .forEach(action => action.remove());
        }
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


    markdownFileHasKeptImage(file) {
        if (!file || file.extension !== "md") {
            return false;
        }

        const keptFile = this.app.vault.getAbstractFileByPath(
            `${file.basename}.png`
        );

        return Boolean(keptFile && keptFile.extension === "png");
    }

    markdownFileHasAnyCandidate(file) {
        if (!file || file.extension !== "md") {
            return false;
        }

        const prefix = `${file.basename}-`;

        for (const vaultFile of this.app.vault.getFiles()) {
            if (
                vaultFile.path.startsWith("candidates/") &&
                vaultFile.extension === "png" &&
                vaultFile.name.startsWith(prefix)
            ) {
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

    setMarkdownReviewActionEnabled(actionEl, enabled) {
        if (!actionEl) {
            return;
        }

        if (enabled) {
            actionEl.classList.remove("is-disabled");
            actionEl.removeAttribute("aria-disabled");
            actionEl.style.pointerEvents = "";
            actionEl.style.opacity = "";
            return;
        }

        actionEl.classList.add("is-disabled");
        actionEl.setAttribute("aria-disabled", "true");
        actionEl.style.pointerEvents = "none";
        actionEl.style.opacity = "0.45";
    }

    scheduleMarkdownReviewActionStateRefresh() {
        if (this.markdownReviewActionRefreshTimer) {
            window.clearTimeout(this.markdownReviewActionRefreshTimer);
        }

        this.markdownReviewActionRefreshTimer = window.setTimeout(() => {
            this.markdownReviewActionRefreshTimer = null;
            this.updateMarkdownReviewActionStates();
        }, 200);
    }

    updateMarkdownReviewActionStates() {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;

            if (
                !(view instanceof GPTViz.obsidian.MarkdownView) ||
                !view.file
            ) {
                continue;
            }

            const reviewEnabled = this.markdownFileCanOpenCandidateView(view.file);
            const reviewActions = view.containerEl.querySelectorAll(
                `.${this.markdownReviewActionClass}`
            );
            reviewActions.forEach(action => {
                this.setMarkdownReviewActionEnabled(action, reviewEnabled);
            });


        }
    }

    enforceMarkdownActionOrder(view) {
        if (!view || !view.containerEl) {
            return;
        }

        const actionsEl = view.containerEl.querySelector(".view-actions");
        if (!actionsEl) {
            return;
        }

        const reviewActionEl = actionsEl.querySelector(
            `.${this.markdownReviewActionClass}`
        );

        if (!reviewActionEl) {
            return;
        }

        const systemToggler = actionsEl.querySelector(
            '.view-action.mod-source-view, .view-action[aria-label*="Source mode"], .view-action[aria-label*="Live Preview"], .view-action[aria-label*="Reading view"], .view-action[aria-label*="Edit mode"]'
        );
        const optionsActionEl = actionsEl.querySelector(
            '.view-action.mod-options, .view-action[aria-label*="More options"], .view-action[aria-label*="Options"]'
        );

        if (systemToggler) {
            actionsEl.insertBefore(reviewActionEl, systemToggler.nextSibling);
        } else {
            actionsEl.appendChild(reviewActionEl);
        }

        if (optionsActionEl) {
            actionsEl.appendChild(optionsActionEl);
        }
    }

    addMarkdownReviewActions() {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;

            if (
                !(view instanceof GPTViz.obsidian.MarkdownView) ||
                !view.file
            ) {
                continue;
            }

            const existingActions = view.containerEl.querySelectorAll(
                `.${this.markdownReviewActionClass}, [aria-label="Review images"], [title="Review images"], [aria-label="GPTViz Candidate View"], [title="GPTViz Candidate View"]`
            );
            existingActions.forEach(action => action.remove());

            if (typeof view.addAction !== "function") {
                continue;
            }

            const reviewActionEl = view.addAction(
                "image",
                "GPTViz Candidate View",
                async () => {
                    if (!this.markdownFileCanOpenCandidateView(view.file)) {
                        return;
                    }

                    try {
                        await this.openCandidateView(null, leaf);
                    } catch (error) {
                        this.reportError(
                            "handling the Markdown image action",
                            error
                        );
                    }
                }
            );

            if (reviewActionEl) {
                reviewActionEl.classList.add(this.markdownReviewActionClass);
                reviewActionEl.setAttribute("aria-label", "GPTViz Candidate View");
                reviewActionEl.setAttribute("title", "GPTViz Candidate View");
                this.setMarkdownReviewActionEnabled(
                    reviewActionEl,
                    this.markdownFileCanOpenCandidateView(view.file)
                );
            }

            this.enforceMarkdownActionOrder(view);
        }
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
        let candidateLeaves = workspace.getLeavesOfType(
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

        if (candidateLeaves.length === 0 && !rememberedPath) {
            this.debug("reload recovery: no existing candidate leaf and no remembered candidate.");
            return;
        }

        if (candidateLeaves.length === 0) {
            this.debug(
                `reload recovery: no existing candidate leaf; creating one for ${rememberedPath}.`
            );
        }

        const wasActive = candidateLeaves.some(
            leaf => workspace.activeLeaf === leaf
        );
        this.debug(`reload recovery: wasActive=${wasActive}, rememberedPath=${rememberedPath || "<none>"}`);

        for (const leaf of candidateLeaves) {
            leaf.detach();
        }
        if (candidateLeaves.length > 0) {
            this.debug("reload recovery: old candidate leaf detached.");
        }

        const leaf = workspace.getLeaf("tab");
        await leaf.setViewState({
            type: GPTViz.CANDIDATE_VIEW_TYPE,
            active: wasActive || candidateLeaves.length === 0
        });
        this.debug(
            `reload recovery: new leaf viewType=${typeof leaf.view?.getViewType === "function" ? leaf.view.getViewType() : "<none>"}, ` +
            `constructor=${leaf.view?.constructor?.name || "<none>"}, ` +
            `hasRefresh=${typeof leaf.view?.refresh === "function"}`
        );

        if (wasActive || candidateLeaves.length === 0) {
            await workspace.revealLeaf(leaf);
            this.setCandidateViewActive(true);
            this.debug("reload recovery: new leaf revealed.");
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
            this.debug("reload recovery: new leaf is not refreshable.");
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
            const needsRefresh = Boolean(preferredPath) ||
                !leaf.view.activeFile ||
                leaf.view.activeFile.path !== targetPath;

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
            const sourceBinary = await this.app.vault.readBinary(candidate.file);
            const selectedCandidatePrompt = GPTViz.extractPromptFromPng(sourceBinary);
            const promptParts = GPTViz.getPromptPartsFromText(executionPrompt);
            const imageNames = promptParts.imageNames.length > 0
                ? promptParts.imageNames
                : [candidate.file.path];
            const loadedImages = await GPTViz.loadPromptImages(
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

            const sourcePrompt = loadedImages.sourcePrompts.find(
                item => item.prompt !== null && item.prompt.trim() !== ""
            );
            const originalPrompt = sourcePrompt
                ? sourcePrompt.prompt
                : selectedCandidatePrompt;

            if (originalPrompt === null || originalPrompt.trim() === "") {
                new GPTViz.obsidian.Notice(
                    `GPTViz: no original prompt found in source image for ${candidate.file.name}.`
                );
                return;
            }

            const existingCandidates = GPTViz.getImageCandidates(
                this.app,
                activeFile
            );
            const predictedNumber = existingCandidates.length > 0
                ? existingCandidates[existingCandidates.length - 1].number + 1
                : 1;
            const predictedCandidateName =
                `${activeFile.basename}-${predictedNumber}.png`;

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

            await this.app.vault.createFolder("candidates").catch(() => {});

            const candidates = GPTViz.getImageCandidates(
                this.app,
                activeFile
            );
            const number = candidates.length > 0
                ? candidates[candidates.length - 1].number + 1
                : 1;
            const candidatePath =
                `candidates/${activeFile.basename}-${number}.png`;
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

        const baseName = activeFile.basename;
        const candidates = GPTViz.getImageCandidates(
            this.app,
            activeFile
        );
        const number = candidates.length > 0
            ? candidates[candidates.length - 1].number + 1
            : 1;
        const candidateName = `${baseName}-${number}.png`;

        let progressOwner = progressView || this.getCandidateView();
        let cancelled = false;
        let generationStartedAt = 0;

        try {
            const promptParts = GPTViz.getPromptParts(section);
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

            await this.app.vault.createFolder("candidates").catch(() => {});

            const saveCandidates = GPTViz.getImageCandidates(
                this.app,
                activeFile
            );
            const saveNumber = saveCandidates.length > 0
                ? saveCandidates[saveCandidates.length - 1].number + 1
                : 1;
            const candidatePath = `candidates/${activeFile.basename}-${saveNumber}.png`;
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
            await this.app.vault.createFolder(current).catch(() => {});
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

                const response = await GPTViz.generateOpenAIImageResponseDetailed(
                    apiKey,
                    block.prompt,
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

                await this.ensureParentFolders(block.asset);
                await this.writeBinaryOverwrite(block.asset, outputPng);
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
                    block.prompt
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
            const sidecarPath = `${activeFile.basename}.marks.json`;
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

