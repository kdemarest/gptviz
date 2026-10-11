unit("image-operations", ["plugin"], () => {
// Shared steps of the image operations (generate, polish, extract, mark).
Object.assign(GPTViz.Plugin.prototype, {
    // The OpenAI key from SecretStorage, or "" after telling the user why it's missing.
    getApiKey() {
        const secretName = this.settings.apiKeySecret;
        const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : "";

        if (!apiKey) {
            new GPTViz.obsidian.Notice(
                secretName ? "GPTViz: API key not found." : "GPTViz: API key not configured."
            );
        }

        return apiKey;
    },

    // Runs work(isCancelled) under the Candidate View's progress overlay (when one is open).
    // The overlay is always removed; errors arriving after the user cancelled are moot.
    async runWithProgress(progressView, name, estimatedDurationMs, cancelNotice, work) {
        const owner = progressView || this.getCandidateView();
        let cancelled = false;

        if (owner) {
            owner.showProgressOverlay(() => {
                cancelled = true;
                owner.hideProgressOverlay();
                new GPTViz.obsidian.Notice(cancelNotice);
            }, estimatedDurationMs, name);
        }

        try {
            return await work(() => cancelled);
        } catch (error) {
            if (cancelled) {
                return undefined;
            }
            throw error;
        } finally {
            if (owner) {
                owner.hideProgressOverlay();
            }
        }
    },

    // Image generation call; its duration becomes the next progress estimate.
    async requestImage(apiKey, promptText, imageInputs) {
        const startedAt = Date.now();
        const result = await GPTViz.generateOpenAIResponse(apiKey, promptText, imageInputs);
        if (result.imageBase64) {
            this.lastGenerationDurationMs = Date.now() - startedAt;
        }
        return result;
    },

    // Name and vault path of the next candidate for an asset: <asset>-<last number + 1>.png.
    nextCandidatePath(activeFile, assetPath) {
        const assetName = assetPath.split("/").pop() || `${activeFile.basename}.png`;
        const baseName = assetName.replace(/\.[^./]+$/, "");
        const candidates = GPTViz.getImageCandidates(this.app, activeFile, assetPath);
        const number = candidates.length > 0 ? candidates[candidates.length - 1].number + 1 : 1;
        const name = `${baseName}-${number}.png`;
        return { name, path: GPTViz.contentPath(`candidates/${name}`) };
    },

    // Saves a generation result as the asset's next candidate (with the prompt embedded) and
    // shows it. A response without an image is shown to the user and nothing is written.
    async saveGeneratedCandidate(activeFile, assetPath, result, embeddedPrompt) {
        if (!result.imageBase64) {
            new GPTViz.ResponseModal(this.app, result.text || "The API returned no image.").open();
            return;
        }

        await GPTViz.ensureFolder(this.app, GPTViz.contentPath("candidates"));

        const { path } = this.nextCandidatePath(activeFile, assetPath);
        const png = GPTViz.embedPromptInPng(GPTViz.base64ToArrayBuffer(result.imageBase64), embeddedPrompt);

        await this.app.vault.createBinary(path, png);
        await this.openCandidateView({ file: activeFile, asset: assetPath, candidate: path });
        new GPTViz.obsidian.Notice(`GPTViz: wrote ${path}`);
    }
});
});
