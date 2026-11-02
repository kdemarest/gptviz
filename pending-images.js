unit("pending-images", ["plugin"], () => {
// Images are generated in background mode. Each one started is recorded in the candidates
// folder until its result is saved, so it survives a dropped connection or an Obsidian
// restart: it is fetched again at startup and by the Fetch Pending Images command.
GPTViz.PENDING_FILE = "_pending.json";
GPTViz.PENDING_POLL_MS = 5000;
GPTViz.PENDING_POLL_LIMIT_MS = 15 * 60 * 1000;

Object.assign(GPTViz.Plugin.prototype, {
    async readPendingImages() {
        const path = GPTViz.candidatePath(GPTViz.PENDING_FILE);
        if (!(await this.app.vault.adapter.exists(path))) {
            return [];
        }
        return JSON.parse(await this.app.vault.adapter.read(path));
    },

    // Applies change(entries) -> entries to the pending file, one change at a time.
    async updatePendingImages(change) {
        const run = (this.pendingImagesWrite || Promise.resolve()).catch(() => {}).then(async () => {
            const entries = change(await this.readPendingImages());
            await GPTViz.ensureFolder(this.app, GPTViz.getWorkspace().candidates);
            await this.app.vault.adapter.write(GPTViz.candidatePath(GPTViz.PENDING_FILE), JSON.stringify(entries, null, 2));
        });
        this.pendingImagesWrite = run;
        return run;
    },

    // Polls a background response until it finishes, retrying through connection failures.
    // Returns the finished response, or null when stopped() or the time limit came first.
    async pollImageResponse(apiKey, response, stopped) {
        const giveUpAt = Date.now() + GPTViz.PENDING_POLL_LIMIT_MS;
        let current = response;

        while (current.status === "queued" || current.status === "in_progress") {
            await new Promise(resolve => window.setTimeout(resolve, GPTViz.PENDING_POLL_MS));
            if (stopped() || Date.now() > giveUpAt) {
                return null;
            }
            try {
                current = await GPTViz.fetchOpenAIResponse(apiKey, current.id);
            } catch (error) {
                // No status: the connection failed. 408, 429 and 5xx are worth retrying too.
                const status = Number(error.status);
                if (status && status !== 408 && status !== 429 && status < 500) {
                    throw error;
                }
            }
        }
        return current;
    },

    // Saves a finished response as its asset's candidate (opening it when show), then drops it
    // from the pending file. One that failed is shown to the user.
    async finishPendingImage(entry, response, show) {
        if (response.status !== "completed") {
            await this.updatePendingImages(entries => entries.filter(item => item.id !== entry.id));
            const details = response.error || response.incomplete_details || response;
            new GPTViz.ResponseModal(this.app, `OpenAI's image for ${entry.assetPath} ${response.status}:\n${JSON.stringify(details, null, 2)}`).open();
            return;
        }

        const note = this.app.vault.getAbstractFileByPath(entry.notePath)
            || { path: entry.notePath, basename: entry.notePath.split("/").pop().replace(/\.md$/i, "") };
        await this.saveGeneratedCandidate(note, entry.assetPath, GPTViz.parseImageResponse(response), entry.prompt, show && !!note.stat, entry.candidate);
        await this.updatePendingImages(entries => entries.filter(item => item.id !== entry.id));
    },

    // Before a new image: checks each pending one once (no waiting), saving those done, then
    // claims the new candidate's name past the ones still pending, so each image keeps the name
    // it was started with.
    async claimCandidateName(apiKey, file, assetPath) {
        for (const entry of await this.readPendingImages()) {
            if (this.activeImageIds && this.activeImageIds.has(entry.id)) {
                continue;
            }
            try {
                const response = await GPTViz.fetchOpenAIResponse(apiKey, entry.id);
                if (response.status !== "queued" && response.status !== "in_progress") {
                    await this.finishPendingImage(entry, response, false);
                }
            } catch (error) {
                if (Number(error.status) === 404) {
                    await this.updatePendingImages(items => items.filter(item => item.id !== entry.id));
                }
                // Otherwise it stays pending; the new image goes ahead.
            }
        }
        const pendingNames = (await this.readPendingImages()).map(entry => entry.candidate).filter(Boolean);
        return this.nextCandidatePath(file, assetPath, pendingNames).name;
    },

    // Generates an image for job ({ file, assetPath, promptText, imageInputs, embeddedPrompt,
    // candidate: its claimed name }) and saves it as a candidate. Cancelling also cancels it at
    // OpenAI; if the connection stays down past the time limit, it stays pending. The duration
    // becomes the next progress estimate.
    async generateCandidate(apiKey, job, isCancelled) {
        const startedAt = Date.now();
        const started = await GPTViz.startOpenAIImageResponse(apiKey, job.promptText, job.imageInputs);
        const entry = {
            id: started.id,
            notePath: job.file.path,
            assetPath: job.assetPath,
            candidate: job.candidate,
            prompt: job.embeddedPrompt,
            startedAt
        };
        await this.updatePendingImages(entries => [...entries, entry]);

        this.activeImageIds = this.activeImageIds || new Set();
        this.activeImageIds.add(entry.id);
        try {
            const response = await this.pollImageResponse(apiKey, started, () => isCancelled() || this.unloaded);
            if (isCancelled()) {
                await this.updatePendingImages(entries => entries.filter(item => item.id !== entry.id));
                GPTViz.cancelOpenAIResponse(apiKey, entry.id).catch(() => {});
                return;
            }
            if (!response) {
                new GPTViz.obsidian.Notice(`GPTViz: no answer yet for ${job.assetPath}. It stays pending: it is fetched when Obsidian starts, or with GPTViz Fetch Pending Images.`, 15000);
                return;
            }
            if (response.status === "completed") {
                this.lastGenerationDurationMs = Date.now() - startedAt;
            }
            await this.finishPendingImage(entry, response, true);
        } finally {
            this.activeImageIds.delete(entry.id);
        }
    },

    // Fetches every pending image not already being polled, saving each as a candidate.
    // asked: from the command, so it also says when there is nothing to fetch.
    async resumePendingImages(asked) {
        const entries = (await this.readPendingImages())
            .filter(entry => !(this.activeImageIds && this.activeImageIds.has(entry.id)));
        if (entries.length === 0) {
            if (asked) {
                new GPTViz.obsidian.Notice("GPTViz: no pending images.");
            }
            return;
        }
        if (this.resumingPendingImages) {
            return;
        }

        const apiKey = this.getApiKey();
        if (!apiKey) {
            return;
        }

        this.resumingPendingImages = true;
        let waiting = 0;
        try {
            new GPTViz.obsidian.Notice(`GPTViz: fetching ${entries.length} pending image${entries.length === 1 ? "" : "s"}.`);
            for (const entry of entries) {
                try {
                    const response = await this.pollImageResponse(
                        apiKey, { id: entry.id, status: "queued" }, () => this.unloaded);
                    if (response) {
                        await this.finishPendingImage(entry, response, false);
                    } else {
                        waiting++;
                    }
                } catch (error) {
                    if (Number(error.status) === 404) {
                        await this.updatePendingImages(items => items.filter(item => item.id !== entry.id));
                        new GPTViz.obsidian.Notice(`GPTViz: OpenAI no longer has the image for ${entry.assetPath}.`);
                    } else {
                        throw error;
                    }
                }
            }
        } finally {
            this.resumingPendingImages = false;
        }
        if (waiting > 0 && !this.unloaded) {
            new GPTViz.obsidian.Notice(`GPTViz: ${waiting} image${waiting === 1 ? " is" : "s are"} still pending.`);
        }
    }
});
});
