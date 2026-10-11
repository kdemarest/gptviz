unit("depends-mode", ["plugin"], () => {
// DependsMode: what the viewed thing is made from. From Markdown, picking a dependency opens
// the note producing it; from the Candidate View or the movie player, it opens that image in
// the Candidate View. Only direct dependencies: pick one and tap again to go deeper.
Object.assign(GPTViz.Plugin.prototype, {
    // Inputs of every operation in a note (Prompt Images:, Extract/Mark Source:, the images a
    // Script shows), plus the Images: of unnamed Prompt sections, which the graph doesn't index.
    // The inputs of the section holding cursorLine (0-based, or -1) come first.
    async getNoteDependencyAssets(note, records, cursorLine) {
        const own = records
            .filter(record => record.filePath === note.path)
            .sort((left, right) => left.line - right.line);
        const current = cursorLine >= 0
            ? own.filter(record => record.line - 1 <= cursorLine).pop()
            : null;

        const rest = new Set();
        own.forEach(record => record.resolvedInputs.forEach(asset => rest.add(asset)));
        const text = await this.app.vault.cachedRead(note);
        for (const section of GPTViz.getPromptSectionsFromText(text)) {
            for (const name of GPTViz.getPromptParts(section).imageNames) {
                rest.add(GPTViz.normalizeDependencyAssetPath(name, ".png"));
            }
        }

        return [
            ...(current ? current.resolvedInputs : []),
            ...[...rest].sort((left, right) => left.localeCompare(right))
        ];
    },

    // Inputs of one asset: those of the operation producing it, else (an unnamed Prompt) the
    // Images: of its Prompt section.
    async getAssetDependencyAssets(note, asset, records) {
        const target = asset.toLowerCase();
        const producer = records.find(record => record.outputPath.toLowerCase() === target);
        if (producer) {
            return producer.resolvedInputs;
        }

        const section = GPTViz.findPromptSectionForAsset(await this.app.vault.cachedRead(note), asset, note.basename);
        return section
            ? GPTViz.getPromptParts(section).imageNames.map(name => GPTViz.normalizeDependencyAssetPath(name, ".png"))
            : [];
    },

    // Each asset with the note producing it (Prompt/Extract heading, else a same-named note),
    // as that producer spells it, in order and without duplicates. Assets the viewed note
    // produces itself are left out. Returns { resources: [{ asset, note }], unresolved: [asset] }.
    resolveDependencyAssets(assets, records, ownNotePath) {
        const producerByOutput = new Map();
        for (const record of records) {
            if (record.outputPath) {
                producerByOutput.set(record.outputPath.toLowerCase(), record);
            }
        }

        const resources = [];
        const unresolved = [];
        const seen = new Set();

        for (const value of assets) {
            const asset = String(value || "").toLowerCase();
            if (!asset || seen.has(asset)) {
                continue;
            }
            seen.add(asset);

            const producer = producerByOutput.get(asset);
            let note = producer ? this.app.vault.getAbstractFileByPath(producer.filePath) : null;
            let assetName = producer ? producer.outputPath : value;

            if (!note) {
                const baseName = asset.split("/").pop().replace(/\.[^.]+$/, "");
                const sameNamePath = GPTViz.contentPath(`${baseName}.md`).toLowerCase();
                note = this.app.vault.getMarkdownFiles().find(file => file.path.toLowerCase() === sameNamePath) || null;
                if (note) {
                    assetName = `${note.basename}.png`;
                }
            }

            if (note && note.path === ownNotePath) {
                continue;
            }
            if (note) {
                resources.push({ asset: assetName, note });
            } else {
                unresolved.push(value);
            }
        }

        return { resources, unresolved };
    },

    async handleDependsModeRequest(view) {
        const isMarkdown = view instanceof GPTViz.obsidian.MarkdownView;
        const records = (await GPTViz.buildDependencyHeadingReport(this.app)).graph.records;
        let note = null;
        let subject = "";
        let assets = [];

        if (isMarkdown) {
            note = view.file;
            subject = note.basename;
            assets = await this.getNoteDependencyAssets(note, records, this.getCursorLineForMovieMode(note, view.leaf));
        } else if (this.isCandidateView(view)) {
            note = view.activeFile;
            subject = view.assetPath.replace(/\.png$/i, "");
            assets = await this.getAssetDependencyAssets(note, view.assetPath, records);
        } else if (this.isMoviPlayerView(view)) {
            note = this.resolveMovieSourceMarkdownFile(view);
            subject = note ? note.basename : "";
            assets = note ? await this.getNoteDependencyAssets(note, records, -1) : [];
        }

        if (!note) {
            throw new Error("DependsMode: this view is not showing a note.");
        }

        const { resources, unresolved } = this.resolveDependencyAssets(assets, records, note.path);
        const rows = resources.map(resource => ({
            label: resource.asset.replace(/\.png$/i, ""),
            value: resource
        }));

        new GPTViz.DependsModal(this.app, subject, rows, unresolved, async resource => {
            try {
                if (isMarkdown) {
                    this.recordBackPlace();
                    await view.leaf.openFile(resource.note);
                } else {
                    await this.openAssetInCandidateView(resource.note, resource.asset, null);
                }
            } catch (error) {
                this.reportError("opening a dependency", error);
            }
        }).open();
    }
});
});
