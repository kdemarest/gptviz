var GPTViz = GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");
GPTViz.CANDIDATE_VIEW_TYPE = "gptviz-candidates";

GPTViz.CandidateView = class extends GPTViz.obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.candidates = [];
        this.index = 0;
        this.imageUrl = null;
        this.refreshQueue = Promise.resolve();
    }

    getViewType() {
        return GPTViz.CANDIDATE_VIEW_TYPE;
    }

    getDisplayText() {
        return "GPTViz Candidates";
    }

    showProgressOverlay(onCancel, estimatedDurationMs, candidateName) {
        this.hideProgressOverlay();
        this.containerEl.style.position = "relative";

        const overlay = this.containerEl.createEl("div");
        overlay.style.position = "absolute";
        overlay.style.inset = "0";
        overlay.style.zIndex = "1000";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.pointerEvents = "none";

        const style = overlay.createEl("style");
        style.textContent = `
            @keyframes gptviz-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;

        const box = overlay.createEl("div");
        box.style.minWidth = "14em";
        box.style.maxWidth = "min(24em, calc(100vw - 2em))";
        box.style.padding = "1em";
        box.style.border = "1px solid var(--background-modifier-border)";
        box.style.borderRadius = "var(--radius-m)";
        box.style.backgroundColor = "var(--background-primary)";
        box.style.boxShadow = "var(--shadow-s)";
        box.style.pointerEvents = "auto";
        box.style.cursor = "grab";
        box.style.touchAction = "none";

        let dragPointerId = null;
        let dragStartX = 0;
        let dragStartY = 0;

        const stopDragging = event => {
            event.stopPropagation();
            if (dragPointerId !== event.pointerId) {
                return;
            }

            dragPointerId = null;
            box.style.cursor = "grab";
            if (box.hasPointerCapture(event.pointerId)) {
                box.releasePointerCapture(event.pointerId);
            }
        };

        box.addEventListener("pointerdown", event => {
            event.stopPropagation();
            if (event.target.closest("button")) {
                return;
            }

            dragPointerId = event.pointerId;
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            box.style.cursor = "grabbing";
            box.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        box.addEventListener("pointermove", event => {
            event.stopPropagation();
            if (dragPointerId !== event.pointerId) {
                return;
            }

            const offsetX = event.clientX - dragStartX;
            const offsetY = event.clientY - dragStartY;
            box.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        });

        box.addEventListener("pointerup", stopDragging);
        box.addEventListener("pointercancel", stopDragging);

        for (const eventType of [
            "touchstart",
            "touchmove",
            "touchend",
            "touchcancel"
        ]) {
            box.addEventListener(
                eventType,
                event => event.stopPropagation()
            );
        }

        const spinner = box.createEl("div");
        spinner.style.width = "2em";
        spinner.style.height = "2em";
        spinner.style.margin = "0 auto 1em";
        spinner.style.border = "0.3em solid var(--background-modifier-border)";
        spinner.style.borderTopColor = "var(--interactive-accent)";
        spinner.style.borderRadius = "50%";
        spinner.style.animation = "gptviz-spin 1s linear infinite";

        box.createEl("p", {
            text: candidateName
        });
        const progress = box.createEl("progress", {
            attr: { max: "100", value: "0" }
        });
        progress.style.width = "100%";
        progress.style.marginBottom = "1em";

        const progressText = box.createEl("p", {
            text: `Estimated time: ${Math.round(estimatedDurationMs / 1000)} seconds`
        });

        const startedAt = Date.now();
        const progressInterval = window.setInterval(() => {
            const elapsed = Date.now() - startedAt;
            const fraction = Math.min(
                elapsed / estimatedDurationMs,
                0.95
            );
            progress.value = fraction * 100;
            progressText.textContent =
                `Elapsed: ${Math.round(elapsed / 1000)} seconds`;
        }, 250);

        const cancelButton = box.createEl("button", {
            text: "Cancel"
        });
        cancelButton.style.pointerEvents = "auto";
        cancelButton.addEventListener("click", onCancel);

        this.progressOverlay = overlay;
        this.progressInterval = progressInterval;
    }

    hideProgressOverlay() {
        if (this.progressInterval) {
            window.clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        if (this.progressOverlay) {
            this.progressOverlay.remove();
            this.progressOverlay = null;
        }
    }

    onOpen() {
        this.plugin.setCandidateViewActive(true);
    }

    async togglePolishInput() {
        if (this.polishOverlay) {
            const isHidden = this.polishOverlay.style.display === "none";
            this.polishOverlay.style.display = isHidden ? "flex" : "none";
            if (isHidden && this.polishTextarea) {
                window.setTimeout(() => this.polishTextarea.focus(), 0);
            }
            return;
        }

        const cacheKey = this.activeFile.basename;
        let initialText = this.plugin.polishPromptCache[cacheKey] || "";
        if (initialText.trim() === "") {
            const polishFile = this.app.vault.getAbstractFileByPath(
                "_polish.md"
            );

            if (polishFile && polishFile.extension === "md") {
                initialText = await this.app.vault.cachedRead(polishFile);
                this.plugin.polishPromptCache[cacheKey] = initialText;
            }
        }

        const overlay = this.contentEl.createEl("div");
        overlay.style.position = "absolute";
        overlay.style.inset = "0";
        overlay.style.zIndex = "1000";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.padding = "1em";
        overlay.style.boxSizing = "border-box";
        overlay.style.backgroundColor = "var(--background-primary)";
        overlay.style.overflowY = "auto";

        overlay.createEl("h2", {
            text: "Polish image"
        });
        overlay.createEl("p", {
            text: "Enter the image prompt to send to the ChatGPT image API."
        });

        const textarea = overlay.createEl("textarea");
        textarea.value = initialText;
        textarea.rows = 12;
        textarea.style.width = "100%";
        textarea.style.flex = "1";
        textarea.style.minHeight = "12em";
        textarea.style.resize = "vertical";
        textarea.setAttribute("aria-label", "Image prompt");

        const buttons = overlay.createEl("div");
        buttons.style.display = "flex";
        buttons.style.justifyContent = "flex-end";
        buttons.style.marginTop = "1em";
        buttons.style.flexShrink = "0";

        const runButton = buttons.createEl("button", {
            text: "Run"
        });
        runButton.classList.add("mod-cta");
        runButton.addEventListener("click", async () => {
            const promptText = textarea.value;
            this.hidePolishInput();

            try {
                await this.plugin.polishActiveMarkdown(
                    this.activeFile,
                    this,
                    promptText
                );
            } catch (error) {
                this.plugin.reportError("polishing the current image", error);
            }
        });

        this.polishOverlay = overlay;
        this.polishTextarea = textarea;
        this.polishButton.style.position = "relative";
        this.polishButton.style.zIndex = "1001";
        window.setTimeout(() => textarea.focus(), 0);
    }

    hidePolishInput() {
        if (this.polishOverlay) {
            this.polishOverlay.style.display = "none";
        }
    }

    createGenerateButton(parent) {
        const button = parent.createEl("button", {
            text: "Generate"
        });
        button.addEventListener("click", async () => {
            try {
                await this.plugin.generateActiveMarkdown(this.activeFile, this);
            } catch (error) {
                this.plugin.reportError("generating an image from Candidate View", error);
            }
        });
        return button;
    }

    refresh(preferredPath) {
        this.refreshQueue = this.refreshQueue.then(
            () => this.refreshNow(preferredPath),
            () => this.refreshNow(preferredPath)
        );
        return this.refreshQueue;
    }

    async refreshNow(preferredPath) {
        if (this.plugin.debug) {
            this.plugin.debug(`view refresh start; preferredPath=${preferredPath || "<none>"}`);
        }

        const contentEl = this.contentEl;
        this.polishOverlay = null;
        this.polishTextarea = null;
        contentEl.empty();
        contentEl.style.position = "relative";
        contentEl.style.display = "flex";
        contentEl.style.flexDirection = "column";
        contentEl.style.height = "100%";
        contentEl.style.overflowY = "auto";
        contentEl.style.paddingTop = "0";

        if (this.imageUrl) {
            URL.revokeObjectURL(this.imageUrl);
            this.imageUrl = null;
        }

        const activeFile = this.plugin.getCurrentMarkdownFile();
        this.activeFile = activeFile;

        if (this.plugin.debug) {
            this.plugin.debug(`view refresh file=${activeFile ? activeFile.path : "<none>"}`);
        }

        if (!activeFile) {
            this.createGenerateButton(contentEl);
            contentEl.createEl("p", {
                text: "Open a Markdown file to view candidates."
            });
            return;
        }

        this.candidates = await GPTViz.ensureKeptImageCandidate(
            this.app,
            activeFile
        );

        if (this.plugin.debug) {
            this.plugin.debug(`view refresh candidates=${this.candidates.length}`);
        }

        if (this.candidates.length === 0) {
            const titleRow = contentEl.createEl("div");
            titleRow.style.display = "flex";
            titleRow.style.alignItems = "center";
            titleRow.style.gap = "0.5em";
            titleRow.style.marginBottom = "0.5em";

            const markdownButton = titleRow.createEl("button", {
                text: "<"
            });
            markdownButton.style.minWidth = "3em";
            markdownButton.style.fontSize = "1.25em";
            markdownButton.style.fontWeight = "700";
            markdownButton.style.lineHeight = "1";
            markdownButton.addEventListener("click", async () => {
                try {
                    const markdownLeaf = this.app.workspace
                        .getLeavesOfType("markdown")
                        .find(leaf => leaf.view.file?.path === this.activeFile.path);

                    if (markdownLeaf) {
                        await this.app.workspace.revealLeaf(markdownLeaf);
                    } else {
                        await this.app.workspace.getLeaf(true).openFile(
                            this.activeFile
                        );
                    }
                } catch (error) {
                    this.plugin.reportError("returning to the Markdown note", error);
                }
            });

            contentEl.createEl("div", {
                text: `No candidates for ${activeFile.name}.`
            });
            this.createGenerateButton(contentEl);
            return;
        }

        const rememberedPath =
            this.plugin.getLastCandidatePath(activeFile.path);

        this.index = this.candidates.length - 1;
        const selectedPath = preferredPath || rememberedPath;
        if (selectedPath) {
            const preferredIndex = this.candidates.findIndex(
                candidate => candidate.file.path === selectedPath
            );

            if (preferredIndex !== -1) {
                this.index = preferredIndex;
            }
        }
        const titleRow = contentEl.createEl("div");
        titleRow.style.display = "flex";
        titleRow.style.alignItems = "center";
        titleRow.style.gap = "0.5em";
        titleRow.style.marginBottom = "0.5em";

        const markdownButton = titleRow.createEl("button", {
            text: "<"
        });
        markdownButton.style.minWidth = "3em";
        markdownButton.style.fontSize = "1.25em";
        markdownButton.style.fontWeight = "700";
        markdownButton.style.lineHeight = "1";
        markdownButton.addEventListener("click", async () => {
            try {
                const markdownLeaf = this.app.workspace
                    .getLeavesOfType("markdown")
                    .find(leaf => leaf.view.file?.path === this.activeFile.path);

                if (markdownLeaf) {
                    await this.app.workspace.revealLeaf(markdownLeaf);
                } else {
                    await this.app.workspace.getLeaf(true).openFile(
                        this.activeFile
                    );
                }
            } catch (error) {
                this.plugin.reportError("returning to the Markdown note", error);
            }
        });

        this.candidateTitleEl = titleRow.createEl("h3");
        this.candidateTitleEl.style.margin = "0";
        titleRow.style.position = "relative";
        titleRow.style.zIndex = "1001";
        titleRow.style.width = "100%";
        const titleSpacer = titleRow.createEl("div");
        titleSpacer.style.flex = "1";
        this.polishButton = titleRow.createEl("button", {
            text: "Polish"
        });
        this.polishButton.style.display = "none";
        this.polishButton.addEventListener("click", async () => {
            try {
                await this.togglePolishInput();
            } catch (error) {
                this.plugin.reportError("opening the Polish input", error);
            }
        });
        const imageContainer = contentEl.createEl("div");
        imageContainer.style.flex = "1";
        imageContainer.style.minHeight = "0";
        imageContainer.style.display = "flex";
        imageContainer.style.alignItems = "center";
        imageContainer.style.justifyContent = "center";

        this.imageEl = imageContainer.createEl("img", {
            attr: {
                alt: "Generated image"
            }
        });
        this.imageEl.style.maxWidth = "100%";
        this.imageEl.style.maxHeight = "100%";
        this.imageEl.style.objectFit = "contain";
        this.imageEl.style.touchAction = "none";
        this.imageEl.style.transformOrigin = "center center";

        let zoomScale = 1;
        let imageOffsetX = 0;
        let imageOffsetY = 0;
        let pinchStartDistance = null;
        let pinchStartScale = 1;
        let panPointerId = null;
        let panStartX = 0;
        let panStartY = 0;
        let panStartOffsetX = 0;
        let panStartOffsetY = 0;
        const pointers = new Map();
        const getPointerDistance = () => {
            const activePointers = [...pointers.values()];
            if (activePointers.length < 2) {
                return null;
            }

            const first = activePointers[0];
            const second = activePointers[1];
            return Math.hypot(
                second.clientX - first.clientX,
                second.clientY - first.clientY
            );
        };
        const clampOffset = (offset, size, scale) => {
            const maximum = Math.max(0, size * (scale - 1) / 2);
            return Math.max(-maximum, Math.min(maximum, offset));
        };
        const applyTransform = () => {
            imageOffsetX = clampOffset(
                imageOffsetX,
                this.imageEl.offsetWidth,
                zoomScale
            );
            imageOffsetY = clampOffset(
                imageOffsetY,
                this.imageEl.offsetHeight,
                zoomScale
            );
            this.imageEl.style.transform =
                `translate(${imageOffsetX}px, ${imageOffsetY}px) scale(${zoomScale})`;
        };
        const applyZoom = scale => {
            zoomScale = Math.max(1, scale);
            applyTransform();
        };

        this.imageEl.addEventListener("pointerdown", event => {
            pointers.set(event.pointerId, event);
            this.imageEl.setPointerCapture(event.pointerId);

            if (pointers.size === 2) {
                panPointerId = null;
                pinchStartDistance = getPointerDistance();
                pinchStartScale = zoomScale;
            } else if (zoomScale > 1) {
                panPointerId = event.pointerId;
                panStartX = event.clientX;
                panStartY = event.clientY;
                panStartOffsetX = imageOffsetX;
                panStartOffsetY = imageOffsetY;
            }

            event.preventDefault();
            event.stopPropagation();
        });

        this.imageEl.addEventListener("pointermove", event => {
            event.stopPropagation();
            if (!pointers.has(event.pointerId)) {
                return;
            }

            pointers.set(event.pointerId, event);
            if (pointers.size === 2 && pinchStartDistance) {
                const currentDistance = getPointerDistance();
                applyZoom(
                    pinchStartScale * currentDistance / pinchStartDistance
                );
                event.preventDefault();
            } else if (
                pointers.size === 1 &&
                panPointerId === event.pointerId &&
                zoomScale > 1
            ) {
                imageOffsetX = panStartOffsetX + event.clientX - panStartX;
                imageOffsetY = panStartOffsetY + event.clientY - panStartY;
                applyTransform();
                event.preventDefault();
            }
        });

        const stopTouch = event => {
            event.stopPropagation();
            pointers.delete(event.pointerId);
            if (this.imageEl.hasPointerCapture(event.pointerId)) {
                this.imageEl.releasePointerCapture(event.pointerId);
            }

            if (pointers.size < 2) {
                pinchStartDistance = null;
            }

            if (pointers.size === 1 && zoomScale > 1) {
                const remainingPointer = [...pointers.entries()][0];
                panPointerId = remainingPointer[0];
                panStartX = remainingPointer[1].clientX;
                panStartY = remainingPointer[1].clientY;
                panStartOffsetX = imageOffsetX;
                panStartOffsetY = imageOffsetY;
            } else if (pointers.size === 0) {
                panPointerId = null;
            }
        };

        this.imageEl.addEventListener("pointerup", stopTouch);
        this.imageEl.addEventListener("pointercancel", stopTouch);

        for (const eventType of [
            "touchstart",
            "touchmove",
            "touchend",
            "touchcancel"
        ]) {
            this.imageEl.addEventListener(
                eventType,
                event => event.stopPropagation()
            );
        }

        const controls = contentEl.createEl("div");
        controls.style.display = "flex";
        controls.style.justifyContent = "space-between";
        controls.style.alignItems = "center";
        controls.style.gap = "0.5em";
        controls.style.marginTop = "1em";
        controls.style.flexShrink = "0";

        const navigation = controls.createEl("div");
        navigation.style.display = "flex";
        navigation.style.gap = "0.5em";

        this.prevButton = navigation.createEl("button", {
            text: "Prev"
        });
        this.nextButton = navigation.createEl("button", {
            text: "Next"
        });
        this.keepButton = navigation.createEl("button", {
            text: "Keep"
        });
        this.generateButton = this.createGenerateButton(controls);

        this.prevButton.addEventListener("click", async () => {
            try {
                if (this.index > 0) {
                    this.index -= 1;
                    await this.renderCurrentImage();
                }
            } catch (error) {
                this.plugin.reportError("moving to the previous candidate image", error);
            }
        });

        this.nextButton.addEventListener("click", async () => {
            try {
                if (this.index < this.candidates.length - 1) {
                    this.index += 1;
                    await this.renderCurrentImage();
                }
            } catch (error) {
                this.plugin.reportError("moving to the next candidate image", error);
            }
        });

        this.keepButton.addEventListener("click", async () => {
            try {
                await this.keepCurrentImage();
            } catch (error) {
                this.plugin.reportError("keeping the current candidate image", error);
            }
        });

        await this.renderCurrentImage();

        if (this.plugin.debug) {
            this.plugin.debug(`view refresh rendered index=${this.index}, path=${this.candidates[this.index].file.path}`);
        }
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

        this.plugin.rememberCandidate(
            this.activeFile.path,
            candidate.file.path
        );

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
        this.keepButton.style.color = isKept
            ? "var(--color-green)"
            : "";
        this.polishButton.style.display = "";
        this.polishButton.disabled = false;
        this.candidateTitleEl.textContent = isKept
            ? `✓ ${candidate.displayName || candidate.file.name}`
            : candidate.displayName || candidate.file.name;
        this.candidateTitleEl.style.color = isKept
            ? "var(--color-green)"
            : "";
    }

    async keepCurrentImage() {
        if (this.keepButton.disabled) {
            return;
        }

        this.keepButton.disabled = true;
        const candidate = this.candidates[this.index];
        let binary = await this.app.vault.readBinary(candidate.file);
        const candidateTimestamps = GPTViz.fileTimestampOptions(candidate.file);
        let savedPrompt = GPTViz.extractPromptFromPng(binary);
        const currentPrompt = this.plugin.getCurrentPromptForFile(
            this.activeFile
        );

        if (
            currentPrompt !== null &&
            currentPrompt.trim() !== "" &&
            (savedPrompt === null || savedPrompt.trim() === "")
        ) {
            binary = GPTViz.embedPromptInPng(binary, currentPrompt);
            await this.app.vault.modifyBinary(
                candidate.file,
                binary,
                candidateTimestamps
            );
            savedPrompt = currentPrompt;
        }

        if (
            savedPrompt !== null &&
            currentPrompt !== null &&
            savedPrompt !== currentPrompt
        ) {
            const choice = await GPTViz.confirmPromptAlignment(this.app);

            if (choice === "Cancel") {
                this.keepButton.disabled = false;
                return;
            }

            if (choice === "Yes") {
                await this.plugin.alignMarkdownPrompt(
                    this.activeFile,
                    savedPrompt
                );
            }
        }

        const path = `${this.activeFile.basename}.png`;
        const keptFile = this.app.vault.getAbstractFileByPath(path);

        if (keptFile) {
            await this.app.vault.modifyBinary(
                keptFile,
                binary,
                candidateTimestamps
            );
        } else {
            await this.app.vault.createBinary(
                path,
                binary,
                candidateTimestamps
            );
        }

        await this.renderCurrentImage();
        new GPTViz.obsidian.Notice(
            `GPTViz: kept ${path}`
        );
    }

    async onClose() {
        this.hideProgressOverlay();
        this.plugin.setCandidateViewActive(false);

        if (this.imageUrl) {
            URL.revokeObjectURL(this.imageUrl);
            this.imageUrl = null;
        }
        this.contentEl.empty();
        this.polishOverlay = null;
        this.polishTextarea = null;

    }
};