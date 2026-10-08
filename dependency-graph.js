globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.findStaleDependencies = async function(app) {
    const rows = [];

    for (const markdownFile of app.vault.getMarkdownFiles().filter(GPTViz.isContentFile)) {
        const content = await app.vault.cachedRead(markdownFile);
        const imageNames = [];

        for (const section of GPTViz.getPromptSectionsFromText(content)) {
            imageNames.push(...GPTViz.getPromptParts(section).imageNames);
        }

        if (imageNames.length === 0) {
            continue;
        }

        const newerDependencies = [];
        const outputFile = app.vault.getAbstractFileByPath(
            GPTViz.contentPath(`${markdownFile.basename}.png`)
        );

        for (const imageName of imageNames) {
            const dependencyPath = /\.[^./]+$/.test(imageName)
                ? imageName
                : `${imageName}.png`;
            const dependencyFile =
                app.vault.getAbstractFileByPath(GPTViz.contentPath(dependencyPath));
            const displayName = dependencyPath.replace(/\.[^./]+$/, "");

            if (!dependencyFile || !dependencyFile.stat) {
                newerDependencies.push(`${displayName} (missing)`);
            } else if (
                !outputFile ||
                !outputFile.stat ||
                dependencyFile.stat.mtime > outputFile.stat.mtime
            ) {
                newerDependencies.push(displayName);
            }
        }

        if (newerDependencies.length > 0) {
            rows.push({
                outputName: markdownFile.basename,
                companionPath: markdownFile.path,
                dependencies: newerDependencies
            });
        }
    }

    return rows;
};

GPTViz.getImageTagReferences = function(text) {
    const references = [];
    const addReference = value => {
        const reference = value.trim()
            .replace(/^<|>$/g, "")
            .split("|")[0]
            .split("#")[0]
            .trim();

        if (
            reference &&
            !/^(?:https?:|app:|data:|mailto:)/i.test(reference)
        ) {
            references.push(reference);
        }
    };

    for (const match of text.matchAll(/!\[\[([^\]]+)\]\]/g)) {
        addReference(match[1]);
    }

    for (const match of text.matchAll(/!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g)) {
        addReference(match[1]);
    }

    for (const match of text.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        addReference(match[1]);
    }

    for (const match of text.matchAll(/^[ \t]*(?:Images|Photos):[ \t]*(.*)$/gim)) {
        for (const value of match[1].split(",")) {
            addReference(value);
        }
    }

    return [...new Set(references)];
};

GPTViz.findInvalidImageReferences = async function(app) {
    const rows = [];

    for (const markdownFile of app.vault.getMarkdownFiles().filter(GPTViz.isContentFile)) {
        const content = await app.vault.cachedRead(markdownFile);
        const invalidImages = [];

        for (const imageReference of GPTViz.getImageTagReferences(content)) {
            let decodedReference = imageReference;

            try {
                decodedReference = decodeURIComponent(imageReference);
            } catch (error) {
                // Keep the original path when the link contains malformed escapes.
            }

            const resolvedFile = app.metadataCache.getFirstLinkpathDest(
                decodedReference,
                markdownFile.path
            );

            if (!resolvedFile || !resolvedFile.stat) {
                invalidImages.push(imageReference);
            }
        }

        if (invalidImages.length > 0) {
            rows.push({
                fileName: markdownFile.basename,
                filePath: markdownFile.path,
                invalidImages: invalidImages
            });
        }
    }

    return rows;
};

GPTViz.normalizeDependencyConfigPath = function(value, asDirectory) {
    let path = String(value || "").trim().replace(/\\/g, "/");

    path = path.replace(/^\.\//, "").replace(/^\/+/, "");

    if (asDirectory) {
        path = path.replace(/\/+$/, "");
        return path ? `${path}/` : "";
    }

    return path.replace(/\/+$/, "");
};

GPTViz.loadDependencyValidationConfig = async function(app) {
    const path = GPTViz.contentPath("_config.json");
    const adapter = app.vault.adapter;

    if (!(await adapter.exists(path))) {
        return {
            path,
            loaded: false,
            sourceDirectories: [],
            excludedFiles: []
        };
    }

    const text = await adapter.read(path);
    let raw;

    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid dependency config JSON at ${path}: ${error.message}`);
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`Invalid dependency config at ${path}: root must be a JSON object.`);
    }

    if (!Object.prototype.hasOwnProperty.call(raw, "source_dirs")) {
        throw new Error(`Invalid dependency config at ${path}: missing required 'source_dirs' array.`);
    }

    if (!Array.isArray(raw.source_dirs)) {
        throw new Error(`Invalid dependency config at ${path}: 'source_dirs' must be an array.`);
    }

    const sourceDirectories = [];
    const seenSourceDirectories = new Set();

    for (let index = 0; index < raw.source_dirs.length; index++) {
        const entry = raw.source_dirs[index];

        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`Invalid dependency config at ${path}: source_dirs[${index}] must be an object { dir, recurse }.`);
        }

        if (typeof entry.dir !== "string") {
            throw new Error(`Invalid dependency config at ${path}: source_dirs[${index}].dir must be a string.`);
        }

        if (typeof entry.recurse !== "boolean") {
            throw new Error(`Invalid dependency config at ${path}: source_dirs[${index}].recurse must be a boolean.`);
        }

        const normalizedDir = GPTViz.normalizeDependencyConfigPath(entry.dir, true);
        const key = `${normalizedDir}::${entry.recurse ? "1" : "0"}`;

        if (seenSourceDirectories.has(key)) {
            continue;
        }

        seenSourceDirectories.add(key);
        sourceDirectories.push({
            dir: normalizedDir,
            recurse: entry.recurse
        });
    }

    if (sourceDirectories.length === 0) {
        throw new Error(`Invalid dependency config at ${path}: 'source_dirs' must contain at least one entry.`);
    }

    const excludedFiles = [];
    const seenExcludedFiles = new Set();

    if (Object.prototype.hasOwnProperty.call(raw, "exclude_files")) {
        if (!Array.isArray(raw.exclude_files)) {
            throw new Error(`Invalid dependency config at ${path}: 'exclude_files' must be an array when provided.`);
        }

        for (let index = 0; index < raw.exclude_files.length; index++) {
            const value = raw.exclude_files[index];

            if (typeof value !== "string") {
                throw new Error(`Invalid dependency config at ${path}: exclude_files[${index}] must be a string.`);
            }

            const normalized = GPTViz.normalizeDependencyConfigPath(value, false);
            if (!normalized || seenExcludedFiles.has(normalized)) {
                continue;
            }

            seenExcludedFiles.add(normalized);
            excludedFiles.push(normalized);
        }
    }

    return {
        path,
        loaded: true,
        sourceDirectories,
        excludedFiles
    };
};

GPTViz.matchesDependencyExcludePattern = function(filePath, pattern) {
    const normalizedPath = GPTViz.normalizeDependencyConfigPath(filePath, false);
    const normalizedPattern = GPTViz.normalizeDependencyConfigPath(pattern, false);

    if (!normalizedPattern) {
        return false;
    }

    if (!normalizedPattern.includes("*")) {
        return normalizedPath === normalizedPattern;
    }

    const escaped = normalizedPattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`);

    return regex.test(normalizedPath);
};

GPTViz.isMarkdownFileAllowedForDependencyValidation = function(filePath, config) {
    // Config paths are relative to the content root.
    const vaultPath = GPTViz.normalizeDependencyConfigPath(filePath, false);
    const contentPrefix = GPTViz.contentPath("");
    if (!vaultPath.startsWith(contentPrefix)) {
        return false;
    }
    const normalizedPath = vaultPath.slice(contentPrefix.length);
    const excludedFiles = Array.isArray(config.excludedFiles)
        ? config.excludedFiles
        : [];

    for (const pattern of excludedFiles) {
        if (GPTViz.matchesDependencyExcludePattern(normalizedPath, pattern)) {
            return false;
        }
    }

    const sourceDirectories = Array.isArray(config.sourceDirectories)
        ? config.sourceDirectories
        : [];

    if (sourceDirectories.length === 0) {
        return false;
    }

    const parentDirectory = normalizedPath.includes("/")
        ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1)
        : "";

    for (const sourceDir of sourceDirectories) {
        const dir = GPTViz.normalizeDependencyConfigPath(sourceDir.dir, true);
        const recurse = sourceDir.recurse === true;

        if (recurse) {
            if (!dir || normalizedPath.startsWith(dir)) {
                return true;
            }
            continue;
        }

        if (parentDirectory === dir) {
            return true;
        }
    }

    return false;
};

// Vault folder holding all content (markdown sources, kept images, candidates, config).
GPTViz.CONTENT_ROOT = "canvid";

GPTViz.contentPath = function(relativePath) {
    return `${GPTViz.CONTENT_ROOT}/${relativePath}`;
};

GPTViz.isContentFile = function(file) {
    return file.path.startsWith(GPTViz.contentPath(""));
};

GPTViz.normalizeDependencyAssetPath = function(value, fallbackExtension) {
    let path = String(value || "").trim();

    path = path.replace(/^<|>$/g, "");
    path = path.replace(/\\/g, "/");
    path = path.replace(/^\.\//, "").replace(/^\/+/, "");

    if (!path) {
        return "";
    }

    if (fallbackExtension && !/\.[^./]+$/.test(path)) {
        path = `${path}${fallbackExtension}`;
    }

    return path;
};

GPTViz.parseDependencyDeclaredInputs = function(operation, sectionText, defaultSource) {
    const lines = String(sectionText || "").split("\n");
    const inputs = [];

    if (operation === "Prompt") {
        for (const line of lines) {
            const match = /^[ \t]*(?:Images|Photos):[ \t]*(.*)$/i.exec(line);
            if (!match) {
                continue;
            }

            for (const raw of match[1].split(",")) {
                const normalized = GPTViz.normalizeDependencyAssetPath(raw, ".png");
                if (normalized) {
                    inputs.push(normalized);
                }
            }
        }

        return [...new Set(inputs)];
    }

    if (operation === "Extract" || operation === "Mark") {
        let source = "";

        for (const line of lines) {
            const match = /^[ \t]*Source:[ \t]*(.+)$/i.exec(line);
            if (match) {
                source = match[1].trim();
                break;
            }
        }

        const normalized = GPTViz.normalizeDependencyAssetPath(
            source || defaultSource,
            ".png"
        );

        return normalized ? [normalized] : [];
    }

    if (operation === "Script") {
        return [];
    }

    return [];
};

GPTViz.getDependencyRecordOutputPath = function(record) {
    if (record.operation !== "Prompt" && record.operation !== "Extract") {
        return "";
    }

    return GPTViz.normalizeDependencyAssetPath(record.name, ".png");
};

GPTViz.getScriptDependenciesFromMoviParser = async function(app, markdownFilePath) {
    const filePath = String(markdownFilePath || "").trim();
    if (!filePath) {
        return [];
    }

    return await new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(Array.isArray(value) ? value : []);
        };

        const timeout = window.setTimeout(() => {
            finish([]);
        }, 500);

        const event = new CustomEvent("gptviz:script-required-assets-request", {
            detail: {
                filePath,
                resolve: payload => {
                    window.clearTimeout(timeout);
                    if (payload && payload.ok && Array.isArray(payload.requiredAssets)) {
                        finish(payload.requiredAssets);
                        return;
                    }
                    finish([]);
                },
                reject: () => {
                    window.clearTimeout(timeout);
                    finish([]);
                }
            },
            cancelable: false
        });

        window.dispatchEvent(event);
    }).then(values => {
        const normalized = [];
        const seen = new Set();
        for (const value of values) {
            const dep = GPTViz.normalizeDependencyAssetPath(value, "").toLowerCase();
            if (!dep || seen.has(dep)) {
                continue;
            }
            seen.add(dep);
            normalized.push(dep);
        }
        return normalized;
    });
};

GPTViz.buildDependencyHeadingReport = async function(app) {
    const allMarkdownFiles = app.vault.getMarkdownFiles();
    const dependencyConfig = await GPTViz.loadDependencyValidationConfig(app);
    const markdownFiles = allMarkdownFiles.filter(markdownFile =>
        GPTViz.isMarkdownFileAllowedForDependencyValidation(markdownFile.path, dependencyConfig)
    );
    const errors = [];
    const warnings = [];
    const records = [];
    const promptByName = new Map();
    const extractByName = new Map();
    const markByName = new Map();
    const markBySourceAndName = new Map();
    const scriptDependenciesByFilePath = new Map();

    const pushIssue = (collection, filePath, line, operation, name, message, code) => {
        collection.push({
            key: `${filePath}#${operation}:${name}`,
            filePath,
            line,
            operation,
            name,
            code,
            message
        });
    };

    const ensureBucket = (map, key) => {
        if (!map.has(key)) {
            map.set(key, []);
        }
        return map.get(key);
    };

    for (const markdownFile of markdownFiles) {
        const text = await app.vault.cachedRead(markdownFile);
        const lines = String(text || "").split("\n");
        const seenInFile = new Set();

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const heading = GPTViz.parseHeading(lines[lineIndex]);
            if (!heading) {
                continue;
            }

            const operationLike = /^(Prompt|Extract|Mark|Script)\b/.exec(heading.text.trim());
            if (!operationLike) {
                continue;
            }

            const parsed = GPTViz.parseDependencyOperationHeading(lines[lineIndex]);
            const lineNumber = lineIndex + 1;

            if (!parsed) {
                const opName = operationLike[1];
                const fallbackName = heading.text.trim().replace(/^\S+[ \t]*/, "") || "invalid";
                pushIssue(
                    errors,
                    markdownFile.path,
                    lineNumber,
                    opName,
                    fallbackName,
                    `Unsupported ${opName} heading form. Use '## <Operation>: <AssetFileName>' or '## <Operation> <AssetFileName>'.`,
                    "invalid_heading_form"
                );
                continue;
            }

            const identity = `${parsed.operation}:${parsed.canonicalName || parsed.name}`;
            const fileIdentityKey = `${markdownFile.path}#${identity}`.toLowerCase();
            if (seenInFile.has(fileIdentityKey)) {
                pushIssue(
                    errors,
                    markdownFile.path,
                    lineNumber,
                    parsed.operation,
                    parsed.name,
                    `Duplicate block identity '${identity}' in the same file.`,
                    "duplicate_block_identity"
                );
                continue;
            }
            seenInFile.add(fileIdentityKey);

            if (!/^[A-Za-z0-9_ -]+(?:\.[A-Za-z0-9_ -]+)*$/.test(parsed.name)) {
                pushIssue(
                    errors,
                    markdownFile.path,
                    lineNumber,
                    parsed.operation,
                    parsed.name,
                    `Illegal target name '${parsed.name}'. Use only letters, numbers, spaces, underscores, hyphens, and dots.`,
                    "illegal_target_name"
                );
                continue;
            }

            const section = GPTViz.getHeadingSectionFromLines(lines, lineIndex);
            const defaultSource = `${markdownFile.basename}.png`;
            let resolvedInputs = GPTViz.parseDependencyDeclaredInputs(
                parsed.operation,
                section.text,
                defaultSource
            );

            if (parsed.operation === "Script") {
                if (!scriptDependenciesByFilePath.has(markdownFile.path)) {
                    const dependencies = await GPTViz.getScriptDependenciesFromMoviParser(
                        app,
                        markdownFile.path
                    );
                    scriptDependenciesByFilePath.set(markdownFile.path, dependencies);
                }
                resolvedInputs = scriptDependenciesByFilePath.get(markdownFile.path) || [];
            }

            const source = parsed.operation === "Mark"
                ? (resolvedInputs[0] || "")
                : "";

            const record = {
                id: `${markdownFile.path}#${identity}`,
                filePath: markdownFile.path,
                fileName: markdownFile.name,
                line: lineNumber,
                operation: parsed.operation,
                name: parsed.name,
                canonicalName: parsed.canonicalName || parsed.name,
                source,
                resolvedInputs,
                outputPath: ""
            };

            record.outputPath = GPTViz.getDependencyRecordOutputPath(record);
            records.push(record);

            const normalizedName = record.canonicalName.toLowerCase();
            if (parsed.operation === "Prompt") {
                ensureBucket(promptByName, normalizedName).push(record);
            } else if (parsed.operation === "Extract") {
                ensureBucket(extractByName, normalizedName).push(record);
            } else if (parsed.operation === "Mark") {
                ensureBucket(markByName, normalizedName).push(record);
                const normalizedSource = String(source || "").toLowerCase();
                const sourceKey = `${normalizedSource}::${normalizedName}`;
                ensureBucket(markBySourceAndName, sourceKey).push(record);
            }
        }
    }

    for (const entries of promptByName.values()) {
        if (entries.length > 1) {
            for (const entry of entries.slice(1)) {
                pushIssue(
                    errors,
                    entry.filePath,
                    entry.line,
                    "Prompt",
                    entry.name,
                    `Duplicate prompt target '${entry.name}' in project.`,
                    "duplicate_prompt_name"
                );
            }
        }
    }

    for (const entries of extractByName.values()) {
        if (entries.length > 1) {
            for (const entry of entries.slice(1)) {
                pushIssue(
                    errors,
                    entry.filePath,
                    entry.line,
                    "Extract",
                    entry.name,
                    `Duplicate extract target '${entry.name}' in project.`,
                    "duplicate_extract_name"
                );
            }
        }
    }

    for (const [name, promptEntries] of promptByName.entries()) {
        if (!extractByName.has(name)) {
            continue;
        }

        const extractEntries = extractByName.get(name);
        for (const entry of promptEntries) {
            pushIssue(
                errors,
                entry.filePath,
                entry.line,
                "Prompt",
                entry.name,
                `Prompt/Extract name collision for '${entry.name}'.`,
                "prompt_extract_collision"
            );
        }

        for (const entry of extractEntries) {
            pushIssue(
                errors,
                entry.filePath,
                entry.line,
                "Extract",
                entry.name,
                `Prompt/Extract name collision for '${entry.name}'.`,
                "prompt_extract_collision"
            );
        }
    }

    for (const [name, markEntries] of markByName.entries()) {
        const distinctSources = new Set(
            markEntries.map(entry => String(entry.source || "").toLowerCase())
        );
        if (markEntries.length > 1 && distinctSources.size > 1) {
            for (const entry of markEntries.slice(1)) {
                pushIssue(
                    warnings,
                    entry.filePath,
                    entry.line,
                    "Mark",
                    entry.name,
                    `Mark name '${entry.name}' is reused on different source images.`,
                    "mark_name_reused"
                );
            }
        }
    }

    for (const entries of markBySourceAndName.values()) {
        if (entries.length > 1) {
            for (const entry of entries.slice(1)) {
                pushIssue(
                    errors,
                    entry.filePath,
                    entry.line,
                    "Mark",
                    entry.name,
                    `Duplicate Mark name '${entry.name}' on source '${entry.source}'.`,
                    "duplicate_mark_name_same_source"
                );
            }
        }
    }

    const producersByOutput = new Map();
    for (const record of records) {
        if (!record.outputPath) {
            continue;
        }

        const key = record.outputPath.toLowerCase();
        ensureBucket(producersByOutput, key).push(record);
    }

    for (const outputRecords of producersByOutput.values()) {
        if (outputRecords.length <= 1) {
            continue;
        }

        const operationList = outputRecords
            .map(item => `${item.operation} ${item.name}`)
            .join(", ");

        for (const record of outputRecords) {
            pushIssue(
                errors,
                record.filePath,
                record.line,
                record.operation,
                record.name,
                `Duplicate output target '${record.outputPath}' is produced by multiple blocks (${operationList}).`,
                "duplicate_output_target"
            );
        }
    }

    const recordById = new Map();
    const outgoingEdges = new Map();

    for (const record of records) {
        recordById.set(record.id, record);
        outgoingEdges.set(record.id, new Set());
    }

    for (const record of records) {
        for (const dependency of record.resolvedInputs) {
            const dependencyKey = dependency.toLowerCase();
            const producers = producersByOutput.get(dependencyKey) || [];

            if (producers.length > 0) {
                for (const producer of producers) {
                    outgoingEdges.get(producer.id).add(record.id);
                }
                continue;
            }

            const directFile = app.vault.getAbstractFileByPath(GPTViz.contentPath(dependency));
            const candidateFile = app.vault.getAbstractFileByPath(GPTViz.contentPath(`candidates/${dependency}`));
            const isResolvedByFile = Boolean(
                (directFile && directFile.stat) ||
                (candidateFile && candidateFile.stat)
            );

            if (!isResolvedByFile) {
                pushIssue(
                    errors,
                    record.filePath,
                    record.line,
                    record.operation,
                    record.name,
                    `Unresolved dependency '${dependency}'. Add or generate the dependency, or update the block reference.`,
                    "unresolved_dependency"
                );
            }
        }
    }

    const visitState = new Map();
    const stack = [];
    const cycleSignatures = new Set();

    const reportCycle = cycleNodeIds => {
        const cycleRecords = cycleNodeIds
            .map(nodeId => recordById.get(nodeId))
            .filter(Boolean);

        if (cycleRecords.length === 0) {
            return;
        }

        const signature = cycleRecords
            .map(item => item.id)
            .sort()
            .join("|");

        if (cycleSignatures.has(signature)) {
            return;
        }
        cycleSignatures.add(signature);

        const chain = cycleRecords
            .map(item => `${item.operation}:${item.name}`)
            .join(" -> ");
        const first = cycleRecords[0];

        pushIssue(
            errors,
            first.filePath,
            first.line,
            first.operation,
            first.name,
            `Dependency cycle detected: ${chain} -> ${first.operation}:${first.name}. Remove at least one dependency edge in the cycle.`,
            "dependency_cycle"
        );
    };

    const dfs = nodeId => {
        visitState.set(nodeId, 1);
        stack.push(nodeId);

        const neighbors = outgoingEdges.get(nodeId) || new Set();
        for (const neighborId of neighbors) {
            const state = visitState.get(neighborId) || 0;

            if (state === 0) {
                dfs(neighborId);
                continue;
            }

            if (state === 1) {
                const cycleStart = stack.indexOf(neighborId);
                if (cycleStart !== -1) {
                    const cycleNodeIds = stack.slice(cycleStart);
                    reportCycle(cycleNodeIds);
                }
            }
        }

        stack.pop();
        visitState.set(nodeId, 2);
    };

    for (const record of records) {
        if ((visitState.get(record.id) || 0) === 0) {
            dfs(record.id);
        }
    }

    const now = new Date().toISOString();
    const lines = [];
    lines.push("## GPTViz dependency report");
    lines.push("");
    lines.push(`Generated: ${now}`);
    lines.push(`Config file: ${dependencyConfig.path} (${dependencyConfig.loaded ? "loaded" : "not found; scanning no files"})`);
    lines.push(`Scanned markdown files: ${markdownFiles.length}`);
    lines.push(`Parsed operations: ${records.length}`);
    lines.push(`Errors: ${errors.length}`);
    lines.push(`Warnings: ${warnings.length}`);
    lines.push("");

    const renderIssue = issue => {
        const displayName = issue.filePath.split("/").pop() || issue.filePath;
        return `- [[${issue.filePath}#${issue.operation} ${issue.name}|${displayName}]] line ${issue.line}: ${issue.message} [${issue.code}]`;
    };

    lines.push("## Errors");
    if (errors.length === 0) {
        lines.push("- None");
    } else {
        for (const issue of errors) {
            lines.push(renderIssue(issue));
        }
    }

    lines.push("");
    lines.push("## Warnings");
    if (warnings.length === 0) {
        lines.push("- None");
    } else {
        for (const issue of warnings) {
            lines.push(renderIssue(issue));
        }
    }

    return {
        errors,
        warnings,
        markdown: lines.join("\n"),
        graph: {
            records,
            dependencyConfig,
            markdownFiles: markdownFiles.map(file => file.path)
        }
    };
};
