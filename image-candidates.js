globalThis.GPTViz = globalThis.GPTViz || {};

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
            file.path.startsWith(GPTViz.contentPath("candidates/")) &&
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

GPTViz.ensureFolder = async function(app, path) {
    try {
        await app.vault.createFolder(path);
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (!/already exists/i.test(message)) {
            throw error;
        }
    }
};

GPTViz.ensureKeptImageCandidate = async function(app, activeFile, assetPath) {
    const normalizedAssetPath = GPTViz.normalizeDependencyAssetPath(
        assetPath || `${activeFile.basename}.png`,
        ".png"
    );
    const keptFile = app.vault.getAbstractFileByPath(
        GPTViz.contentPath(normalizedAssetPath)
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

    await GPTViz.ensureFolder(app, GPTViz.contentPath("candidates"));

    const assetName = normalizedAssetPath.split("/").pop() || `${activeFile.basename}.png`;
    const assetBaseName = assetName.replace(/\.[^./]+$/, "");
    const number = candidates.length > 0
        ? candidates[candidates.length - 1].number + 1
        : 1;
    const path = GPTViz.contentPath(`candidates/${assetBaseName}-${number}.png`);

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
