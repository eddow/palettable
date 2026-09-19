Concepts:
Toolbars = Tool[]
Track = { space, toolbar }[]
Stack = Track[]
Parking = Toolbar[]

Horizontal parking stacks toolbars *vertically* (and vice-versa)

core-css: When editing and not dragging, toolbars in tracks get handles (padding) on mouse-over


## Ideas

- In edition mode, have a contextual menu for tools and toolbars (tracks?)

## TODOs

- HTML change *does* change which element the mouse is over (or a least should)
- We have to double the stack-DZ before de-highlighting the other ones
- clicking a tool in the edit command-box combo should begin add (now, it stays on the last selection)
- key shortcuts do not work when the html page is not properly focused
- key shortcuts for game-speed (just an example) allows no increase but infinite decrease (even getting to negative numbers)
- items should have a vertical and horizontal version: vertical ones should be contained in a max-standard-width (basically the same as height when horizontal)
- When radiobuttongroup is used, we should be able to configure if the text is shown too or not. On vertical tools, the ext will appear on mouse-over, without resizing the toolbar and beside the icons who, at rest, will be the only ones visible