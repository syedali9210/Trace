# Trace roadmap: what the space lacks and what we build

Progress is tracked in the README's "Roadmap and progress" table.

Written 2026-10-28 from two rounds of research and ideation with Syed. Round 1 is the eight ideas in §9a; round 2 is the rest. As of 2026-10-29, phases A and B are built (v1) and most of C (the queue, `check_change`, the "no" list, DESIGN.md and tokens, decisions that know what they govern); 8, 16 and the rest of 5 are next, then D and E.

## 1. The short answer

Making screens is solved, or about to be: Figma Make, Claude Design, Stitch, v0 and Lovable all do it, backed by more money than we will ever have. What nobody does is keep the design, the code, the running product and the reasons behind them **in agreement, every day, without anyone writing anything down**. Handoff tools treat this as a one-off moment. It isn't. Design and code drift apart with every commit and every Figma save, and AI agents make the drift faster.

Trace already sees all four of those things over time. The move is to stop being only a recorder and become the **judge with a memory**: it measures every change, checks it against what was designed, asked for and decided, sends each problem to the person or agent who should fix it, and learns from what gets kept or reverted.

## 2. What changed in 2026 (the facts the rest stands on)

- **Figma is building the bridge inside Figma.** Make imports a real GitHub repo, edits it on the canvas and opens pull requests (Full seats on paid plans only). Code layers (open beta, Oct 2026) bring coded screens onto the canvas and extract them back into layers. Specs and MCP tools let agents read and write both. Our PRD named "Figma builds the same inside Figma" as a top risk; it happened.
- **Figma keeps the useful data behind price.** The Variables REST API is Enterprise-only. The Figma MCP is reportedly limited to 6 calls a month on Starter.
- **Anthropic shipped Claude Design** (April 2026): reads a codebase and design files, builds a design system, hands off to Claude Code.
- **Agents read files, not minds.** DESIGN.md (from Google Stitch) is becoming the way to give agents design rules; DTCG tokens reached a stable format (2025.10) and Figma imports it.
- **Agents still invent things.** Storybook built an MCP because agents made up props and duplicate components. Off-system output looks on-brand, so it slips through review.
- **Models can't grade their own work reliably.** Visual self-checks need deterministic measurements next to any model opinion.
- **Handoff is still broken.** One survey: 21% call it smooth. Telerik: 84% use AI, only 16% see strongly positive results.
- **Design systems fail on adoption, not creation.** zeroheight 2026: 7% of teams at full adoption, 61% short of people, 20% measure nothing.
- **Prototypes get thrown away.** Vibe-coded prototypes reach "about 50%" and are rebuilt, and the decisions inside them are lost with them.
- **States get forgotten.** Empty, loading, error and overflow cases show up in QA or production because reviews use full demo data.
- **Accessibility starts in design.** Deque attributes 67% of defects to design; automated checks fully cover about 30% of WCAG criteria.
- **Hiring wants proof of thinking.** Reviewers report spotting AI in every portfolio; they want decisions, trade-offs and real process, and also expect AI fluency.
- **Agents lose context between sessions and tools,** and parallel sessions contradict each other without anyone noticing.

## 3. The workflow end to end, and where it breaks

| Stage | What people do | What breaks | Who covers it today | Still missing |
|---|---|---|---|---|
| Research | interviews, notes, insights | insights never reach the decision they should shape | Dovetail, Maze | the link from an insight to the screen it changed |
| Define | brief, PRD, constraints | the brief and the build drift; nobody rereads the brief | docs | checking the build against the brief's promises |
| Explore | options, references, prototypes | rejected options and why are lost | Figma, Make, Claude Design | a record of what was tried and refused |
| Decide | reviews, critique, approvals | feedback in five places; suggestions look like decisions | Figma comments, Slack | decisions with an owner, a source and a scope |
| Specify | states, responsive, content, a11y, motion | happy path only; lorem ipsum; states found in code | Figma Specs, annotations | a list of states the code has that nobody designed |
| Build | code, agents | agents go off-system; invent components; change more than asked | Make, Cursor, Claude Code | a check that the change matches the ask |
| Verify | design QA, review | review is the bottleneck now; drift looks fine | Chromatic, Pixelay, Floto | review that shows only what changed and what's wrong |
| Ship | release | nobody knows if shipped equals approved | CI | "shipped vs approved" coverage |
| Learn | metrics, feedback | can't tie a metric to a design change | PostHog, GA | the design change marked on the metric |
| Remember | case study, rationale | written late, from memory, or never | Notion, ADRs | rationale as a by-product of the work |

The pattern: every stage has a tool for **making** its artefact. Almost no stage has a tool for **keeping it true** once the next stage starts.

## 4. Seven problems, each seen from several angles

Each problem is looked at through the same lenses: **information** (what is missing), **time** (when it is known vs when it is needed), **ownership** (who should act), **incentive** (why people don't do it), **trust** (can you believe it), **cost** (what a late fix costs).

### P1. "Handoff is broken"
- *Time:* handoff is one event; drift is continuous. A tool for the event solves the wrong shape.
- *Ownership:* when design and code disagree, nobody knows whose job it is. Timestamps do: the side that moved last is usually the intended one, so the other side gets the task.
- *Information:* overlays compare pixels; what people need is properties (16 vs 14 px, token vs near-token).
- **Insight:** replace "handoff" with a continuous agreement check that says who should act.

### P2. "Decisions and rationale get lost"
- *Incentive:* writing the why is extra work, so it slips. It has to fall out of work already done (commits, chats, comments).
- *Trust:* a stale why misleads agents. A decision needs to know **what it governs** (a token, a component, a property) so it can notice when that thing changes.
- *Cost:* without the why, people re-argue settled things and agents re-propose rejected ideas.
- **Insight:** decisions should be attached to measured properties. When the property changes, the decision asks: superseded or broken?

### P3. "AI output is off-system"
- *Information:* the agent can't see tokens, components or rules unless they're in front of it (DESIGN.md, MCP).
- *Trust:* even with context, it drifts, and it looks on-brand, so humans miss it.
- *Cost:* generating is nearly free now; **reviewing is the bottleneck**. The scarce thing is human attention per change.
- **Insight:** measure success in minutes of human review per change. Every feature should cut it: show only what changed, against what was asked, with measured differences, riskiest first.

### P4. "States and real content are missing"
- *Time:* designers draw the happy path; the code has the loading, error and empty branches. They meet in QA.
- *Information:* the code already knows which states exist (`isLoading`, `error ?`, empty lists, `disabled`). Nobody compares that list to what was designed or seen.
- *Cost:* overflow, long names and translations break layouts in production.
- **Insight:** the running app can be **pushed into its states on purpose** (empty data, errors, slow network, long text, phone width, dark mode) and checked by rules, without a model.

### P5. "Design systems don't get adopted"
- *Ownership:* system teams are understaffed (61%) and can't police every team.
- *Information:* adoption is counted by imports, which lies. What counts is what renders on screens users see.
- *Incentive:* nobody fixes drift when the fix is manual. A ready-made fix (snap to token) gets merged.
- **Insight:** measure adoption where users see it (rendered screens), find the near-misses, and offer the fix.

### P6. "Prototypes get rebuilt and thrown away"
- *Information:* the prototype's value isn't its code; it's the screens, flows, states, copy and decisions in it.
- *Time:* production gets built later, by someone else, and nobody checks it against the prototype.
- **Insight:** treat the prototype as the spec and the acceptance test. Walk it, walk production, match the screens, report what's covered and what differs.

### P7. "Nobody can prove the process"
- *Trust:* hiring managers and clients can't tell real process from an AI-written story.
- *Information:* Trace has the timestamps, versions, quotes and authors (human or agent commits).
- **Insight:** a case study where every claim links to evidence, including an honest split of what the person decided and what agents built. That is exactly what 2026 hiring asks for: your own thinking plus AI fluency.

### Two more that cut across everything
- **Agents contradict each other.** One session makes the button black, another makes it blue again. A property that flips back and forth across commits is an **undecided question**. Find it, ask the human once, record the answer, give it to every agent.
- **Designers can't run the code.** The barrier is repo, build and install setup. Trace already installs, runs any version and isolates its toolchain, so it can be the safe "run it for me" layer that lets a designer comment on a pixel and get a checked change.

## 5. The same features through each person's eyes

| Person | Their job | Their pain | What Trace gives today | What's missing |
|---|---|---|---|---|
| Designer | make it right, keep it right | the build doesn't match; their Figma goes stale; no credit for process | capture, timeline, case study | Figma ↔ app matching; "your Figma is out of date here"; proof of process |
| Developer / design engineer | build it fast, once | vague specs, surprise Figma changes, review churn | MCP, tokens, History runs | property diffs instead of pictures; a check in the pull request; DESIGN.md |
| PM / founder | ship what was agreed | can't see if shipped equals approved | Latest feed, tasks | shipped-vs-approved coverage; one place for what needs a decision |
| Design system lead | adoption | can't measure; can't police | colours and type from the running app | rendered usage, near-misses, duplicates, dead components, fix suggestions |
| Freelancer / agency | get paid for scope | endless revisions; unclear "small change" | moments, comments | approved version as the baseline; each request sized by what it touches |
| Client / stakeholder | approve | links everywhere, can't tell what changed | guest links (table exists) | one review link per version with pins; approval recorded as a decision |
| Hiring manager | judge thinking | AI-written case studies | case study engine | claims linked to evidence; human vs agent split |
| AI agent | build on-system | no context, no "no" list, no way to check itself | MCP tools, recall, remember | rejected list; a `check_change` tool that measures its own work |
| Security / IT | nothing leaks | cloud tools see NDA work | local-first, redaction, sandboxed previews | already strong; works on any Figma plan |

The agent row is the one most tools miss: the agent is now a user. It needs four things: the current truth (tokens, components with pictures, screens), the rules, **what was tried and rejected**, and a deterministic way to check its own change before handing it back.

The freelancer and the AI-agent rows share one mechanism: "approved vs requested" for a client is the same check as "asked vs did" for an agent. Build it once.

## 6. What the space lacks

1. **A continuous agreement check** between design, code and the running product. Today's tools are one-off handoffs or one-sided checks (Figma checks Figma; CI checks code).
2. **Provenance from pixel to reason.** No tool answers "why does this look like this?" with the commit, the ask and the person.
3. **A deterministic judge for AI changes.** Review is the bottleneck, and models can't grade themselves.
4. **State and content coverage.** Nothing lists the states the code has that nobody designed, or stress-tests the real app with empty, error, long and translated content.
5. **Memory of "no".** Agents repeat rejected ideas because rejections aren't kept anywhere they read.
6. **Decisions that know what they govern** and notice when they're broken.
7. **Cross-tool, cross-agent memory that is local and doesn't need Figma Enterprise.**
8. **Verifiable process** for hiring, clients and audits.

## 7. What Trace solves today, honestly

**Strong:**
- Captures from folders, Figma, GitHub and links; files changes into projects; writes changelogs.
- Reads every AI tool's memory and chats (Claude Code, Codex, Gemini, Cursor, Copilot) and gives them back through one MCP.
- Runs any git version of an app, walks every screen headless, measures colours and type from the running app.
- Lets @claude / @trace edit code from a comment and commits it with the reason; rollback is safe.
- Writes the case study and deck from the real work.
- Local-first, with secret scrubbing and sandboxed previews.

**Weak:**
- **It records more than it judges.** It shows a lot and rarely says "this needs you".
- **It lives in its own window.** Nothing appears in the pull request, the terminal or Figma, so people have to remember to open it.
- **Walks are slow** (about 15 minutes for the engine), so per-commit checks aren't possible yet.
- **It's a local `npm start` app for one person.** Team review and client links are half-built.
- **Figma and GitHub connectors are untested live.**

## 8. How it all connects: three primitives

Most of the ideas below are views on three things. Building the three is what keeps this from becoming twenty separate features.

1. **The property graph.** Every measured property (colour, size, weight, radius, spacing, text) of every element on every screen at every version, with its provenance: component → file → commit → ask → person or agent. The walk already collects most of it (React tree with rects and props, text styles, tokens); it just isn't stored as one queryable record.
2. **The matcher.** Pairs a reference with an actual: by text content first, then name, structure and position. References can be a Figma frame, a prototype screen, the approved version, the previous version, or the same screen in a forced state. One matcher, many uses.
3. **The checks.** Deterministic rules over the graph: token drift, scope, overflow, contrast, missing states, oscillation, broken decisions, learned rules. No model needed to decide pass or fail; the model only helps phrase things and map vague words.

Everything feeds one loop: **context in → change → measure → check → route → learn → context in.**

## 9. The ideas

### 9a. Round 1 (from the first research pass)

1. **Re-walk only what a commit touched.**
   - Changed files → their components → importers up the `discover()` graph → screens whose React tree renders any of them → replay only those screens' stored steps.
   - Global CSS, tokens, Tailwind config or package changes mean a full walk.
   - Compare against the previous version by structure first (components added or removed, props, text styles), pixels second.
   - Turns a 15-minute walk into seconds per commit. Everything per-commit depends on this.
2. **Asked vs did: the scope check.**
   - Targets come from matching the ask's words against screen, section, component and visible-text names.
   - The changed set comes from idea 1.
   - Anything outside "targets plus their dependents" is flagged ("asked about the header; the Footer also changed on 3 screens").
   - A vague ask that matches nothing skips the check instead of guessing.
3. **Token drift that knows which side moved.**
   - Gather values from declared tokens, Figma node trees (works on any plan) and the running app.
   - Group them like `typeScale()` merges sizes within 4%; colours close in OKLCH count as one.
   - Near a token but not equal → likely mistake, offer to snap. Far and used once → decide: new token or remove.
   - Figma vs code mismatch: the newer side wins by default and the other side gets the task. If the newer side is an AI commit whose ask didn't mention it, ask a human.
4. **DESIGN.md and tokens.json written from what was measured.**
   - Tokens, type scale, components with props and pictures, decisions and learned rules.
   - Proposed after each commit through `propose_file`, never written without approval.
   - Every agent gets on-system without MCP; tokens reach Figma without the Enterprise API.
5. **Rules learned from reverts and approvals (TASTE.md, automated).**
   - A rollback (`Trace-Rolled-Back-To:`), a `git revert`, or a correction in chat soon after a change, paired with the measured difference that was undone → a candidate rule ("no gradients", "don't touch the nav icons").
   - Approvals ("perfect", "keep it") → positive rules.
   - One tap confirms; confirmed rules go into DESIGN.md and are checked on every commit.
6. **Figma frame ↔ running screen, matched automatically.**
   - Pair by shared text, then frame name vs route or screen name, then device shape.
   - Inside a pair, match elements by exact text, then position; compare font, weight, colour, radius, padding.
   - Every pair, every version, no setup; idea 3 says who fixes each difference.
7. **Reuse guard.**
   - Duplicates: components with ≥ 60% prop overlap that also render alike.
   - Usage by rendered screens, not imports; components that never render are dead.
   - `find_component` MCP tool so agents look before they write.
   - Figma variant properties vs code prop types → suggested Code Connect mappings.
8. **Point at a pixel: see why, then fix it.**
   - Smallest React element under the point → component → file → commits → ask or chat → person.
   - A comment there goes to an agent with the exact target; Trace re-walks that screen and posts before/after with the scope check.

### 9b. Round 2 (from the angles above)

9. **Stress walk: force the states and check them by rule.** *(P4)*
   - The walk page already exposes raw CDP. Use `Fetch` interception to answer JSON requests with empty arrays (empty state), 500s (error state) or a delay (loading state). Use network throttling, locale override, the phone viewport and dark mode (already there).
   - Pseudo-localise: stretch every text node by about 40% with accented letters to imitate translation.
   - Check by rule, no model: text clipped (`scrollWidth > clientWidth` with hidden overflow), elements overlapping, sideways scroll, contrast below 4.5:1, blank screens, unhandled errors in the console.
   - If the app doesn't fetch anything, say so plainly ("this app's data is built in; states can't be forced") instead of pretending.
10. **States inventory: what the code has that nobody designed.** *(P4)*
    - From `props.js` (boolean flags, unions) and the component bodies (`if (loading)`, `error ?`, `.length === 0`), list each component's states.
    - Mark each one: seen in a walk? forced by the stress walk? has a Figma frame?
    - Output: "Checkout has loading and error branches; neither was ever designed or seen."
11. **Decisions that know what they govern.** *(P2)*
    - When a decision comes from a measured change (ideas 2, 3, 5), store what it governs: component or token, property, value.
    - When the property graph shows that value changed, the decision is flagged: superseded (update it) or broken (fix the code).
    - Decisions without a measurable target stay plain text, like today.
12. **Undecided questions from flip-flops.** *(cross-cutting)*
    - In the property graph over versions, a value that goes A → B → A is a flip. Two flips, or flips by different agents, mean nobody decided.
    - Ask the human once, store the answer as a decision with what it governs (idea 11), and give it to every agent.
13. **The "no" list for agents.** *(agent POV)*
    - Every revert, rollback and refused proposal is kept with what it undid and why.
    - Served through MCP and DESIGN.md as "tried and rejected" so agents stop re-proposing it.
14. **`check_change`: a judge agents can call.** *(agent POV, P3)*
    - An MCP tool that runs ideas 1, 2, 3, 9 and the learned rules on the agent's working tree and returns findings as data.
    - The agent fixes its own work against measurements, not its own opinion, before a human sees it.
15. **Prototype as the acceptance test.** *(P6)*
    - Walk the prototype (a Make export, a Claude Design HTML, a Lovable app, an old branch). Walk production. The matcher pairs screens.
    - Report coverage ("production has 14 of the prototype's 18 screens") and the differences on each pair.
    - Same matcher as idea 6; only the reference changes.
16. **Feedback that closes on evidence.** *(Decide stage)*
    - A pinned comment resolves to a target (idea 8). It closes only when a later walk shows the target changed, and the before/after is attached.
    - Suggestions and decisions are separate kinds (the decision extractor already exists in `api.js`).
17. **Approved vs requested, for clients.** *(freelancer POV)*
    - An approved version becomes the baseline. Each new request is sized by what it touches (screens, components, tokens), using the same scope machinery as idea 2.
    - "Touches one text style" is a revision; "touches 6 screens and the palette" is a direction change. The numbers make that conversation easy.
18. **Proof of process.** *(P7, hiring POV)*
    - Every case-study claim links to its evidence: the version, the measured change, the quote, the date.
    - An honest authorship split from commit trailers and agent chats: what the person decided, what agents built.
19. **One attention queue.** *(the "judge" layer)*
    - Instead of feeds that show everything, one list of things that disagree: drift, failed scope checks, missing states, broken decisions, undecided questions, open feedback.
    - Each item has a one-click way out: snap to token, ask an agent, update Figma, confirm a rule, mark as intended.
    - Sorted by risk: out of scope first, broken decisions next, drift last.
20. **Design change marked on the metric.** *(Learn stage, later)*
    - Trace knows when each measured change landed. With a PostHog or GA connector, draw before/after windows on the metric the brief said it should move.
    - Pre/post, not proof of cause; label it that way.

## 10. What makes it a full tool people can use

These are product requirements, not features. Without them the ideas above stay a demo.

- **Value in five minutes.** Drop a folder → it installs, runs, walks, and shows the first real finding (near-miss colours, a clipped label) before asking for any key or account.
- **Present where people already work.** A `trace check` command in `bin/trace.js` for the terminal and a git hook; a pull-request comment when GitHub is connected; MCP and DESIGN.md for agents. A tool you have to remember to open gets forgotten.
- **Trust.** Every claim links to evidence; nothing is written without approval; everything can be undone (rollback exists). Say what wasn't checked.
- **Fast enough to run on every commit.** Idea 1 first.
- **No paywalled dependency.** Measured truth from the running app works without Figma Enterprise, Full seats or MCP quotas. Figma data makes it richer, not possible.
- **Local and private by default.** It's already the strongest selling point against cloud tools for NDA work.
- **Team-ready without becoming a cloud.** Read-only review links per version for clients and stakeholders; approvals recorded as decisions.
- **Installs like an app.** One installer instead of `npm start` (the PRD planned Tauri).

## 11. Order of work

| Phase | What | Why first |
|---|---|---|
| A. Foundation | incremental walk (1); the property graph with provenance (§8); `trace check` CLI | everything per-commit and every check needs these |
| B. Checks | scope (2); directional drift (3); stress walk (9); states inventory (10); flip-flops (12) | the judge; each is a rule over the graph |
| C. Closing the loop | attention queue (19); pixel → why → fix (8); feedback that closes on evidence (16); `check_change` (14); the "no" list (13); DESIGN.md + tokens.json (4); learned rules (5); decisions that govern (11) | turns findings into fixes and memory |
| D. References | Figma ↔ app (6); prototype as test (15); reuse guard (7); approved vs requested (17); proof of process (18) | the matcher, pointed at different references |
| E. Reach | PR comments; review links; the installer; metrics (20) | gets it into other people's hands |

## 12. What we won't build

- Another prompt-to-UI generator. The labs and Figma own it.
- AI "design scores" or a model grading taste. Unreliable, and it hides the evidence.
- A Figma overlay tool on its own. Commodity; the matcher does it as a side effect.
- A Figma plugin that copies Make.
- Personas, research summaries or case studies written from nothing. Everything starts from captured evidence.

## 13. Sources

- Figma Config 2026: [CMSWire](https://www.cmswire.com/digital-experience/figma-launches-code-layers-motion-at-config-2026/), [Figma Help: Config India 2026](https://help.figma.com/hc/en-us/articles/43663368947863-What-s-new-from-Config-India-2026), [AICoder: code layers, Specs, MCP](https://aicoder.com/news/news-20261016-figma-config-india-code-layers-specs-mcp), [VentureBeat: two-way GitHub](https://venturebeat.com/technology/are-designers-the-new-swes-figma-makes-new-two-way-github-integration-turns-designs-into-live-production-code-with-built-in-governance)
- Figma limits: [API report card](https://supergood.ai/api-report-card/figma), [MCP guide](https://mcpservers.org/servers/figma/mcp-server-guide)
- [Claude Design (MacRumors)](https://www.macrumors.com/2026/04/17/anthropic-claude-design)
- [DESIGN.md (MindStudio)](https://www.mindstudio.ai/blog/what-is-design-md-google-stitch), [DTCG 2025.10 (W3C)](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Storybook MCP (LogRocket)](https://blog.logrocket.com/storybook-mcp-component-libraries/), [AI design system drift (SuperDesign)](https://superdesign.dev/blog/ai-design-system-drift), [Check Designs misses code drift (DEV)](https://dev.to/akollu72/check-designs-validates-your-figma-what-validates-your-code-38c2)
- Design QA: [Figma Live Design QA MCP](https://glama.ai/mcp/servers/hdfq0ka348), [Pixelay](https://www.hypermatic.com/articles/pixelay-design-qa-tool/), [visual verification loops](https://paddo.dev/blog/multimodal-validation-visual-verification/)
- Handoff and AI: [handoff statistics](https://blog.mean.ceo/?p=11519), [Telerik report](https://www.telerik.com/ai-design-development-workflows-report-2025)
- Design systems: [zeroheight 2026 report](https://webinars.zeroheight.com/register/zeroheight-design-systems-report-2026-adoption-as-an-existential-challenge), [zeroheight on measuring the dev side](https://help.zeroheight.com/hc/en-us/articles/36474148202523-How-to-measure-the-dev-side-of-a-design-system)
- States and content: [forgotten UI states](https://medium.com/bytelimes/6-most-forgotten-ui-states-that-prevent-you-from-writing-good-software-1dd51537a548), [handoff gaps (Figr)](https://figr.design/blog/design-to-dev-handoff-problems), [lorem ipsum (UX Planet)](https://uxplanet.org/should-we-use-lorem-ipsum-in-product-design-f1a09b9fd3ec)
- Accessibility: [Deque on the design/dev gap](https://www.deque.com/blog/is-closing-the-web-accessibility-design-development-gap-a-bridge-too-far/), [WCAG 2.2 checklist 2026](https://www.digitalapplied.com/blog/wcag-2-2-accessibility-audit-checklist-2026-reference)
- Prototypes: [ArcTouch](https://arctouch.com/blog/vibe-coding-prototypes), [prototype-to-production gap](https://elsesite.pages.dev/resources/field-notes/the-prototype-to-production-gap)
- Decisions and feedback: [decision capture is a write-path problem](https://briefhq.ai/blog/decision-capture-ai-coding-agents-write-path/), [Figma feedback into action (DEV)](https://dev.to/usamakashif/how-to-turn-figma-feedback-into-action-without-losing-your-mind-1fj4), [best design feedback tool (Fabric)](https://fabric.so/comparison/best-design-feedback-tool), [citations in research](https://www.userinterviews.com/blog/citations-are-missing-link-in-insight-driven-decisions)
- Agents and context: [why agents forget between sessions](https://dev.to/pekg/why-ai-coding-agents-forget-everything-between-sessions-and-how-to-fix-it-pik), [when teams collaborate](https://keepgoing-48o.pages.dev/blog/why-ai-forgets-when-teams-collaborate/)
- Designers in code: [Built In: vibe coding for designers and PMs](https://builtin.com/articles/unlock-vibe-coding-designers-product-managers)
- Hiring: [AI for UX portfolios (uxfolio)](https://blog.uxfol.io/?p=631937), [the portfolio question](https://balintbogdan.substack.com/p/the-portfolio-question)
- Freelance scope: [change-request process](https://boutarek.duckdns.org/web-design-scope-template-change-request-process/), [scope creep (Twine)](https://www.twine.net/blog/how-to-handle-scope-creep)
- Measuring design: [how to measure design](https://corpwaters.substack.com/p/how-to-measure-design)
