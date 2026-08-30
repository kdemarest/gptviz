var GPTViz = GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");

GPTViz.testOpenAIConnection = async function(apiKey) {
    const response = await GPTViz.obsidian.requestUrl({
        url: "https://api.openai.com/v1/responses",
        method: "POST",

        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "gpt-5.6-luna",
            input: "Reply with exactly: connection successful"
        })
    });

    const data = response.json;

    for (const output of data.output || []) {
        for (const content of output.content || []) {
            if (
                content.type === "output_text" &&
                content.text
            ) {
                return content.text;
            }
        }
    }

    throw new Error("OpenAI returned no text response.");
};


GPTViz.generateOpenAIResponse = async function(apiKey, prompt, imageInputs) {
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
