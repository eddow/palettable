## Ideas

- In edition mode, have a contextual menu for tools and toolbars (tracks?)
- resize longitudinal tools + drawer-tools (sliders, ...)

## TODOs

- demo+tests contexts
- demo+tests light/dark themes
- isolate demo data for it to be usable by all demos
- drawers are not yet presentable
- check edition in drawer
- refactor adding tool
- status are completely not-done: 0
- derived points
  - enum from whatever: list values in the point
  - command from whatever: push+set / pop (ex. pause = set gameSpeed=0 / reset gameSpeed to what it was before pause)

## CSS refactor

What about using vertical/horizontal classes telling the orientation of a track (even if the class can be on a stack/parking as it applies to all its tracks) and use it for the sub-elements (tools)?

```css
/* Define your layout containers */
.horizontal {
  container-type: normal;
  --layout: horizontal;
}

.vertical {
  container-type: normal;
  --layout: vertical;
}

/* Your leaf element looks at the CLOSEST inherited --layout value */
@container style(--layout: horizontal) {
  .my-leaf-element {
    /* These styles apply because the closest container is horizontal, 
       ignoring the vertical container higher up! */
    display: flex;
    flex-direction: row;
  }
}

@container style(--layout: vertical) {
  .my-leaf-element {
    display: flex;
    flex-direction: column;
  }
}
```