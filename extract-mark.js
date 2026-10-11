unit("extract-mark", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    extractFirstJsonObject(text) {
        const raw = String(text || "").trim();
        if (!raw) {
            throw new Error("Empty model response.");
        }

        // Models often wrap JSON in prose; on a parse failure, fall back to the outermost {...}.
        try {
            return JSON.parse(raw);
        } catch (error) {
            // not bare JSON; fall through to the {...} extraction below
        }

        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) {
            throw new Error(`Model response did not contain JSON: ${raw}`);
        }

        const jsonText = raw.slice(start, end + 1);
        return JSON.parse(jsonText);
    },

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
    },

    async getMarkBlocksForFile(file) {
        const text = await this.app.vault.cachedRead(file);
        return GPTViz.parseMarkBlocksFromText(text, file.path);
    },

    async hasMarkBlocksForFile(file) {
        const blocks = await this.getMarkBlocksForFile(file);
        return blocks.length > 0;
    },

    async getExtractBlocksForFile(file) {
        const text = await this.app.vault.cachedRead(file);
        return GPTViz.parseExtractBlocksFromText(text, file.path);
    },

    async hasExtractBlocksForFile(file) {
        const blocks = await this.getExtractBlocksForFile(file);
        return blocks.length > 0;
    },

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
            await GPTViz.ensureFolder(this.app, current);
        }
    },

    async writeBinaryOverwrite(path, binary) {
        const existing = this.app.vault.getAbstractFileByPath(path);

        if (existing && existing.extension) {
            await this.app.vault.modifyBinary(existing, binary);
            return;
        }

        await this.app.vault.createBinary(path, binary);
    },

    async extractActiveMarkdown(file, candidateView, options) {
        const activeFile = file || this.getCurrentMarkdownFile();
        if (!activeFile) {
            throw new Error("No active Markdown file for Extract operation.");
        }

        const apiKey = this.getApiKey();
        if (!apiKey) {
            return;
        }

        const blocks = await this.getExtractBlocksForFile(activeFile);
        if (blocks.length === 0) {
            new GPTViz.obsidian.Notice("GPTViz: no # Extract sections found.");
            return;
        }

        let blocksToRun = blocks;
        const editor = options && options.editor;

        if (editor) {
            const cursorLine = editor.getCursor().line;
            const blockAtCursor = blocks.find(block =>
                cursorLine >= block.startLine &&
                cursorLine < block.endLine
            );

            if (blockAtCursor) {
                blocksToRun = [blockAtCursor];
            }
        }

        const progressName = blocksToRun.length === 1
            ? blocksToRun[0].asset
            : `${activeFile.basename}.extract`;

        await this.runWithProgress(
            candidateView,
            progressName,
            Math.max(10000, blocksToRun.length * 14000),
            "GPTViz: extract cancelled.",
            async isCancelled => {
                const writtenAssets = [];

                for (const block of blocksToRun) {
                    if (isCancelled()) {
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

                    if (isCancelled()) {
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

                    await this.ensureParentFolders(GPTViz.contentPath(block.asset));
                    await this.writeBinaryOverwrite(GPTViz.contentPath(block.asset), outputPng);
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
            }
        );
    },

    async markActiveMarkdown(file, candidateView) {
        const activeFile = file || this.getCurrentMarkdownFile();
        if (!activeFile) {
            throw new Error("No active Markdown file for Mark operation.");
        }

        const apiKey = this.getApiKey();
        if (!apiKey) {
            return;
        }

        const blocks = await this.getMarkBlocksForFile(activeFile);
        if (blocks.length === 0) {
            new GPTViz.obsidian.Notice("GPTViz: no # Mark sections found.");
            return;
        }

        await this.runWithProgress(
            candidateView,
            `${activeFile.basename}.marks.json`,
            Math.max(10000, blocks.length * 12000),
            "GPTViz: marking cancelled.",
            async isCancelled => {
                const marks = [];

                for (const block of blocks) {
                    if (isCancelled()) {
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

                    if (isCancelled()) {
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
                const sidecarPath = GPTViz.contentPath(`${activeFile.basename}.marks.json`);
                await this.app.vault.adapter.write(
                    sidecarPath,
                    JSON.stringify(payload, null, 2)
                );

                if (candidateView) {
                    await candidateView.setMarks(marks);
                }

                new GPTViz.obsidian.Notice(
                    `GPTViz: wrote ${marks.length} mark${marks.length === 1 ? "" : "s"} to ${sidecarPath}`
                );
            }
        );
    }
});
});
