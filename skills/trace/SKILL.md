---
name: trace
description: Assemble the project in this folder in Trace, the design memory, and fill its case study. Use when the user says "trace", "set up Trace here", "assemble the case study", "log this to Trace", "fill the case study", or starts design or product work in a folder that Trace should capture.
---

# Trace: assemble this project

Trace keeps the design history of a project: every screen and change (code changes are drawn), the docs, decisions, references, reviews, tasks, the prompts given to AI, and a case study built from all of it. This skill points Trace at the current folder and fills in what only you, the agent, know.

## 1. Assemble

Run this from the project folder (the folder you are working in):

```bash
node "{{TRACE_DIR}}/bin/trace.js" assemble
```

It finds or creates the Trace project for this folder, watches the folder (screens, docs and component code are captured and drawn), reads the AI memory for it, adds the Trace script to this folder's CLAUDE.md, and assembles the case study. It prints the project link, what it found, and which case-study questions are still open.

If it says Trace isn't running, tell the user to start it (`cd "{{TRACE_DIR}}" && npm start`) and stop there.

## 2. Answer the open case-study questions

If the Trace MCP tools are available (`get_case_study`, `answer_case_study`):

1. Call `get_case_study` for this project. It returns every question with the answer Trace assembled, its sources, and a status (filled, partial, missing).
2. For each partial or missing question, write an answer with `answer_case_study`, from what you actually know of this work: this conversation, the code, the docs in the folder, the decisions made. Quote the user's own words where you can. Never invent numbers, users, results or dates; if you don't know, say what's unknown in one line instead of guessing.
3. Keep answers short and concrete: two to five sentences, naming the screens, components, colours and constraints involved.

If the MCP tools aren't connected, print the open questions to the user with your proposed answers, and tell them they can paste them in Trace (project → Case study) or connect the MCP server in Trace → Settings → MCP.

## 3. While you keep working

After each set of changes, call `explain_changes` (the script in CLAUDE.md says how): what the user asked, what you understood, why each change, the references they gave you, and your own review. It shows up on the change in Trace for the user to review.

## 4. Keep the person's reasons

Trace's Thinking section keeps the user's own reasons, in their words, and builds the story they tell about the work (the problem is the villain and gets 30–40% of it; then the turn, the hero, behind the scenes, how it fits people's day, and the business goal).

- When the user writes `thought: …`, call `add_thought` with their words, minus the prefix. Say in one line that it's filed.
- After you finish an ask, call `get_thinking` and ask the user one open question from `ask_next` (usually why they wanted a change that way). File the answer with `add_thought` (`kind: why`, with the `moment_id`).
- Never file your own reasoning or a guess there. If `get_thinking` returns a `reminder`, pass it on once.

## 5. Report

Finish with the project link from step 1 and a one-line summary: how many questions are answered now, and what the user should look at.
