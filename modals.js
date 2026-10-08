globalThis.GPTViz = globalThis.GPTViz || {};

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

GPTViz.MovieScriptUsageModal = class extends GPTViz.obsidian.Modal {
    constructor(app, sourceFile, rows, onPick) {
        super(app);
        this.app = app;
        this.sourceFile = sourceFile;
        this.rows = Array.isArray(rows) ? rows : [];
        this.onPick = typeof onPick === "function" ? onPick : null;
    }

    onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();

        const sourceLabel = this.sourceFile && this.sourceFile.basename
            ? this.sourceFile.basename
            : "current note";
        this.titleEl.textContent = `MovieMode scripts using ${sourceLabel} assets`;

        if (this.rows.length === 0) {
            contentEl.createEl("p", {
                text: `No # Script dependencies reference assets from ${sourceLabel}.`
            });
            return;
        }

        const list = contentEl.createEl("div");
        list.style.maxHeight = "60vh";
        list.style.overflowY = "auto";

        for (const row of this.rows) {
            const item = list.createEl("div");
            item.style.display = "grid";
            item.style.gridTemplateColumns = "1fr";
            item.style.gap = "0.25em";
            item.style.padding = "0.6em 0";
            item.style.borderBottom = "1px solid var(--background-modifier-border)";

            const openButton = item.createEl("button", {
                text: row.name
            });
            openButton.style.textAlign = "left";
            openButton.addEventListener("click", async () => {
                try {
                    if (this.onPick) {
                        await this.onPick(row);
                    }
                } finally {
                    this.close();
                }
            });

            item.createEl("div", {
                text: row.path
            });
            if (Array.isArray(row.matches) && row.matches.length > 0) {
                item.createEl("div", {
                    text: `Depends: ${row.matches.join(", ")}`
                });
            }
        }
    }

    onClose() {
        this.contentEl.empty();
    }
};

GPTViz.MovieAssetUsageModal = class extends GPTViz.obsidian.Modal {
    constructor(app, sourceFile, rows, onPick) {
        super(app);
        this.app = app;
        this.sourceFile = sourceFile;
        this.rows = Array.isArray(rows) ? rows : [];
        this.onPick = typeof onPick === "function" ? onPick : null;
    }

    onOpen() {
        const contentEl = this.contentEl;
        contentEl.empty();

        const sourceLabel = this.sourceFile && this.sourceFile.basename
            ? this.sourceFile.basename
            : "current note";
        this.titleEl.textContent = `MovieMode assets in ${sourceLabel}`;

        if (this.rows.length === 0) {
            contentEl.createEl("p", {
                text: `No Prompt/Extract asset headings were found in ${sourceLabel}.`
            });
            return;
        }

        const list = contentEl.createEl("div");
        list.style.maxHeight = "60vh";
        list.style.overflowY = "auto";

        for (const row of this.rows) {
            const item = list.createEl("div");
            item.style.display = "grid";
            item.style.gridTemplateColumns = "1fr";
            item.style.gap = "0.25em";
            item.style.padding = "0.6em 0";
            item.style.borderBottom = "1px solid var(--background-modifier-border)";

            const openButton = item.createEl("button", {
                text: row.label
            });
            openButton.style.textAlign = "left";
            openButton.addEventListener("click", async () => {
                try {
                    if (this.onPick) {
                        await this.onPick(row);
                    }
                } finally {
                    this.close();
                }
            });

            item.createEl("div", {
                text: row.filePath
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
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

        const actions = contentEl.createEl("div");
        actions.style.display = "flex";
        actions.style.gap = "0.6em";
        actions.style.alignItems = "center";

        const copyButton = actions.createEl("button", {
            text: "Copy"
        });

        copyButton.addEventListener("click", async () => {
            const payload = [
                "GPTViz failure",
                `Operation: ${this.context}`,
                "",
                detail
            ].join("\n");

            let copied = false;

            try {
                if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                    await navigator.clipboard.writeText(payload);
                    copied = true;
                }
            } catch (error) {}

            if (!copied) {
                try {
                    const textarea = document.createElement("textarea");
                    textarea.value = payload;
                    textarea.style.position = "fixed";
                    textarea.style.left = "-9999px";
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    copied = document.execCommand("copy");
                    textarea.remove();
                } catch (error) {}
            }

            new GPTViz.obsidian.Notice(
                copied
                    ? "GPTViz: error copied to clipboard."
                    : "GPTViz: could not copy automatically."
            );
        });

        const clearButton = actions.createEl("button", {
            text: "Clear"
        });
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
