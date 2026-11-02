unit("depends-mode", ["plugin"], () => {
// DependsMode: what the viewed thing is made from. From Markdown, picking a dependency opens
// the note producing it, at its Prompt; from the Candidate View or the movie player, it opens that image in
// the Candidate View. Only direct dependencies: pick one and tap again to go deeper.
Object.assign(GPTViz.Plugin.prototype, {
    // Inputs of every operation in a note (Prompt Images:, Extract/Mark Source:, the images a
    // Script shows), plus the Images: of unnamed Prompt sections, which the graph doesn't index.
    // The inputs of the section holding cursorLine (0-based, or -1) come first; that section's
    // own output is left out, but the note's other outputs it uses are listed.
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

        const ownOutput = current ? current.outputPath.toLowerCase() : "";
        return [
            ...(current ? current.resolvedInputs : []),
            ...[...rest].sort((left, right) => left.localeCompare(right))
        ].filter(asset => !ownOutput || asset.toLowerCase() !== ownOutput);
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
    // as that producer spells it, in order and without duplicates.
    // Returns { resources: [{ asset, note }], unresolved: [asset] }.
    resolveDependencyAssets(assets, records) {
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
                note = GPTViz.resolveName(this.app, `${baseName}.md`).file || null;
                if (note) {
                    assetName = `${note.basename}.png`;
                }
            }

            if (note) {
                resources.push({ asset: assetName, note });
            } else {
                unresolved.push(value);
            }
        }

        return { resources, unresolved };
    },

    // Generate's check: the images file's Prompt for assetPath names that don't exist yet.
    // Tapping one opens the Prompt that makes it (a Prompt heading, else a same-named note);
    // one with no Prompt gets a new one in file, after this Prompt, for the user to move to
    // its owner.
    async showMissingImages(file, assetPath, names) {
        const records = (await GPTViz.buildDependencyHeadingReport(this.app)).graph.records;
        const subject = assetPath.replace(/\.png$/i, "");
        const rows = [];

        for (const name of names) {
            const asset = GPTViz.normalizeDependencyAssetPath(name, ".png");
            const producer = records.find(record => record.outputPath.toLowerCase() === asset.toLowerCase());
            const note = producer
                ? this.app.vault.getAbstractFileByPath(producer.filePath)
                : GPTViz.resolveName(this.app, `${asset.replace(/\.png$/i, "")}.md`).file;
            if (note) {
                rows.push({ label: name, value: { note, asset: producer ? producer.outputPath : `${note.basename}.png` } });
            } else {
                rows.push({ label: `${name} (no prompt: tap to start one)`, value: { name, asset } });
            }
        }

        new GPTViz.DependsModal(this.app, subject, rows, [], async ({ note, name, asset }) => {
            try {
                if (note) {
                    await this.showPromptSection(note, asset);
                    return;
                }
                await this.startPromptForImage(file, assetPath, name);
                const view = await this.showPromptSection(file, asset);
                const editor = view ? view.editor : null;
                if (editor && view.getMode() !== "preview") {
                    const text = editor.getValue().split("\n");
                    const line = text.findIndex((value, index) => index >= editor.getCursor().line && value.includes("<subject>"));
                    if (line >= 0) {
                        const ch = text[line].indexOf("<subject>");
                        editor.setSelection({ line, ch }, { line, ch: ch + "<subject>".length });
                    }
                }
            } catch (error) {
                this.reportError(note ? "opening a missing image's prompt" : "starting a missing image's prompt", error);
            }
        }, {
            title: `${subject} needs images that don't exist yet`,
            message: "Nothing was generated. Tap one to open its prompt, or to start one."
        }).open();
    },

    // From a note: the Prompt or Extract holding the cursor, else the one picked from the note's
    // list (as ImageMode does). A note with none, such as a Script's, lists the whole note, and
    // so does a picker row for the note's Scripts and Marks when it has them.
    async handleMarkdownDependsRequest(view, records) {
        const note = view.file;
        const cursorLine = this.getCursorLineForMovieMode(note, view.leaf);
        const rows = await this.getMovieModeAssetRowsForMarkdownFile(note);
        const showRow = async row => this.showDependsList(view, note, row.assetPath.replace(/\.png$/i, ""),
            await this.getAssetDependencyAssets(note, row.assetPath, records), records);
        const showNote = async () => this.showDependsList(view, note, note.basename,
            await this.getNoteDependencyAssets(note, records, cursorLine), records);
        const hasOthers = records.some(record =>
            record.filePath === note.path && record.operation !== "Prompt" && record.operation !== "Extract");

        const here = rows.find(row => cursorLine >= row.startLine && cursorLine < row.endLine);
        if (here) {
            await showRow(here);
            return;
        }
        if (rows.length === 0) {
            await showNote();
            return;
        }
        if (rows.length === 1 && !hasOthers) {
            await showRow(rows[0]);
            return;
        }

        const pickRows = rows.map(row => ({ label: row.assetPath.replace(/\.png$/i, ""), value: row }));
        if (hasOthers) {
            pickRows.push({ label: `All of ${note.basename}`, value: null });
        }
        new GPTViz.PickListModal(this.app, `What in ${note.basename} depends on what?`, pickRows, "", async row => {
            try {
                await (row ? showRow(row) : showNote());
            } catch (error) {
                this.reportError("switching to DependsMode", error);
            }
        }).open();
    },

    async handleDependsModeRequest(view) {
        const records = (await GPTViz.buildDependencyHeadingReport(this.app)).graph.records;

        if (view instanceof GPTViz.obsidian.MarkdownView) {
            if (!view.file) {
                throw new Error("DependsMode: this view is not showing a note.");
            }
            await this.handleMarkdownDependsRequest(view, records);
            return;
        }

        let note = null;
        let subject = "";
        let assets = [];
        if (this.isCandidateView(view)) {
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
        await this.showDependsList(view, note, subject, assets, records);
    },

    // Why a dependency's image is out of date, or "" when it isn't (or can't be told): not made
    // yet, made from another prompt than its Prompt gives now (the PNG holds the prompt that
    // made it; one saved without Traits counts too), or older than one of its own inputs.
    async getDependencyStaleness(resource, records) {
        const file = GPTViz.resolveName(this.app, resource.asset, [".png"]).file;
        if (!file) {
            return "not made yet";
        }

        const reasons = [];
        const section = GPTViz.findPromptSectionForAsset(
            await this.app.vault.cachedRead(resource.note), resource.asset, resource.note.basename);
        if (section) {
            const saved = GPTViz.extractPromptFromPng(await this.app.vault.readBinary(file));
            const { promptParts, promptText } = await this.buildPromptText(section, resource.note);
            if (saved && saved.trim() !== promptText.trim() && saved.trim() !== promptParts.text.trim()) {
                reasons.push("prompt changed");
            }
        }

        const newer = [];
        for (const input of await this.getAssetDependencyAssets(resource.note, resource.asset, records)) {
            const inputFile = GPTViz.resolveName(this.app, input.split("/").pop(), [".png"]).file;
            if (inputFile && inputFile.stat.mtime > file.stat.mtime) {
                newer.push(inputFile.basename);
            }
        }
        if (newer.length > 0) {
            reasons.push(`${newer.join(", ")} newer`);
        }

        return reasons.length > 0 ? `out of date: ${reasons.join("; ")}` : "";
    },

    // The list of what subject depends on, each marked when out of date. From Markdown a pick
    // opens its note at its Prompt; elsewhere it opens its image in the Candidate View.
    async showDependsList(view, note, subject, assets, records) {
        const isMarkdown = view instanceof GPTViz.obsidian.MarkdownView;
        const { resources, unresolved } = this.resolveDependencyAssets(assets, records);
        const rows = await Promise.all(resources.map(async resource => {
            let detail;
            try {
                detail = await this.getDependencyStaleness(resource, records);
            } catch (error) {
                detail = `couldn't check: ${error.message}`;
            }
            return { label: resource.asset.replace(/\.png$/i, ""), value: resource, detail };
        }));

        new GPTViz.DependsModal(this.app, subject, rows, unresolved, async resource => {
            try {
                if (isMarkdown) {
                    await this.showPromptSection(resource.note, resource.asset, view.leaf);
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
