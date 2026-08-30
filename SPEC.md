## Implemented

GPTViz currently provides five commands:

- **GPT connect** — verifies the configured OpenAI API connection.
    
- **GPT show prompt** — finds the current Markdown `Prompt` section and reports it.
    
- **GPTViz Generate Image** — sends the current Markdown `Prompt` section, including any referenced images from an `Images:` line, to the OpenAI image-generation tool and writes a successful image result to a new candidate PNG. While the request is running, it shows a spinner modal with a Cancel button. Cancellation closes the modal, prevents the result from being saved, and does not consume a candidate number. After a successful image is saved, it invokes the same file-based review operation used by GPTViz Review Images.
    
- **GPTViz Review Images** — scans the current Markdown file’s existing PNG candidates and opens the highest-numbered image in a modal with Prev, Next, and Keep controls. Prev is disabled on the first image, Next is disabled on the last image, and Keep is disabled and reads Kept when the current image matches the root-level kept image. The modal can be closed with Obsidian’s X. It has no connection to a prior generation call and stores no viewing state.
    
- **GPTViz Check Dependencies** — scans every Markdown file’s Prompt sections for `Images:` references. It compares each referenced image with the note’s root-level generated PNG and displays stale or missing dependencies in a scrollable modal. Tapping a listed note opens its companion Markdown file.

A prompt starts at a Markdown heading whose text begins with `Prompt`.

The section ends at the next heading of the same or higher level.

If no Prompt heading exists above the cursor, the first Prompt section in the file is used.

Successful image results are decoded from base64 and saved as PNG files under `candidates/`, using the current Markdown file’s base name and a number one greater than the highest existing PNG candidate number. Candidate numbering is derived only from files in `candidates/`; GPTViz stores no counter or candidate metadata.

If the API returns text instead of an image, including a refusal or other complaint, GPTViz displays that text in a modal and does not create a candidate file. Unexpected non-image responses are also displayed in the modal as readable JSON. A non-image response does not consume a candidate number.

An optional `Images:` line in the Prompt section contains comma-separated image names. Images are loaded from the project root; names without an extension use `.png`. The line is removed from the textual prompt, and supported images are sent as image inputs. GPTViz collects all missing, unreadable, or unsupported image warnings, displays them together in a modal, and does not show the spinner or send an image-generation request when any warning exists.

A `Photos:` line is deprecated in favor of `Images:`. If a Prompt section contains `Photos:`, GPTViz displays a deprecation warning and does not send an image-generation request.

## Planned

No additional planned behavior is currently documented.

## Principle

Obsidian is the editor and file selector.

GPTViz only needs to:

- read the current Prompt section
    
- load reference images
    
- generate candidate images
    
- browse candidates
    
- promote a chosen candidate
    
- check image dependencies
