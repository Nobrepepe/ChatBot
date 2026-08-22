# Character Chat — Visual Design Philosophy

**Purpose.** This document is permanent. Point any agent building or changing a screen at this
file. It states the reasoning behind the design so a new screen arrives already consistent.

The app is **Electron + React + plain CSS**. The design system lives in
`src/renderer/src/styles/` (`tokens.css`, `base.css`, `patterns.css`) and the component library in
`src/renderer/src/components/`. Where this document and a component's ad-hoc styling disagree,
this document wins.

> This is the second edition. The first edition governed the Flet app; its scroll-region
> constraints, its Flet-specific spellings, and its fixed 52px gutters are superseded.
> Scrolling is unrestricted everywhere. Two rules carried over unchanged, because they are the
> identity of the app: **there are no boxes**, and **art keeps its transparent edges**.

---

## 1. The thesis

> **The app is about talking to someone who remembers you. The interface should feel like the room
> the conversation happens in, not like the client that sends the request.**

Three consequences, in priority order. When two conflict, the earlier one wins.

1. **Art carries the screen.** The most emotionally loaded thing on screen is a character or a
   place. Give it the room, let it bleed off the frame, and let it dissolve rather than end.
2. **State is stated in words, once, warmly.** "The history window carries the last thirty" beats
   a badge reading `30/41`. The app talks to the writer like a collaborator who has read the file.
3. **Data is available, not shouted.** The prompt debug panel, the session summaries, the full
   lore list all exist — behind a text action or on their own screen, never in the middle of a
   conversation.

---

## 2. The two structural rules

### Rule 1 — There are no boxes

No filled panels, no borders, no border-radius on content containers, no cards, no chips, no
pills, no gradient buttons, no icon buttons, no bordered or filled inputs. Grouping comes from
**proximity, an eyebrow label, and a fading rule** — that is sufficient, and it is what makes the
screens read as pages rather than as dialogs.

Edges are implied, never drawn:

- `.rule` — a 1px hairline that fades out before it reaches the end (`--rule-end` varies per
  rule so consecutive rules do not end on the same vertical; that irregularity is deliberate).
- `.eyebrow` — an 11px uppercase letter-spaced label introduces every block, replacing panel
  chrome.
- `.field` — inputs are borderless text over a 1px underline that turns amber on focus. Never a
  plate, never a radius.
- `.text-action` — actions are text: serif amber for the primary ("Send →"), quiet sans for
  secondary, `--bad` for destructive. Never a button shape.
- `.fading-bar` — meters are gradient hairlines whose track fades out; never a closed rectangle.
- Overlays are **full-frame screens**, not floating cards: the page dims behind a blur, the
  overlay carries an eyebrow, a serif headline, a fading rule, and text actions. Escape closes.

### Rule 2 — Art keeps its transparent edges

The repo's character art carries alpha. It is never cropped into a rectangle, never masked, never
framed: `.alpha-art` renders it `object-fit: contain` so the figure's own edge is the edge.
Ghosted states (`.art-ghost`) dim and desaturate the art itself — never a wrapper that also holds
the state text, which stays at full strength.

Opaque art (world covers, scene backdrops) dissolves into the floor instead of ending:
`.masked-art` fades it out with CSS mask gradients, and full-bleed backdrops carry `.scrim-top`
so text stays legible. If a gradient has not reached transparent by the edge of its box, it draws
a rectangle — check the corners.

Every no-art state is deliberate: `.hatch`, a 45° hatch at the correct aspect ratio with a mono
caption (`NO PORTRAIT`), never a broken image or an icon.

---

## 3. Tokens

`tokens.css` is the single source. Do not introduce new colours; if you need a hue the palette
lacks, you are probably encoding something that should be prose.

- Floor `--bg #121014` — warm charcoal; every screen sits directly on it. `--bg-deep` exists for
  rare recessed areas and is never a panel background.
- Text `--text-1 #ece7e1` warm off-white, `--text-dim`, `--muted`, `--muted-2` (the contrast
  floor for real information), `--faint` (decorative only).
- **One accent**: `--accent #d9a86c`, ember amber. It marks the primary action, the one thing
  that is ready, and the active tab underline — and nothing else. `--good` and `--bad` carry
  clears and blocks, always accompanied by words.
- Type: **Newsreader** (vendored) for headlines, names, and every number the writer reads as a
  quantity; **IBM Plex Sans** (vendored) for everything else. The serif/sans split *is* the
  information architecture. Display sizes multiply by `--text-scale` (the accessibility setting);
  interface text stays stable.

---

## 4. How to compose a new screen

1. **Name the one thing the screen is for**, in one sentence, in the writer's language. If you
   cannot write that sentence, it is two screens.
2. **Find the art** and place it first, large, bleeding off at least one edge. A screen with no
   art (Settings) is carried by its headline and whitespace — do not invent decoration.
3. **Write the headline as a reactive sentence** generated from the data, with an authored
   fallback for the empty case. Sentence case, full stop.
4. **Reduce the rest to two or three threads**, each an eyebrow plus a few lines, separated by
   fading rules.
5. **Place at most one pulse** (`.pulse-dot`) on the thing that is ready or blocking. Then stop.

## 5. Voice

- Sentence case, full stops. "Nine met, four scenes running." not "9 Characters / 4 Sessions".
- Say what happens next, not what a thing is: "Begin the scene →", "Keep this memory →".
- Warm, never cute. No exclamation marks, no emoji, no icons standing in for words.
- State guarantees plainly: "Nothing is written until you begin it." "Private notes — never sent
  in scene prompts." Removing anxiety is a feature.
- Every state shown in colour or dimming is also written in words, at full strength.
- Any screen that touches a scene says how much history the model is actually being sent.

## 6. Motion

- **Pulse** marks exactly one thing per screen: what is ready or what is blocking.
- **Bars animate** from their previous value on change.
- Route changes fade briefly; hover raises text from `--muted` toward the accent.
- **Reduced motion** (the setting or `prefers-reduced-motion`) kills all of it via
  `[data-reduce-motion]` — verify it catches anything new you add.

## 7. Constraints that outlive the design

- Visual work happens in `src/renderer/` only. Everything a screen shows already exists in the
  IPC surface (`src/shared/ipc.ts`); if a screen seems to need new data, check the repositories
  first.
- Fonts are vendored and offline. No network calls to render, ever.
- Keyboard behaviour survives any restyle: Escape closes the top overlay, Enter sends and
  Shift+Enter breaks a line in composers, Ctrl+K finds a note in the workspace.
- The window resizes; express layout as flex and grid with `minmax`, not fixed pixel widths.
