unit("candidate-view", [], () => {
globalThis.GPTViz = globalThis.GPTViz || {};

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
        this.markPoints = [];
        this.hasMarkBlocks = false;
        this.hasExtractBlocks = false;
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
        this.syncModeRibbon();
    }

    syncModeRibbon() {
        this.plugin.syncModeRibbonForView(this);
    }

    async returnToNote() {
        const activeFile = this.activeFile || this.plugin.getCurrentMarkdownFile();

        if (!activeFile) {
            throw new Error("No active Markdown file to return to.");
        }

        const preferredSection = this.plugin.getSelectedCandidateAssetSection(activeFile.path);

        const waitForViewReady = async () => {
            await new Promise(resolve => window.setTimeout(resolve, 100));
        };

        const scrollEditorToCursor = async leaf => {
            const editor = leaf && leaf.view ? leaf.view.editor : null;
            if (!editor) {
                return;
            }

            const cursor = editor.getCursor();
            const currentLine = Number(cursor.line);
            const hasValidCursor = Number.isFinite(currentLine);
            const currentCh = Number(cursor.ch);
            const sectionStart = preferredSection ? Number(preferredSection.startLine) : NaN;
            const sectionEnd = preferredSection ? Number(preferredSection.endLine) : NaN;
            const hasSection = Number.isFinite(sectionStart);

            let targetCursor = null;

            if (hasSection) {
                const inSection = hasValidCursor &&
                    currentLine >= sectionStart &&
                    (!Number.isFinite(sectionEnd) || currentLine < sectionEnd);

                if (!inSection) {
                    targetCursor = {
                        line: Math.max(0, sectionStart),
                        ch: 0
                    };
                }
            }

            if (!targetCursor && hasValidCursor) {
                targetCursor = {
                    line: currentLine,
                    ch: Number.isFinite(currentCh) ? currentCh : 0
                };
            }

            if (!targetCursor) {
                return;
            }

            try {
                editor.setCursor(targetCursor);
            } catch (error) {
                const detail = error instanceof Error
                    ? (error.stack || error.message)
                    : String(error);
                throw new Error(
                    "MarkdownMode cursor positioning failed: editor.setCursor threw for " +
                    `${activeFile.path} at line ${targetCursor.line}, ch ${targetCursor.ch}. ` +
                    `Reason: ${detail}`,
                    { cause: error }
                );
            }

            await new Promise(resolve => window.setTimeout(resolve, 50));

            const containerEl = leaf && leaf.view ? leaf.view.containerEl : null;
            const scrollerEl = containerEl
                ? containerEl.querySelector(".cm-scroller")
                : null;
            const activeLineEl = containerEl
                ? containerEl.querySelector(".cm-active .cm-line, .cm-line.cm-active, .cm-activeLine .cm-line, .cm-activeLine")
                : null;

            if (!scrollerEl || !activeLineEl) {
                return;
            }

            const scrollerRect = scrollerEl.getBoundingClientRect();
            const lineRect = activeLineEl.getBoundingClientRect();
            const computedLineHeight = Number.parseFloat(
                window.getComputedStyle(activeLineEl).lineHeight
            );
            const measuredLineHeight = lineRect.height;
            const lineHeight = Number.isFinite(computedLineHeight) && computedLineHeight > 0
                ? computedLineHeight
                : (Number.isFinite(measuredLineHeight) && measuredLineHeight > 0 ? measuredLineHeight : 20);
            const topPaddingLines = 4;
            const targetTop = scrollerRect.top + lineHeight * topPaddingLines;
            const delta = lineRect.top - targetTop;

            if (Number.isFinite(delta) && Math.abs(delta) > 1) {
                const nextScrollTop = Math.max(0, scrollerEl.scrollTop + delta);
                scrollerEl.scrollTop = nextScrollTop;
            }
        };

        const markdownLeaf = this.app.workspace
            .getLeavesOfType("markdown")
            .find(leaf => leaf.view.file?.path === activeFile.path);

        if (markdownLeaf) {
            await this.app.workspace.revealLeaf(markdownLeaf);
            await waitForViewReady();
            await scrollEditorToCursor(markdownLeaf);
            return;
        }

        const newLeaf = this.app.workspace.getLeaf(true);
        await newLeaf.openFile(activeFile);
        await waitForViewReady();
        await scrollEditorToCursor(newLeaf);
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
                GPTViz.contentPath("_polish.md")
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
        const button = parent.createEl("button");
        button.setAttribute("aria-label", "Generate image");
        button.setAttribute("title", "Generate image");
        GPTViz.obsidian.setIcon(button, "plus");
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
        this.markPoints = [];
        this.hasMarkBlocks = false;
        this.hasExtractBlocks = false;


        if (!activeFile) {
            this.createGenerateButton(contentEl);
            contentEl.createEl("p", {
                text: "Open a Markdown file to view candidates."
            });
            return;
        }

        this.hasMarkBlocks = await this.plugin.hasMarkBlocksForFile(activeFile);
        this.hasExtractBlocks = await this.plugin.hasExtractBlocksForFile(activeFile);

        this.assetPath = this.plugin.getActiveCandidateAssetPath(activeFile);
        try {
            this.candidates = await GPTViz.ensureKeptImageCandidate(
                this.app,
                activeFile,
                this.assetPath
            );
        } catch (error) {
            this.plugin.reportError("loading candidate images", error);
            contentEl.createEl("p", {
                text: "GPTViz: could not load candidate images. See the error dialog for details."
            });
            return;
        }


        if (this.candidates.length === 0) {
            const noCandidatesAssetPath = this.assetPath || `${activeFile.basename}.png`;
            const noCandidatesAssetName = noCandidatesAssetPath.split("/").pop() || `${activeFile.basename}.png`;
            const noCandidatesLabel = noCandidatesAssetName.replace(/\.[^./]+$/, "");
            contentEl.createEl("div", {
                text: `No candidates for ${noCandidatesLabel}.`
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

        this.candidateTitleEl = titleRow.createEl("h3");
        this.candidateTitleEl.style.margin = "0";
        titleRow.style.position = "relative";
        titleRow.style.zIndex = "1001";
        titleRow.style.width = "100%";
        const titleSpacer = titleRow.createEl("div");
        titleSpacer.style.flex = "1";
        this.polishButton = titleRow.createEl("button");
        this.polishButton.setAttribute("aria-label", "Polish image");
        this.polishButton.setAttribute("title", "Polish image");
        GPTViz.obsidian.setIcon(this.polishButton, "pencil");
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
        imageContainer.style.position = "relative";

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

        this.markLayerEl = imageContainer.createEl("div");
        this.markLayerEl.style.position = "absolute";
        this.markLayerEl.style.inset = "0";
        this.markLayerEl.style.pointerEvents = "none";
        this.markLayerEl.style.zIndex = "2";

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
            this.renderMarkDots();
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

        this.prevButton = navigation.createEl("button");
        this.prevButton.setAttribute("aria-label", "Previous image");
        this.prevButton.setAttribute("title", "Previous image");
        GPTViz.obsidian.setIcon(this.prevButton, "chevron-left");
        this.goKeptButton = navigation.createEl("button");
        this.goKeptButton.setAttribute("aria-label", "Go to kept image");
        this.goKeptButton.setAttribute("title", "Go to kept image");
        GPTViz.obsidian.setIcon(this.goKeptButton, "bookmark");
        this.nextButton = navigation.createEl("button");
        this.nextButton.setAttribute("aria-label", "Next image");
        this.nextButton.setAttribute("title", "Next image");
        GPTViz.obsidian.setIcon(this.nextButton, "chevron-right");
        this.keepButton = navigation.createEl("button", {
            text: "Keep"
        });
        this.markButton = navigation.createEl("button", {
            text: "Mark"
        });
        this.markButton.style.display = "none";
        this.extractButton = navigation.createEl("button", {
            text: "Extract"
        });
        this.extractButton.style.display = "none";
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

        this.goKeptButton.addEventListener("click", async () => {
            try {
                const keptIndex = await this.findKeptCandidateIndex();
                if (keptIndex === -1 || keptIndex === this.index) {
                    return;
                }

                this.index = keptIndex;
                await this.renderCurrentImage();
            } catch (error) {
                this.plugin.reportError("jumping to the kept candidate image", error);
            }
        });

        this.keepButton.addEventListener("click", async () => {
            try {
                await this.keepCurrentImage();
            } catch (error) {
                this.plugin.reportError("keeping the current candidate image", error);
            }
        });

        this.markButton.addEventListener("click", async () => {
            try {
                await this.plugin.markActiveMarkdown(this.activeFile, this);
            } catch (error) {
                this.plugin.reportError("marking target positions", error);
            }
        });

        this.extractButton.addEventListener("click", async () => {
            try {
                await this.plugin.extractActiveMarkdown(this.activeFile, this);
            } catch (error) {
                this.plugin.reportError("extracting image assets", error);
            }
        });

        await this.renderCurrentImage();


        this.syncModeRibbon();
    }

    async findKeptCandidateIndex() {
        const keptFile = this.app.vault.getAbstractFileByPath(
            GPTViz.contentPath(this.assetPath || `${this.activeFile.basename}.png`)
        );

        if (!keptFile || this.candidates.length === 0) {
            return -1;
        }

        const keptBinary = await this.app.vault.readBinary(keptFile);

        for (let index = 0; index < this.candidates.length; index++) {
            const candidateBinary = await this.app.vault.readBinary(this.candidates[index].file);
            if (GPTViz.binaryEqual(candidateBinary, keptBinary)) {
                return index;
            }
        }

        return -1;
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
        this.imageEl.onload = () => this.renderMarkDots();
        this.imageEl.src = this.imageUrl;

        this.prevButton.disabled = this.index === 0;
        this.nextButton.disabled =
            this.index === this.candidates.length - 1;

        this.plugin.rememberCandidate(
            this.activeFile.path,
            candidate.file.path
        );

        const keptFile = this.app.vault.getAbstractFileByPath(
            GPTViz.contentPath(this.assetPath || `${this.activeFile.basename}.png`)
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

        if (this.goKeptButton) {
            const keptIndex = await this.findKeptCandidateIndex();
            this.goKeptButton.disabled = keptIndex === -1 || keptIndex === this.index;
        }

        const showMarkButton = Boolean(isKept && this.hasMarkBlocks);
        this.markButton.style.display = showMarkButton ? "" : "none";
        this.markButton.disabled = !showMarkButton;

        const showExtractButton = Boolean(isKept && this.hasExtractBlocks);
        this.extractButton.style.display = showExtractButton ? "" : "none";
        this.extractButton.disabled = !showExtractButton;

        if (!showMarkButton) {
            this.markPoints = [];
            this.renderMarkDots();
        }

        if (showMarkButton) {
            const sidecarPath = GPTViz.contentPath(`${this.activeFile.basename}.marks.json`);
            this.markPoints = [];
            if (await this.app.vault.adapter.exists(sidecarPath)) {
                try {
                    const data = JSON.parse(await this.app.vault.adapter.read(sidecarPath));
                    if (!Array.isArray(data.marks)) {
                        throw new Error(`${sidecarPath} has no "marks" array.`);
                    }
                    this.markPoints = data.marks;
                } catch (error) {
                    this.plugin.reportError(`reading ${sidecarPath}`, error);
                }
            }
        }

        this.polishButton.style.display = "";
        this.polishButton.disabled = false;
        this.candidateTitleEl.textContent = isKept
            ? `✓ ${candidate.displayName || candidate.file.name}`
            : candidate.displayName || candidate.file.name;
        this.candidateTitleEl.style.color = isKept
            ? "var(--color-green)"
            : "";

        this.renderMarkDots();
    }

    async setMarks(marks) {
        this.markPoints = marks;
        this.renderMarkDots();
    }

    renderMarkDots() {
        if (!this.markLayerEl) {
            return;
        }

        this.markLayerEl.empty();

        if (this.markPoints.length === 0) {
            return;
        }

        const container = this.markLayerEl;
        const containerRect = container.getBoundingClientRect();
        const imageRect = this.imageEl
            ? this.imageEl.getBoundingClientRect()
            : null;

        if (
            !imageRect ||
            imageRect.width <= 0 ||
            imageRect.height <= 0 ||
            containerRect.width <= 0 ||
            containerRect.height <= 0
        ) {
            return;
        }

        const imageLeft = imageRect.left - containerRect.left;
        const imageTop = imageRect.top - containerRect.top;
        const imageWidth = imageRect.width;
        const imageHeight = imageRect.height;

        for (const mark of this.markPoints) {
            const x = Number(mark.x);
            const y = Number(mark.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }

            const dot = container.createEl("div");
            dot.style.position = "absolute";
            dot.style.left = `${imageLeft + x * imageWidth}px`;
            dot.style.top = `${imageTop + y * imageHeight}px`;
            dot.style.width = "22px";
            dot.style.height = "22px";
            dot.style.borderRadius = "50%";
            dot.style.transform = "translate(-50%, -50%)";
            dot.style.background = "rgba(255, 0, 255, 0.9)";
            dot.style.border = "2px solid white";
            dot.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.5)";

            const label = container.createEl("div", {
                text: String(mark.name || "")
            });
            label.style.position = "absolute";
            label.style.left = `${imageLeft + x * imageWidth + 14}px`;
            label.style.top = `${imageTop + y * imageHeight - 14}px`;
            label.style.padding = "2px 6px";
            label.style.fontSize = "12px";
            label.style.fontWeight = "700";
            label.style.background = "rgba(0,0,0,0.65)";
            label.style.color = "white";
            label.style.borderRadius = "8px";
        }
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
        const currentPrompt = await this.plugin.getCurrentPromptForFile(
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

        const path = GPTViz.contentPath(this.assetPath || `${this.activeFile.basename}.png`);
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
});
