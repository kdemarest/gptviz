## Mode Ribbon

At the top right corner of key screens is a container called .mode-ribbon and the gptviz project owns and controls that ribbon.

Mode Ribbon contains these buttons:

1. MarkdownMode - show the source note of whatever is being viewed.
2. ImageMode - show the viewed note's image(s) in the candidate view.
3. MovieMode - play the viewed script, or go to the scripts that use what is being viewed.
4. DependsMode - pick one of the things the viewed item depends on and go to it.
5. More Actions - The same vertical elipsis that appears on .view-actions, plus "Check dependencies" (the vault-wide dependency check that writes _deps.md).

MarkdownMode, ImageMode and MovieMode show the same thing in another form. A button is greyed out when that form doesn't exist or is the one already showing. DependsMode is the only button that moves to a different thing.

| Viewing | MarkdownMode | ImageMode | MovieMode | DependsMode |
|---|---|---|---|---|
| Note (md) | grey | its image(s) in candidate view; grey for a note with no Prompt or image | play its Script (pick if several); else the scripts using its assets (pick if several) → script md | pick an input → its md |
| Candidate view | the note, at this image's Prompt | grey | as for its note | pick an input of this image → its image in candidate view |
| Movie player | the script md | grey | grey | pick an image the script shows → its image in candidate view |

Back is a separate button just left of the ribbon. Every gptviz navigation (mode buttons, DependsMode, opening a note, the Candidate View or a movie) records the place being left: a note, a Candidate View note + image + candidate, or a movie's script. Back returns to the last recorded place that differs from the current one, and is greyed out when there is none. Places are kept for the session only, up to 50.

DependsMode stays in the kind of view you are in, and lists direct dependencies only; pick one and tap again to go deeper. To review another image of the same note, go back to the note with MarkdownMode and use ImageMode.

Buttons are added to the Mode Ribbon using addModeButton(). That function takes an integer position, and then the button to be added. If the same button is added twice, then the old version of that button is discarded and the new version of the button is used. If the button being added is in a position for example position 1 and there's already a button there then the prior button is discarded. 

All buttons are added when the code starts, whether from a load or an plugin reload. The buttons all always appear on that ribbon from then on. They always start lit/enabled, but some are disabled when appropriate.

To the extent possible, .view-actions container is hidden.

The .mode-ribbon is used on the markdown view, the image candidate view the movie view, and the 3d view.

Buttons on mode ribbon are enabled and disabled from a single, centralized place.