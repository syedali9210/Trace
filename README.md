# Trace — design context engine

**Job:** When I hand design work to an AI agent or a teammate, I want them to already know the project's history, decisions and current state, so I stop re-explaining it and stop writing changelogs by hand.
**Primary persona:** the solo design engineer who designs in Figma or Framer and builds with Claude Code or Cursor.
**The one action:** connect a tool once; after that, confirm what Trace captured in the review inbox (one key per moment).

Trace captures design work from your tools, groups raw saves into **moments**, writes the changelog, files each moment into a **project**, and serves that memory to people (timeline, diffs, decks) and to AI agents (an MCP server). Agents can also recall what your other AI tools remember.

## Run it

```bash
npm install
```

```bash
npm start
```

The app is built once (it lives in `ui/`, see below):

```bash
npm --prefix ui install
```

```bash
npm run build:ui
```

Open http://127.0.0.1:4317. The first run walks you through solo/team, connecting a first tool, and watching the first moment arrive. Pick **Sample project** to see everything working before you connect anything.

```bash
npm test
```

The test is a self-check run in a throwaway data folder: diffs, regions, magnitude, grounding and a real end-to-end pass through the queue, then version history, partial walks, the checks (drift, scope, design against code, flip-flops, states, the queue, `check_change`, broken decisions, the "no" list, DESIGN.md), the chat insight engine's rules, a deck's numbers and what each file is.

## The app (ui/): shadcn/ui + Fluid Functionalism

The interface is a React app in `ui/` (Vite, Tailwind v4), installed with the shadcn CLI: shadcn/ui on Base UI with the Nova preset (Geist), and every Fluid Functionalism component (`npx shadcn add https://www.fluidfunctionalism.com/r/setup/phosphor.json`, so its components draw Phosphor icons, the same set as the nav rail). The components live in `ui/src/components/ui`; Trace's screens in `ui/src/app`.

- Buttons, menus (Dropdown), dialogs, tabs and segmented controls, switches, sliders, selects, tables, tooltips, the ⌘K command menu, banners and badges are Fluid Functionalism's; inputs, textareas, native selects, checkboxes, fields, popovers, skeletons, empty states and toasts (Sonner) are shadcn's.
- Ask is built from Fluid Functionalism's chat parts: ChatMessage, ThinkingSteps (the tools it runs, folded once it answers), ThinkingIndicator and InputMessage (Stop while it works, ↑ for past questions).
- Trace's own lists (the settings nav, follow-up questions) use its fluid hover: one highlight glides to the row nearest the pointer.
- Motion follows the OS reduced-motion setting (`MotionConfig reducedMotion="user"`). Theme: light, dark or the system's, from the account menu (shadcn's `.dark` class).
- The nav rail keeps its own look.

`npm start` serves the built app from `ui/dist` (and falls back to the old no-build app in `web/` if there is no build). To work on the interface with live reload, run the server and then `npm run dev:ui` (Vite on http://127.0.0.1:5317, passing /api to the server).

## Connect your tools (Settings → Sources)

| Tool | How | You need |
|---|---|---|
| Figma | REST API, polled every minute: versions → changed frames → node-level diffs, renders, comments, variables (Enterprise) | A personal access token + file links or team IDs |
| GitHub | Commits, PRs, review comments; Figma links in commits/PRs become "implements" links | A fine-grained token, or tick "use my GitHub CLI login" |
| Watched folder | Any save inside the folder (exports, .ai, .psd, .riv, .sketch, video). Files in an `exports/` folder close a moment | A folder path |
| Links | Figma, Framer, Spline, Rive, Webflow, Adobe, YouTube, Loom, Vimeo, Dribbble, Behance, Google Docs, any page. Snapshotted now and every 6 h | Paste a link (or Ctrl V anywhere) |
| Drop / paste / upload | Anywhere in the app. Zips are unpacked; re-uploading a file with the same name makes a new version with a diff | Nothing |

## Your AIs' memory (AI memory page)

Reading memory needs no API key (Trace’s own AI is optional, see below). Every AI you use already keeps its own memory; Trace reads it **when an agent asks**, so what one AI learned is there for the next one.

| AI | What Trace reads |
|---|---|
| Claude Code | `~/.claude/projects` sessions and memory files, `CLAUDE.md` |
| Codex | `~/.codex/sessions`, `AGENTS.md` |
| Antigravity | `~/.gemini/antigravity/brain` transcripts and artifacts, `GEMINI.md` |
| Cursor | Its chat store (`state.vscdb`, read from a copy) |
| GitHub Copilot | VS Code `chatSessions` |
| Claude.ai / ChatGPT | A chat export you upload |

Connect each one on the AI memory page. Only files that changed since the last call are re-read (at most every 60 s), tool output is skipped and keys and tokens are blanked before anything is stored. Sessions map to a project through the folders you list in its settings.

Changelogs are written by rules from the diff ("Decreased font size. Changed colours."), so every claim comes from what actually changed.

**What your chats say** (a project's AI memory, and behind its decks, decisions and artifacts). Trace reads each Claude Code session of the project whole: what you asked and how you said it, what Claude replied, what it reasoned, and which files it changed for each ask. By rules, not a model, it finds the rules you set ("never introduce a new arbitrary value", "dont use strokes anywhere in the site"), what you said no to and what it was about, what you kept ("bro its good now"), why things broke (Claude's words, from its replies and its reasoning, not its guesses), results in numbers ("cut the app's code from 26.9 MB to 9.8 MB") and what it made (the films, docs and pictures it linked that are still there). Each with its day, its chat and its files, the strongest first. A session is streamed once and cached by its size and time (a 500 MB chat: about 5 s once, then instant). Other tools' chats bring their asks and the AI's last word from the memory index.

## Trace's AI (optional: Settings → AI)

Add a **Vercel AI Gateway** key in Settings → AI (or set `AI_GATEWAY_API_KEY`). The default model is `nvidia/nemotron-3.5-lightning-free` (free on the gateway); any gateway model works, as `provider/model`. The key is stored encrypted on this computer. Without a key the AI buttons stay hidden (Ask explains how to turn it on) and the rules engines carry on as before.

- **Ask Trace** (**Ask**, beside the + at the bottom of every page, or Ctrl J): the whole screen, plain and quiet. Your chats on the left, kept in this browser and grouped by day (Today, Yesterday, This week, Earlier), each with its project; New chat at the top; a chat from the last 15 minutes carries on when you open Ask again. Before you ask, **Start from your work**: questions built from your own projects, each with what it's about ("What changed in portfolio v2 lately, and why?" · "Added 95 code files and 77 images · 4 h ago"; the open tasks, open reviews, uploads waiting in Review, what your agents did; the page you came from asks its own question first), and **Carry on** with your recent chats. One chat over every project, its folders and code, what your AI tools remember, and everything in Trace, aware of the page you're on; the project it reads is picked in the box. It works through the same tools agents get over MCP, so it can search, read blocks and files, and file what you ask for (notes into a block, tasks, case-study answers, insights, comments). Your question sits on the right; the answer reads as a page (15 px, 1.7 line height) under "Trace · 10.4s": while it works, a quiet dot says which step it's on ("Read the latest changes"); then its steps fold into one line you can open, and under the answer: copy, ask it again, and **Ask next**. Ids it cites become small "change" links to that change. A file it wants to create or change in a project's folder waits for your **Write the file**. On a phone or tablet the chats open as a drawer.
- **Insights with AI** (the canvas bar, or **Ask AI** on a link between two blocks): reads the blocks side by side and saves gaps, conflicts and matches on the links. It keeps an insight only if the items it cites are really in those blocks.
- **Find the why** (a change page, when nothing explains it yet): reads the AI sessions and comments around the change and quotes the one that says why, for you to keep or dismiss. If none does, it says so.
- **Draft open answers** (the case study): drafts the thin and open questions from their own evidence, marked as Trace AI's; your answers are never touched.
- **Suggest tasks** (the to-do board): finds the things to do in the open reviews; add the ones you want.
- **Draft the brief** (project ⋯ → Start the brief from the work): written from the project's docs and recent work instead of a template.
- **Sorting your agent chats**: coding agents get asked all sorts in a project's folder ("shorten this message for my landlord", a resume, a LinkedIn post). Every 10 minutes Trace sorts each project's new chats: plain personal and career asks are filed out by rules, the rest are read by the AI in batches of 15, in time order. It names each chat's kind (work, process, social, career, personal, elsewhere), notes in a few words what it was about, and links it to the change it led to. A short follow-up ("a bit shorter", "humanize it") goes where the chat before it went. Filed-out chats leave the journey, the digest, the case study, brainstorms and project-scoped memory search; a chat that led to a change lands on that change in the journey. File one out by hand (the eye on a prompt), or bring it back from the list at the end of a project's timeline; the AI never overrules you. Verdicts are kept by the chat's time, so a resumed session (which copies its chats into a new file) is sorted once and shown once.
- **Where it stands**: every 10 minutes, a project with new work, file changes in its folders or new sessions in your coding agents gets its digest refreshed (what changed, what's open, what's next), shown under the project's title. **Sync now** sorts the newest chats and rebuilds it from the last two weeks; Settings → AI turns the timer off and shows how many chats were sorted. Agents get it in `get_project_context`.

**The free model**: Nemotron 3.5 Lightning thinks before it answers, and the thinking counts against the token budget. On a big JSON job it can think through all of it and say nothing (the old "The AI's digest couldn't be read"), so JSON jobs (sorting, the digest, insights, why, drafts) run without thinking, and Ask thinks briefly and asks again without thinking if it runs out of room. The free tier takes 5 requests a minute, so every call waits its turn in one queue: what you are waiting on goes first, background work after, and a 429 waits as long as the Gateway says before trying again. Ask shows the wait. `AI_RPM` (or the `ai_rpm` setting) changes the limit for a paid key.

Text read from files and tools is passed as data, never as instructions; `.env` files, keys, dependencies and build output are never read. The model's provider may keep prompts to improve its model.

## Search (Ctrl K)

Searches the work, every block's notes, case-study answers and what your AIs remember. Scope it to a project and it searches the project's folders on disk too (file names and text, with the matching line), and to one of those folders. A file opens on its matching line. The first row asks Trace's AI the same question.

## To do (Home → To do, and each project's Tasks)

Tasks as cards on a board: click to select, click again to edit (title, details, status, who's on it), drag to reorder, resize, drag from a card's dots to another to say "do this, then that". The round button marks a task done. Home shows every project's tasks, tinted by project; a project's Tasks (and its canvas Tasks block) show its own.

## A project, opened

A project opens the NCS way, filling the window: the back arrow and a tick scrubber on the left, every iteration down the middle as it looks (newest first, the date floating at the top, the name and description above), and beside it the iteration in view: **Changes** (the sentence, refresh), one card per kind of change with before → after values, **Why** (the AI's reasoning or the change's note, its first sentence in bold), what you **Marked**, what **You asked** your AI and the references pinned to it. The switcher at the top right goes to **History** (below), the **Canvas**, the **Case study** and, under ⋯, everything else (Artifacts, References, Tasks, Tree, AI memory, Decisions, Proposals, Files, Decks, Workflow). Under 1100px wide, the cards beside the work step aside (the change page has them all).

**Annotate** (the pencil next to +): **Draw** in red on the picture, **Erase** a line or a mark, **Comment** on a spot (a bubble pin), **Mark** a spot (a numbered green pin, listed beside the work), × to finish (Esc too), and search.

## The journey

Each change is told as a story: what you gave (your prompts and the pictures you pasted, read from your AIs' own sessions in the project's folders), what the AI replied and the screenshot it took, what changed, why, and your review.

**The script.** Agents connected to Trace get a short script before they work (in the MCP instructions and in `get_project_context`). It asks them to call `explain_changes` after every ask: what you asked in your words, what they understood, each change with why, the references you gave them, and their own review of that reasoning. It lands on the change as a card you mark **Looks right** or reply to; the agent reads your reply next time. Project → AI memory → *Add to CLAUDE.md* (or AGENTS.md, GEMINI.md, Cursor rules) writes the same script into the project's folder, inside a marked block Trace replaces on the next add.

**References** are pictures, videos, links, notes, colours and fonts. Pin any of them to the change it shaped (from the reference's menu, or + on the change page). Pictures you paste into a prompt to your AI are picked up and pinned to the change that prompt led to.

**Home** is NCS's **Latest** feed: each project's newest work, three quarters wide, beside its changelog card (the project, refresh, the changes sentence, today's before → after rows fading out, expand), the sides swapping row by row. Click the work to open the project; expand for every change, the tasks and open reviews. **Projects** shows every project on one page, and **To do** every project's tasks.

**Code changes are drawn.** When a `.tsx` or `.jsx` file changes in a watched folder, Trace compiles that file against its own project (esbuild, the project's own React and CSS), renders it in a headless browser and keeps the picture as that version, so a code change shows visually everywhere a design change does, with a pixel diff and changed regions. Every exported component is drawn as a labelled frame, with sample props read from its own TypeScript types (`label: string` becomes "Label", a union takes its first value, lists start empty, callbacks do nothing; optional props keep their defaults). If none can draw without real data, the whole app is drawn with that version of the file. On the change page, **Drawn** compares the pictures, **Live** runs both versions side by side in sandboxed frames, **Code** shows the line diff. Test, spec and story files are skipped. Needs Edge or Chrome (`TRACE_BROWSER` to choose); without one, code changes keep their text cards.

**Tree** (a project tab): every version as a node on a canvas, joined to the one it came from, with its picture, when it was made and who made it. Code saved while an AI was working in that folder counts as the AI's. Explorations branch off the main line; "evolved into" links are dashed. Switch to one component to see each drawn version of that file.

## History: every version of the product on a canvas

**History** (beside Timeline at the top of a project) is the product's whole history, read from its folder's git: every version is a node on an endless canvas, oldest on the left, branches below the main line, with what changed in it (its files and lines), what was asked, who made it and when. A folder that isn't a git repository yet gets **Start version history** (it adds `.git` and a `.gitignore`, and saves what's there as the first version). Files changed since the last version show as a dashed **Not saved yet** node; **Save version** in the dock saves them.

Drag the ground (or scroll) to move around, Ctrl + wheel or a pinch to zoom, **F** to fit the whole history, ← → to walk the versions. Pick one and its panel says:

- **What was asked** and **Why**: from the version's message (`Asked:` / `Why:` lines), from Claude's own run when Claude made it from Trace, or from the chat in your coding agent's memory (Claude Code, Codex…) just before the version was saved.
- **How Claude worked**: every step of a Trace run (what it read, searched, ran and edited, and what it said along the way).
- **Changes** (each file's line diff), **Files** (every file as it was in that version, opened in place) and the **Thread**.

**Tag @claude** in a version's thread (or **Ask Claude** in the dock) and Claude Code runs headless in the project's folder (`claude -p`, edits only: read, edit, search, and `git show/log/diff` to look at older versions). A node appears on the canvas at once and shows what it's doing; when it finishes, Trace saves its change as the next version, authored by Claude, with your ask and its reasons in the message, and Claude answers in the thread. Unsaved changes of yours are saved as their own version first. Needs Claude Code installed and signed in on this computer (`claude`, then `/login`); `TRACE_CLAUDE` points at another build.

**Tag @trace** instead for **Trace AI**, the free model on your Vercel AI Gateway key (Settings → AI): it reads and edits the folder's files through five tools (list, read, read as it was in that version, exact find-and-replace, write), and its change lands the same way, as a version by "Trace AI" with the ask and its why. It costs nothing; it's slower (the free tier takes 5 requests a minute, and the canvas says when it's waiting its turn) and simpler than Claude, so keep it for small, clear changes. @claude uses your Claude plan's usage, not money. The thread's two buttons, **Claude** and **Trace AI · free**, pick which one.

**Frames** (the switch beside the project's name, or **See its frames** on any version): that version's frontend as it really runs, in three tabs.

- **Screens.** Trace runs the version (its own dev server) and walks it in a headless browser the way a person would: tabs, buttons, menus, sheets, the theme switch, links inside the app, from a fresh first visit each time (three tabs at once). It never clicks anything that deletes, pays, sends, saves or leaves the app. Every different state it lands in becomes a screen, **pictured at its whole length**: it waits for the data to land, tells everything that waits to be scrolled to that it's in view (sections that fade in, pictures that load late), and for an app shell whose content scrolls inside a window-high frame it grows the window until nothing is hidden. Overlay screens (a dialog, a sheet, each stage of an intro) are pictured as the window shows them. A first walk's screens appear on the canvas as they're found.
- **The map.** Columns say how many clicks in a screen is (Opens on, 1 click in, 2 clicks in…). A line with corners leaves a screen's edge level with what was clicked (ringed on its picture) and ends in an arrow at the next screen's name, with the click's words beside it; lines from one screen share a trunk. Hovering a screen lights its lines; picking one lights the whole trail of clicks that reaches it, and its panel's steps each go to their screen. A long page shows its first 1¼ windows and unfolds (**Whole page · 4,048 px**). Arrow keys move between screens (→ what it leads to, ← where it came from, ↑ ↓ the screens beside it); the minimap in the corner shows where you are and takes you anywhere. Dialogs and their stages are framed together under one label.
- **On top of each screen:** **Frame by frame** plays its assembly, the app's own components lit one at a time in the order React built them, outermost first, each where it drew (read from React's own tree, so components kept inside a file count too), the ones already shown left outlined; ← → step, Space plays, `[` `]` go to the previous and next screen without closing. **Preview** opens the version live in that state (its clicks replayed in the page), at Desktop, Tablet or Phone width; when the clicks don't land, the app stops or it's slow to open, it says so in the stage with Start it over, a new tab, or its picture. Under each screen, **In this frame** sorts what it's made of by kind (Buttons, Inputs, Overlays, Navigation, Status, Data, Text styles, Layout); a chip outlines where that part drew, a click opens it in the design system.
- **Checks** (the strip's fourth stage, "4 need you"): one list of what needs you, beside the work, riskiest first: a change that moved screens the ask didn't name, a decision the code broke, a value that keeps changing back (nobody has decided it), the design and the code apart (captured Figma frames, variables and token files against what runs, and which side changed last), what breaks under the stress walk, values that almost match the app's own. Each says its file, its last commit and what was asked for it. **Ask Claude** writes the request out at the sheet's foot for you to read and send; **It's meant** and **Keep …** are decisions (Undo for a few seconds), so the item doesn't come back. States the code has that no walk has seen and no design shows come last, with the **stress walk**: every page opened with no data, failing data, slow data and ~40% longer text (a translation), checked by rule (text cut off, sideways scroll, text over text, contrast, a blank page, errors thrown); what it forces counts as seen. The same checks run from a terminal: `node bin/trace.js check [folder] [--ask "…"] [--stress]`.
- **How far it got** (the strip): Packages · App · Walk, each with a status dot. Each opens to what it means and the way out when it's stuck: install what's missing, try the app again or restart it, read the last lines its dev server said, run it in another of its modes, walk again, the clicks the walk couldn't make and why. A walk that breaks part-way keeps what it found; one that finds nothing keeps the screens from before and says what went wrong. If the app asked for data that didn't come (its API isn't running), the canvas says so; when its scripts run it in another mode (`vite --mode replay` in `build:replay`), **Runs in** switches to that mode, which often brings its own data, and walks it again.
- **Design system.** A bar with **Foundations** (Colours, Type, Radii, Shadows, Spacing, Motion) and **Components** (All, then each kind), lit for the section in view. **Colours**: each scale as one strip of steps (gray 100 → 1000) on its theme's own ground, Light or Dark, the #hex shown on hover and copied with a click (a tick says so; a see-through colour is #rrggbbaa); the named colours (background, focus, black…) as cards with their #hex and how text reads on them (its own foreground when it has one, else white or dark text, with the ratio and AA/AAA). The text styles on its screens (each drawn as the app draws it). **Components**: every component in the code as a gallery (each as it shows on its screens, filtered by kind), then each kind, **buttons first**: its real appearances (each different set of props once, a click opens Frame by frame there), every state when it can stand alone (Default, Hover, Focus, Pressed, Disabled, each on/off prop, a row per variant from its union type, a `&`-joined props alias or `cva()`), **States and motion** for its animations, its code, and the screens it's used in.
  **Write DESIGN.md** (in its header) shows DESIGN.md and `design.tokens.json` (DTCG 2025.10) written from what runs: the colours the app's own code declares (a library's palette only where it's drawn, a dev tool's not at all), the type scale and the radii and spacing its screens use, its components and their states, decisions, and what was tried and undone. Nothing is written to the folder until you say so; agents read DESIGN.md before they change the app.
- **Packages.** What the app needs (its package.json and the repository's), wanted against installed, missing first, conflicts with a fix each, and **Install what's missing** with the folder's own package manager (pnpm, yarn or npm, from its lockfile), trying the next way when one fails.

Fetching is light: the canvas shows each screen's picture (a WebP the browser encodes itself, 2×, or 1.5× for a page longer than 4,000 px) instead of an iframe per component; parts are drawn live only in the design system, when they scroll near. Screens and tokens work for any app that runs; drawing a part on its own needs Vite.

From any version: **Run it** starts its own dev server (an old version is checked out into a git worktree in Trace's data folder, borrowing the folder's installed packages, with its own Vite cache), so it plays in its node with its real animations and screenshots itself for the canvas; **Open** shows it full screen at desktop, tablet or phone width. Up to three run at once per project. Monorepos run their web package (`apps/*`, `packages/*`); plain sites with an `index.html` are served straight from the version. **Download** gives the version as a .zip. **Roll back to this** puts every file back as it was, saved as a new version, so nothing after it is lost. **Push** sends the versions to the repository's remote (or one you add); Trace never pushes on its own.


## A project is a canvas of blocks

The **Canvas** (from the switcher) has blocks for the Overview (where it stands, the problem, the case study, open tasks, the latest review, broken constraints), Iterations, Reviews, Brainstorming (sticky notes, your prompts to AI, explorations), Constraints (read from the brief and the project's PRD/README, checked against the latest design and code), Design references, Tasks, Decisions, Case study and Artifacts, plus blocks you add. Click a block to select it, again for a peek (jot a sticky there), double-click to open it. Drag, resize and link blocks like the to-do board.

**Linking two blocks** asks what one says about the other. Rules, no model: reviews and ideas no task covers ("make it a task"), constraints the design keeps or breaks, references the work looks like, decisions the latest design drops, case-study questions a block can answer, and the subjects both keep coming back to. The knot on the link shows the count, coloured by the worst finding; agents add their own with `add_insight`.

**Replay** rewinds the canvas: drag the slider (or press play) to see which blocks had anything on any day.

**A block, opened** is a stream of frames (pictures on their grey well, text as quiet cards) with small context cards beside each (the NCS changes sidebar, generalised: changes as before → after, a constraint's check, a reference's colours and the changes it's pinned to). Find in the block (Ctrl F) marks every match, Enter steps through them. Annotate drops comment pins on pictures. Sticky notes go at the top of a block, or beside any frame.

## The case study

Every question a case study needs (overview, problem, users, goals, constraints, research, process, decisions, solution, implementation, validation, reflection, team), answered from the work with its sources and screens: the brief and the project's own docs (README and PRD first), iterations, decisions, references, reviews, tasks, the prompts you gave your AIs and the reasoning they logged. Click any answer to edit it; yours always wins. **Ask your agent** copies a prompt: the agent reads the questions with `get_case_study` and fills the thin ones with `answer_case_study`. **Download .md** exports it all, pictures linked.

## The skill for coding agents

Settings → MCP & agents → **Install for Claude Code** writes `~/.claude/skills/trace/SKILL.md`. Then, in any project folder, ask Claude Code to "use trace" or "assemble the case study". It runs:

```bash
node "<this folder>/bin/trace.js" assemble
```

which finds or makes the project for that folder, watches it (screens, docs and component code are captured and drawn), reads Claude Code's and Codex's memory of it, adds the reasoning script to its CLAUDE.md, and assembles the case study, printing what's still open. The agent then answers the open questions over MCP. Other agents can run the same command; `node bin/trace.js case-study` prints the case study as markdown.

```bash
node "<this folder>/bin/trace.js" check --ask "what was asked"
```

walks the running app again (only the screens a change touched) and prints the checks with each finding's file, commit and ask; `--stress` also runs the stress walk. It exits 1 when a change moved screens the ask didn't name. The script Trace adds to CLAUDE.md tells agents to read `get_rejected` before they start and to call `check_change` before they say a change is done.

## Artifacts

What your AIs made (agents add them with `add_artifact`) and what you add yourself (paste, upload or link), laid out like Claude's: the artifact's story and code on the left, the artifact running on the right. React/JSX is compiled by Trace with its packages from esm.sh and Tailwind available, so a Claude artifact pasted in runs as it did there; HTML and SVG run as they are; pictures and markdown are shown. **Made in your chats** lists what Claude said it made in the project's chats (the films, docs and pictures it linked that are still in the folder), each with the ask it answered.

## Decks, decisions, proposals, files, workflow

All of them are worked out from the project's real work, by rules, and say where each thing comes from.

- **Decks** (⋯ → Make a deck): a story, not a list. **Case study** (what it set out to do, the problem in your words with your screenshot, how it went day by day, what didn't work, before and now, why things broke, the results in numbers, what came out of it, what it follows now, where it stands, what's next), **Design review** and **Client update** each have their own arc. Built from the versions and what was asked for each, what your chats say, the screens the walk pictured, your own screenshots from the chats beside the screen as it is now, decisions, what was undone, and the open checks. Each slide has the layout that suits it (a statement, big numbers, your words as a quote, before and now, screens, a timeline, a list); the accent is the app's own colour; every slide's sources are in its speaker notes; a slide with nothing true to say is left out. Numbers have to be results (a fix's "dropped from 144 to 19 fps" is the problem it removed, not a result), your words are quoted exactly (one with strong language is passed over, not softened), and "just push" or "continue" isn't what the work was for. Edit any slide; export PPTX, PDF or Google Slides.
- **Decisions**: suggested from your chats (the rules you set, what you kept, the choices Claude made with a reason), from comments and from the checks, each with where it came from; Confirm keeps it, Dismiss keeps the no so it isn't suggested again. A decision made in Checks knows what it governs (a value at a place), so a change that breaks it comes back as "Decided text-2xl, and it's text-xl again".
- **Proposals**: the branches in git not merged into the main line yet, with how far ahead and behind they are, the files they change, their last change and what was asked for them (Trace never merges), then explorations and proposals for review.
- **Files**: by what they are to you: design and docs, the UI's code, the app's own pictures (folded after a dozen), and what isn't relevant here hidden behind one line that says how many and why (a tool's export or build output, setup and config, generated files, fonts, icons, scratch files, code that draws nothing, the same file twice).
- **Workflow**: **Draft from activity** draws how the work really goes: you → your asks in your coding agents → each agent that made versions → versions in git → Trace's walk and checks → review, with the tools the project captures from feeding the brief; each node shows this week's count for this project.

## Connect an agent (Settings → MCP & agents)

Create a token (read-only by default; tick "allow writes" for comments, artifacts, moments, issues), then:

```bash
claude mcp add --transport http trace http://127.0.0.1:4317/mcp --header "Authorization: Bearer <token>"
```

Clients that only speak stdio: `TRACE_URL=http://127.0.0.1:4317 TRACE_TOKEN=<token> node bin/trace-mcp.js`.

Tools: `ask_trace` (ask Trace’s AI, when a key is set), `get_block` (one part of a project), `search_files` and `read_file` (the project’s folders on disk), `add_note` (file something in a block), `add_task`, `get_case_study` and `answer_case_study` (the case-study questions, and filling them), `add_insight` (connect two canvas blocks), `explain_changes` (log your reasoning for a set of changes, for the person to review), `recall` (what other AIs remember), `remember` (leave a note for the next agent), `list_projects`, `get_project_context`, `search`, `get_latest_state` (with the screen's image), `get_changes`, `get_moment` (before/after images), `get_references`, `get_decisions` (with what each governs), `get_comments`, `get_design_tokens`, `check_change` (walk the running app again and check the change by rule: outside the ask, broken decisions, undecided values, design against code, near misses; each with a fix written out), `get_rejected` (what was tried and undone, and why), `post_comment`, `add_artifact`, `add_moment`, `update_issue`. Resources `trace://project/{id}/brief|current|decisions|references`. Prompts "build-screen", "review-implementation", "summarize-week". Every call is in the audit log; captured text that reads like instructions is marked as data.

## Teams

Settings → Members switches to team mode and makes invite links (editor, reviewer, viewer). Start with `TRACE_HOST=0.0.0.0` so teammates on your network can open them. Project settings make expiring guest links (view + comment) for clients.

| Variable | Default | |
|---|---|---|
| `TRACE_PORT` | 4317 | |
| `TRACE_HOST` | 127.0.0.1 | `0.0.0.0` to share on your network |
| `TRACE_DATA` | `./data` | Database and stored files |
| `TRACE_KEY_DIR` | `~/.trace` | Key for the encrypted token vault, kept apart from the data |
| `TRACE_BROWSER` | Edge or Chrome | Headless browser used to snapshot live pages |

## How it works

```
tools ─▶ ingest ─▶ normalize ─▶ snapshot ─▶ diff ─▶ cluster ─▶ route ─▶ describe ─▶ index ─▶ inbox / timeline / MCP
         (event log,  (DOM-T     (preview,   (structural   (20-min     (mapping → learned   (rules from  (FTS5 + vectors
          idempotent)  assets)    pHash)      + pixels +    sessions,   rules → link graph   the diff)    + graph edges)
                                              SSIM + type)  boundaries) → similarity)
```

Each stage is a worker on a durable job queue (retries with backoff, then a dead-letter list in Settings → Engine). Inbox corrections write routing rules, so filing improves per workspace.

| Path | What |
|---|---|
| `server/engine.js` | The eight stages, the queue, sessions, inbox operations and learning |
| `server/diff.js` | Structural diff, pixel diff + SSIM + region boxes, change type, 0–100 magnitude |
| `server/connectors/` | Connector SDK registry; Figma, GitHub, folder, links, uploads, agents |
| `server/retrieval.js` | Hybrid search, graph expansion, context packs, design tokens, summaries |
| `server/mcp.js` | The MCP server, and the same tools for Trace’s AI |
| `server/ai.js` | Trace’s AI: the AI Gateway client, Ask’s tool loop, insights between blocks, the project sync |
| `server/folders.js` | A project’s folders on disk: search, read and write inside them only, never secrets |
| `server/words.js` | Changelog sentences, titles, decisions and summaries from the diff, by rules |
| `server/memory.js` | Reads each AI's memory (prompts, pictures given, replies, the AI's last screenshot), cleans it, indexes it and answers `recall` |
| `server/render.js` | Draws component code: reads exports and prop types, compiles with esbuild, screenshots before and after |
| `server/frames.js`, `screens.js`, `walk.js`, `cdp.js` | Frames: every component the code defines and what it uses; the walk of a running version into screens (a headless browser over the DevTools protocol, the in-page reader of clickables, states, React's tree, text styles and tokens) |
| `server/vite-frames.mjs`, `frame-runtime.js`, `props.js` | Drawing one part with its states and motion in the version's own Vite, sample props from its types, its loading/error/empty branches, and replaying a screen's clicks for Preview |
| `server/history.js` | The project's git: versions and what was asked for each, running and walking a version, roll back, push, a file's last commit and ask (`lastChanges`), what was undone (`rejected`), unmerged branches (`branches`) |
| `server/check.js` | The checks: drift, scope, design against code, flip-flops, states inventory, broken decisions, the queue (`queue`), the "no" list, DESIGN.md and DTCG tokens |
| `server/stress.js` | The stress walk: pages with no data, failing data, slow data and long text, checked by rule |
| `server/chats.js` | The chat insight engine: each session read whole, rules, causes, results, deliverables; decisions suggested from it |
| `server/deck.js` | Decks: the arcs, the slide layouts, PPTX |
| `server/relevance.js` | What each file is: design and docs, UI code, the app's pictures, or hidden and why |
| `ui/src/app/views/history.jsx`, `frames.jsx` | History (versions, @claude, run, roll back, push) and Frames (Screens, Design system, Packages) |
| `ui/src/app/views/tree.jsx` | The version tree canvas |
| `server/blocks.js` | The project canvas's blocks and what's in each |
| `server/insights.js` | What linking two blocks reveals (rules) |
| `server/casestudy.js` | The case study: docs reader, constraints and their checks, every answer with sources |
| `skills/trace/SKILL.md`, `bin/trace.js` | The skill for coding agents and the command it runs |
| `ui/src/app/views/canvas.jsx`, `block.jsx`, `casestudy.jsx`, `artifacts.jsx`, `bento.jsx` | Canvas, block view, case study, artifacts, the shared drag-and-link board |
| `server/refs.js` | References, pinning them to changes, and picking up pictures pasted into prompts |
| `ui/src/app/views/ask.jsx`, `todo.jsx` | Ask (chats kept in this browser, starting points from your work, the reading column; Fluid Functionalism's ThinkingSteps and InputMessage) and its dock button, a file opened from search; the to-do board |
| `ui/src/app/trace.css` (type scale `--fs-*`, card depth `--sh-card`) | Trace's own layout and surfaces (the rail, the dock, timeline frames, the canvas, the journey) on the shadcn + Fluid Functionalism theme in `ui/src/index.css`; it sits in a CSS layer below Tailwind's utilities, so the components always win |
| `ui/src/app/lib.jsx` | The API client, live events, router, and the wrappers every screen uses (Menu → Dropdown, Seg → Tabs, Dialog, SwitchField, Field, Tip, FluidList) |
| `ui/src/app/views/timeline.jsx` | A project, opened: iterations down the middle, the cards beside them, annotate (draw, erase, comment, mark) |
| `ui/src/app/views/journey.jsx` | The journey: prompts, replies, reasoning cards with your review, the script |
| `server/api.js` | REST API, roles, files, live events, export, hard delete |
| `ui/` | The app (React, Vite, Tailwind v4, shadcn/ui, Fluid Functionalism). `web/` is the old no-build version, kept as a fallback |

## PRD coverage

All fifteen features are built: F1 connectors and auto-capture, F2 drop and multi-format, F3 embed links, F4 review inbox, F5 timeline and project cards, F6 changes box, F7 change detail and visual diff, F8 comments, F9 MCP server, F10 comment-to-agent loop (agents read comments and post artifacts over MCP), F11 references and moodboard, F12 solo and team mode, F13 explorations, proposals and issues, F14 decks, F15 workflow visualizer.

Built differently from the PRD, on purpose (the upgrade path is noted in the code):

- **Runs on your machine.** SQLite (FTS5) instead of Postgres + pgvector; in-process workers instead of Temporal/BullMQ; Server-Sent Events instead of WebSockets. The server is its own desktop agent, so there's no separate Tauri tray app.
- **Polling, not webhooks.** Figma and GitHub webhooks need a public URL, so Trace polls every minute.
- **Tokens, not OAuth.** Figma, GitHub and MCP use tokens you paste; nothing is registered with a third party.
- **Local embeddings.** Text vectors are hashed bags of words and image vectors are colour/layout descriptors, so similarity works offline. Swap in a real embeddings API when recall matters.

Not built:

- email-in (P1), the browser extension (Later), plans and billing;
- PSD, .riv, .splinecode and font previews: these get a stored card with metadata;
- HEIC: this build of sharp can't decode it;
- PDF and `.ai` files get a text card (text extracted for search), not a rendered page.

Not yet checked against the live services: the Figma and GitHub connectors were written against the documented APIs but haven't run with real tokens here. The sample project uses a structured stand-in for Figma, so frame-level diffs, routing, MCP and AI memory are proven end to end. Cursor and Copilot reading is written against their stores but had no saved chats on this machine to test with.

`npm audit` flags `image-size` inside `pptxgenjs` (denial of service on JXL/HEIF/ICNS parsing). Trace only ever passes it PNGs it rendered itself.

## Roadmap and progress

The plan is in [docs/ROADMAP.md](docs/ROADMAP.md): Trace stops being only a recorder and becomes the judge with a memory. It measures every change, checks it against what was designed, asked for and decided, sends each problem to whoever should fix it, and learns from what's kept or reverted. It rests on three building blocks: a record of every measured value with its provenance, a matcher (reference ↔ what runs), and fixed rules.

This table is kept current as work lands, so a new session can pick up where the last one stopped. Status: **done**, **in progress**, **next**, **later**.

| # | Item | Phase | Status | Where / notes |
|---|---|---|---|---|
| 0 | Faster walk: explore first, capture screens in parallel batches, assemble and club at the end | A | **done** | `server/screens.js` `walkUrl`: 5 explorers + 3 painters (by CPU count), batches per first click, assembly at the end. Engine 15 min / 28 screens → 2 min 47 s / 37; portfolio 66 s / 11 → 61 s / 17 |
| 1 | Re-walk only what a commit touched | A | **done** | `touched()`, `filesOf()`, `baseFor()` in `server/screens.js`; `discover().imports` in `server/frames.js`. Portfolio: 1 file → 4 of 17 screens in 32 s; nothing changed → 1 s. Frames' Walk popover says what was redone and has "Walk all of it" |
| — | Record of measured values with provenance (component → file → commit → ask) | A | **done (v1)** | `__tw.values(names)` in `server/walk.js`: per screen, every colour, radius and spacing with its count and up to 3 places (the app's own component drawing it, box, text); stored as `values`, plus a fingerprint `sig`. `check()` joins each place's component to its file (`discover()`), and `lastChanges()` in `server/history.js` joins each file to its last commit, its agent and its ask (commit `Asked:`, Trace run, or the agent chat before it). Not yet one stored, queryable record per version: the joins happen when a check runs |
| — | `trace check` command | A | **done** | `node bin/trace.js check [folder] [--ask "…"]`: walks the running app again (only what changed), runs the checks (scope, drift, design, flip-flops, states), says each finding's file, last commit and ask, exits 1 when a change went outside the ask. API `GET /api/projects/:id/history/:sha/check?ask=` |
| 2 | Asked vs did: scope check on AI commits | B | **done (v1)** | `scope()` in `server/check.js`: ask words vs each screen's name, title, sections and components (CamelCase split); flags moved screens (`since.moved`: fingerprint changed, or new) the ask doesn't name; skips asks that name nothing. Ask = `--ask`, else the commit's `Asked:` line |
| 3 | Token drift that knows which side moved | B | **done (v1)** | `drift()` in `server/check.js`: near misses against the app's own scale (values used 5+ times) and its colour tokens, colours compared in OKLab across rgb/lab/oklch/oklab/color(), printed as hex; whole-pixel lengths 1px/4% off. `designOf()` + `against()`: the captured Figma frames (fills, strokes, radii, auto-layout spacing, text sizes), Figma variables and token JSON files against what runs, by value (near miss) and by token name (`color/primary` = `--color-primary`). The side that changed last moved (design: the captured change that set the value; code: the file's last commit), so the other acts; an agent's change its ask didn't mention goes to a person. Not tried on real Figma data yet (no project has a Figma file connected); reading Figma straight from a link with a personal token is still to do |
| 9 | Stress walk: forced empty, error, slow, long-text states, checked by rule | B | **done (v1)** | `server/stress.js` `stressApp()`: each page of the last walk (up to 8, its first screen; not dialogs or option rows) loaded fresh in 3 tabs under base / empty (every list in its JSON answers emptied) / error (JSON answers → 500) / slow (held 6 s, pictured while waiting) / long (`__tw.stretch()`: every text ~40% longer, accented), through CDP `Fetch` at the response stage (dev-server traffic left alone). Rules in `__tw.rules()` (walk.js): text cut off by its own box (ellipsis and line clamps are meant), sideways scroll, text over text (nothing solid painted between them), WCAG contrast, blank page; errors thrown. Only what the as-is load didn't already have is reported. The component trees of the forced states feed the states inventory (`forced`). `POST/GET /api/projects/:id/history/:sha/stress`, `trace check --stress`, saved as `<sha>.stress.json`. Not yet: states reached by clicks (dialogs, tabs), throttling and locale, a UI |
| 10 | States inventory: what the code has that nobody designed | B | **done (v1)** | `branchesIn()` in `server/props.js` reads loading/error/empty branches from each component's own conditions; `discover()` gives every component `states` (those, plus `propTypes()` flags and variants). `inventory()` in `server/check.js` marks each state seen (a walked screen drew it with that prop, or drew an Empty/Problem/Skeleton inside it) and designed (a captured Figma name has the component and the state). In `trace check` and the check API. Branches on data a component fetches itself stay unseen until the stress walk (9) forces them |
| 12 | Flip-flops: values that keep changing back = undecided questions | B | **done (v1)** | `flipLog()` + `flips()` in `server/check.js`: the last 300 commits' UI diffs (`-U0`, each hunk headed by its function or CSS rule through git's css driver with indented selectors allowed); a removed line paired with the added line most like it; a place = one kind of value (`text` size ≠ `text` colour) on one line, followed as the line's other values change; A → B → A from the value it had last is a flip; two flips, or two hands, = undecided. Reverts and rollbacks don't count. Next: ask once and store the answer as a decision (11) |
| 19 | One queue of what needs you | C | **done (v1)** | `queue()` in `server/check.js` (`GET /api/projects/:id/history/:sha/queue`): the check's findings as one list, riskiest first (outside the ask, undecided flip-flops, design ↔ code, breaks, near-miss values), each with a stable key, where it comes from and a request for an agent written out; states nobody has seen as a summary after. In Frames, **Checks** is the fourth stage of the strip ("4 need you") and opens a side sheet beside the work: **Ask Claude** opens the request at the sheet's foot to read, edit and send (a @claude comment on the version); **It's meant** and **Keep …** (a flip-flop) are decisions (`source_type: 'check'`) that take the item off for good, with Undo; **Show it** goes to the screen; the stress walk runs from the sheet. Per project and version for now, not across projects |
| 8 | Point at a pixel: see why, then fix it | C | **done (v1)** | In Frames → a screen → **Frame by frame** (`Assemble` in `ui/src/app/views/frames.jsx`): clicking the picture picks the smallest part under the pointer. Beside it, **Why it looks like this**: its file's last commit, who (the agent too) and the ask behind it (`GET /api/projects/:id/history/:sha/why?file=` → `lastChanges()`), and the values it draws with (`values` from the walk: fills as swatches, spacing, radius). **Change it** writes a request to Claude naming the screen, the component, its file and its text, sent as an `@claude` comment on the version like the Checks queue |
| 16 | Feedback that closes only on evidence | C | **done (v1)** | `server/evidence.js`: a comment on a version with `region: {kind: 'part', screen, comp}` keeps the part as the walk drew it (`snapOf`: its box, text, props, the values it draws with); after every walk (`closeOnEvidence`, called when `walkApp` saves) each open one is looked at again on the same screen (`keyOf`: the clicks that reach it) and, if the part changed, closes with `region.evidence` {changed in words, before and after picture and box} and a reply from Trace in its thread. A screen not reached or a part not found leaves it open. Frame by frame: "Feedback on this part" (open, or closed with before/after), a note field, and "Change it" pins its request to the part too. `GET /api/projects/:id/history/:sha/feedback?key=&comp=` |
| 21 | Design canvas in Claude Code: pick anything on the running app, change it like Figma, Claude writes it | C | **done (v3: live, inspector, undo/redo, words, code in sync)** | `server/design.js` (proxy that adds `server/design-page.js` to the working copy's pages and passes hot reload through; edits store `data/design/<pid>.json`; `locate()` → file and line from the element's classes, text and component chain, React's owner first; `codeFor()` → Tailwind class to add and the ones it replaces, a project token by name, else CSS; `sessionNow()` → the newest Claude Code session in the project's folder: asks, reasoning, replies, files edited; `askDesign()` → Trace AI (Nemotron) with all of that as context). UI `#/p/:id/design` (`ui/src/app/views/design.jsx`): Pick / Use the app, Desktop/Tablet/Phone, Design (layout, padding, type, fill, corners and border, opacity), Changes (send to Claude Code, or have Claude apply now), Context (the session now, Ask Trace). Skill `skills/trace-design/SKILL.md` (installed with the trace skill), MCP `open_design` / `get_design_changes` / `design_changes_done`, CLI `trace canvas` / `trace changes [--done]` |
| 14 | `check_change` MCP tool for agents | C | **done (v1)** | `check_change` in `server/mcp.js` (read-only, also in Trace AI's tool set): walks the running app again when it runs in Trace (only what the change touched), then returns the queue (`queue()`) as a verdict ("outside the ask…" / "needs a look" / "clear"), the findings with file, commit, ask and a fix written out, how many a person has decided, and states nobody has seen. Findings a person marked as meant aren't returned. The agent script (added to CLAUDE.md/AGENTS.md from Trace) says to call it before saying a change is done |
| 13 | The "no" list for agents | C | **done (v1)** | `rejected()` in `server/history.js`: versions that undo others (git revert, Trace rollback, or a message that says so) with what they undid (named, else the earlier version sharing most of the undo clause's words and a file) and the asks behind both; `noList()` in `server/check.js` adds values tried and dropped (a flip-flop by one hand). MCP `get_rejected`, `GET /api/projects/:id/rejected`; the agent script says to read it before starting. Refused proposals and DESIGN.md come with item 4 |
| 4 | DESIGN.md and tokens.json from what was measured | C | **done (v1)** | `designDoc()` in `server/check.js`, proposed by `POST /api/projects/:id/history/:sha/design-doc` (the AI's file proposals, written only by `POST /api/ai/files/:id`). DESIGN.md: the colour tokens the app's own code declares (one `git grep`; a library's palette only where drawn, a dev tool's not at all), the colours most drawn (merged by hex), the measured type scale, the radii and spacing used 5+ times, shadows and motion tokens, components by kind with their states (not a tool's previews or stories), decisions, and what was tried and undone (each ask as its gist). `design.tokens.json`: DTCG 2025.10 (colour objects, dimensions, typography composites; dark values in `$extensions`). Frames → Design system → **Write DESIGN.md** shows both files, then Write or Cancel. Not yet: written again by itself after each commit |
| 5 | Rules learned from reverts and approvals | C | **done (v1)** | `ruleOf()`, `AVOID`, `changeOf()`, `ruleBreaks()` in `server/check.js`; `learnRules()` in `server/chats.js`. A rule is a decision that governs `{kind: 'avoid', id}` (a look: glass/blur, gloss/glow, gradients, emoji, all caps, italics, sparkle icons, each a code pattern) or `{kind: 'protect', words}` (something not to touch, found in changed files' paths and components). Learned from the instruction and memory files and the markdown they point to (one sentence is enough), and from corrections in chats and undone versions (twice or more). Suggested in Decisions with "Trace checks every change for …"; confirmed ones are checked on the change (unsaved edits, else the last version), in the Checks queue second after scope, in `check_change` and `trace check` (exit 1). "Unless asked": an ask that names the look allows it |
| 11 | Decisions that know what they govern | C | **done (v1)** | `decision.governs` (a new column): what a decision settles, `{kind: 'value', file, in, value}`; set by **Keep …** on a flip-flop, accepted by `POST /api/projects/:id/decisions`, returned by MCP `get_decisions`. `broken()` in `server/check.js`: a governed place whose value in the code is now another; the queue lists it second, after changes outside the ask ("Decided “text-2xl”, and it's text-xl again", who changed it back, a fix written out). Only values at a place for now; a decision in plain words governs nothing yet |
| 6 | Figma frame ↔ running screen matching | D | **done (v1)** | `server/match.js`. A walk now keeps `els` (`__tw.els()` in `server/walk.js`): every block of words as drawn (font, size, weight, line height, letter spacing, colour, the app's component), the box around it (fill, radius, padding, a line on any side) and the colour it sits on. `fromFigma()` reads a captured frame the same way (each text's smallest shape around it, the nearest fill behind it). `pairs()`: the frame's words on the screen, then its name against the screen's name and address, then device shape, then whether its blocks sit as on the frame (tabs and dialogs of one page share words). `compare()`: the same words placed where the nearest blocks found once on both sides went (a section that moved keeps its rows apart), else most words in common nearby; a frame wider than the walk scales; a live clock is no change; a box that lost its line isn't compared by corners and padding with the element around it. `matchProject()` in `server/check.js`, `GET /api/projects/:id/history/:sha/match?with=figma\|<sha>` (Figma, or another walked version). The Checks queue lists each Figma pair that differs (`kind: 'figma'`), blames the files of the parts that differ and says which side changed last. Not yet tried with a real Figma file (none connected here); walks from before 29 Oct need redoing for `els` |
| 15 | Prototype as the acceptance test | D | **done (v1)** | The matcher between two walks: a version of this project (`?with=<sha>`, an old branch) or another project's walk (`?with=p_…[:sha]`: a Make export, an HTML prototype, a Lovable app, once it's a project walked in Trace). `pairs(…, {one: true})`: one to one, best first; a prototype's screen is covered only by one that has most of what makes it that screen (its words that the screen most like it lacks: a tab's panel, a dialog's), or is at the same address; a screen with none of its own (a section folded) needs nearly all its words. `matchProject()` returns `covered` of `refs`, `lacking` (the prototype's screens not here) and `extra`. `trace check --proto <commit, branch or folder>` prints "this has 1 of its 4 screens", each pair's differences, and exits 1 when one is lacking; `check_change` takes `prototype` (the agent script says so). Not yet: a view for it in Trace |
| 7 | Reuse guard (duplicates, rendered usage, `find_component`, Code Connect) | D | later | |
| 17 | Approved vs requested, for clients | D | later | |
| 18 | Proof of process (claims linked to evidence) | D | later | |
| — | Pull-request comments, review links, installer | E | later | |
| 20 | Design changes marked on metrics | E | later | |

### Progress log

- **2026-10-28:** roadmap written (`docs/ROADMAP.md`, two rounds of research). Started item 0.
- **2026-10-28:** items 0 and 1 done.
  - The walk explores without pictures in 5 pages, pictures in 3 more (one click from where a page stands when it can), and numbers and clubs everything at the end, so ids and "2 of 6" stages don't depend on which page was first.
  - A state found on a page that made clicks its steps don't record is pictured on the spot (its steps may not replay).
  - A step that can't be found draws the page whole once and looks again (lists that draw rows as they're scrolled to).
  - `calm()` waits for React to take over a server-drawn page (Next.js): clicks before that did nothing, which lost the theme toggle under load.
  - `tree()` finds React's root on `document` too (Next.js), so Next apps get component trees.
  - Walk data now keeps each screen's fingerprint (`fp`), `files` (git ids, or size:time for the working copy), `routes`, `timing` and `since` ({changed, redid, of, from}).
  - A walk starts from this version's last walk, or its parent commit's. A changed file reaches the components it draws (through helpers and hooks that draw nothing). Only screens whose tree has those are gone to again, with new clicks explored from them. CSS, config, packages, the entry, a file outside the code, a new device or another mode mean a full walk. `{full: true}` forces one.
  - Self-check covers `touched` and `changedIn`.
- **2026-10-28:** `trace check`, scope and drift (v1).
  - Each pictured screen keeps `values` (from `__tw.values(names)`) and `sig` (components + props, text styles, values; not words, so a clock doesn't count). A partial walk's `since.moved` lists screens whose `sig` changed, plus new ones.
  - `server/check.js`: `oklab()`, `hex()`, `drift()`, `scope()`, `check()`. Self-check covers colour conversions, near-miss and far values, fractional (fluid) lengths left alone, scope inside/outside/skipped.
  - Tried on the portfolio: one touched file → 4 screens walked again, nothing moved, scope passes; drift found a 5px padding where the app uses 4px 186 times, and a 15%-alpha grey 2.35 off one used 5 times. 32 s in all.
  - A cold Next.js dev server makes the first full walk ~100 s (routes compile on first visit); warm, ~60 s.
- **2026-10-28:** provenance and the design side of drift (resumed in the primary chat).
  - `lastChanges(p, files, sha)` in `server/history.js`: per file, the last commit that changed it (or "unsaved edits"), who, which agent, and what was asked. `history()` and it share `asksOf()` and `agentOf()`.
  - Asks that only say "push this" or "commit it" are skipped when matching an agent chat to a commit; the ask before them counts. On the portfolio, commit 246e505 had been credited to "push this to git"; now it shows its title.
  - A partial walk's `since.files` keeps which files changed (up to 200), so scope can say why a screen outside the ask moved: the changed files that reach it.
  - `check()` returns `changes` (file → last commit and ask), `at[].file` on every drift place, `outside[].because`, and `design` (pairs with `moved` and `acts`). `oklab()` reads hex; lengths compare rem as 16px. `diff.js` now records changes to Figma variables like token-file changes, so the design side has a time.
  - `trace check` prints each finding's file and commit, why an outside screen moved, and a Design section ("the design changed last → the code follows"; "an agent changed it without being asked: a person decides").
  - Tried on the portfolio: the 15%-grey drift traces to `CollapsibleTrigger` → `src/components/ui/collapsible.tsx` → 246e505 by Claude Sonnet 5. A drift drawn by a library component (`MotionDOMComponent`) has no file yet. Self-check covers hex, `against()`, `designOf()` from a captured Figma frame and `lastChanges()`.
- **2026-10-28:** item 10, states inventory.
  - On the Animation engine (28 screens): 190 states in 115 components that no walk saw and no design shows. Top: `Waiting` and `ProductCard` in `src/Home.tsx` each branch on loading, error and empty (checked by hand: `s.loading ?`, `s.error ?`, `list.length ?`); every walked screen showed their lists. On the portfolio: 16 components, mostly empty branches (`ParticleImage`, `Scrubber`, `Tabs`).
  - A code branch and a prop of the same name count once (the prop). The first variant counts as seen when the component is drawn without that prop (it's the default).
  - Matching a state to a design name uses whole words, so a short state like `md` can't match on the component's name alone.
  - The check (with discover) takes ~0.35 s on the engine.
- **2026-10-28:** item 12, flip-flops.
  - Found on real history, each checked by hand against git: the portfolio's name in `Hero()` went `text-xl → text-2xl` ("Normalize typography… 24px for section titles and name", Syed) and back to `text-xl` inside "Rework case-study nav…" (Claude Sonnet 5): two hands, so undecided. the client storefront's `.ground__copy` weight 400 → 600 → 400 → 500 (three Claude Opus 5 commits); the engine's `.tip` radius 8px → 6px → 8px (Claude Opus 5.5).
  - What made it precise: a size and a colour of one prefix are two kinds (otherwise `text-2xl → text-xl` with `text-[#979797] → text-foreground` on one line was unreadable); CSS needs its rule as context (`border-radius:` alone collided across a whole stylesheet); git's built-in css context skips indented selectors, so rules inside `@layer` all read as `@layer components {` until `diff.css.xfuncname` allowed indentation; a flip must start from the value it had last (two lines sharing a place otherwise read as one going back).
  - Pairing lines: half the words of the longer line or more the same (overlap over union failed two-word CSS lines).
  - With the history read, the check takes ~1.1 s on the portfolio. Self-check covers the Hero case, a revert, and a CSS custom property at column 0 (its removed line starts `---`, like a diff header).
- **2026-10-28:** item 9, the stress walk. Phase B is done (v1).
  - Animation engine (Vite, one page at `/`, 9 JSON requests): 12 s. All four conditions took effect (checked in the pictures): no data → "32 template ideas from the Lab"; failing → "Something went wrong · Try again" and "Server offline"; slow → "Checking the AI…" and a skeleton; long text stretched. Nothing broke by rule. It forced 7 states no walk had seen: `Waiting`, `Shared` and `ProductCard` loading and error, `ProductCard` empty.
  - Portfolio (Next.js, 5 pages, 2 JSON requests each): 29 s warm. Nothing broke under the conditions; as it is, the nav's grey is 4.35:1 ("Home" 3.17:1), under WCAG's 4.5:1.
  - False findings found and fixed on the way: white text on a photo read 1:1 (the background is now what's painted under the text, `elementsFromPoint`, with pointer events switched on for the moment so a click-through gradient counts); stacked cards read as text over text (now only when nothing solid is painted between); a dev toolbar's panel faded to opacity 0 (an ancestor's opacity counts); long text re-reported contrast (words' length can't change a colour); a `const i` shadowing the loop's `i` made `rules()` throw silently.
- **2026-10-29:** item 19, the queue (Phase C begins).
  - Placed where the work is: the Frames strip (Packages · App · Walk · **Checks**), one count, the list in a side sheet over the canvas (the History/Frames panel pattern), not a new page and not Home.
  - Portfolio: 4 need you. First the undecided name size (`text-xl` / `text-2xl`, both commits shown, Keep either), then faint text on 5 pages (2.72:1 at worst), then two near-miss values with file and commit. Engine: 2 near-miss text sizes turned out to be fluid sizes landing near a whole pixel (20.9988px): `near()` now treats only exact whole pixels as typed-in values.
  - Checked with real pointer clicks at 1440 (light, dark) and 390: the request opens prefilled and Cancel closes it (nothing was sent); It's meant takes it off (4 → 3, "1 other decided before") and Undo brings it back; no sideways scroll on the phone, where the sheet docks at the bottom and the strip shows only Checks.
  - Not yet: one queue across projects (Home stays as it is unless Syed asks), "Update Figma" as a way out, and a decision that says what it governs (11) beyond the check's key.
- **2026-10-29:** items 14 and 13, for agents.
  - `check_change` over MCP, tested in the self-check through the same tool layer agents and Trace AI use: a saved walk's near miss comes back with its fix ("Use #3b82f6 instead of #3b83f6…"), after the design finding a captured Figma frame raised (riskier, so first); once a person marks it meant, it's gone and `decided_by_people` counts it.
  - The "no" list on real history, matched by hand: portfolio "Revert maze pet buddy path animation" (asked "revert the path animation change") undid dd33537 "Add maze pet buddy hero animation"; the client storefront "Revert the catalogue props back over the cards" (asked "revert the ball assets change") undid c01376f "…tuck the props behind the cards"; "Revert the episode relay's burst…" undid 4995698 "…give the relay a burst". Values: the client storefront `.ground__copy` weight 600 tried, back to 400; engine `.tip` radius 6px tried, back to 8px. "…, revert MobileNav to icons" has no earlier version naming MobileNav, so what it undid is left unknown rather than guessed.
  - Self-check: a Trace rollback lists the version it undid and that version's ask.
- **2026-10-29:** item 4, DESIGN.md and DTCG tokens.
  - Portfolio: 56 of the app's own colours (with dark values), 12 type roles, the radius and spacing scales, 80 components, its decisions and two undone versions. What was taken out on the way, each seen in the real output: Tailwind's 22-colour palette where nothing draws it, the Agentation dev toolbar's `--agentation-color-*` (drawn on screen, but not declared in the app's code), `.design-sync/previews/*.tsx` components, a duplicate #ffffff (Chrome writes it as rgb and as lab), and page-feedback pastes as asks ("## Page Feedback… **Feedback:** inside this section use the animation…" now reads as its feedback line).
  - Checked with real clicks: Design system → Write DESIGN.md → both files shown, switch to the tokens, Cancel; nothing was written to the portfolio's folder (his repo wasn't asked to change).
- **2026-10-29:** item 11, decisions that know what they govern.
  - On the portfolio, with real clicks: Keep text-2xl on the hero name → the flip leaves the list at once → the check runs again (1.5–5 s) and "Decisions the code broke: Decided “text-2xl”, and it's text-xl again… changed back in 246e505 by Claude Sonnet 5" appears with the request to Claude written out → Cancel, Undo → back as it was. No test decision left behind (one run's Undo came after its toast closed, so the decision was removed by hand and the toast now stays 8 s).
  - A decided item now leaves the list as soon as it's clicked; the check catching up used to leave it there for seconds.
  - Self-check covers `broken()` with the flip-flop log from item 12's check: "keep text-2xl" is broken by the change back, "keep text-xl" and a decision in plain words aren't.
- **2026-10-29:** the engines behind Decks, Decisions, Proposals, Workflow, Files, AI memory and Artifacts, on one new engine that reads the chats (Syed: "make an insight engine which will use logics and from all the chats of the claude reasoning, response and the user also").
  - **The chat insight engine**, `server/chats.js` (`GET /api/projects/:id/insights/chats`): every Claude Code session of a project read whole (the person's asks, Claude's replies, its reasoning, the files it edited per ask), by rules: rules the person set, corrections (with what Claude had just said it made), approvals (his way: "bro its good now"), causes (from replies and reasoning, guesses and machine setup left out), results in numbers, Claude's reasoned choices, and the deliverables Claude linked (films, docs, pictures that still exist). Scored, near-duplicates folded, themes, the asks day by day. Cached per session by size and time: the engine's 510 MB chat takes 4.6 s once, then 50 ms. Other tools' chats come from the memory index. Self-check covers each rule, including the traps found in the real chats: "bro" isn't shouting, a pasted error isn't a rule, a page-feedback paste is its feedback line, "probably…" isn't a cause.
  - **Decks** (`server/deck.js`, rewritten): three arcs (Case study, Design review, Client update) from the versions and their asks, the chat insights, the walked screens (cropped to the window), the person's own screenshots from the chats beside the screen as it is now (matched by the files the ask changed), decisions, the "no" list and the open checks. Slide layouts per kind (title with the app as cover, statement, numbers, quote, before/now, screens, timeline, list), the accent is the app's own colour (portfolio: #DB744F, the hero's orange), every slide's sources in its notes, a slide with nothing true to say left out. Accuracy rules found on the real decks: a number describing a problem a fix removed ("dropped from 144 to 19 fps, and this layer fixed it") isn't a result; "5 → 8, s" (the "s" of "so") and "0 → 1" aren't results; quotes stay exact, so one with strong language is passed over; asks like "just push for now" or "continue" aren't what the work was for; one screen per row of options. The deck view draws each layout like the PPTX. Self-check covers the number rules.
  - **Files** (`server/relevance.js`): each file is design and docs, UI code, the app's own pictures, or hidden with its reason (a tool's export or build output, setup and config, generated, a font, an icon, scratch, code that draws nothing, the same file twice). the client storefront: 87 that matter, 122 hidden (72 Figma exports); portfolio: favicon and share pictures are the app's, not design. One line shows the hidden ones with counts per reason.
  - **Decisions**: suggested from the chats once each (rules, what was kept when he said it was good, Claude's reasoned choices), with "Where it came from"; Dismiss keeps a no instead of deleting, so it isn't suggested again.
  - **Proposals**: branches not merged into the main line, with how far ahead and behind, the files, the last change and what was asked (`branches()` in history.js); the portfolio's `borderless-redesign`. Read only.
  - **Workflow**: drafted from what happens in a code project (people → asks in Claude Code → each agent that made versions → versions in git → walk and checks → review); activity per project this week (it counted every project's events before).
  - **AI memory**: "What your chats say" above the chats (rules, what you said no to, what you kept, why things broke, results). **Artifacts**: "Made in your chats".
  - Test decks and test decision suggestions made while checking were deleted.
- **2026-10-29:** item 5, rules from what was said no to (secondary account, continuing the primary chat's work).
  - Where the rules really are: the chats hold few standing ones (portfolio: 6 rule sentences, all one-task limits such as "Do not touch horizontal padding… this pass is vertical rhythm only"); TASTE.md, which the global CLAUDE.md points to, and the memory notes hold them. Reading the markdown an instruction file names is general, not a special case.
  - Learned on the portfolio: "No glass and blur unless asked" (from "No glass, blur scrims or gloss unless asked.", 4 sentences) and "No gloss and glow" ("…a soft shadow, no glow"). Dropped on the way, each seen in real output: gradients (both quotes preferred one: "a gradient, not a cut"; a no now counts only before the look, in its clause), sparkle (no no before it), "every asset individually" / "the project" / "horizontal padding" as things not to touch (a property or filler, or not naming anything in the project's code).
  - Checked against the last 52 versions of the portfolio and the engine: 5 flags, each a real `backdrop-blur`, glass panel or zero-offset glow added to UI code (e.g. 5b55364 "Fullscreen animation pages…": `bg-card/80 backdrop-blur` on a button). A glow is a shadow with no offset (`0 0 18px`); variable names, effect names and comments with "glow" don't count (they did at first: 15 lines in one version).
  - Self-check covers `ruleOf` (a no before the look, a look asked for, a protect with "(you, 28 Oct)" after it, "don't change anything"), `ruleBreaks` (avoid, protect, allowed when the ask names it, glow vs plain shadow vs a variable).
  - Not done: a rule broken end to end in the app (needs a confirmed rule and a change adding blur; tested on real history in a script instead). The four suggestions first made with weaker quotes were removed and made again.
- **2026-10-29:** item 8, point at a pixel.
  - Checked with real clicks at 1440 on the portfolio: Frame by frame → clicking the nav picks `Nav` → "519c698 by Claude Sonnet 5, Jul 28: 'Fix section nav: full reloads, wrong landing spot, dead scrubber clicks'" and its spacing and fill → Change it → the request opens in place of the parts list ("@claude On the screen 'Syed Ali', change Nav (src/components/Nav.tsx, the part that reads 'Syed.Ali Projects About me My Space Con…'): ") → Cancel; nothing was sent.
  - Clicking blank space picks the smallest box there (on the portfolio, a decorative `GuideLine` that spans the hero); that's right by the rule, and the parts list is beside it to pick another.
  - The first lookup on a project takes a few seconds (it reads the chats to find the ask); after that it's quick.
  - Next: 16 (feedback that closes only on evidence), then Phase D.
- **2026-10-29:** item 21, the design canvas in Claude Code (Syed: "we directly call this as a skill and it lives inside the claude code and whenever we design claude opens that canvas and we can select, edit and change its properties just like figma… our app have full context… and the nematron api… does the supported processing and answering").
  - Tested on the portfolio (Next.js) with real pointer input in a headless browser: pick the hero name → **Hero**, `src/components/sections/Hero.tsx:95`, the line `<p className="text-xl font-medium text-foreground">Syed Ali</p>` → Size 28 → drawn at once, kept as `font-size 20px → 28px`, Tailwind `text-xl → text-[28px]` → `trace changes` prints exactly that for Claude → `--done`. The test edits were removed; the portfolio's code wasn't touched.
  - What made it exact: the element's owner (React dev builds keep who wrote each element; a Next.js server component is an owner by name only), then every component between it and the page (FadeIn draws the `<p>`, Hero writes it); a class string written in 5 files is told apart by those components' files.
  - Ask on the canvas (Nemotron, ~10 s): "calmer and more premium" → weight 500 → 400, line height 28 → 36px, a softer grey, at `Hero.tsx:95`.
  - The session panel reads the newest Claude Code session that has an ask in it (a just-opened one may not); portfolio and engine read right, the client site has none in its own folder.
  - Fixed on the way: "Run it" flashing before the first answer (now "Opening the canvas…"); colours computed as `lab()` read as "#2.c0f…" in the colour field (now drawn to one pixel and read back); plain class names like `nav-link` taken for Tailwind (now Tailwind's own prefixes).
  - Both skills were installed into `~/.claude/skills` (trace, trace-design) on Syed's ask; Claude Code lists trace-design.
  - Not yet: the canvas inside the History/Frames views, dragging to reorder or resize on the canvas, editing text in place, and item 16.
- **2026-10-29:** the canvas edits live, and a real inspector (Syed: "give a better UI to the properties and changing panel… the changing is not happening in real time").
  - Why it wasn't live: a number applied only on Enter or leaving the field, and every change made the page report its new style, which rebuilt the field (the field was keyed by its value), so typing lost focus after one key. Now fields keep what you type while you're in them and apply on every key, every ↑/↓ (Shift for ten) and every step of dragging the label sideways (Figma's scrub, 2px a step). Checked with real input in a headless browser: "3" then "32" kept focus and redrew the page each key (line height followed), Corners scrubbed 0 → 10, ↑ and ⇧↑ on line height 44.8 → 55.8, Reset put the size back and took it off the list.
  - An edit now records where the property started (`firsts`), not the value mid-drag, so a long scrub reads "20px → 32px".
  - The inspector (`Props` in `ui/src/app/views/design.jsx`): Auto layout (direction, gap, align and justify as icon wells, for flex and grid), Size (W, H), Padding (horizontal and vertical, "Each side" opens four), Type (font, size and weight, line height and letter spacing, align, colour), Fill, Stroke (width and colour; adds a solid style when there was none), Corners, Opacity. Sections fold and remember it; Stroke and Opacity start folded unless used. A changed property: its label dark with a reset arrow, a bar on its field, a dot on its section. Taste rules followed: TASTE.md §1.5j-6 (grey label column, filled fields with units, no borders) and the folding rule.
  - Code hints follow the page's root size (`rem` from the page): the portfolio's root is 14px, so its `text-base` is 14px and 16px is `text-[16px]`; a hint that would swap a class for itself names the value instead. Syed's two edits from trying the canvas (font size 14 → 16 on Hero.tsx:14 and :154) had "text-base → text-base"; corrected to `text-[16px]`.
  - The hot-reload socket passes through the proxy (checked: Next's Turbopack connects through it), so Claude's code changes show on the canvas live.
- **2026-10-29:** item 16, feedback that closes on evidence. Phase C is done (v1).
  - Tested on the portfolio's real walk, put back afterwards: a note pinned to Nav on the first screen kept a snapshot; a walk with Nav unchanged left it open; a copy of the walk with Nav drawing one more spacing value closed it, with the evidence "space now also 99px", Nav's box before and after, and the reply "Trace: Closed on evidence: the walk 29 Oct, 16:18 shows Nav on 'Syed Ali' changed: space now also 99px." The walk file was restored byte for byte and the test comments and their search entries deleted.
  - Only a walk after the comment counts. Changes say only what was added or removed ("space 8px → 12px", "now also", "no longer"), not the whole set.
  - A Next.js server component (Hero) isn't in the walk's component tree (React's client tree only names it as an owner), so it can't be pinned from Frame by frame; the client parts inside it can.
  - Self-check covers `keyOf`, `snapOf` (only that component's values), `diffOf` (a value for another, text, nothing changed).
  - Next: Phase D, starting with 6 (Figma frame ↔ running screen matching).
- **2026-10-29:** canvas undo/redo, text editing, code in sync (Syed: "add a undo, redo option and… edit the text… and… edit the code as well in the sync").
  - **Undo and redo**: the top bar's ↶ ↷, Ctrl/⌘ Z and Ctrl/⌘ Shift Z (or Y), also while the canvas has the keys (the page passes them up). Each change is a step; a drag or a run of typing on one property is one. Undo of a change Trace wrote into the code takes it back out of the file.
  - **Words**: double-click any text that is words alone on the canvas and type (Enter keeps, Shift+Enter a new line, Escape puts it back), or use the Text section's field, or "Edit it on the page". It changes the existing text node, so React keeps it. Kept as an edit of `text` ("“Syed Ali” → “Syed W. Ali”"); the brief tells Claude to change the words.
  - **Write to code** (top bar switch, remembered): each change goes into its file as it settles when Trace can write it exactly (`rewrite()` in `server/design.js`: classes swapped on its line, a shorthand's other side kept (py-3 → pt-4 pb-3), a variant kept (md:…), words replaced when once on the line); then the page lets go of its own drawing so the reload shows the code's result. The rest stay drafts for Claude. Written ones show under "Written to the code by Trace"; × takes one back out. Changing it back takes it out too, only if the line is still as Trace wrote it.
  - **Code tab**: the picked element's file, opened at its line (marked in the gutter), editable; Save (Ctrl S) writes it and the canvas follows as the app reloads. A save is refused if the file changed since it was opened (Claude, the canvas writing, another editor): Reload, then change it again. Never a file outside the project or a secret (`codeFile()`).
  - Checked with real input on the portfolio, with Hero.tsx backed up and compared after: size 28 → undo 20 → redo 28 ("20px → 28px"); double-click the name, type "Syed W. Ali", Enter → kept → Ctrl+Z → "Syed Ali"; Write to code on, size 26 → `Hero.tsx:95` became `text-[26px]`, the Code tab opened at 95 with it → Undo → `text-xl` again. Hero.tsx ended byte for byte as before and git shows it clean.
  - Fixed on the way: after an undo the canvas forgot where a property started, so the next edit was kept "from undefined" and undoing a written change left `text-[20px]` instead of `text-xl`. Starting values now last the session, and the server refuses an edit with no start.
  - Self-check covers `rewrite` (shorthand, variant, words once, a line that isn't it).
- **2026-10-29:** item 6, the matcher (reference ↔ what runs), the second building block of the roadmap.
  - Tried on real data: the portfolio's `borderless-redesign` branch head (36011ac) against its base (d2fc93a), both run from git by Trace and walked. The first try paired every tab of the old version with the new home screen (the same address; the first screen there won), reported the header clock ("5:54 PM IST" → "5:52 PM IST"), swapped two rows of a settings panel that had moved 600 px down, and missed every removed line. Now each state finds its own, and what's reported is the commit: the header's colour #09090b → #030303 and the page's behind the hero, and the lines taken off the header, the six project cards and the footer card (11 differences, nothing else). The commit's message: "Remove all stroke lines, keep spacing; adopt portfolio-claude's background".
  - The Checks queue's Figma side on a temporary frame drawn from the old version's home screen (1440 wide, top 900 px), deleted after: one item, “Home hero” in Figma and “Syed Ali”: the fill and lines above, at 0–900 px of the page, scaled 0.889, blamed on `src/components/Nav.tsx`, commit 5beba60, with the ask behind it and a fix written out.
  - Fixed in the walk on the way: a box's line was looked for on its top side only (a header's is at its bottom), in `values()` too, so drift and the design checks missed those colours.
  - Old versions of a Next.js 16 app run with `--webpack` in their worktree (`startLive` in `server/history.js`): Turbopack refuses the linked `node_modules` outside its root. Their walks found 3 to 6 of the 6 dialog states from run to run (a cold webpack dev server is slow); a state the walk didn't reach pairs with the nearest one and says which words are gone.
  - Real Figma frames need Figma connected in Trace (Settings → Sources) with Syed's own account; the Figma tools in this Claude Code session are signed in to someone else's and weren't used.
  - Self-check covers pairing (a frame over two pages, tabs of one page, a scrolled dialog state), scale, weight and corners, reworded and missing words, the clock, a moved panel, a line taken off and the colour behind.
  - Next: 15 (prototype as the acceptance test), which uses the matcher.
- **2026-10-29:** item 15, the prototype as the acceptance test.
  - Tried on the portfolio: master (production, its working copy's walk, 18 screens) against the `borderless-redesign` branch as the prototype: "this has 1 of its 4 screens". The branch's About me / Experience / Side quests dialog states aren't in master (its code has no "Side quests" at all), and the home screen differs by its font (Inter → Segoe UI, master's `layout.tsx`), sizes, line heights and 34 words ("Design Engineer" is "Product Designer" there). Against d2fc93a: 1 of 5. Exit 1 both times. The same through `check_change` with `prototype`.
  - The first try said "4 of 4": every page of the portfolio has the header and hero, so any page cleared the bar for a tab state. Coverage now hinges on what makes a state that state (see the table).
  - Between two versions the same rule finds what a walk missed: the branch head's walk has no "Inside my brain" state, so it isn't covered (it had been paired with the home screen).
  - Found on the way, a walk issue (left as its own task): on a slow old-version dev server a tab click that didn't take was kept as that tab's state ("Side quests dialog" drawing About me's panel). Walks of that version found 3 to 6 of its 6 states.
  - Self-check covers one-to-one pairing and coverage (production's other pages don't cover the prototype's tab states; its own Experience page does).
  - Next: 7 (reuse guard).
