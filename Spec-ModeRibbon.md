## Mode Ribbon

At the top right corner of key screens is a container called .mode-ribbon and the gptviz project owns and controls that ribbon.

Mode Ribbon contains these buttons:

1. MarkdownMode - this puts the app onto Obsidian's standard markdown view.
2. ImageMode - this opens the candidate view
3. MovieMode - this opens the movie viewer
4. DependsMode - this runs the dependency check and opens _deps.md
5. More Actions - The same vertical elipsis that appears on .view-actions

Buttons are added to the Mode Ribbon using addModeButton(). That function takes an integer position, and then the button to be added. If the same button is added twice, then the old version of that button is discarded and the new version of the button is used. If the button being added is in a position for example position 1 and there's already a button there then the prior button is discarded. 

All buttons are added when the code starts, whether from a load or an plugin reload. The buttons all always appear on that ribbon from then on. They always start lit/enabled, but some are disabled when appropriate.

To the extent possible, .view-actions container is hidden.

The .mode-ribbon is used on the markdown view, the image candidate view the movie view, and the 3d view.

Buttons on mode ribbon are enabled and disabled from a single, centralized place.