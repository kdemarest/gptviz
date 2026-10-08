globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");

Object.assign(GPTViz.Plugin.prototype, {
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
    },

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
    },

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
    },

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
    },

    getModeRibbonButton(view, key) {
        if (!view || !view.containerEl || !key) {
            return null;
        }

        return view.containerEl.querySelector(
            `.mode-ribbon [data-mode-button-key="${CSS.escape(key)}"]`
        );
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    scheduleMarkdownReviewActionStateRefresh() {
        if (this.markdownReviewActionRefreshTimer) {
            window.clearTimeout(this.markdownReviewActionRefreshTimer);
        }

        this.markdownReviewActionRefreshTimer = window.setTimeout(() => {
            this.markdownReviewActionRefreshTimer = null;
            this.updateMarkdownReviewActionStates();
        }, 200);
    },

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
});
