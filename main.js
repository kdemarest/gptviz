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

            const dependencies = item.createEl("div");
            dependencies.createEl("strong", {
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
        const outputPath = `${markdownFile.basename}.png`;
        const outputFile = app.vault.getAbstractFileByPath(outputPath);

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

GPTViz.ResponseModal = class extends GPTViz.obsidian.Modal {
    constructor(app, text) {
        super(app);
        this.text = text;
    }

    onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();

        contentEl.createEl("h2", {
            text: "GPTViz response"
        });

        contentEl.createEl("pre", {
            text: this.text
        });

        const closeButton = contentEl.createEl("button", {
            text: "Close"
        });

        closeButton.addEventListener("click", () => {
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
};

GPTViz.ImageModal = class extends GPTViz.obsidian.Modal {
    constructor(app, candidates, index, activeFile) {
        super(app);
        this.candidates = candidates;
        this.index = index;
        this.activeFile = activeFile;
        this.imageUrl = null;
    }

    async onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();

        this.imageEl = contentEl.createEl("img", {
            attr: {
                alt: "Generated image"
            }
        });

        this.imageEl.style.maxWidth = "100%";
        this.imageEl.style.maxHeight = "70vh";
        this.imageEl.style.objectFit = "contain";

        const controls = contentEl.createEl("div");
        controls.style.display = "flex";
        controls.style.gap = "0.5em";
        controls.style.marginTop = "1em";

        this.prevButton = controls.createEl("button", {
            text: "Prev"
        });
        this.nextButton = controls.createEl("button", {
            text: "Next"
        });
        this.keepButton = controls.createEl("button", {
            text: "Keep"
        });

        this.prevButton.addEventListener("click", async () => {
            if (this.index > 0) {
                this.index -= 1;
                await this.renderCurrentImage();
            }
        });

        this.nextButton.addEventListener("click", async () => {
            if (this.index < this.candidates.length - 1) {
                this.index += 1;
                await this.renderCurrentImage();
            }
        });

        this.keepButton.addEventListener("click", async () => {
            await this.keepCurrentImage();
        });

        await this.renderCurrentImage();
    }

    async renderCurrentImage() {
        const candidate = this.candidates[this.index];
        const binary = await this.app.vault.readBinary(candidate.file);

        if (this.imageUrl) {
            URL.revokeObjectURL(this.imageUrl);
        }

        this.imageUrl = URL.createObjectURL(
            new Blob([binary], { type: "image/png" })
        );
        this.imageEl.src = this.imageUrl;

        this.prevButton.disabled = this.index === 0;
        this.nextButton.disabled =
            this.index === this.candidates.length - 1;

        const keptFile = this.app.vault.getAbstractFileByPath(
            `${this.activeFile.basename}.png`
        );
        let isKept = false;

        if (keptFile) {
            const keptBinary = await this.app.vault.readBinary(keptFile);
            isKept = GPTViz.binaryEqual(binary, keptBinary);
        }

        this.keepButton.disabled = isKept;
        this.keepButton.textContent = isKept ? "Kept" : "Keep";
        this.titleEl.textContent = isKept
            ? `✓ ${candidate.file.name}`
            : candidate.file.name;
        this.titleEl.style.color = isKept
            ? "var(--color-green)"
            : "";
    }

    async keepCurrentImage() {
        if (this.keepButton.disabled) {
            return;
        }

        this.keepButton.disabled = true;

        const candidate = this.candidates[this.index];
        const binary = await this.app.vault.readBinary(candidate.file);
        const path = `${this.activeFile.basename}.png`;
        const keptFile = this.app.vault.getAbstractFileByPath(path);

        if (keptFile) {
            await this.app.vault.modifyBinary(keptFile, binary);
        } else {
            await this.app.vault.createBinary(path, binary);
        }

        this.keepButton.textContent = "Kept";
        new GPTViz.obsidian.Notice(
            `GPTViz: kept ${path}`
        );
    }

    onClose() {
        if (this.imageUrl) {
            URL.revokeObjectURL(this.imageUrl);
        }
        this.contentEl.empty();
    }
};

GPTViz.LoadingModal = class extends GPTViz.obsidian.Modal {
    constructor(app, onCancel, estimatedDurationMs) {
        super(app);
        this.onCancel = onCancel;
        this.estimatedDurationMs = estimatedDurationMs;
    }

    onOpen() {
        const style = document.createElement("style");
        style.textContent = `
            @keyframes gptviz-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        this.styleEl = style;

        const contentEl = this.contentEl;
        contentEl.empty();
        this.startedAt = Date.now();

        const spinner = contentEl.createEl("div");
        spinner.style.width = "2em";
        spinner.style.height = "2em";
        spinner.style.margin = "1em auto";
        spinner.style.border = "0.3em solid var(--background-modifier-border)";
        spinner.style.borderTopColor = "var(--interactive-accent)";
        spinner.style.borderRadius = "50%";
        spinner.style.animation = "gptviz-spin 1s linear infinite";

        contentEl.createEl("p", {
            text: "Generating image..."
        });

        this.progress = contentEl.createEl("progress", {
            attr: {
                max: "100",
                value: "0"
            }
        });
        this.progress.style.width = "100%";
        this.progress.style.marginBottom = "1em";

        this.progressText = contentEl.createEl("p", {
            text: `Estimated time: ${Math.round(this.estimatedDurationMs / 1000)} seconds`
        });

        this.progressInterval = window.setInterval(() => {
            const elapsed = Date.now() - this.startedAt;
            const fraction = Math.min(
                elapsed / this.estimatedDurationMs,
                0.95
            );

            this.progress.value = fraction * 100;
            this.progressText.textContent =
                `Elapsed: ${Math.round(elapsed / 1000)} seconds`;
        }, 250);

        const cancelButton = contentEl.createEl("button", {
            text: "Cancel"
        });

        cancelButton.addEventListener("click", () => {
            this.onCancel();
        });
    }

    onClose() {
        if (this.progressInterval) {
            window.clearInterval(this.progressInterval);
        }
        if (this.styleEl) {
            this.styleEl.remove();
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
            const numberText = file.name.slice(
                prefix.length,
                -4
            );

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

GPTViz.openImageModal = async function(app, candidates, index, activeFile) {
    new GPTViz.ImageModal(
        app,
        candidates,
        index,
        activeFile
    ).open();
};

GPTViz.reviewLatestImage = async function(app, activeFile) {
    const candidates = GPTViz.getImageCandidates(
        app,
        activeFile
    );

    if (candidates.length === 0) {
        return false;
    }

    await GPTViz.openImageModal(
        app,
        candidates,
        candidates.length - 1,
        activeFile
    );

    return true;
};

GPTViz.Plugin = class extends GPTViz.obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        this.lastGenerationDurationMs = null;

        this.addSettingTab(
            new GPTViz.SettingTab(this.app, this)
        );

        this.addCommand({
            id: "gpt-connect",
            name: "gpt connect",

            callback: async () => {
                await this.connect();
            }
        });

        this.addCommand({
            id: "gpt-show-prompt",
            name: "gpt show prompt",

            editorCallback: editor => {
                this.showPrompt(editor);
            }
        });

        this.addCommand({
            id: "gpt-check-dependencies",
            name: "GPTViz Check Dependencies",

            callback: async () => {
                await this.checkDependencies();
            }
        });

        this.addCommand({
            id: "gpt-generate",
            name: "GPTViz Generate Image",

            editorCallback: async editor => {
                await this.generate(editor);
            }
        });

        this.addCommand({
            id: "gpt-review-images",
            name: "GPTViz Review Images",

            editorCallback: async () => {
                await this.reviewImages();
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            GPTViz.DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
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

            new GPTViz.obsidian.Notice(
                `GPTViz: ${result}`
            );

        } catch (error) {
            console.error("GPTViz connection error:", error);

            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            new GPTViz.obsidian.Notice(
                `GPTViz failed: ${message}`
            );
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
            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            new GPTViz.obsidian.Notice(
                `GPTViz dependency check failed: ${message}`
            );
        }
    }

    async generate(editor) {
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

        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile) {
            new GPTViz.obsidian.Notice(
                "GPTViz: no active Markdown file."
            );
            return;
        }

        let loadingModal = null;
        let cancelled = false;
        let generationStartedAt = 0;

        try {
            new GPTViz.obsidian.Notice(
                "GPTViz: generating response..."
            );

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
                this.lastGenerationDurationMs || 20000;

            loadingModal = new GPTViz.LoadingModal(
                this.app,
                () => {
                    cancelled = true;

                    if (loadingModal) {
                        loadingModal.close();
                        loadingModal = null;
                    }

                    new GPTViz.obsidian.Notice(
                        "GPTViz: generation cancelled."
                    );
                },
                estimatedDurationMs
            );
            loadingModal.open();

            const result =
                await GPTViz.generateOpenAIResponse(
                    apiKey,
                    promptParts.text,
                    imageInputs
                );

            if (cancelled) {
                return;
            }

            loadingModal.close();
            loadingModal = null;

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

            const baseName = activeFile.basename;
            const candidates = GPTViz.getImageCandidates(
                this.app,
                activeFile
            );
            const number = candidates.length > 0
                ? candidates[candidates.length - 1].number + 1
                : 1;
            const path = `candidates/${baseName}-${number}.png`;
            const binary = atob(result.imageBase64);
            const bytes = new Uint8Array(binary.length);

            for (let index = 0; index < binary.length; index++) {
                bytes[index] = binary.charCodeAt(index);
            }

            await this.app.vault.createBinary(
                path,
                bytes.buffer
            );

            await this.reviewImages();

            new GPTViz.obsidian.Notice(
                `GPTViz: wrote ${path}`
            );
        } catch (error) {
            if (loadingModal) {
                loadingModal.close();
            }

            if (cancelled) {
                return;
            }

            console.error("GPTViz generation error:", error);

            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            new GPTViz.obsidian.Notice(
                `GPTViz failed: ${message}`
            );
        }
    }

    async reviewImages() {
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile || activeFile.extension !== "md") {
            new GPTViz.obsidian.Notice(
                "GPTViz: no active Markdown file."
            );
            return;
        }

        const hasCandidates = await GPTViz.reviewLatestImage(
            this.app,
            activeFile
        );

        if (!hasCandidates) {
            new GPTViz.obsidian.Notice(
                "GPTViz: no image candidates found."
            );
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

        console.log(
            "GPTViz prompt:",
            section.text
        );

        const firstLine =
            section.text.split("\n")[0] || "# Prompt";

        new GPTViz.obsidian.Notice(
            `GPTViz: found "${firstLine}" (${section.text.length} characters)`
        );
    }
};

module.exports = GPTViz.Plugin;

