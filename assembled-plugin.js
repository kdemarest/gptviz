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
        if (this.plugin && typeof this.plugin.syncModeRibbonForView === "function") {
            this.plugin.syncModeRibbonForView(this, this.leaf || null);
        }
    }

    ensureReturnToNoteAction() {
        const existingActions = this.containerEl.querySelectorAll(
            ".gptviz-return-to-note-action, [aria-label=\"Return to note\"], [title=\"Return to note\"]"
        );
        existingActions.forEach(action => action.remove());

        const buttonEl = document.createElement("button");
        buttonEl.classList.add("clickable-icon");
        buttonEl.classList.add("gptviz-candidate-added-action");
        buttonEl.classList.add("gptviz-return-to-note-action");
        buttonEl.setAttribute("aria-label", "Return to note");
        buttonEl.setAttribute("title", "Return to note");
        buttonEl.setAttribute("type", "button");
        buttonEl.setAttribute("data-mode-button-key", "MarkdownMode");
        GPTViz.obsidian.setIcon(buttonEl, "file-text");
        buttonEl.addEventListener("click", async () => {
            try {
                await this.returnToNote();
            } catch (error) {
                this.plugin.reportError("returning to the Markdown note", error);
            }
        });

        this.addModeButton(0, buttonEl);
    }

    ensureMovieModeAction() {
        const existingActions = this.containerEl.querySelectorAll(
            ".gptviz-movie-mode-action, [aria-label=\"MovieMode\"], [title=\"MovieMode\"]"
        );
        existingActions.forEach(action => action.remove());

        const buttonEl = document.createElement("button");
        buttonEl.classList.add("clickable-icon");
        buttonEl.classList.add("gptviz-candidate-added-action");
        buttonEl.classList.add("gptviz-movie-mode-action");
        buttonEl.setAttribute("aria-label", "MovieMode");
        buttonEl.setAttribute("title", "MovieMode");
        buttonEl.setAttribute("type", "button");
        buttonEl.setAttribute("data-mode-button-key", "MovieMode");
        GPTViz.obsidian.setIcon(buttonEl, "film");
        buttonEl.addEventListener("click", async () => {
            try {
                await this.plugin.requestMovieMode({
                    source: "candidate-view",
                    filePath: this.activeFile?.path || null
                });
            } catch (error) {
                this.plugin.reportError("switching to MovieMode", error);
            }
        });

        this.addModeButton(3, buttonEl);
    }

    enforceCandidateActionOrder() {
        const actionsEl = this.containerEl.querySelector(".view-actions");
        if (!actionsEl) {
            return;
        }

        const returnActionEl = actionsEl.querySelector(
            ".gptviz-return-to-note-action"
        );
        if (!returnActionEl) {
            return;
        }

        const systemToggler = actionsEl.querySelector(
            '.view-action.mod-source-view, .view-action[aria-label*="Source mode"], .view-action[aria-label*="Live Preview"], .view-action[aria-label*="Reading view"], .view-action[aria-label*="Edit mode"]'
        );

        if (systemToggler) {
            actionsEl.insertBefore(returnActionEl, systemToggler.nextSibling);
            return;
        }

        const otherAddedAction = actionsEl.querySelector(
            ".gptviz-candidate-added-action:not(.gptviz-return-to-note-action)"
        );
        if (otherAddedAction) {
            actionsEl.insertBefore(returnActionEl, otherAddedAction);
        }
    }

    getModeRibbon() {
        const headerEl = this.containerEl.querySelector(".view-header");
        if (!headerEl) {
            return null;
        }

        let ribbon = headerEl.querySelector(".mode-ribbon");
        if (ribbon) {
            return ribbon;
        }

        ribbon = headerEl.createEl("div");
        ribbon.classList.add("mode-ribbon");
        ribbon.style.display = "inline-flex";
        ribbon.style.alignItems = "center";
        ribbon.style.gap = "0.25em";
        ribbon.style.marginInlineStart = "auto";

        const actionsEl = headerEl.querySelector(".view-actions");
        if (actionsEl) {
            headerEl.insertBefore(ribbon, actionsEl);
        } else {
            headerEl.appendChild(ribbon);
        }

        return ribbon;
    }

    addModeButton(position, buttonEl) {
        if (!Number.isInteger(position) || position < 0) {
            throw new Error("addModeButton requires a non-negative integer position.");
        }
        if (!(buttonEl instanceof HTMLElement)) {
            throw new Error("addModeButton requires buttonEl to be an HTMLElement.");
        }

        const ribbon = this.getModeRibbon();
        if (!ribbon) {
            return null;
        }

        const fallbackKey =
            buttonEl.getAttribute("aria-label") ||
            buttonEl.getAttribute("title") ||
            (buttonEl.textContent || "").trim();
        const buttonKey =
            buttonEl.getAttribute("data-mode-button-key") ||
            fallbackKey;

        if (buttonKey) {
            buttonEl.setAttribute("data-mode-button-key", buttonKey);
            const existingByKey = ribbon.querySelectorAll(
                `[data-mode-button-key="${CSS.escape(buttonKey)}"]`
            );
            existingByKey.forEach(existing => {
                if (existing !== buttonEl) {
                    existing.remove();
                }
            });
        }

        const existingAtPosition = ribbon.querySelector(
            `[data-mode-button-position="${position}"]`
        );
        if (existingAtPosition && existingAtPosition !== buttonEl) {
            existingAtPosition.remove();
        }

        buttonEl.setAttribute("data-mode-button-position", String(position));

        const orderedButtons = [...ribbon.children].filter(
            child => child !== buttonEl
        );
        const insertBefore = orderedButtons.find(child => {
            const childPos = Number(
                child.getAttribute("data-mode-button-position")
            );
            return Number.isFinite(childPos) && childPos > position;
        });

        if (insertBefore) {
            ribbon.insertBefore(buttonEl, insertBefore);
        } else {
            ribbon.appendChild(buttonEl);
        }

        return buttonEl;
    }

    ensureModeRibbonMoreActionsButton() {
        const actionsEl = this.containerEl.querySelector(".view-actions");
        const optionsActionEl = actionsEl
            ? actionsEl.querySelector(
                '.view-action.mod-options, .view-action[aria-label*="More options"], .view-action[aria-label*="Options"]'
            )
            : null;

        if (!optionsActionEl) {
            this.containerEl
                .querySelectorAll('.gptviz-mode-more-actions, [data-mode-button-key="MoreActions"]')
                .forEach(action => action.remove());
            return;
        }

        const buttonEl = document.createElement("button");
        buttonEl.classList.add("clickable-icon");
        buttonEl.classList.add("gptviz-mode-more-actions");
        buttonEl.setAttribute("aria-label", "More Actions");
        buttonEl.setAttribute("title", "More Actions");
        buttonEl.setAttribute("type", "button");
        buttonEl.setAttribute("data-mode-button-key", "MoreActions");
        GPTViz.obsidian.setIcon(buttonEl, "more-vertical");
        buttonEl.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();

            const liveActionsEl = this.containerEl.querySelector(".view-actions");
            const liveOptionsActionEl = liveActionsEl
                ? liveActionsEl.querySelector(
                    '.view-action.mod-options, .view-action[aria-label*="More options"], .view-action[aria-label*="Options"]'
                )
                : null;

            if (!liveOptionsActionEl) {
                return;
            }

            liveOptionsActionEl.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window
                })
            );
        });

        this.addModeButton(99, buttonEl);
    }

    async returnToNote() {
        const activeFile = this.activeFile || this.plugin.getCurrentMarkdownFile();

        if (!activeFile) {
            throw new Error("No active Markdown file to return to.");
        }

        const preferredSection = this.plugin && typeof this.plugin.getSelectedCandidateAssetSection === "function"
            ? this.plugin.getSelectedCandidateAssetSection(activeFile.path)
            : null;

        const waitForViewReady = async () => {
            await new Promise(resolve => window.setTimeout(resolve, 100));
        };

        const scrollEditorToCursor = async leaf => {
            const editor = leaf && leaf.view ? leaf.view.editor : null;
            if (!editor || typeof editor.getCursor !== "function") {
                return;
            }

            let cursor = null;
            try {
                cursor = editor.getCursor();
            } catch (error) {
                cursor = null;
            }

            const currentLine = cursor ? Number(cursor.line) : NaN;
            const hasValidCursor = Number.isFinite(currentLine);
            const currentCh = cursor ? Number(cursor.ch) : 0;
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

            if (typeof editor.setCursor === "function") {
                try {
                    editor.setCursor(targetCursor);
                } catch (error) {
                    const detail = error instanceof Error
                        ? (error.stack || error.message)
                        : String(error);
                    throw new Error(
                        "MarkdownMode cursor positioning failed: editor.setCursor threw for " +
                        `${activeFile.path} at line ${targetCursor.line}, ch ${targetCursor.ch}. ` +
                        `Reason: ${detail}`
                    );
                }
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
        this.markPoints = [];
        this.hasMarkBlocks = false;
        this.hasExtractBlocks = false;

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

        this.hasMarkBlocks = await this.plugin.hasMarkBlocksForFile(activeFile);
        this.hasExtractBlocks = await this.plugin.hasExtractBlocksForFile(activeFile);

        this.assetPath = this.plugin.getActiveCandidateAssetPath(activeFile);
        this.candidates = await GPTViz.ensureKeptImageCandidate(
            this.app,
            activeFile,
            this.assetPath
        );

        if (this.plugin.debug) {
            this.plugin.debug(`view refresh candidates=${this.candidates.length}`);
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

        if (this.plugin.debug) {
            this.plugin.debug(`view refresh rendered index=${this.index}, path=${this.candidates[this.index].file.path}`);
        }

        this.syncModeRibbon();
    }

    async findKeptCandidateIndex() {
        const keptFile = this.app.vault.getAbstractFileByPath(
            this.assetPath || `${this.activeFile.basename}.png`
        );

        if (!keptFile || !Array.isArray(this.candidates) || this.candidates.length === 0) {
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
            this.assetPath || `${this.activeFile.basename}.png`
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
            const sidecarPath = `${this.activeFile.basename}.marks.json`;
            try {
                if (await this.app.vault.adapter.exists(sidecarPath)) {
                    const text = await this.app.vault.adapter.read(sidecarPath);
                    const data = JSON.parse(text);
                    this.markPoints = Array.isArray(data.marks) ? data.marks : [];
                } else {
                    this.markPoints = [];
                }
            } catch (error) {
                this.markPoints = [];
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
        this.markPoints = Array.isArray(marks) ? marks : [];
        this.renderMarkDots();
    }

    renderMarkDots() {
        if (!this.markLayerEl) {
            return;
        }

        this.markLayerEl.empty();

        if (!Array.isArray(this.markPoints) || this.markPoints.length === 0) {
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

        const path = this.assetPath || `${this.activeFile.basename}.png`;
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

GPTViz.normalizeDependencyConfigPath = function(value, asDirectory) {
    let path = String(value || "").trim().replace(/\\/g, "/");

    path = path.replace(/^\.\//, "").replace(/^\/+/, "");

    if (asDirectory) {
        path = path.replace(/\/+$/, "");
        return path ? `${path}/` : "";
    }

    return path.replace(/\/+$/, "");
};

GPTViz.loadDependencyValidationConfig = async function(app) {
    const path = "_config.json";
    const adapter = app.vault.adapter;

    if (!(await adapter.exists(path))) {
        return {
            path,
            loaded: false,
            sourceDirectories: [],
            excludedFiles: []
        };
    }

    const text = await adapter.read(path);
    let raw;

    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid dependency config JSON at ${path}: ${error.message}`);
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`Invalid dependency config at ${path}: root must be a JSON object.`);
    }

    if (!Object.prototype.hasOwnProperty.call(raw, "source_dirs")) {
        throw new Error(`Invalid dependency config at ${path}: missing required 'source_dirs' array.`);
    }

    if (!Array.isArray(raw.source_dirs)) {
        throw new Error(`Invalid dependency config at ${path}: 'source_dirs' must be an array.`);
    }

    const sourceDirectories = [];
    const seenSourceDirectories = new Set();

    for (let index = 0; index < raw.source_dirs.length; index++) {
        const entry = raw.source_dirs[index];

        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`Invalid dependency config at ${path}: source_dirs[${index}] must be an object { dir, recurse }.`);
        }

        if (typeof entry.dir !== "string") {
            throw new Error(`Invalid dependency config at ${path}: source_dirs[${index}].dir must be a string.`);
        }

        if (typeof entry.recurse !== "boolean") {
            throw new Error(`Invalid dependency config at ${path}: source_dirs[${index}].recurse must be a boolean.`);
        }

        const normalizedDir = GPTViz.normalizeDependencyConfigPath(entry.dir, true);
        const key = `${normalizedDir}::${entry.recurse ? "1" : "0"}`;

        if (seenSourceDirectories.has(key)) {
            continue;
        }

        seenSourceDirectories.add(key);
        sourceDirectories.push({
            dir: normalizedDir,
            recurse: entry.recurse
        });
    }

    if (sourceDirectories.length === 0) {
        throw new Error(`Invalid dependency config at ${path}: 'source_dirs' must contain at least one entry.`);
    }

    const excludedFiles = [];
    const seenExcludedFiles = new Set();

    if (Object.prototype.hasOwnProperty.call(raw, "exclude_files")) {
        if (!Array.isArray(raw.exclude_files)) {
            throw new Error(`Invalid dependency config at ${path}: 'exclude_files' must be an array when provided.`);
        }

        for (let index = 0; index < raw.exclude_files.length; index++) {
            const value = raw.exclude_files[index];

            if (typeof value !== "string") {
                throw new Error(`Invalid dependency config at ${path}: exclude_files[${index}] must be a string.`);
            }

            const normalized = GPTViz.normalizeDependencyConfigPath(value, false);
            if (!normalized || seenExcludedFiles.has(normalized)) {
                continue;
            }

            seenExcludedFiles.add(normalized);
            excludedFiles.push(normalized);
        }
    }

    return {
        path,
        loaded: true,
        sourceDirectories,
        excludedFiles
    };
};

GPTViz.matchesDependencyExcludePattern = function(filePath, pattern) {
    const normalizedPath = GPTViz.normalizeDependencyConfigPath(filePath, false);
    const normalizedPattern = GPTViz.normalizeDependencyConfigPath(pattern, false);

    if (!normalizedPattern) {
        return false;
    }

    if (!normalizedPattern.includes("*")) {
        return normalizedPath === normalizedPattern;
    }

    const escaped = normalizedPattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`);

    return regex.test(normalizedPath);
};

GPTViz.isMarkdownFileAllowedForDependencyValidation = function(filePath, config) {
    const normalizedPath = GPTViz.normalizeDependencyConfigPath(filePath, false);
    const excludedFiles = Array.isArray(config.excludedFiles)
        ? config.excludedFiles
        : [];

    for (const pattern of excludedFiles) {
        if (GPTViz.matchesDependencyExcludePattern(normalizedPath, pattern)) {
            return false;
        }
    }

    const sourceDirectories = Array.isArray(config.sourceDirectories)
        ? config.sourceDirectories
        : [];

    if (sourceDirectories.length === 0) {
        return false;
    }

    const parentDirectory = normalizedPath.includes("/")
        ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1)
        : "";

    for (const sourceDir of sourceDirectories) {
        const dir = GPTViz.normalizeDependencyConfigPath(sourceDir.dir, true);
        const recurse = sourceDir.recurse === true;

        if (recurse) {
            if (!dir || normalizedPath.startsWith(dir)) {
                return true;
            }
            continue;
        }

        if (parentDirectory === dir) {
            return true;
        }
    }

    return false;
};

GPTViz.normalizeDependencyAssetPath = function(value, fallbackExtension) {
    let path = String(value || "").trim();

    path = path.replace(/^<|>$/g, "");
    path = path.replace(/\\/g, "/");
    path = path.replace(/^\.\//, "").replace(/^\/+/, "");

    if (!path) {
        return "";
    }

    if (fallbackExtension && !/\.[^./]+$/.test(path)) {
        path = `${path}${fallbackExtension}`;
    }

    return path;
};

GPTViz.parseDependencyDeclaredInputs = function(operation, sectionText, defaultSource) {
    const lines = String(sectionText || "").split("\n");
    const inputs = [];

    if (operation === "Prompt") {
        for (const line of lines) {
            const match = /^[ \t]*(?:Images|Photos):[ \t]*(.*)$/i.exec(line);
            if (!match) {
                continue;
            }

            for (const raw of match[1].split(",")) {
                const normalized = GPTViz.normalizeDependencyAssetPath(raw, ".png");
                if (normalized) {
                    inputs.push(normalized);
                }
            }
        }

        return [...new Set(inputs)];
    }

    if (operation === "Extract" || operation === "Mark") {
        let source = "";

        for (const line of lines) {
            const match = /^[ \t]*Source:[ \t]*(.+)$/i.exec(line);
            if (match) {
                source = match[1].trim();
                break;
            }
        }

        const normalized = GPTViz.normalizeDependencyAssetPath(
            source || defaultSource,
            ".png"
        );

        return normalized ? [normalized] : [];
    }

    if (operation === "Script") {
        return [];
    }

    return [];
};

GPTViz.getDependencyRecordOutputPath = function(record) {
    if (record.operation !== "Prompt" && record.operation !== "Extract") {
        return "";
    }

    return GPTViz.normalizeDependencyAssetPath(record.name, ".png");
};

GPTViz.getScriptDependenciesFromMoviParser = async function(app, markdownFilePath) {
    const filePath = String(markdownFilePath || "").trim();
    if (!filePath) {
        return [];
    }

    return await new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(Array.isArray(value) ? value : []);
        };

        const timeout = window.setTimeout(() => {
            finish([]);
        }, 500);

        const event = new CustomEvent("gptviz:script-required-assets-request", {
            detail: {
                filePath,
                resolve: payload => {
                    window.clearTimeout(timeout);
                    if (payload && payload.ok && Array.isArray(payload.requiredAssets)) {
                        finish(payload.requiredAssets);
                        return;
                    }
                    finish([]);
                },
                reject: () => {
                    window.clearTimeout(timeout);
                    finish([]);
                }
            },
            cancelable: false
        });

        window.dispatchEvent(event);
    }).then(values => {
        const normalized = [];
        const seen = new Set();
        for (const value of values) {
            const dep = GPTViz.normalizeDependencyAssetPath(value, "").toLowerCase();
            if (!dep || seen.has(dep)) {
                continue;
            }
            seen.add(dep);
            normalized.push(dep);
        }
        return normalized;
    });
};

GPTViz.buildDependencyHeadingReport = async function(app) {
    const allMarkdownFiles = app.vault.getMarkdownFiles();
    const dependencyConfig = await GPTViz.loadDependencyValidationConfig(app);
    const markdownFiles = allMarkdownFiles.filter(markdownFile =>
        GPTViz.isMarkdownFileAllowedForDependencyValidation(markdownFile.path, dependencyConfig)
    );
    const errors = [];
    const warnings = [];
    const records = [];
    const promptByName = new Map();
    const extractByName = new Map();
    const markByName = new Map();
    const markBySourceAndName = new Map();
    const scriptDependenciesByFilePath = new Map();

    const pushIssue = (collection, filePath, line, operation, name, message, code) => {
        collection.push({
            key: `${filePath}#${operation}:${name}`,
            filePath,
            line,
            operation,
            name,
            code,
            message
        });
    };

    const ensureBucket = (map, key) => {
        if (!map.has(key)) {
            map.set(key, []);
        }
        return map.get(key);
    };

    for (const markdownFile of markdownFiles) {
        const text = await app.vault.cachedRead(markdownFile);
        const lines = String(text || "").split("\n");
        const seenInFile = new Set();

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const heading = GPTViz.parseHeading(lines[lineIndex]);
            if (!heading) {
                continue;
            }

            const operationLike = /^(Prompt|Extract|Mark|Script)\b/.exec(heading.text.trim());
            if (!operationLike) {
                continue;
            }

            const parsed = GPTViz.parseDependencyOperationHeading(lines[lineIndex]);
            const lineNumber = lineIndex + 1;

            if (!parsed) {
                const opName = operationLike[1];
                const fallbackName = heading.text.trim().replace(/^\S+[ \t]*/, "") || "invalid";
                pushIssue(
                    errors,
                    markdownFile.path,
                    lineNumber,
                    opName,
                    fallbackName,
                    `Unsupported ${opName} heading form. Use '## <Operation>: <AssetFileName>' or '## <Operation> <AssetFileName>'.`,
                    "invalid_heading_form"
                );
                continue;
            }

            const identity = `${parsed.operation}:${parsed.canonicalName || parsed.name}`;
            const fileIdentityKey = `${markdownFile.path}#${identity}`.toLowerCase();
            if (seenInFile.has(fileIdentityKey)) {
                pushIssue(
                    errors,
                    markdownFile.path,
                    lineNumber,
                    parsed.operation,
                    parsed.name,
                    `Duplicate block identity '${identity}' in the same file.`,
                    "duplicate_block_identity"
                );
                continue;
            }
            seenInFile.add(fileIdentityKey);

            if (!/^[A-Za-z0-9_ -]+(?:\.[A-Za-z0-9_ -]+)*$/.test(parsed.name)) {
                pushIssue(
                    errors,
                    markdownFile.path,
                    lineNumber,
                    parsed.operation,
                    parsed.name,
                    `Illegal target name '${parsed.name}'. Use only letters, numbers, spaces, underscores, hyphens, and dots.`,
                    "illegal_target_name"
                );
                continue;
            }

            const section = GPTViz.getHeadingSectionFromLines(lines, lineIndex);
            const defaultSource = `${markdownFile.basename}.png`;
            let resolvedInputs = GPTViz.parseDependencyDeclaredInputs(
                parsed.operation,
                section.text,
                defaultSource
            );

            if (parsed.operation === "Script") {
                if (!scriptDependenciesByFilePath.has(markdownFile.path)) {
                    const dependencies = await GPTViz.getScriptDependenciesFromMoviParser(
                        app,
                        markdownFile.path
                    );
                    scriptDependenciesByFilePath.set(markdownFile.path, dependencies);
                }
                resolvedInputs = scriptDependenciesByFilePath.get(markdownFile.path) || [];
            }

            const source = parsed.operation === "Mark"
                ? (resolvedInputs[0] || "")
                : "";

            const record = {
                id: `${markdownFile.path}#${identity}`,
                filePath: markdownFile.path,
                fileName: markdownFile.name,
                line: lineNumber,
                operation: parsed.operation,
                name: parsed.name,
                canonicalName: parsed.canonicalName || parsed.name,
                source,
                resolvedInputs,
                outputPath: ""
            };

            record.outputPath = GPTViz.getDependencyRecordOutputPath(record);
            records.push(record);

            const normalizedName = record.canonicalName.toLowerCase();
            if (parsed.operation === "Prompt") {
                ensureBucket(promptByName, normalizedName).push(record);
            } else if (parsed.operation === "Extract") {
                ensureBucket(extractByName, normalizedName).push(record);
            } else if (parsed.operation === "Mark") {
                ensureBucket(markByName, normalizedName).push(record);
                const normalizedSource = String(source || "").toLowerCase();
                const sourceKey = `${normalizedSource}::${normalizedName}`;
                ensureBucket(markBySourceAndName, sourceKey).push(record);
            }
        }
    }

    for (const entries of promptByName.values()) {
        if (entries.length > 1) {
            for (const entry of entries.slice(1)) {
                pushIssue(
                    errors,
                    entry.filePath,
                    entry.line,
                    "Prompt",
                    entry.name,
                    `Duplicate prompt target '${entry.name}' in project.`,
                    "duplicate_prompt_name"
                );
            }
        }
    }

    for (const entries of extractByName.values()) {
        if (entries.length > 1) {
            for (const entry of entries.slice(1)) {
                pushIssue(
                    errors,
                    entry.filePath,
                    entry.line,
                    "Extract",
                    entry.name,
                    `Duplicate extract target '${entry.name}' in project.`,
                    "duplicate_extract_name"
                );
            }
        }
    }

    for (const [name, promptEntries] of promptByName.entries()) {
        if (!extractByName.has(name)) {
            continue;
        }

        const extractEntries = extractByName.get(name);
        for (const entry of promptEntries) {
            pushIssue(
                errors,
                entry.filePath,
                entry.line,
                "Prompt",
                entry.name,
                `Prompt/Extract name collision for '${entry.name}'.`,
                "prompt_extract_collision"
            );
        }

        for (const entry of extractEntries) {
            pushIssue(
                errors,
                entry.filePath,
                entry.line,
                "Extract",
                entry.name,
                `Prompt/Extract name collision for '${entry.name}'.`,
                "prompt_extract_collision"
            );
        }
    }

    for (const [name, markEntries] of markByName.entries()) {
        const distinctSources = new Set(
            markEntries.map(entry => String(entry.source || "").toLowerCase())
        );
        if (markEntries.length > 1 && distinctSources.size > 1) {
            for (const entry of markEntries.slice(1)) {
                pushIssue(
                    warnings,
                    entry.filePath,
                    entry.line,
                    "Mark",
                    entry.name,
                    `Mark name '${entry.name}' is reused on different source images.`,
                    "mark_name_reused"
                );
            }
        }
    }

    for (const entries of markBySourceAndName.values()) {
        if (entries.length > 1) {
            for (const entry of entries.slice(1)) {
                pushIssue(
                    errors,
                    entry.filePath,
                    entry.line,
                    "Mark",
                    entry.name,
                    `Duplicate Mark name '${entry.name}' on source '${entry.source}'.`,
                    "duplicate_mark_name_same_source"
                );
            }
        }
    }

    const producersByOutput = new Map();
    for (const record of records) {
        if (!record.outputPath) {
            continue;
        }

        const key = record.outputPath.toLowerCase();
        ensureBucket(producersByOutput, key).push(record);
    }

    for (const outputRecords of producersByOutput.values()) {
        if (outputRecords.length <= 1) {
            continue;
        }

        const operationList = outputRecords
            .map(item => `${item.operation} ${item.name}`)
            .join(", ");

        for (const record of outputRecords) {
            pushIssue(
                errors,
                record.filePath,
                record.line,
                record.operation,
                record.name,
                `Duplicate output target '${record.outputPath}' is produced by multiple blocks (${operationList}).`,
                "duplicate_output_target"
            );
        }
    }

    const recordById = new Map();
    const outgoingEdges = new Map();

    for (const record of records) {
        recordById.set(record.id, record);
        outgoingEdges.set(record.id, new Set());
    }

    for (const record of records) {
        for (const dependency of record.resolvedInputs) {
            const dependencyKey = dependency.toLowerCase();
            const producers = producersByOutput.get(dependencyKey) || [];

            if (producers.length > 0) {
                for (const producer of producers) {
                    outgoingEdges.get(producer.id).add(record.id);
                }
                continue;
            }

            const directFile = app.vault.getAbstractFileByPath(dependency);
            const candidateFile = app.vault.getAbstractFileByPath(`candidates/${dependency}`);
            const isResolvedByFile = Boolean(
                (directFile && directFile.stat) ||
                (candidateFile && candidateFile.stat)
            );

            if (!isResolvedByFile) {
                pushIssue(
                    errors,
                    record.filePath,
                    record.line,
                    record.operation,
                    record.name,
                    `Unresolved dependency '${dependency}'. Add or generate the dependency, or update the block reference.`,
                    "unresolved_dependency"
                );
            }
        }
    }

    const visitState = new Map();
    const stack = [];
    const cycleSignatures = new Set();

    const reportCycle = cycleNodeIds => {
        const cycleRecords = cycleNodeIds
            .map(nodeId => recordById.get(nodeId))
            .filter(Boolean);

        if (cycleRecords.length === 0) {
            return;
        }

        const signature = cycleRecords
            .map(item => item.id)
            .sort()
            .join("|");

        if (cycleSignatures.has(signature)) {
            return;
        }
        cycleSignatures.add(signature);

        const chain = cycleRecords
            .map(item => `${item.operation}:${item.name}`)
            .join(" -> ");
        const first = cycleRecords[0];

        pushIssue(
            errors,
            first.filePath,
            first.line,
            first.operation,
            first.name,
            `Dependency cycle detected: ${chain} -> ${first.operation}:${first.name}. Remove at least one dependency edge in the cycle.`,
            "dependency_cycle"
        );
    };

    const dfs = nodeId => {
        visitState.set(nodeId, 1);
        stack.push(nodeId);

        const neighbors = outgoingEdges.get(nodeId) || new Set();
        for (const neighborId of neighbors) {
            const state = visitState.get(neighborId) || 0;

            if (state === 0) {
                dfs(neighborId);
                continue;
            }

            if (state === 1) {
                const cycleStart = stack.indexOf(neighborId);
                if (cycleStart !== -1) {
                    const cycleNodeIds = stack.slice(cycleStart);
                    reportCycle(cycleNodeIds);
                }
            }
        }

        stack.pop();
        visitState.set(nodeId, 2);
    };

    for (const record of records) {
        if ((visitState.get(record.id) || 0) === 0) {
            dfs(record.id);
        }
    }

    const now = new Date().toISOString();
    const lines = [];
    lines.push("## GPTViz dependency report");
    lines.push("");
    lines.push(`Generated: ${now}`);
    lines.push(`Config file: ${dependencyConfig.path} (${dependencyConfig.loaded ? "loaded" : "not found; scanning no files"})`);
    lines.push(`Scanned markdown files: ${markdownFiles.length}`);
    lines.push(`Parsed operations: ${records.length}`);
    lines.push(`Errors: ${errors.length}`);
    lines.push(`Warnings: ${warnings.length}`);
    lines.push("");

    const renderIssue = issue => {
        const displayName = issue.filePath.split("/").pop() || issue.filePath;
        return `- [[${issue.filePath}#${issue.operation} ${issue.name}|${displayName}]] line ${issue.line}: ${issue.message} [${issue.code}]`;
    };

    lines.push("## Errors");
    if (errors.length === 0) {
        lines.push("- None");
    } else {
        for (const issue of errors) {
            lines.push(renderIssue(issue));
        }
    }

    lines.push("");
    lines.push("## Warnings");
    if (warnings.length === 0) {
        lines.push("- None");
    } else {
        for (const issue of warnings) {
            lines.push(renderIssue(issue));
        }
    }

    return {
        errors,
        warnings,
        markdown: lines.join("\n"),
        graph: {
            records,
            dependencyConfig,
            markdownFiles: markdownFiles.map(file => file.path)
        }
    };
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

GPTViz.getImageCandidates = function(app, activeFile, assetPath) {
    const normalizedAssetPath = GPTViz.normalizeDependencyAssetPath(
        assetPath || `${activeFile.basename}.png`,
        ".png"
    );
    const assetName = normalizedAssetPath.split("/").pop() || `${activeFile.basename}.png`;
    const assetBaseName = assetName.replace(/\.[^./]+$/, "");
    const prefix = `${assetBaseName}-`;
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

GPTViz.ensureKeptImageCandidate = async function(app, activeFile, assetPath) {
    const normalizedAssetPath = GPTViz.normalizeDependencyAssetPath(
        assetPath || `${activeFile.basename}.png`,
        ".png"
    );
    const keptFile = app.vault.getAbstractFileByPath(
        normalizedAssetPath
    );
    const candidates = GPTViz.getImageCandidates(app, activeFile, normalizedAssetPath);

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

    const assetName = normalizedAssetPath.split("/").pop() || `${activeFile.basename}.png`;
    const assetBaseName = assetName.replace(/\.[^./]+$/, "");
    const number = candidates.length > 0
        ? candidates[candidates.length - 1].number + 1
        : 1;
    const path = `candidates/${assetBaseName}-${number}.png`;

    try {
        await app.vault.createBinary(
            path,
            candidateBinary,
            keptTimestamps
        );
    } catch (error) {
        const refreshedCandidates = GPTViz.getImageCandidates(
            app,
            activeFile,
            normalizedAssetPath
        );

        for (const candidate of refreshedCandidates) {
            const refreshedCandidateBinary = await app.vault.readBinary(candidate.file);

            if (GPTViz.binaryEqual(candidateBinary, refreshedCandidateBinary)) {
                return refreshedCandidates;
            }
        }

        throw error;
    }

    return GPTViz.getImageCandidates(app, activeFile, normalizedAssetPath);
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

        await this.app.vault.adapter.write("_lastErr.log", `${lastErrorPayload}\n`);
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

    getModeRibbonForView(view) {
        if (!view || !view.containerEl) {
            return null;
        }

        const headerEl = view.containerEl.querySelector(".view-header");
        if (!headerEl) {
            return null;
        }

        let ribbon = headerEl.querySelector(".mode-ribbon");
        if (ribbon) {
            return ribbon;
        }

        ribbon = headerEl.createEl("div");
        ribbon.classList.add("mode-ribbon");
        ribbon.style.display = "inline-flex";
        ribbon.style.alignItems = "center";
        ribbon.style.gap = "0";
        ribbon.style.marginInlineStart = "auto";

        const actionsEl = headerEl.querySelector(".view-actions");
        if (actionsEl) {
            headerEl.insertBefore(ribbon, actionsEl);
        } else {
            headerEl.appendChild(ribbon);
        }

        return ribbon;
    }

    addModeButton(view, position, buttonEl) {
        if (!Number.isInteger(position) || position < 0) {
            throw new Error("addModeButton requires a non-negative integer position.");
        }
        if (!(buttonEl instanceof HTMLElement)) {
            throw new Error("addModeButton requires buttonEl to be an HTMLElement.");
        }

        const ribbon = this.getModeRibbonForView(view);
        if (!ribbon) {
            return null;
        }

        const fallbackKey =
            buttonEl.getAttribute("aria-label") ||
            buttonEl.getAttribute("title") ||
            (buttonEl.textContent || "").trim();
        const buttonKey =
            buttonEl.getAttribute("data-mode-button-key") ||
            fallbackKey;

        if (buttonKey) {
            buttonEl.setAttribute("data-mode-button-key", buttonKey);
            const existingByKey = ribbon.querySelectorAll(
                `[data-mode-button-key="${CSS.escape(buttonKey)}"]`
            );
            existingByKey.forEach(existing => {
                if (existing !== buttonEl) {
                    existing.remove();
                }
            });
        }

        const existingAtPosition = ribbon.querySelector(
            `[data-mode-button-position="${position}"]`
        );
        if (existingAtPosition && existingAtPosition !== buttonEl) {
            existingAtPosition.remove();
        }

        buttonEl.setAttribute("data-mode-button-position", String(position));

        const orderedButtons = [...ribbon.children].filter(
            child => child !== buttonEl
        );
        const insertBefore = orderedButtons.find(child => {
            const childPos = Number(
                child.getAttribute("data-mode-button-position")
            );
            return Number.isFinite(childPos) && childPos > position;
        });

        if (insertBefore) {
            ribbon.insertBefore(buttonEl, insertBefore);
        } else {
            ribbon.appendChild(buttonEl);
        }

        return buttonEl;
    }

    ensureModeRibbonMoreActionsButton(view) {
        if (!view || !view.containerEl) {
            return;
        }

        const buttonEl = document.createElement("button");
        buttonEl.classList.add("clickable-icon");
        buttonEl.classList.add("gptviz-mode-more-actions");
        buttonEl.setAttribute("aria-label", "More Actions");
        buttonEl.setAttribute("title", "More Actions");
        buttonEl.setAttribute("type", "button");
        buttonEl.setAttribute("data-mode-button-key", "MoreActions");
        GPTViz.obsidian.setIcon(buttonEl, "more-vertical");
        buttonEl.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();

            const liveActionsEl = view.containerEl.querySelector(".view-actions");
            const liveOptionsActionEl = liveActionsEl
                ? liveActionsEl.querySelector(
                    '.view-action.mod-options, .view-action[aria-label*="More options"], .view-action[aria-label*="Options"]'
                )
                : null;

            if (!liveOptionsActionEl) {
                return;
            }

            liveOptionsActionEl.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window
                })
            );
        });

        this.addModeButton(view, 99, buttonEl);
    }

    setModeButtonEnabled(buttonEl, enabled) {
        if (!buttonEl) {
            return;
        }

        if (enabled) {
            buttonEl.classList.remove("is-disabled");
            buttonEl.removeAttribute("aria-disabled");
            buttonEl.style.pointerEvents = "";
            buttonEl.style.opacity = "";
            return;
        }

        buttonEl.classList.add("is-disabled");
        buttonEl.setAttribute("aria-disabled", "true");
        buttonEl.style.pointerEvents = "none";
        buttonEl.style.opacity = "0.45";
    }

    getModeRibbonButton(view, key) {
        if (!view || !view.containerEl || !key) {
            return null;
        }

        return view.containerEl.querySelector(
            `.mode-ribbon [data-mode-button-key="${CSS.escape(key)}"]`
        );
    }

    applyModeRibbonButtonVisualsForView(view) {
        if (!view || !view.containerEl) {
            return;
        }

        const ribbon = view.containerEl.querySelector(".mode-ribbon");
        if (!ribbon) {
            return;
        }

        const ribbonButtons = ribbon.querySelectorAll(".clickable-icon");
        if (!ribbonButtons.length) {
            return;
        }

        const sourceButton = view.containerEl.querySelector(".view-actions .clickable-icon") ||
            document.querySelector(".view-actions .clickable-icon");

        let targetWidth = 29;
        let targetHeight = 29;
        const backgroundColor = "var(--interactive-normal)";
        const border = "1px solid var(--background-modifier-border)";
        let borderRadius = "var(--radius-s)";
        const boxShadow = "none";

        if (sourceButton) {
            const sourceStyle = window.getComputedStyle(sourceButton);
            const sourceWidth = Number.parseFloat(sourceStyle.width);
            const sourceHeight = Number.parseFloat(sourceStyle.height);
            const sourceRect = sourceButton.getBoundingClientRect();

            if (Number.isFinite(sourceWidth) && sourceWidth > 0) {
                targetWidth = Math.round(sourceWidth);
            } else if (Number.isFinite(sourceRect.width) && sourceRect.width > 0) {
                targetWidth = Math.round(sourceRect.width);
            }

            if (Number.isFinite(sourceHeight) && sourceHeight > 0) {
                targetHeight = Math.round(sourceHeight);
            } else if (Number.isFinite(sourceRect.height) && sourceRect.height > 0) {
                targetHeight = Math.round(sourceRect.height);
            }

            if (sourceStyle.borderRadius) {
                borderRadius = sourceStyle.borderRadius;
            }
        }

        targetWidth = Math.max(20, Math.min(targetWidth, 48));
        targetHeight = Math.max(20, Math.min(targetHeight, 48));

        const compactHeight = Math.max(16, targetHeight - 6);

        ribbon.style.display = "inline-flex";
        ribbon.style.alignItems = "center";
        ribbon.style.gap = "0";
        ribbon.style.overflow = "hidden";
        ribbon.style.marginTop = "0";
        ribbon.style.marginBottom = "0";
        ribbon.style.height = `${compactHeight}px`;
        ribbon.style.minHeight = `${compactHeight}px`;
        ribbon.style.maxHeight = `${compactHeight}px`;
        ribbon.style.backgroundColor = backgroundColor;
        ribbon.style.border = border;
        ribbon.style.borderRadius = borderRadius;
        ribbon.style.boxShadow = boxShadow;

        const sourceIconEl = sourceButton
            ? sourceButton.querySelector("svg, .svg-icon")
            : null;
        const sourceIconStyle = sourceIconEl
            ? window.getComputedStyle(sourceIconEl)
            : null;
        const sourceIconWidth = sourceIconStyle
            ? Number.parseFloat(sourceIconStyle.width)
            : NaN;
        const sourceIconHeight = sourceIconStyle
            ? Number.parseFloat(sourceIconStyle.height)
            : NaN;

        ribbonButtons.forEach((buttonEl, index) => {
            const isLast = index === ribbonButtons.length - 1;

            buttonEl.style.width = `${targetWidth}px`;
            buttonEl.style.height = `${compactHeight}px`;
            buttonEl.style.minWidth = `${targetWidth}px`;
            buttonEl.style.minHeight = `${compactHeight}px`;
            buttonEl.style.display = "inline-flex";
            buttonEl.style.alignItems = "center";
            buttonEl.style.justifyContent = "center";
            buttonEl.style.boxSizing = "border-box";
            buttonEl.style.padding = "0";
            buttonEl.style.lineHeight = "1";
            buttonEl.style.backgroundColor = "transparent";
            buttonEl.style.border = "none";
            buttonEl.style.borderRadius = "0";
            buttonEl.style.boxShadow = "none";
            buttonEl.style.margin = "0";
            buttonEl.style.borderInlineEnd = isLast
                ? "none"
                : "1px solid var(--background-modifier-border)";

            const iconEl = buttonEl.querySelector("svg, .svg-icon");
            if (iconEl) {
                if (Number.isFinite(sourceIconWidth) && sourceIconWidth > 0) {
                    iconEl.style.width = `${sourceIconWidth}px`;
                }
                if (Number.isFinite(sourceIconHeight) && sourceIconHeight > 0) {
                    iconEl.style.height = `${sourceIconHeight}px`;
                }
                iconEl.style.maxWidth = "none";
                iconEl.style.maxHeight = "none";
            }
        });
    }

    applyModeRibbonButtonStatesForView(view, leaf) {
        if (!view || !view.containerEl) {
            return;
        }

        const isMarkdown = view instanceof GPTViz.obsidian.MarkdownView;
        const isCandidate = this.isCandidateView(view);
        const isMovie = this.isMoviPlayerView(view);

        if (!isMarkdown && !isCandidate && !isMovie) {
            return;
        }

        const markdownModeButtonEl = this.getModeRibbonButton(view, "MarkdownMode");
        const imageModeButtonEl = this.getModeRibbonButton(view, "ImageMode");
        const movieModeButtonEl = this.getModeRibbonButton(view, "MovieMode");
        const dependsModeButtonEl = this.getModeRibbonButton(view, "DependsMode");
        const moreActionsButtonEl = this.getModeRibbonButton(view, "MoreActions");

        const hasMarkdownTarget = isMarkdown
            ? Boolean(leaf)
            : isCandidate
                ? Boolean(view.activeFile)
                : Boolean(this.resolveMovieSourceMarkdownFile(view));
        this.setModeButtonEnabled(markdownModeButtonEl, hasMarkdownTarget);

        let canOpenImageMode = true;
        if (isMarkdown) {
            canOpenImageMode = Boolean(view.file && this.markdownFileCanOpenCandidateView(view.file));
        } else if (isMovie) {
            const sourceFile = this.resolveMovieSourceMarkdownFile(view);
            canOpenImageMode = Boolean(sourceFile && this.markdownFileCanOpenCandidateView(sourceFile));
        } else if (isCandidate) {
            canOpenImageMode = Boolean(view.activeFile && this.markdownFileCanOpenCandidateView(view.activeFile));
        }
        this.setModeButtonEnabled(imageModeButtonEl, canOpenImageMode);

        this.setModeButtonEnabled(movieModeButtonEl, true);
        this.setModeButtonEnabled(dependsModeButtonEl, true);

        const actionsEl = view.containerEl.querySelector(".view-actions");
        const optionsActionEl = actionsEl
            ? actionsEl.querySelector(
                '.view-action.mod-options, .view-action[aria-label*="More options"], .view-action[aria-label*="Options"]'
            )
            : null;
        this.setModeButtonEnabled(moreActionsButtonEl, Boolean(optionsActionEl));
    }

    syncModeRibbonForView(view, leaf) {
        if (!view || !view.containerEl) {
            return;
        }

        const isMarkdown = view instanceof GPTViz.obsidian.MarkdownView;
        const isCandidate = this.isCandidateView(view);
        const isMovie = this.isMoviPlayerView(view);

        if (!isMarkdown && !isCandidate && !isMovie) {
            return;
        }

        const viewActionsEl = view.containerEl.querySelector(".view-actions");
        if (viewActionsEl) {
            viewActionsEl.style.display = isMarkdown ? "none" : "";
        }

        const markdownModeButtonEl = document.createElement("button");
        markdownModeButtonEl.classList.add("clickable-icon");
        markdownModeButtonEl.classList.add("gptviz-markdown-mode-action");
        markdownModeButtonEl.setAttribute("aria-label", "MarkdownMode");
        markdownModeButtonEl.setAttribute("title", "MarkdownMode");
        markdownModeButtonEl.setAttribute("type", "button");
        markdownModeButtonEl.setAttribute("data-mode-button-key", "MarkdownMode");
        GPTViz.obsidian.setIcon(markdownModeButtonEl, "file-text");
        markdownModeButtonEl.addEventListener("click", async () => {
            try {
                if (isCandidate && typeof view.returnToNote === "function") {
                    await view.returnToNote();
                    return;
                }

                if (isMovie) {
                    await this.returnToMovieSourceNote(view);
                    return;
                }

                if (leaf) {
                    await this.app.workspace.revealLeaf(leaf);
                }
            } catch (error) {
                this.reportError("switching to MarkdownMode", error);
            }
        });
        this.addModeButton(view, 0, markdownModeButtonEl);

        const imageModeButtonEl = document.createElement("button");
        imageModeButtonEl.classList.add("clickable-icon");
        imageModeButtonEl.classList.add(this.markdownReviewActionClass);
        imageModeButtonEl.setAttribute("aria-label", "ImageMode");
        imageModeButtonEl.setAttribute("title", "ImageMode");
        imageModeButtonEl.setAttribute("type", "button");
        imageModeButtonEl.setAttribute("data-mode-button-key", "ImageMode");
        GPTViz.obsidian.setIcon(imageModeButtonEl, "image");
        imageModeButtonEl.addEventListener("click", async () => {
            try {
                if (isMarkdown) {
                    if (!this.markdownFileCanOpenCandidateView(view.file)) {
                        return;
                    }
                    await this.handleMarkdownImageModeRequest(view.file, leaf);
                    return;
                }

                if (isMovie) {
                    await this.openCandidateViewForMovieSource(view);
                    return;
                }

                if (isCandidate) {
                    await this.handleMarkdownImageModeRequest(view.activeFile || null, leaf);
                    return;
                }
            } catch (error) {
                this.reportError("switching to ImageMode", error);
            }
        });

        this.addModeButton(view, 2, imageModeButtonEl);

        const movieModeButtonEl = document.createElement("button");
        movieModeButtonEl.classList.add("clickable-icon");
        movieModeButtonEl.classList.add(this.markdownMovieModeActionClass);
        movieModeButtonEl.setAttribute("aria-label", "MovieMode");
        movieModeButtonEl.setAttribute("title", "MovieMode");
        movieModeButtonEl.setAttribute("type", "button");
        movieModeButtonEl.setAttribute("data-mode-button-key", "MovieMode");
        GPTViz.obsidian.setIcon(movieModeButtonEl, "film");
        movieModeButtonEl.addEventListener("click", async () => {
            try {
                if (isMarkdown) {
                    await this.handleMarkdownMovieModeRequest(view.file, leaf);
                    return;
                }

                if (isCandidate) {
                    const preferredAssetPath = this.getCandidateAssetPathForMovieMode(view);
                    await this.handleMarkdownMovieModeRequest(
                        view.activeFile || null,
                        leaf,
                        { preferredAssetPath }
                    );
                    return;
                }

                const filePath = this.resolveMovieSourceMarkdownFile(view)?.path || null;

                await this.requestMovieMode({
                    source: "movie-view",
                    filePath
                });
            } catch (error) {
                this.reportError("switching to MovieMode", error);
            }
        });
        this.addModeButton(view, 3, movieModeButtonEl);

        const dependencyActionEl = document.createElement("button");
        dependencyActionEl.classList.add("clickable-icon");
        dependencyActionEl.classList.add(this.markdownDependencyActionClass);
        dependencyActionEl.setAttribute("aria-label", "DependsMode");
        dependencyActionEl.setAttribute("title", "DependsMode");
        dependencyActionEl.setAttribute("type", "button");
        dependencyActionEl.setAttribute("data-mode-button-key", "DependsMode");
        GPTViz.obsidian.setIcon(dependencyActionEl, "git-branch");
        dependencyActionEl.addEventListener("click", async () => {
            await this.validateDependencyHeadings();
        });
        this.addModeButton(view, 4, dependencyActionEl);

        this.ensureModeRibbonMoreActionsButton(view);
        this.applyModeRibbonButtonStatesForView(view, leaf);
        this.applyModeRibbonButtonVisualsForView(view);
    }

    syncAllModeRibbons() {
        const seenViews = new Set();

        const syncLeafList = leafType => {
            for (const leaf of this.app.workspace.getLeavesOfType(leafType)) {
                const view = leaf && leaf.view;
                if (!view || seenViews.has(view)) {
                    continue;
                }
                seenViews.add(view);
                this.syncModeRibbonForView(view, leaf);
            }
        };

        syncLeafList("markdown");
        syncLeafList(GPTViz.CANDIDATE_VIEW_TYPE);
        syncLeafList("movi-player-view");
    }

    syncAllMarkdownModeRibbons() {
        this.syncAllModeRibbons();
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

    syncMovieModeRibbon(view) {
        this.syncModeRibbonForView(view, null);
    }

    syncAllMovieModeRibbons() {
        this.syncAllModeRibbons();
    }

    addSharedViewReviewActions() {
        this.syncAllModeRibbons();
    }

    addSharedViewDependencyActions() {
        this.syncAllModeRibbons();
    }

    removeMarkdownMovieModeActions() {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;

            if (!(view instanceof GPTViz.obsidian.MarkdownView)) {
                continue;
            }

            view.containerEl
                .querySelectorAll(
                    `.${this.markdownMovieModeActionClass}, [aria-label="MovieMode"], [title="MovieMode"]`
                )
                .forEach(action => action.remove());
        }
    }

    addMarkdownMovieModeActions() {
        this.syncAllMarkdownModeRibbons();
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
            const keptFile = this.app.vault.getAbstractFileByPath(assetPath);
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
                !vaultFile.path.startsWith("candidates/") ||
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

        new GPTViz.MovieScriptUsageModal(
            this.app,
            sourceFile,
            rows,
            async row => {
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
            }
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

        new GPTViz.MovieAssetUsageModal(
            this.app,
            file,
            orderedRows,
            async row => {
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
            }
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

        new GPTViz.MovieAssetUsageModal(
            this.app,
            file,
            orderedRows,
            async row => {
                await this.showMovieScriptUsageForAssets(file, [row.assetPath], leaf);
            }
        ).open();
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
            if (!(view instanceof GPTViz.obsidian.MarkdownView)) {
                continue;
            }
            this.applyModeRibbonButtonStatesForView(view, leaf);
        }

        for (const leaf of this.app.workspace.getLeavesOfType(GPTViz.CANDIDATE_VIEW_TYPE)) {
            const view = leaf.view;
            if (!this.isCandidateView(view)) {
                continue;
            }
            this.applyModeRibbonButtonStatesForView(view, leaf);
        }

        for (const leaf of this.app.workspace.getLeavesOfType("movi-player-view")) {
            const view = leaf.view;
            if (!this.isMoviPlayerView(view)) {
                continue;
            }
            this.applyModeRibbonButtonStatesForView(view, leaf);
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
        this.syncAllMarkdownModeRibbons();
    }

    removeMarkdownDependencyActions() {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;

            if (!(view instanceof GPTViz.obsidian.MarkdownView)) {
                continue;
            }

            view.containerEl
                .querySelectorAll(
                    `.${this.markdownDependencyActionClass}, [aria-label="GPTViz Validate Dependencies"], [title="GPTViz Validate Dependencies"]`
                )
                .forEach(action => action.remove());
        }
    }

    enforceMarkdownDependencyActionOrder(view) {
        // DependsMode is owned by .mode-ribbon ordering via addModeButton.
        return;
    }

    addMarkdownDependencyActions() {
        this.syncAllMarkdownModeRibbons();
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
            const reportPath = "_deps.md";
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
            if (normalizedImagePath.startsWith("candidates/") && fallbackMarkdownFile && fallbackMarkdownFile.path) {
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
                companionCandidates.push(`${baseName}.md`);
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

            await this.app.vault.createFolder("candidates").catch(() => {});

            const candidates = GPTViz.getImageCandidates(
                this.app,
                activeFile,
                targetAssetPath
            );
            const number = candidates.length > 0
                ? candidates[candidates.length - 1].number + 1
                : 1;
            const candidatePath =
                `candidates/${targetAssetBaseName}-${number}.png`;
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

            await this.app.vault.createFolder("candidates").catch(() => {});

            const saveCandidates = GPTViz.getImageCandidates(
                this.app,
                activeFile,
                targetAssetPath
            );
            const saveNumber = saveCandidates.length > 0
                ? saveCandidates[saveCandidates.length - 1].number + 1
                : 1;
            const candidatePath = `candidates/${targetAssetBaseName}-${saveNumber}.png`;
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




globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");

GPTViz.testOpenAIConnection = async function(apiKey) {
    const response = await GPTViz.obsidian.requestUrl({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "gpt-5.6-luna",
            input: "Reply with exactly: connection successful"
        })
    });

    const data = response.json;

    for (const output of data.output || []) {
        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                return content.text;
            }
        }
    }

    throw new Error("OpenAI returned no text response.");
};


GPTViz.generateOpenAIResponse = async function(apiKey, prompt, imageInputs) {
    const response = await GPTViz.obsidian.requestUrl({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "gpt-5.6-luna",
            tools: [
                {
                    type: "image_generation"
                }
            ],
            input: imageInputs && imageInputs.length > 0
                ? [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: prompt
                            },
                            ...imageInputs
                        ]
                    }
                ]
                : prompt
        })
    });

    const data = response.json;
    let imageBase64 = null;
    const textParts = [];

    for (const output of data.output || []) {
        if (
            output.type === "image_generation_call" &&
            output.result
        ) {
            imageBase64 = output.result;
        }

        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                textParts.push(content.text);
            }
        }
    }

    if (imageBase64 || textParts.length > 0) {
        return {
            imageBase64: imageBase64,
            text: textParts.join("\n\n")
        };
    }

    return {
        imageBase64: null,
        text: JSON.stringify(data, null, 2)
    };
};


GPTViz.generateOpenAIImageResponseDetailed = async function(apiKey, prompt, imageInputs) {
    const response = await GPTViz.obsidian.requestUrl({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "gpt-5.6-luna",
            tools: [
                {
                    type: "image_generation"
                }
            ],
            input: imageInputs && imageInputs.length > 0
                ? [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: prompt
                            },
                            ...imageInputs
                        ]
                    }
                ]
                : prompt
        })
    });

    const data = response.json;
    const imageBase64s = [];
    const textParts = [];

    for (const output of data.output || []) {
        if (
            output.type === "image_generation_call" &&
            output.result
        ) {
            imageBase64s.push(output.result);
        }

        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                textParts.push(content.text);
            }
        }
    }

    return {
        imageBase64s: imageBase64s,
        text: textParts.length > 0
            ? textParts.join("\n\n")
            : JSON.stringify(data, null, 2)
    };
};


GPTViz.generateOpenAITextResponse = async function(apiKey, prompt, imageInputs) {
    const response = await GPTViz.obsidian.requestUrl({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "gpt-5.6-luna",
            input: imageInputs && imageInputs.length > 0
                ? [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: prompt
                            },
                            ...imageInputs
                        ]
                    }
                ]
                : prompt
        })
    });

    const data = response.json;
    const textParts = [];

    for (const output of data.output || []) {
        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                textParts.push(content.text);
            }
        }
    }

    if (textParts.length > 0) {
        return textParts.join("\n\n");
    }

    return JSON.stringify(data, null, 2);
};

globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.parseHeading = function(line) {
    const match = /^(#+)[ \t]+(.+)$/.exec(line);

    if (!match) {
        return null;
    }

    return {
        level: match[1].length,
        text: match[2]
    };
};

GPTViz.getDependencyDefaultExtension = function(operation) {
    if (operation === "Prompt" || operation === "Extract") {
        return ".png";
    }

    if (operation === "Mark") {
        return ".marks.json";
    }

    if (operation === "Script") {
        return ".ms";
    }

    return "";
};

GPTViz.normalizeDependencyOutputName = function(operation, name) {
    const value = String(name || "").trim();
    const defaultExtension = GPTViz.getDependencyDefaultExtension(operation);

    if (!defaultExtension) {
        return value;
    }

    if (value.toLowerCase().endsWith(defaultExtension)) {
        return value.slice(0, -defaultExtension.length);
    }

    return value;
};

GPTViz.parseDependencyOperationHeading = function(line) {
    const heading = GPTViz.parseHeading(line);
    if (!heading) {
        return null;
    }

    const match = /^(Prompt|Extract|Mark|Script)(?:[ \t]*:[ \t]*|[ \t]+)(.+)$/.exec(
        heading.text.trim()
    );

    if (!match) {
        return null;
    }

    const operation = match[1];
    const name = match[2].trim();
    if (!name) {
        return null;
    }

    const canonicalName = GPTViz.normalizeDependencyOutputName(operation, name);

    return {
        level: heading.level,
        operation,
        name,
        canonicalName,
        id: `${operation}:${canonicalName}`
    };
};

GPTViz.isPromptHeading = function(line) {
    const heading = GPTViz.parseHeading(line);

    return (
        heading !== null &&
        /^Prompt(?:[ \t]|:|$)/.test(heading.text)
    );
};

GPTViz.getHeadingSectionFromLines = function(lines, startLine) {
    const startHeading = GPTViz.parseHeading(lines[startLine]);
    const headingLevel = startHeading.level;
    let endLine = lines.length;

    // End at the next heading of the same or higher level.
    for (let line = startLine + 1; line < lines.length; line++) {
        const heading = GPTViz.parseHeading(lines[line]);

        if (heading && heading.level <= headingLevel) {
            endLine = line;
            break;
        }
    }

    return {
        text: lines.slice(startLine, endLine).join("\n"),
        startLine: startLine,
        endLine: endLine
    };
};

GPTViz.getPromptSectionFromLines = function(lines, startLine) {
    return GPTViz.getHeadingSectionFromLines(lines, startLine);
};

GPTViz.getPromptSection = function(editor) {
    const lineCount = editor.lineCount();
    const cursorLine = editor.getCursor().line;
    const lines = [];

    for (let line = 0; line < lineCount; line++) {
        lines.push(editor.getLine(line));
    }

    let startLine = -1;

    // Find nearest Prompt heading at or above cursor.
    for (let line = cursorLine; line >= 0; line--) {
        if (GPTViz.isPromptHeading(lines[line])) {
            startLine = line;
            break;
        }
    }

    // If none above cursor, use first Prompt heading in file.
    if (startLine === -1) {
        for (let line = 0; line < lineCount; line++) {
            if (GPTViz.isPromptHeading(lines[line])) {
                startLine = line;
                break;
            }
        }
    }

    if (startLine === -1) {
        return null;
    }

    return GPTViz.getPromptSectionFromLines(lines, startLine);
};


GPTViz.getPromptParts = function(section) {
    const textLines = [];
    const imageNames = [];

    for (const line of section.text.split("\n")) {
        const match = /^[ \t]*Images:[ \t]*(.*)$/.exec(line);

        if (match) {
            for (const name of match[1].split(",")) {
                const trimmedName = name.trim();

                if (trimmedName) {
                    imageNames.push(trimmedName);
                }
            }
        } else {
            textLines.push(line);
        }
    }

    return {
        text: textLines.join("\n"),
        imageNames: imageNames
    };
};

GPTViz.getPromptPartsFromText = function(text) {
    return GPTViz.getPromptParts({
        text: String(text || "")
    });
};

GPTViz.normalizeIncludeHeadingLabel = function(value) {
    return String(value || "")
        .replace(/\s*#+\s*$/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
};

GPTViz.parseIncludeSpec = function(specText) {
    const raw = String(specText || "").trim();

    if (!raw) {
        return {
            path: "",
            heading: ""
        };
    }

    const hashIndex = raw.indexOf("#");

    if (hashIndex === -1) {
        return {
            path: raw,
            heading: ""
        };
    }

    return {
        path: raw.slice(0, hashIndex).trim(),
        heading: raw.slice(hashIndex + 1).trim()
    };
};

GPTViz.normalizeVaultPath = function(path) {
    const parts = [];

    for (const part of String(path || "").replace(/\\/g, "/").split("/")) {
        const segment = part.trim();

        if (!segment || segment === ".") {
            continue;
        }

        if (segment === "..") {
            if (parts.length > 0) {
                parts.pop();
            }
            continue;
        }

        parts.push(segment);
    }

    return parts.join("/");
};

GPTViz.resolveIncludePath = function(targetPath, fromPath, vaultName) {
    let includePath = String(targetPath || "").trim();

    if (!includePath) {
        return "";
    }

    includePath = includePath.replace(/^<|>$/g, "").replace(/\\/g, "/");

    if (includePath.startsWith("/")) {
        const marker = `/${vaultName}/`;
        const markerIndex = includePath.indexOf(marker);

        if (markerIndex !== -1) {
            includePath = includePath.slice(markerIndex + marker.length);
        }

        return GPTViz.normalizeVaultPath(includePath.replace(/^\/+/, ""));
    }

    const sourcePath = GPTViz.normalizeVaultPath(fromPath || "");
    const slashIndex = sourcePath.lastIndexOf("/");
    const sourceDir = slashIndex === -1
        ? ""
        : sourcePath.slice(0, slashIndex + 1);

    return GPTViz.normalizeVaultPath(`${sourceDir}${includePath}`);
};

GPTViz.extractHeadingBodyFromText = function(text, headingName) {
    const target = GPTViz.normalizeIncludeHeadingLabel(headingName);

    if (!target) {
        return null;
    }

    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    let startLine = -1;
    let level = 0;

    for (let line = 0; line < lines.length; line++) {
        const parsed = GPTViz.parseHeading(lines[line]);

        if (!parsed) {
            continue;
        }

        if (GPTViz.normalizeIncludeHeadingLabel(parsed.text) === target) {
            startLine = line;
            level = parsed.level;
            break;
        }
    }

    if (startLine === -1) {
        return null;
    }

    let endLine = lines.length;

    for (let line = startLine + 1; line < lines.length; line++) {
        const parsed = GPTViz.parseHeading(lines[line]);

        if (parsed && parsed.level <= level) {
            endLine = line;
            break;
        }
    }

    return lines.slice(startLine + 1, endLine).join("\n");
};

GPTViz.expandIncludesInText = async function(app, text, fromPath, stack, maxDepth, options) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const output = [];
    const includeStack = Array.isArray(stack) ? stack : [];
    const depthLimit = Number.isFinite(Number(maxDepth))
        ? Number(maxDepth)
        : 8;
    const includeOptions = options && typeof options === "object"
        ? options
        : {};
    const disallowIncludedImagesTag = includeOptions.disallowIncludedImagesTag === true;

    if (includeStack.length > depthLimit) {
        throw new Error(
            `Include error at ${fromPath || "<inline>"}: maximum include depth exceeded (${depthLimit}).`
        );
    }

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const match = /^\s*\{#(?:include|incude)\s+(.+?)\}\s*$/i.exec(line);

        if (!match) {
            output.push(line);
            continue;
        }

        const includeSpec = GPTViz.parseIncludeSpec(match[1]);
        const sourceLabel = fromPath || "<inline>";
        const sourceLine = index + 1;

        if (!includeSpec.path) {
            throw new Error(
                `Include error at ${sourceLabel}:${sourceLine} - missing include path.`
            );
        }

        const resolvedPath = GPTViz.resolveIncludePath(
            includeSpec.path,
            fromPath,
            app.vault.getName()
        );

        if (!resolvedPath) {
            throw new Error(
                `Include error at ${sourceLabel}:${sourceLine} - could not resolve include path '${includeSpec.path}'.`
            );
        }

        const includeKey = includeSpec.heading
            ? `${resolvedPath}#${includeSpec.heading}`
            : resolvedPath;

        if (includeStack.includes(includeKey)) {
            const chain = [...includeStack, includeKey].join(" -> ");
            throw new Error(
                `Include error at ${sourceLabel}:${sourceLine} - include cycle detected: ${chain}`
            );
        }

        const includeFile = app.vault.getAbstractFileByPath(resolvedPath);

        if (!includeFile || !includeFile.extension) {
            throw new Error(
                `Include error at ${sourceLabel}:${sourceLine} - file not found: ${resolvedPath}`
            );
        }

        let includeText;

        try {
            includeText = await app.vault.cachedRead(includeFile);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            throw new Error(
                `Include error at ${sourceLabel}:${sourceLine} - could not read ${resolvedPath}: ${message}`
            );
        }

        if (includeSpec.heading) {
            const sectionBody = GPTViz.extractHeadingBodyFromText(
                includeText,
                includeSpec.heading
            );

            if (sectionBody === null) {
                throw new Error(
                    `Include error at ${sourceLabel}:${sourceLine} - heading not found in ${resolvedPath}: ${includeSpec.heading}`
                );
            }

            includeText = sectionBody;
        }

        if (disallowIncludedImagesTag) {
            const includedLines = String(includeText || "").replace(/\r\n/g, "\n").split("\n");
            const imagesIndex = includedLines.findIndex(line => /^[ \t]*Images:[ \t]*/i.test(line));

            if (imagesIndex !== -1) {
                throw new Error(
                    `Include error at ${sourceLabel}:${sourceLine} - included content from ${resolvedPath} contains an Images: tag (line ${imagesIndex + 1}); Images: is not allowed inside # Prompt includes.`
                );
            }
        }

        const expanded = await GPTViz.expandIncludesInText(
            app,
            includeText,
            resolvedPath,
            [...includeStack, includeKey],
            depthLimit,
            includeOptions
        );

        output.push(expanded);
    }

    return output.join("\n");
};

GPTViz.binaryToBase64 = function(binary) {
    const bytes = new Uint8Array(binary);
    let characters = "";

    for (let index = 0; index < bytes.length; index++) {
        characters += String.fromCharCode(bytes[index]);
    }

    return btoa(characters);
};

GPTViz.pngCrc32 = function(bytes) {
    let crc = 0xffffffff;

    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (
                (crc & 1) ? 0xedb88320 : 0
            );
        }
    }

    return (crc ^ 0xffffffff) >>> 0;
};

GPTViz.embedPromptInPng = function(binary, prompt) {
    const source = new Uint8Array(binary);
    const signature = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10
    ]);

    for (let index = 0; index < signature.length; index++) {
        if (source[index] !== signature[index]) {
            throw new Error("Image generation returned invalid PNG data.");
        }
    }

    const encoder = new TextEncoder();
    const keyword = encoder.encode("Prompt");
    const text = encoder.encode(
        String(prompt || "").replace(/\u0000/g, "")
    );
    const data = new Uint8Array(
        keyword.length + 1 + 1 + 1 + 1 + 1 + text.length
    );
    let offset = 0;

    data.set(keyword, offset);
    offset += keyword.length;
    data[offset++] = 0;
    data[offset++] = 0;
    data[offset++] = 0;
    data[offset++] = 0;
    data[offset++] = 0;
    data.set(text, offset);

    const type = encoder.encode("iTXt");
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(type, 4);
    chunk.set(data, 8);

    const crcInput = new Uint8Array(type.length + data.length);
    crcInput.set(type, 0);
    crcInput.set(data, type.length);
    view.setUint32(
        8 + data.length,
        GPTViz.pngCrc32(crcInput)
    );

    let position = signature.length;
    let insertAt = -1;
    while (position + 12 <= source.length) {
        const length = new DataView(
            source.buffer,
            source.byteOffset + position,
            4
        ).getUint32(0);
        const typeText = String.fromCharCode(
            source[position + 4],
            source[position + 5],
            source[position + 6],
            source[position + 7]
        );
        const nextPosition = position + 12 + length;

        if (nextPosition > source.length) {
            throw new Error("Image generation returned truncated PNG data.");
        }

        if (typeText === "IHDR") {
            insertAt = nextPosition;
            break;
        }

        position = nextPosition;
    }

    if (insertAt === -1) {
        throw new Error("Image generation returned a PNG without an IHDR chunk.");
    }

    const result = new Uint8Array(source.length + chunk.length);
    result.set(source.slice(0, insertAt), 0);
    result.set(chunk, insertAt);
    result.set(source.slice(insertAt), insertAt + chunk.length);
    return result.buffer;
};

GPTViz.extractPromptFromPng = function(binary) {
    const source = new Uint8Array(binary);
    const signature = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10
    ]);

    for (let index = 0; index < signature.length; index++) {
        if (source[index] !== signature[index]) {
            return null;
        }
    }

    const decoder = new TextDecoder();
    let position = signature.length;

    while (position + 12 <= source.length) {
        const view = new DataView(
            source.buffer,
            source.byteOffset + position,
            4
        );
        const length = view.getUint32(0);
        const typeText = String.fromCharCode(
            source[position + 4],
            source[position + 5],
            source[position + 6],
            source[position + 7]
        );
        const dataStart = position + 8;
        const nextPosition = position + 12 + length;

        if (nextPosition > source.length) {
            return null;
        }

        if (typeText === "iTXt") {
            const dataEnd = dataStart + length;
            let cursor = dataStart;
            const keywordStart = cursor;

            while (cursor < dataEnd && source[cursor] !== 0) {
                cursor++;
            }

            const keyword = decoder.decode(
                source.slice(keywordStart, cursor)
            );
            if (keyword === "Prompt" && cursor + 2 < dataEnd) {
                const compressionFlag = source[cursor + 1];
                cursor += 3;

                if (compressionFlag === 0) {
                    while (cursor < dataEnd && source[cursor] !== 0) {
                        cursor++;
                    }
                    if (cursor >= dataEnd) {
                        return null;
                    }
                    cursor++;

                    while (cursor < dataEnd && source[cursor] !== 0) {
                        cursor++;
                    }
                    if (cursor >= dataEnd) {
                        return null;
                    }
                    cursor++;

                    return decoder.decode(source.slice(cursor, dataEnd));
                }
            }
        }

        position = nextPosition;
    }

    return null;
};

GPTViz.loadPromptImages = async function(app, imageNames) {
    const imageInputs = [];
    const sourcePrompts = [];
    const warnings = [];

    for (const imageName of imageNames) {
        const path = /\.[^./]+$/.test(imageName)
            ? imageName
            : `${imageName}.png`;
        let file = app.vault.getAbstractFileByPath(path);

        if (!file || !file.extension) {
            file = app.vault.getAbstractFileByPath(`candidates/${path}`);
        }

        if (!file || !file.extension) {
            warnings.push(`Image not found: ${path}`);
            continue;
        }

        const extension = file.extension.toLowerCase();
        const mimeTypes = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp"
        };
        const mimeType = mimeTypes[extension];

        if (!mimeType) {
            warnings.push(`Unsupported image type: ${path}`);
            continue;
        }

        let binary;

        try {
            binary = await app.vault.readBinary(file);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            warnings.push(`Could not read image ${path}: ${message}`);
            continue;
        }

        imageInputs.push({
            type: "input_image",
            image_url: `data:${mimeType};base64,${GPTViz.binaryToBase64(binary)}`
        });
        sourcePrompts.push({
            path: file.path,
            prompt: GPTViz.extractPromptFromPng(binary)
        });
    }

    return {
        imageInputs: imageInputs,
        sourcePrompts: sourcePrompts,
        warnings: warnings
    };
};


GPTViz.getPromptSectionsFromText = function(text) {
    const lines = text.split("\n");
    const sections = [];

    for (let line = 0; line < lines.length; line++) {
        if (GPTViz.isPromptHeading(lines[line])) {
            sections.push(
                GPTViz.getPromptSectionFromLines(lines, line)
            );
        }
    }

    return sections;
};


GPTViz.isExtractHeading = function(line) {
    const heading = GPTViz.parseHeading(line);

    return (
        heading !== null &&
        heading.level === 1 &&
        heading.text.trim() === "Extract"
    );
};

GPTViz.getExtractSectionsFromText = function(text) {
    const lines = String(text || "").split("\n");
    const sections = [];

    for (let line = 0; line < lines.length; line++) {
        if (GPTViz.isExtractHeading(lines[line])) {
            sections.push(
                GPTViz.getHeadingSectionFromLines(lines, line)
            );
        }
    }

    return sections;
};

GPTViz.parseExtractBlocksFromText = function(text, markdownFile) {
    const sections = GPTViz.getExtractSectionsFromText(text);
    const blocks = [];
    const seenAssets = new Set();

    for (const section of sections) {
        const lines = section.text.split("\n");
        let asset = "";
        let source = "";
        const bodyLines = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const assetMatch = /^[ \t]*Asset:[ \t]*(.+)$/i.exec(line);
            if (assetMatch) {
                asset = assetMatch[1].trim();
                continue;
            }

            const sourceMatch = /^[ \t]*Source:[ \t]*(.+)$/i.exec(line);
            if (sourceMatch) {
                source = sourceMatch[1].trim();
                continue;
            }

            bodyLines.push(line);
        }

        const lineNumber = section.startLine + 1;

        if (!asset) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Missing required 'Asset:' in # Extract block.`
            );
        }

        if (!/\.png$/i.test(asset)) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Asset must end with .png (got '${asset}').`
            );
        }

        const normalizedAsset = asset.toLowerCase();
        if (seenAssets.has(normalizedAsset)) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Duplicate Asset target '${asset}'.`
            );
        }
        seenAssets.add(normalizedAsset);

        const prompt = bodyLines.join("\n").trim();
        if (!prompt) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Empty # Extract prompt body for '${asset}'.`
            );
        }

        blocks.push({
            asset,
            source,
            prompt,
            line: lineNumber,
            startLine: section.startLine,
            endLine: section.endLine
        });
    }

    return blocks;
};

GPTViz.base64ToArrayBuffer = function(base64Text) {
    const binary = atob(String(base64Text || ""));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes.buffer;
};

GPTViz.removeKeyColorFromPng = async function(binary, tolerance) {
    const threshold = Number.isFinite(Number(tolerance))
        ? Number(tolerance)
        : 40;
    const feather = threshold * 2;

    const blob = new Blob([binary], { type: "image/png" });
    const imageUrl = URL.createObjectURL(blob);

    try {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("Could not decode PNG for Extract post-processing."));
            element.src = imageUrl;
        });

        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;

        if (!width || !height) {
            throw new Error("Could not decode Extract image dimensions.");
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Could not create 2D context for Extract post-processing.");
        }

        context.drawImage(image, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        const sampleRadius = 2;
        const corners = [
            [0, 0],
            [width - 1, 0],
            [0, height - 1],
            [width - 1, height - 1]
        ];
        let sampleCount = 0;
        let keyR = 0;
        let keyG = 0;
        let keyB = 0;

        for (const [cornerX, cornerY] of corners) {
            for (let offsetY = -sampleRadius; offsetY <= sampleRadius; offsetY++) {
                for (let offsetX = -sampleRadius; offsetX <= sampleRadius; offsetX++) {
                    const x = Math.max(0, Math.min(width - 1, cornerX + offsetX));
                    const y = Math.max(0, Math.min(height - 1, cornerY + offsetY));
                    const index = (y * width + x) * 4;
                    const alpha = pixels[index + 3];

                    if (alpha === 0) {
                        continue;
                    }

                    keyR += pixels[index];
                    keyG += pixels[index + 1];
                    keyB += pixels[index + 2];
                    sampleCount += 1;
                }
            }
        }

        if (sampleCount === 0) {
            return binary;
        }

        keyR /= sampleCount;
        keyG /= sampleCount;
        keyB /= sampleCount;

        for (let index = 0; index < pixels.length; index += 4) {
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            const alpha = pixels[index + 3];

            if (alpha === 0) {
                continue;
            }

            const distance = Math.sqrt(
                (red - keyR) * (red - keyR) +
                (green - keyG) * (green - keyG) +
                (blue - keyB) * (blue - keyB)
            );

            if (distance <= threshold) {
                pixels[index + 3] = 0;
                continue;
            }

            if (distance <= feather) {
                const factor = (distance - threshold) / (feather - threshold);
                pixels[index + 3] = Math.max(0, Math.min(255, Math.round(alpha * factor)));
            }
        }

        context.putImageData(imageData, 0, 0);

        const pngBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => {
                if (result) {
                    resolve(result);
                    return;
                }

                reject(new Error("Could not encode PNG after Extract post-processing."));
            }, "image/png");
        });

        return await pngBlob.arrayBuffer();
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
};

GPTViz.isMarkHeading = function(line) {
    const heading = GPTViz.parseHeading(line);

    return (
        heading !== null &&
        heading.level === 1 &&
        heading.text.trim() === "Mark"
    );
};

GPTViz.getMarkSectionsFromText = function(text) {
    const lines = String(text || "").split("\n");
    const sections = [];

    for (let line = 0; line < lines.length; line++) {
        if (GPTViz.isMarkHeading(lines[line])) {
            sections.push(
                GPTViz.getHeadingSectionFromLines(lines, line)
            );
        }
    }

    return sections;
};

GPTViz.parseMarkBlocksFromText = function(text, markdownFile) {
    const sections = GPTViz.getMarkSectionsFromText(text);
    const blocks = [];
    const seenNames = new Set();

    for (const section of sections) {
        const lines = section.text.split("\n");
        let name = "";
        let source = "";
        const bodyLines = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const nameMatch = /^[ \t]*Name:[ \t]*(.+)$/i.exec(line);
            if (nameMatch) {
                name = nameMatch[1].trim();
                continue;
            }

            const sourceMatch = /^[ \t]*Source:[ \t]*(.+)$/i.exec(line);
            if (sourceMatch) {
                source = sourceMatch[1].trim();
                continue;
            }

            bodyLines.push(line);
        }

        const lineNumber = section.startLine + 1;

        if (!name) {
            throw new Error(
                `Mark parse error at ${markdownFile}:${lineNumber} - Missing required 'Name:' in # Mark block.`
            );
        }

        if (seenNames.has(name)) {
            throw new Error(
                `Mark parse error at ${markdownFile}:${lineNumber} - Duplicate mark name '${name}'.`
            );
        }
        seenNames.add(name);

        const prompt = bodyLines.join("\n").trim();
        if (!prompt) {
            throw new Error(
                `Mark parse error at ${markdownFile}:${lineNumber} - Empty # Mark prompt body for '${name}'.`
            );
        }

        blocks.push({
            name,
            source,
            prompt,
            line: lineNumber
        });
    }

    return blocks;
};

globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");

GPTViz.DEFAULT_SETTINGS = {
    apiKeySecret: ""
};

GPTViz.SettingTab = class extends GPTViz.obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const containerEl = this.containerEl;

        containerEl.empty();

        new GPTViz.obsidian.Setting(containerEl)
            .setName("OpenAI API key")
            .setDesc("Select or create the secret containing your OpenAI API key.")
            .addComponent(el =>
                new GPTViz.obsidian.SecretComponent(this.app, el)
                    .setValue(this.plugin.settings.apiKeySecret)
                    .onChange(async value => {
                        this.plugin.settings.apiKeySecret = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
};

