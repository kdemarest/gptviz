unit("generate", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    // A note's text as saved. A loaded editor showing the note is saved first, so typing
    // from the last moments (before Obsidian's autosave) counts.
    async readNoteText(file) {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            if (leaf.view instanceof GPTViz.obsidian.MarkdownView && leaf.view.file?.path === file.path) {
                await leaf.view.save();
            }
        }
        return await this.app.vault.read(file);
    },

    // The asset being worked on: the Candidate View's, else the note's selected or default one.
    getWorkingAssetPath(file, candidateView) {
        return candidateView && candidateView.assetPath
            ? GPTViz.normalizeDependencyAssetPath(candidateView.assetPath, ".png")
            : this.getActiveCandidateAssetPath(file);
    },

    // The resolved prompt text that produces assetPath, or null when no Prompt produces it
    // (e.g. Extract outputs).
    async getCurrentPromptForFile(file, assetPath) {
        const section = GPTViz.findPromptSectionForAsset(await this.readNoteText(file), assetPath, file.basename);
        if (!section) {
            return null;
        }

        const resolvedSectionText = await GPTViz.expandIncludesInText(
            this.app,
            section.text,
            file.path,
            [file.path],
            8,
            { disallowIncludedImagesTag: true }
        );

        return GPTViz.getPromptParts({ text: resolvedSectionText }).text;
    },

    // Starts a "# Prompt <name>" in file, just after the Prompt for assetPath (else at the end),
    // from the vault's reference-image header, replacing the blank lines between them.
    async startPromptForImage(file, assetPath, name) {
        await this.readNoteText(file);
        await this.app.vault.process(file, text => {
            const lines = text.replace(/\r\n/g, "\n").split("\n");
            const section = GPTViz.findPromptSectionForAsset(text, assetPath, file.basename);
            const end = section ? section.endLine : lines.length;
            let at = end;
            while (at > 0 && lines[at - 1].trim() === "") {
                at--;
            }
            lines.splice(at, end - at, "", `# Prompt ${name}`, "", ...GPTViz.NEW_PROMPT_HEADER.split("\n"), "");
            return lines.join("\n");
        });
    },

    // Rewrites the Prompt section for assetPath to savedPrompt, keeping its heading and Images: lines.
    async alignMarkdownPrompt(file, assetPath, savedPrompt) {
        await this.readNoteText(file);
        await this.app.vault.process(file, text => {
            const section = GPTViz.findPromptSectionForAsset(text, assetPath, file.basename);
            if (!section) {
                throw new Error(`${file.path} has no Prompt section for ${assetPath}.`);
            }

            const lines = text.split("\n");
            const sectionLines = section.text.split("\n");
            const imageLines = sectionLines.filter(line => /^[ \t]*Images:[ \t]*(.*)$/i.test(line));
            const savedLines = savedPrompt.split("\n");
            const savedHeading = GPTViz.parseHeading(savedLines[0]);
            const alignedLines = [
                sectionLines[0],
                ...imageLines,
                ...(savedHeading ? savedLines.slice(1) : savedLines)
            ];

            return [...lines.slice(0, section.startLine), ...alignedLines, ...lines.slice(section.endLine)].join("\n");
        });
    },

    async generateActiveMarkdown(file, progressView) {
        const activeFile = file || this.getCurrentMarkdownFile();
        if (!activeFile) {
            new GPTViz.obsidian.Notice("GPTViz: no active Markdown file.");
            return;
        }

        const assetPath = this.getWorkingAssetPath(activeFile, progressView);
        const section = GPTViz.findPromptSectionForAsset(await this.readNoteText(activeFile), assetPath, activeFile.basename);
        if (!section) {
            new GPTViz.obsidian.Notice(`GPTViz: ${activeFile.basename} has no Prompt section for ${assetPath}.`);
            return;
        }

        await this.generate(section, activeFile, assetPath, progressView);
    },

    // Traits of each image a prompt names, appended so the image model gets each subject's
    // signature cues and relative size without the user retyping them. They come from the note
    // whose Prompt produces the image, else the same-named note on the search path.
    async getImageTraitsText(imageNames) {
        const blocks = [];

        for (let index = 0; index < imageNames.length; index++) {
            const resolved = GPTViz.resolveName(this.app, imageNames[index], [".png"]);
            if (!resolved.file) {
                continue;
            }
            const asset = resolved.file.name;
            const producer = this.findPromptNoteForImage(resolved.file);
            const note = producer
                ? producer.note
                : GPTViz.resolveName(this.app, `${resolved.file.basename}.md`).file;
            if (!note) {
                continue;
            }

            const traits = GPTViz.findTraitsSection(await this.app.vault.cachedRead(note), asset);
            if (traits) {
                blocks.push(`Traits of image ${index + 1} (${resolved.file.basename}):\n${traits}`);
            }
        }

        return blocks.join("\n\n");
    },

    async resolveCompanionPromptForImagePath(imagePath, fallbackMarkdownFile) {
        const normalizedImagePath = String(imagePath || "").trim();

        const companionCandidates = [];

        if (fallbackMarkdownFile && fallbackMarkdownFile.path) {
            companionCandidates.push(fallbackMarkdownFile.path);
        }

        if (normalizedImagePath) {
            if (GPTViz.isCandidateFile({ path: normalizedImagePath }) && fallbackMarkdownFile && fallbackMarkdownFile.path) {
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
                const companion = GPTViz.resolveName(this.app, `${baseName}.md`);
                if (companion.file) {
                    companionCandidates.push(companion.path);
                }
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
    },

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

        const apiKey = this.getApiKey();
        if (!apiKey) {
            return;
        }

        try {
            let sourceBinary = await this.app.vault.readBinary(candidate.file);
            let selectedCandidatePrompt = GPTViz.extractPromptFromPng(sourceBinary);
            const promptParts = GPTViz.getPromptPartsFromText(executionPrompt);
            // [[self]] is the selected candidate. Candidates are not on the search path, so it
            // is passed as the file itself.
            const imageNames = promptParts.imageNames.length > 0
                ? promptParts.imageNames.map(name => (name === candidate.file.name ? candidate.file : name))
                : [candidate.file];
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

            const targetAssetPath = this.getWorkingAssetPath(activeFile, progressView);
            // the new candidate's name (candidate is the selected one, the polish's source)
            const newCandidate = await this.claimCandidateName(apiKey, activeFile, targetAssetPath);

            await this.runWithProgress(
                progressView,
                newCandidate,
                this.lastGenerationDurationMs || 60000,
                "GPTViz: polishing cancelled.",
                async isCancelled => this.generateCandidate(apiKey, {
                    file: activeFile,
                    assetPath: targetAssetPath,
                    promptText: promptParts.text,
                    imageInputs: loadedImages.imageInputs,
                    embeddedPrompt: originalPrompt,
                    candidate: newCandidate
                }, isCancelled)
            );
        } catch (error) {
            this.reportError("polishing an image", error);
        }
    },

    // What Generate sends for a Prompt section of file: its text with includes expanded, then
    // the Traits of the images it names. Returns { promptParts, promptText }.
    async buildPromptText(section, file) {
        const resolvedPromptSectionText = await GPTViz.expandIncludesInText(
            this.app,
            section.text,
            file.path,
            [file.path],
            8,
            { disallowIncludedImagesTag: true }
        );
        const promptParts = GPTViz.getPromptParts({
            text: resolvedPromptSectionText
        });
        const traitsText = await this.getImageTraitsText(promptParts.imageNames);
        const promptText = traitsText
            ? `${promptParts.text.trimEnd()}\n\n${traitsText}`
            : promptParts.text;
        return { promptParts, promptText };
    },

    async generate(section, activeFile, targetAssetPath, progressView) {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return;
        }

        try {
            const { promptParts, promptText } = await this.buildPromptText(section, activeFile);
            const missing = promptParts.imageNames.filter(name => !GPTViz.resolveName(this.app, name, [".png"]).file);
            if (missing.length > 0) {
                await this.showMissingImages(activeFile, targetAssetPath, missing);
                return;
            }
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

            const candidate = await this.claimCandidateName(apiKey, activeFile, targetAssetPath);
            await this.runWithProgress(
                progressView,
                candidate,
                this.lastGenerationDurationMs || 60000,
                "GPTViz: generation cancelled.",
                async isCancelled => this.generateCandidate(apiKey, {
                    file: activeFile,
                    assetPath: targetAssetPath,
                    promptText,
                    imageInputs: loadedImages.imageInputs,
                    embeddedPrompt: promptText,
                    candidate
                }, isCancelled)
            );
        } catch (error) {
            this.reportError("generating an image", error);
        }
    }
});
});
