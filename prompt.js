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

GPTViz.getPromptSectionFromLines = function(lines, startLine) {
    const startHeading = GPTViz.parseHeading(lines[startLine]);
    const promptLevel = startHeading.level;
    let endLine = lines.length;

    // End at the next heading of the same or higher level.
    for (let line = startLine + 1; line < lines.length; line++) {
        const heading = GPTViz.parseHeading(lines[line]);

        if (heading && heading.level <= promptLevel) {
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
