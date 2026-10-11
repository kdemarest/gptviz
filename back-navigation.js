unit("back-navigation", ["plugin"], () => {
// Browser-style Back across Markdown, the Candidate View and the movie player. Every gptviz
// navigation (openNote, openCandidateView, requestMovieMode, DependsMode in Markdown) first
// records the place being left; Back returns to the last recorded place that differs from
// the current one. Session only, newest last.
GPTViz.BACK_HISTORY_LIMIT = 50;

Object.assign(GPTViz.Plugin.prototype, {
    // The place a view shows, or null for views Back can't return to.
    describePlace(view) {
        if (view instanceof GPTViz.obsidian.MarkdownView && view.file) {
            return { kind: "markdown", path: view.file.path };
        }
        if (this.isCandidateView(view) && view.activeFile) {
            const state = view.getState();
            return { kind: "candidate", path: state.file, asset: state.asset, candidate: state.candidate };
        }
        if (this.isMoviPlayerView(view)) {
            const sourceFile = this.resolveMovieSourceMarkdownFile(view);
            return sourceFile ? { kind: "movie", path: sourceFile.path } : null;
        }
        return null;
    },

    // Places with the same key are the same stop for Back (a candidate view stop ignores
    // which candidate was showing).
    placeKey(place) {
        return place ? `${place.kind}|${place.path}|${place.asset || ""}`.toLowerCase() : "";
    },

    recordBackPlace() {
        if (this.navigatingBack) {
            return;
        }

        const place = this.describePlace(this.app.workspace.getMostRecentLeaf()?.view);
        if (!place) {
            return;
        }

        this.backHistory = this.backHistory || [];
        const last = this.backHistory[this.backHistory.length - 1];
        if (last && this.placeKey(last) === this.placeKey(place)) {
            this.backHistory[this.backHistory.length - 1] = place;
        } else {
            this.backHistory.push(place);
            this.backHistory.splice(0, Math.max(0, this.backHistory.length - GPTViz.BACK_HISTORY_LIMIT));
        }
        this.updateModeRibbonButtonStates();
    },

    hasBackPlace() {
        return Boolean(this.backHistory && this.backHistory.length > 0);
    },

    async goBack(view) {
        const currentKey = this.placeKey(this.describePlace(view));
        const history = this.backHistory || [];
        while (history.length > 0 && this.placeKey(history[history.length - 1]) === currentKey) {
            history.pop();
        }

        const place = history.pop();
        this.updateModeRibbonButtonStates();
        if (!place) {
            new GPTViz.obsidian.Notice("GPTViz: nothing to go back to.");
            return;
        }

        const file = this.app.vault.getAbstractFileByPath(place.path);
        if (!file || file.extension !== "md") {
            throw new Error(`Back: note not found: ${place.path}`);
        }

        this.navigatingBack = true;
        try {
            if (place.kind === "markdown") {
                await this.openNote(file);
            } else if (place.kind === "candidate") {
                await this.openCandidateView({ file, asset: place.asset, candidate: place.candidate });
            } else {
                await this.requestMovieMode({ source: "back", filePath: place.path });
            }
        } finally {
            this.navigatingBack = false;
        }
    }
});
});
