unit("generate", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
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
    },

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
    },

    async generateActiveMarkdown(file, progressView) {
        const requestedFile = file || this.getCurrentMarkdownFile();
        const editor = this.getMarkdownEditor(requestedFile);

        if (!editor) {
            throw new Error(
                this.describeMarkdownEditorFailure(requestedFile)
            );
        }

        await this.generate(editor, requestedFile, progressView);
    },

    async resolveCompanionPromptForImagePath(imagePath, fallbackMarkdownFile) {
        const normalizedImagePath = String(imagePath || "").trim();

        const companionCandidates = [];

        if (fallbackMarkdownFile && fallbackMarkdownFile.path) {
            companionCandidates.push(fallbackMarkdownFile.path);
        }

        if (normalizedImagePath) {
            if (normalizedImagePath.startsWith(GPTViz.contentPath("candidates/")) && fallbackMarkdownFile && fallbackMarkdownFile.path) {
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
                companionCandidates.push(GPTViz.contentPath(`${baseName}.md`));
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
        let generationStartedAt;

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
            if (progressOwner) {
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

            if (progressOwner) {
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

            await GPTViz.ensureFolder(this.app, GPTViz.contentPath("candidates"));

            const candidates = GPTViz.getImageCandidates(
                this.app,
                activeFile,
                targetAssetPath
            );
            const number = candidates.length > 0
                ? candidates[candidates.length - 1].number + 1
                : 1;
            const candidatePath =
                GPTViz.contentPath(`candidates/${targetAssetBaseName}-${number}.png`);
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
            if (progressOwner) {
                progressOwner.hideProgressOverlay();
            }

            if (cancelled) {
                return;
            }

            this.reportError("polishing an image", error);
        }
    },

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
        let generationStartedAt;

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
            if (progressOwner) {
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

            if (progressOwner) {
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

            await GPTViz.ensureFolder(this.app, GPTViz.contentPath("candidates"));

            const saveCandidates = GPTViz.getImageCandidates(
                this.app,
                activeFile,
                targetAssetPath
            );
            const saveNumber = saveCandidates.length > 0
                ? saveCandidates[saveCandidates.length - 1].number + 1
                : 1;
            const candidatePath = GPTViz.contentPath(`candidates/${targetAssetBaseName}-${saveNumber}.png`);
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
            if (progressOwner) {
                progressOwner.hideProgressOverlay();
            }

            if (cancelled) {
                return;
            }

            this.reportError("generating an image", error);
        }
    }
});
});
