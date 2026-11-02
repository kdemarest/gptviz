unit("openai", [], () => {
globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");


// An image request: the prompt and its reference images, with the image generation tool.
GPTViz.imageRequestBody = function(prompt, imageInputs) {
    return {
        model: "gpt-5.6-luna",
        tools: [
            {
                type: "image_generation"
            }
        ],
        input: imageInputs && imageInputs.length > 0
            ? [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: prompt
                        },
                        ...imageInputs
                    ]
                }
            ]
            : prompt
    };
};

// A finished response's image and text: { imageBase64, text }; text is the whole response
// when it holds neither.
GPTViz.parseImageResponse = function(data) {
    let imageBase64 = null;
    const textParts = [];

    for (const output of data.output || []) {
        if (
            output.type === "image_generation_call" &&
            output.result
        ) {
            imageBase64 = output.result;
        }

        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                textParts.push(content.text);
            }
        }
    }

    if (imageBase64 || textParts.length > 0) {
        return {
            imageBase64: imageBase64,
            text: textParts.join("\n\n")
        };
    }

    return {
        imageBase64: null,
        text: JSON.stringify(data, null, 2)
    };
};

// requestUrl for the background calls, failing with what went wrong: OpenAI's status and
// message (error.status set), or, with no status, that OpenAI couldn't be reached. (On the
// phone a failed request otherwise throws an empty Error.)
GPTViz.requestOpenAI = async function(request, what) {
    let response;
    try {
        response = await GPTViz.obsidian.requestUrl({ ...request, throw: false });
    } catch (error) {
        throw new Error(`Couldn't reach OpenAI while ${what} (${error.message || "no connection"}).`, { cause: error });
    }
    if (response.status >= 400) {
        let message = response.text;
        try {
            message = response.json.error.message || message;
        } catch (error) {
            // Not JSON: keep the text.
        }
        const error = new Error(`OpenAI answered ${response.status} while ${what}: ${message}`);
        error.status = response.status;
        throw error;
    }
    return response;
};

// Starts an image in background mode: the request returns at once with the response (its id
// and status), and the image is fetched with fetchOpenAIResponse, so a dropped connection
// loses nothing. store keeps it fetchable after the first ten minutes.
GPTViz.startOpenAIImageResponse = async function(apiKey, prompt, imageInputs) {
    const response = await GPTViz.requestOpenAI({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            ...GPTViz.imageRequestBody(prompt, imageInputs),
            background: true,
            store: true
        })
    }, "starting the image (nothing was recorded as pending)");

    const data = response.json;
    if (!data || !data.id) {
        throw new Error(`OpenAI returned no response id: ${response.text}`);
    }
    return data;
};

GPTViz.fetchOpenAIResponse = async function(apiKey, id) {
    const response = await GPTViz.requestOpenAI({
        url: `https://api.openai.com/v1/responses/${encodeURIComponent(id)}`,
        method: "GET",
        headers: {
            "Authorization": `Bearer ${apiKey}`
        }
    }, `fetching image ${id}`);
    return response.json;
};

GPTViz.cancelOpenAIResponse = async function(apiKey, id) {
    await GPTViz.requestOpenAI({
        url: `https://api.openai.com/v1/responses/${encodeURIComponent(id)}/cancel`,
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`
        }
    }, `cancelling image ${id}`);
};


GPTViz.generateOpenAIImageResponseDetailed = async function(apiKey, prompt, imageInputs) {
    const response = await GPTViz.obsidian.requestUrl({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "gpt-5.6-luna",
            tools: [
                {
                    type: "image_generation"
                }
            ],
            input: imageInputs && imageInputs.length > 0
                ? [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: prompt
                            },
                            ...imageInputs
                        ]
                    }
                ]
                : prompt
        })
    });

    const data = response.json;
    const imageBase64s = [];
    const textParts = [];

    for (const output of data.output || []) {
        if (
            output.type === "image_generation_call" &&
            output.result
        ) {
            imageBase64s.push(output.result);
        }

        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                textParts.push(content.text);
            }
        }
    }

    return {
        imageBase64s: imageBase64s,
        text: textParts.length > 0
            ? textParts.join("\n\n")
            : JSON.stringify(data, null, 2)
    };
};


GPTViz.generateOpenAITextResponse = async function(apiKey, prompt, imageInputs) {
    const response = await GPTViz.obsidian.requestUrl({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "gpt-5.6-luna",
            input: imageInputs && imageInputs.length > 0
                ? [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: prompt
                            },
                            ...imageInputs
                        ]
                    }
                ]
                : prompt
        })
    });

    const data = response.json;
    const textParts = [];

    for (const output of data.output || []) {
        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                textParts.push(content.text);
            }
        }
    }

    if (textParts.length > 0) {
        return textParts.join("\n\n");
    }

    return JSON.stringify(data, null, 2);
};
});
