var GPTViz = GPTViz || {};

GPTViz.parseHeading = function(line) {
    const match = /^(#+)[ \t]+(.+)$/.exec(line);

    if (!match) {
        return null;
    }

    return {
        level: match[1].length,
        text: match[2]
    };
};

GPTViz.isPromptHeading = function(line) {
    const heading = GPTViz.parseHeading(line);

    return (
        heading !== null &&
        /^Prompt(?:[ \t]|$)/.test(heading.text)
    );
};

GPTViz.getHeadingSectionFromLines = function(lines, startLine) {
    const startHeading = GPTViz.parseHeading(lines[startLine]);
    const headingLevel = startHeading.level;
    let endLine = lines.length;

    // End at the next heading of the same or higher level.
    for (let line = startLine + 1; line < lines.length; line++) {
        const heading = GPTViz.parseHeading(lines[line]);

        if (heading && heading.level <= headingLevel) {
            endLine = line;
            break;
        }
    }

    return {
        text: lines.slice(startLine, endLine).join("\n"),
        startLine: startLine,
        endLine: endLine
    };
};

GPTViz.getPromptSectionFromLines = function(lines, startLine) {
    return GPTViz.getHeadingSectionFromLines(lines, startLine);
};

GPTViz.getPromptSection = function(editor) {
    const lineCount = editor.lineCount();
    const cursorLine = editor.getCursor().line;
    const lines = [];

    for (let line = 0; line < lineCount; line++) {
        lines.push(editor.getLine(line));
    }

    let startLine = -1;

    // Find nearest Prompt heading at or above cursor.
    for (let line = cursorLine; line >= 0; line--) {
        if (GPTViz.isPromptHeading(lines[line])) {
            startLine = line;
            break;
        }
    }

    // If none above cursor, use first Prompt heading in file.
    if (startLine === -1) {
        for (let line = 0; line < lineCount; line++) {
            if (GPTViz.isPromptHeading(lines[line])) {
                startLine = line;
                break;
            }
        }
    }

    if (startLine === -1) {
        return null;
    }

    return GPTViz.getPromptSectionFromLines(lines, startLine);
};


GPTViz.getPromptParts = function(section) {
    const textLines = [];
    const imageNames = [];

    for (const line of section.text.split("\n")) {
        const match = /^[ \t]*Images:[ \t]*(.*)$/.exec(line);

        if (match) {
            for (const name of match[1].split(",")) {
                const trimmedName = name.trim();

                if (trimmedName) {
                    imageNames.push(trimmedName);
                }
            }
        } else {
            textLines.push(line);
        }
    }

    return {
        text: textLines.join("\n"),
        imageNames: imageNames
    };
};

GPTViz.getPromptPartsFromText = function(text) {
    return GPTViz.getPromptParts({
        text: String(text || "")
    });
};

GPTViz.binaryToBase64 = function(binary) {
    const bytes = new Uint8Array(binary);
    let characters = "";

    for (let index = 0; index < bytes.length; index++) {
        characters += String.fromCharCode(bytes[index]);
    }

    return btoa(characters);
};

GPTViz.pngCrc32 = function(bytes) {
    let crc = 0xffffffff;

    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (
                (crc & 1) ? 0xedb88320 : 0
            );
        }
    }

    return (crc ^ 0xffffffff) >>> 0;
};

GPTViz.embedPromptInPng = function(binary, prompt) {
    const source = new Uint8Array(binary);
    const signature = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10
    ]);

    for (let index = 0; index < signature.length; index++) {
        if (source[index] !== signature[index]) {
            throw new Error("Image generation returned invalid PNG data.");
        }
    }

    const encoder = new TextEncoder();
    const keyword = encoder.encode("Prompt");
    const text = encoder.encode(
        String(prompt || "").replace(/\u0000/g, "")
    );
    const data = new Uint8Array(
        keyword.length + 1 + 1 + 1 + 1 + 1 + text.length
    );
    let offset = 0;

    data.set(keyword, offset);
    offset += keyword.length;
    data[offset++] = 0;
    data[offset++] = 0;
    data[offset++] = 0;
    data[offset++] = 0;
    data[offset++] = 0;
    data.set(text, offset);

    const type = encoder.encode("iTXt");
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(type, 4);
    chunk.set(data, 8);

    const crcInput = new Uint8Array(type.length + data.length);
    crcInput.set(type, 0);
    crcInput.set(data, type.length);
    view.setUint32(
        8 + data.length,
        GPTViz.pngCrc32(crcInput)
    );

    let position = signature.length;
    let insertAt = -1;
    while (position + 12 <= source.length) {
        const length = new DataView(
            source.buffer,
            source.byteOffset + position,
            4
        ).getUint32(0);
        const typeText = String.fromCharCode(
            source[position + 4],
            source[position + 5],
            source[position + 6],
            source[position + 7]
        );
        const nextPosition = position + 12 + length;

        if (nextPosition > source.length) {
            throw new Error("Image generation returned truncated PNG data.");
        }

        if (typeText === "IHDR") {
            insertAt = nextPosition;
            break;
        }

        position = nextPosition;
    }

    if (insertAt === -1) {
        throw new Error("Image generation returned a PNG without an IHDR chunk.");
    }

    const result = new Uint8Array(source.length + chunk.length);
    result.set(source.slice(0, insertAt), 0);
    result.set(chunk, insertAt);
    result.set(source.slice(insertAt), insertAt + chunk.length);
    return result.buffer;
};

GPTViz.extractPromptFromPng = function(binary) {
    const source = new Uint8Array(binary);
    const signature = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10
    ]);

    for (let index = 0; index < signature.length; index++) {
        if (source[index] !== signature[index]) {
            return null;
        }
    }

    const decoder = new TextDecoder();
    let position = signature.length;

    while (position + 12 <= source.length) {
        const view = new DataView(
            source.buffer,
            source.byteOffset + position,
            4
        );
        const length = view.getUint32(0);
        const typeText = String.fromCharCode(
            source[position + 4],
            source[position + 5],
            source[position + 6],
            source[position + 7]
        );
        const dataStart = position + 8;
        const nextPosition = position + 12 + length;

        if (nextPosition > source.length) {
            return null;
        }

        if (typeText === "iTXt") {
            const dataEnd = dataStart + length;
            let cursor = dataStart;
            const keywordStart = cursor;

            while (cursor < dataEnd && source[cursor] !== 0) {
                cursor++;
            }

            const keyword = decoder.decode(
                source.slice(keywordStart, cursor)
            );
            if (keyword === "Prompt" && cursor + 2 < dataEnd) {
                const compressionFlag = source[cursor + 1];
                cursor += 3;

                if (compressionFlag === 0) {
                    while (cursor < dataEnd && source[cursor] !== 0) {
                        cursor++;
                    }
                    if (cursor >= dataEnd) {
                        return null;
                    }
                    cursor++;

                    while (cursor < dataEnd && source[cursor] !== 0) {
                        cursor++;
                    }
                    if (cursor >= dataEnd) {
                        return null;
                    }
                    cursor++;

                    return decoder.decode(source.slice(cursor, dataEnd));
                }
            }
        }

        position = nextPosition;
    }

    return null;
};

GPTViz.loadPromptImages = async function(app, imageNames) {
    const imageInputs = [];
    const sourcePrompts = [];
    const warnings = [];

    for (const imageName of imageNames) {
        const path = /\.[^./]+$/.test(imageName)
            ? imageName
            : `${imageName}.png`;
        let file = app.vault.getAbstractFileByPath(path);

        if (!file || !file.extension) {
            file = app.vault.getAbstractFileByPath(`candidates/${path}`);
        }

        if (!file || !file.extension) {
            warnings.push(`Image not found: ${path}`);
            continue;
        }

        const extension = file.extension.toLowerCase();
        const mimeTypes = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp"
        };
        const mimeType = mimeTypes[extension];

        if (!mimeType) {
            warnings.push(`Unsupported image type: ${path}`);
            continue;
        }

        let binary;

        try {
            binary = await app.vault.readBinary(file);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            warnings.push(`Could not read image ${path}: ${message}`);
            continue;
        }

        imageInputs.push({
            type: "input_image",
            image_url: `data:${mimeType};base64,${GPTViz.binaryToBase64(binary)}`
        });
        sourcePrompts.push({
            path: file.path,
            prompt: GPTViz.extractPromptFromPng(binary)
        });
    }

    return {
        imageInputs: imageInputs,
        sourcePrompts: sourcePrompts,
        warnings: warnings
    };
};


GPTViz.getPromptSectionsFromText = function(text) {
    const lines = text.split("\n");
    const sections = [];

    for (let line = 0; line < lines.length; line++) {
        if (GPTViz.isPromptHeading(lines[line])) {
            sections.push(
                GPTViz.getPromptSectionFromLines(lines, line)
            );
        }
    }

    return sections;
};


GPTViz.isExtractHeading = function(line) {
    const heading = GPTViz.parseHeading(line);

    return (
        heading !== null &&
        heading.level === 1 &&
        heading.text.trim() === "Extract"
    );
};

GPTViz.getExtractSectionsFromText = function(text) {
    const lines = String(text || "").split("\n");
    const sections = [];

    for (let line = 0; line < lines.length; line++) {
        if (GPTViz.isExtractHeading(lines[line])) {
            sections.push(
                GPTViz.getHeadingSectionFromLines(lines, line)
            );
        }
    }

    return sections;
};

GPTViz.parseExtractBlocksFromText = function(text, markdownFile) {
    const sections = GPTViz.getExtractSectionsFromText(text);
    const blocks = [];
    const seenAssets = new Set();

    for (const section of sections) {
        const lines = section.text.split("\n");
        let asset = "";
        let source = "";
        const bodyLines = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const assetMatch = /^[ \t]*Asset:[ \t]*(.+)$/i.exec(line);
            if (assetMatch) {
                asset = assetMatch[1].trim();
                continue;
            }

            const sourceMatch = /^[ \t]*Source:[ \t]*(.+)$/i.exec(line);
            if (sourceMatch) {
                source = sourceMatch[1].trim();
                continue;
            }

            bodyLines.push(line);
        }

        const lineNumber = section.startLine + 1;

        if (!asset) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Missing required 'Asset:' in # Extract block.`
            );
        }

        if (!/\.png$/i.test(asset)) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Asset must end with .png (got '${asset}').`
            );
        }

        const normalizedAsset = asset.toLowerCase();
        if (seenAssets.has(normalizedAsset)) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Duplicate Asset target '${asset}'.`
            );
        }
        seenAssets.add(normalizedAsset);

        const prompt = bodyLines.join("\n").trim();
        if (!prompt) {
            throw new Error(
                `Extract parse error at ${markdownFile}:${lineNumber} - Empty # Extract prompt body for '${asset}'.`
            );
        }

        blocks.push({
            asset,
            source,
            prompt,
            line: lineNumber,
            startLine: section.startLine,
            endLine: section.endLine
        });
    }

    return blocks;
};

GPTViz.base64ToArrayBuffer = function(base64Text) {
    const binary = atob(String(base64Text || ""));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes.buffer;
};

GPTViz.removeKeyColorFromPng = async function(binary, tolerance) {
    const threshold = Number.isFinite(Number(tolerance))
        ? Number(tolerance)
        : 40;
    const feather = threshold * 2;

    const blob = new Blob([binary], { type: "image/png" });
    const imageUrl = URL.createObjectURL(blob);

    try {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("Could not decode PNG for Extract post-processing."));
            element.src = imageUrl;
        });

        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;

        if (!width || !height) {
            throw new Error("Could not decode Extract image dimensions.");
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Could not create 2D context for Extract post-processing.");
        }

        context.drawImage(image, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        const sampleRadius = 2;
        const corners = [
            [0, 0],
            [width - 1, 0],
            [0, height - 1],
            [width - 1, height - 1]
        ];
        let sampleCount = 0;
        let keyR = 0;
        let keyG = 0;
        let keyB = 0;

        for (const [cornerX, cornerY] of corners) {
            for (let offsetY = -sampleRadius; offsetY <= sampleRadius; offsetY++) {
                for (let offsetX = -sampleRadius; offsetX <= sampleRadius; offsetX++) {
                    const x = Math.max(0, Math.min(width - 1, cornerX + offsetX));
                    const y = Math.max(0, Math.min(height - 1, cornerY + offsetY));
                    const index = (y * width + x) * 4;
                    const alpha = pixels[index + 3];

                    if (alpha === 0) {
                        continue;
                    }

                    keyR += pixels[index];
                    keyG += pixels[index + 1];
                    keyB += pixels[index + 2];
                    sampleCount += 1;
                }
            }
        }

        if (sampleCount === 0) {
            return binary;
        }

        keyR /= sampleCount;
        keyG /= sampleCount;
        keyB /= sampleCount;

        for (let index = 0; index < pixels.length; index += 4) {
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            const alpha = pixels[index + 3];

            if (alpha === 0) {
                continue;
            }

            const distance = Math.sqrt(
                (red - keyR) * (red - keyR) +
                (green - keyG) * (green - keyG) +
                (blue - keyB) * (blue - keyB)
            );

            if (distance <= threshold) {
                pixels[index + 3] = 0;
                continue;
            }

            if (distance <= feather) {
                const factor = (distance - threshold) / (feather - threshold);
                pixels[index + 3] = Math.max(0, Math.min(255, Math.round(alpha * factor)));
            }
        }

        context.putImageData(imageData, 0, 0);

        const pngBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => {
                if (result) {
                    resolve(result);
                    return;
                }

                reject(new Error("Could not encode PNG after Extract post-processing."));
            }, "image/png");
        });

        return await pngBlob.arrayBuffer();
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
};

GPTViz.isMarkHeading = function(line) {
    const heading = GPTViz.parseHeading(line);

    return (
        heading !== null &&
        heading.level === 1 &&
        heading.text.trim() === "Mark"
    );
};

GPTViz.getMarkSectionsFromText = function(text) {
    const lines = String(text || "").split("\n");
    const sections = [];

    for (let line = 0; line < lines.length; line++) {
        if (GPTViz.isMarkHeading(lines[line])) {
            sections.push(
                GPTViz.getHeadingSectionFromLines(lines, line)
            );
        }
    }

    return sections;
};

GPTViz.parseMarkBlocksFromText = function(text, markdownFile) {
    const sections = GPTViz.getMarkSectionsFromText(text);
    const blocks = [];
    const seenNames = new Set();

    for (const section of sections) {
        const lines = section.text.split("\n");
        let name = "";
        let source = "";
        const bodyLines = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const nameMatch = /^[ \t]*Name:[ \t]*(.+)$/i.exec(line);
            if (nameMatch) {
                name = nameMatch[1].trim();
                continue;
            }

            const sourceMatch = /^[ \t]*Source:[ \t]*(.+)$/i.exec(line);
            if (sourceMatch) {
                source = sourceMatch[1].trim();
                continue;
            }

            bodyLines.push(line);
        }

        const lineNumber = section.startLine + 1;

        if (!name) {
            throw new Error(
                `Mark parse error at ${markdownFile}:${lineNumber} - Missing required 'Name:' in # Mark block.`
            );
        }

        if (seenNames.has(name)) {
            throw new Error(
                `Mark parse error at ${markdownFile}:${lineNumber} - Duplicate mark name '${name}'.`
            );
        }
        seenNames.add(name);

        const prompt = bodyLines.join("\n").trim();
        if (!prompt) {
            throw new Error(
                `Mark parse error at ${markdownFile}:${lineNumber} - Empty # Mark prompt body for '${name}'.`
            );
        }

        blocks.push({
            name,
            source,
            prompt,
            line: lineNumber
        });
    }

    return blocks;
};
