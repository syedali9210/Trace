---
name: trace-design
description: Open Trace's design canvas on the app in this folder, so the person picks anything on screen and changes its spacing, size, type, colour, corners and border like in Figma while you work, then take their changes and write them in the code. Use whenever you design or polish UI with the person ("open the canvas", "design mode", "let me tweak it", "I want to adjust this visually", "apply my canvas changes"), and before UI work in a project Trace knows.
---

# Trace design canvas

Trace runs this folder's app on its own dev server and opens it as a canvas: the person picks any element and changes how it's drawn (layout, padding, gap, type, colour, fill, corners, border, opacity) and sees it at once. Each change is kept with where it lives in the code (file and line) and the code it needs (the Tailwind class to add and the ones it replaces, else CSS). Trace also reads this session while it's open (what the person asks, your replies and reasoning, the files you edit), so its AI can answer their questions on the canvas with all of it.

## 1. Open it

From the project folder:

```bash
node "{{TRACE_DIR}}/bin/trace.js" canvas
```

It starts the app in Trace if it isn't running, opens the canvas in the browser and prints its link. Give the person the link and tell them, in a line: pick anything, change it on the right, then say "apply my canvas changes". (Over MCP: `open_design`.)

While it's open, keep working on what they asked. Your code changes show on the canvas as you make them (the dev server reloads).

## 2. Take their changes and write them

When they say they're done, or "apply my canvas changes":

```bash
node "{{TRACE_DIR}}/bin/trace.js" changes
```

(Over MCP: `get_design_changes`.) Each change gives the element, its file and line, the line as it is now, the property from → to, and the code to make. Make exactly those changes:

- With Tailwind, swap the classes it names (`text-xl → text-[28px]`). When it says to replace a shorthand (`py-3` for a top-only change), keep the other side (`pt-4 pb-3`).
- Without Tailwind, set the CSS it gives on that element's rule.
- If a line moved, find the element by its text and classes near the line given. If a change is drawn by a shared component (a `Button` used in many places), say so and ask whether to change the component or only this use.
- Keep their values exact (28px is 28px). Change nothing they didn't.

Then:

```bash
node "{{TRACE_DIR}}/bin/trace.js" changes --done
node "{{TRACE_DIR}}/bin/trace.js" check --ask "<what they asked, in their words>"
```

The check walks the screens your change touched and says if it went outside what was asked or broke a rule they set. Tell them what changed, file by file, in a few lines.
