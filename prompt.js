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

GPTViz.getPromptSection = function(editor) {
    const lineCount = editor.lineCount();
    const cursorLine = editor.getCursor().line;

    let startLine = -1;

    // Find nearest Prompt heading at or above cursor.
    for (let line = cursorLine; line >= 0; line--) {
        if (GPTViz.isPromptHeading(editor.getLine(line))) {
            startLine = line;
            break;
        }
    }

    // If none above cursor, use first Prompt heading in file.
    if (startLine === -1) {
        for (let line = 0; line < lineCount; line++) {
            if (GPTViz.isPromptHeading(editor.getLine(line))) {
                startLine = line;
                break;
            }
        }
    }

    if (startLine === -1) {
        return null;
    }

    const startHeading =
        GPTViz.parseHeading(editor.getLine(startLine));

    const promptLevel = startHeading.level;
    let endLine = lineCount;

    /*
     * End at the next heading of the same or higher level.
     *
     * Example:
     *
     * ### Prompt - Forest
     * #### Details          included
     * ##### More details    included
     * ### Notes             STOP
     *
     * A ## or # heading would also stop the section.
     */
    for (let line = startLine + 1; line < lineCount; line++) {
        const heading =
            GPTViz.parseHeading(editor.getLine(line));

        if (heading && heading.level <= promptLevel) {
            endLine = line;
            break;
        }
    }

    const lines = [];

    for (let line = startLine; line < endLine; line++) {
        lines.push(editor.getLine(line));
    }

    return {
        text: lines.join("\n"),
        startLine: startLine,
        endLine: endLine
    };
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

GPTViz.binaryToBase64 = function(binary) {
    const bytes = new Uint8Array(binary);
    let characters = "";

    for (let index = 0; index < bytes.length; index++) {
        characters += String.fromCharCode(bytes[index]);
    }

    return btoa(characters);
};

GPTViz.loadPromptImages = async function(app, imageNames) {
    const imageInputs = [];
    const warnings = [];

    for (const imageName of imageNames) {
        const path = /\.[^./]+$/.test(imageName)
            ? imageName
            : `${imageName}.png`;
        const file = app.vault.getAbstractFileByPath(path);

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
    }

    return {
        imageInputs: imageInputs,
        warnings: warnings
    };
};


GPTViz.getPromptSectionsFromText = function(text) {
    const lines = text.split("\n");
    const starts = [];

    for (let line = 0; line < lines.length; line++) {
        if (GPTViz.isPromptHeading(lines[line])) {
            starts.push(line);
        }
    }

    const sections = [];

    for (let index = 0; index < starts.length; index++) {
        const startLine = starts[index];
        const startHeading = GPTViz.parseHeading(lines[startLine]);
        let endLine = lines.length;

        for (let line = startLine + 1; line < lines.length; line++) {
            const heading = GPTViz.parseHeading(lines[line]);

            if (heading && heading.level <= startHeading.level) {
                endLine = line;
                break;
            }
        }

        sections.push({
            text: lines.slice(startLine, endLine).join("\n"),
            startLine: startLine,
            endLine: endLine
        });
    }

    return sections;
};
