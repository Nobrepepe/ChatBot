# Character Chat — Visual Design Philosophy

**Purpose.** This document is permanent. Point any agent building or changing a screen at this
file. It states the reasoning behind the design so a new screen arrives already consistent — not a
matched screenshot, but a screen that was designed the same way.

Read §1 and §2 before writing any control. §3–§9 are the reference. §10 is the checklist to run
before calling a screen done.

The app is **Flet 0.28.3 / Python**, not HTML. §5 gives the Flet spelling of every pattern. Where
this document and a Material default disagree, this document wins.

---

## 1. The thesis

> **The app is about talking to someone who remembers you. The interface should feel like the room
> the conversation happens in, not like the client that sends the request.**

Every decision below descends from that sentence. The old UI was a game launcher wrapped around a
chat: bordered cards, gradient pills, square icon buttons, a bubble per line, a titled panel per
idea. It was *legible* and it was *furniture*. The redesign's bet is that the reader will feel a
character's presence in art that bleeds off the frame and in a sentence that tells them what she
currently knows — never in a rounded rectangle with a violet glow.

Three consequences, in priority order. When two conflict, the earlier one wins.

1. **Art carries the screen.** The most emotionally loaded thing on screen is a character or a
   place. Give it the room, let it run off the edge of the frame, and let it dissolve rather than
   end. Chrome does not compete with art.
2. **State is stated in words, once, warmly.** "The history window carries the last thirty. Eleven
   messages now fall outside it." beats a badge reading `30/41`. The app talks to the writer like a
   collaborator who has read the file, not like a status bar.
3. **Data is available, not shouted.** Nothing is deleted; the prompt debug panel, the session
   notes, the full lore list all still exist. They live behind `⌄` disclosure or on their own
   screen instead of occupying the middle of a conversation.

### The five words

If you remember nothing else: **bleed, imply, name, one, quiet.**

- **Bleed** — art exceeds its container and dissolves into the floor.
- **Imply** — edges are suggested by fading hairlines and grouping, never drawn as boxes.
- **Name** — every block is introduced by a small uppercase eyebrow; every state is written in prose.
- **One** — one accent colour, one pulsing element, one headline, one hero numeral per screen.
- **Quiet** — everything not carrying meaning drops toward `MUTED_2` and gets out of the way.

And one that belongs only to this app: **remember.** Any screen that touches a scene must make the
model's actual memory visible — what is in the context window, what is canon, what was summarized,
what falls outside. A character who "develops over time" is the product. If a screen hides how much
of that history is really being sent, the screen is lying.

---

## 2. The non-negotiable rules

These five are structural. A screen that breaks one does not match the app, however good it looks
in isolation.

### Rule 1 — There are no boxes

No filled `bgcolor` panels, no `border=ft.border.all(...)`, no `border_radius` on a content
container, no cards, no chips, no pills, no gradient buttons, no square icon buttons, no bordered
or filled `TextField`, no `ft.Tabs`. Grouping comes from **proximity, an eyebrow label, and a
fading rule** — that is sufficient, and it is what makes the screens read as pages rather than as
dialogs.

Two exceptions, both narrow:

- **A menu or modal must have a surface** to be readable over what it covers. Treat it as a
  screen, not a card: fill it with `BG`, no border, no radius, 52px gutter, eyebrow + fading rule
  at the top, text actions at the bottom. See §5, *Overlay*.
- **A genuinely tabular authoring surface** — the notes browser list — may use a per-row
  `border=ft.border.only(bottom=ft.BorderSide(1, LINE))`. Density is correct in exactly one place:
  where the writer is comparing thirty rows of the same shape. A player-facing screen does not get
  this exception.

### Rule 2 — Every rule fades

A hairline never touches both ends of its container. Always a gradient, and vary the far stop per
rule (**0.55–0.84**) so consecutive rules do not end on the same vertical. That irregularity is
deliberate — it is what stops a stack of blocks from reading as a table. Use `th.rule(end)`; never
`ft.Divider`, never `border.only(bottom=...)` on a block.

### Rule 3 — Art is masked, never cropped, and the mask must finish inside the box

No image sits inside a hard rectangle. Every image is faded into `BG` with a radial shader mask,
and full-bleed art carries a scrim so text stays legible.

**The failure mode to watch for, because it has already bitten this design twice:** a radial
gradient — whether it is the mask, the glow behind the art, or the floor-fade over it — that has
not reached fully transparent (or fully `BG`) *by the edge of its own box* draws a visible
rectangle. In Flutter/Flet a `RadialGradient` radius is a fraction of the box's **shortest** side,
so on a tall portrait box a radius that looks generous still spills past the left and right edges.
Size every radial so its last stop lands inside the box, and check the corners.

**The repo's character art uses transparency.** Preserve its alpha and show 16:9 tile assets with
`ImageFit.CONTAIN`; do not crop them or add a shader that erases their transparent edges. Radial
masks remain useful for opaque world covers and full-bleed backdrops, not as a blanket image rule.

**Collections remain reachable.** Character browse and selection surfaces use responsive 16:9
grids. Art may bleed decoratively, but controls and selectable content may not be cut off.

### Rule 4 — Colour is never the only carrier

Cyan means ready, mint means it clears, `BAD` means blocked or empty, dimmed means not in this
scene — and every one of those is *also* written in text ("running", "this will start", "Voice is
still empty", "not in this scene"). This is an accessibility requirement and a tone requirement:
the prose is the design, the colour is reinforcement.

A corollary that has already gone wrong once: **never put `opacity` on a wrapper that also holds
the state text.** Ghost the art element, at 42% with `grayscale(1) brightness(.62)`; leave the name
and the status line at full strength.

### Rule 5 — There is one accent, and worlds are not colour-coded

`world_accent()` is gone. Deriving a hue per world from a hash of its name gave six unrelated
palettes, made every screen a different colour, and meant "ready" and "this world happens to be
indigo" were spelled the same way. One cyan carries the primary action, the one thing that is
ready, and the active tab underline. A world's identity comes from its artwork.

A character may still have a colour — but only as the radial glow behind *their own* art, never as
UI state, never on text.

---

## 3. Tokens

Do not introduce new colours. If you need a hue the palette lacks, you are probably encoding
something that should be prose.

```python
BG        = "#0F1315"   # the single floor colour — every screen sits directly on it
BG2       = "#161C1F"   # rare recessed areas only; never a panel background
TEXT_1    = "#E4EEF1"
TEXT_DIM  = "#AEBBC0"   # body copy that is not the headline
MUTED     = "#98A7AD"   # secondary text actions
MUTED_2   = "#85949A"   # eyebrows, labels, and any caption carrying a fact — the contrast floor
FAINT     = "#66757B"   # decorative only, and in practice only the mono art placeholders
ACCENT    = "#79CDD4"   # pale cyan — the one action / attention / ready colour
ACCENT_2  = "#9D9FD6"   # a second, quieter thread; use sparingly or not at all
GOOD      = "#7CC7A4"   # clears, gains, connected
BAD       = "#CC7A6B"   # empty, blocked, destructive
LINE      = ft.Colors.with_opacity(0.14, "#E4EEF1")   # only ever used through a fade
LINE_INPUT= ft.Colors.with_opacity(0.18, "#E4EEF1")   # the rule under an input
```

**Contrast floor.** `MUTED_2` on `BG` is ≈5.9:1 and is the darkest colour allowed to carry real
information. `FAINT` is ≈3.9:1 and is decorative: the `NO PORTRAIT` / `NO ART` mono captions, and
nothing else. If you are about to set a character's role, a message count, a field label or a
field's value in `FAINT`, use `MUTED_2`.

**Cyan discipline.** Per screen, cyan may appear on: the primary action, the one thing that is
ready, and the active tab underline. If a third unrelated element wants cyan, one of them is not
actually important.

**Character colours** live in content, not in the palette — a cool hue per character
(`Lirael #5F93AB`, `Morgana #7A5FA8`, …), used for the radial behind that character's art and
nothing else.

### Type

Two families, **vendored in `assets/fonts/`**. The app must render with no network access, so
never add a web font link.

| Family | Role |
| --- | --- |
| **Newsreader** 300–400 (+ italic) | Headlines, character/world/scene names, section titles, and **every number the writer reads as a quantity** |
| **IBM Plex Sans** 300–600 | Everything else — eyebrows, body, rows, actions, captions |

The serif/sans split *is* the information architecture: serif = the thing itself and its magnitude,
sans = the apparatus around it. A message count in IBM Plex Sans is a bug. Cinzel and Manrope are
retired; delete them from `assets/fonts/` once no module references them.

| Token | Size / weight | Where |
| --- | --- | --- |
| `display_xl` | 88–96 / serif 300, lh .98 | The subject's own name on a screen about one subject (a world, a character) |
| `display_l` | 88–92 / serif 300, lh .9 | The single hero numeral |
| `display_m` | 52–62 / serif 300, lh 1.06 | Screen headline — a reactive sentence |
| `display_s` | 34–40 / serif 300 | The speaker's name in visual-novel mode; a primary text action |
| `title` | 21–23 / serif 400 | A session title, a character name in a shelf, a world in a list |
| `numeral` | 19–46 / serif 300, tabular | Any quantity that is not the hero |
| `eyebrow` | 11 / sans 500, `.16em` tracking, uppercase, `MUTED_2` | The label above every block |
| `body` | 15 / lh 1.6, `TEXT_DIM` | Explanatory prose |
| `ui` | 13.5–14.5 / sans 400–600 | Rows, text actions, filters |
| `caption` | 11.5–12.5 / `MUTED_2` | Sub-labels, counts, status |
| `mono` | 9.5–11 / monospace, `FAINT` | Art-placeholder captions only |

`display_*` sizes must be multiplied by the settings text scale, and any headline must **wrap, not
clip,** at scale 1.4.

### Spacing

Screen gutter **52px**. Between blocks **30–46px**. Eyebrow → its content **10–22px**. Row padding
**9–14px** vertical, **0** horizontal — a row is not inset, because a row is not a card. Shelf gaps
**24–26px**. Column gutters **70–90px**.

Rhythm over grid: block spacing is regular, but *within* a shelf let sizes be uneven (alternate
portrait tiles by ±14px vertically). Perfect alignment reads as a form.

---

## 4. How to compose a new screen

Follow this order. It is the order the existing screens were built in, and it is why they cohere.

**Step 1 — Name the one thing the screen is for,** in one sentence, in the writer's language.
*Home* is "which world am I stepping back into?" *Chat* is "the room the conversation is in."
*Scene setup* is "will this start?" *Memory* is "what does she carry into every scene?" If you
cannot write that sentence, it is two screens.

**Step 2 — Find the art.** Which asset shape carries this screen? World cover 16:9, session
backdrop 16:9, character portrait 3:4, character tile 16:9. Place it first, large, bleeding off at
least one edge, masked. If the screen genuinely has no art (Settings), it is carried by the
headline and generous whitespace — do not invent decoration to fill it.

**Step 3 — Write the headline as a reactive sentence.** Not a noun ("Worlds") but the state ("Eden
Castle is still mid-scene."). Generated from the database, with an authored fallback for the empty
case ("Nothing started yet — pick a world and it will wait for you there."). Sentence case, full
stop.

**Step 4 — Choose the one hero numeral** and set it at `display_l`. A message count, a memory
count, a threshold. Everything else numeric drops to `numeral` or `caption`. A screen may have
none — the conversation is its own hero on the chat screen.

**Step 5 — Reduce the rest to two or three threads,** each an eyebrow plus a few lines, separated
by fading rules. Three is comfortable; four is a warning; five means something belongs behind
disclosure or on its own screen.

**Step 6 — Push the tables behind `⌄` disclosure** at the bottom of the frame, as label/value rows
with fading rules.

**Step 7 — Place exactly one pulse** on the one thing that is ready or blocking. Then stop.

---

## 5. The pattern library

Reuse these before inventing. Everything here lives in `app/ui/theme.py`; a new screen should read
as a recombination of it.

**Eyebrow block.** `th.eyebrow("WHERE YOU LEFT OFF")`, a 10–22px gap, the content, then
`th.rule(0.62)`. The universal unit of the app. It replaces every old `panel()` and
`section_header()`.

**Fading rule.**

```python
def rule(end: float = 0.74) -> ft.Container:
    return ft.Container(
        height=1,
        gradient=ft.LinearGradient(
            begin=ft.alignment.center_left,
            end=ft.alignment.center_right,
            colors=[ft.Colors.TRANSPARENT, LINE, LINE, ft.Colors.TRANSPARENT],
            stops=[0.0, 0.06, end, 1.0],
        ),
    )
```

**Masked art.** `ft.ShaderMask` with `BlendMode.DST_IN` and a `RadialGradient` whose last stop
lands inside the box (Rule 3):

```python
ft.ShaderMask(
    ft.Image(src=path, fit=ft.ImageFit.COVER, alignment=ft.alignment.Alignment(0, -0.8)),
    blend_mode=ft.BlendMode.DST_IN,
    shader=ft.RadialGradient(
        center=ft.alignment.Alignment(0, -0.16),
        radius=0.5,
        colors=[ft.Colors.BLACK, ft.Colors.BLACK, ft.Colors.TRANSPARENT],
        stops=[0.0, 0.26, 0.72],
    ),
)
```

**Portrait.** A `Stack` of three layers and no fourth: the character's radial glow behind, the
masked art, and — only over the plain floor — a floor-matched radial fade. No ring, no frame, no
radius, no card. Ready pulses the **glow layer**, never an outline. Not-yet-written is the same
tile at 42% with `grayscale(1) brightness(.62)`, glow off, and the reason written underneath at
full strength. No portrait yet is a 45° hatch at the same aspect ratio with a mono caption.

**Scrim.** Full-bleed backdrop art always carries a top-down scrim to `BG` and, where text sits
beside the art, a side scrim across the **whole frame** — a scrim that covers only part of the
width is a rectangle.

**Hero numeral + fading bar.** A serif numeral, an adjacent `GOOD`/`BAD` delta ("+12 since
Tuesday"), and beneath it a 2px bar whose fill fades out past the filled portion — the track is
never a closed rectangle. Bars animate from their previous value on change (600ms,
`AnimationCurve.EASE_OUT_CUBIC`), because progression feedback is the point.

**Verdict line.** A comparison resolved into one warm sentence with the numbers and states inline
and coloured: *"Two characters and a premise — this will start. The scene is created when you
begin it."* Guarantees the writer cares about are stated explicitly.

**Text actions.** Primary = serif `display_s`, `ACCENT`, sitting on a rule that gradients from
transparent to cyan; the cost or context beneath in `caption`. Secondary = plain `ui` text in
`MUTED`. Destructive = `BAD`. Disabled = `FAINT` with no rule. Never a `Container` with `bgcolor`,
`border` and `border_radius`.

**Text tabs.** Filters, world tabs, modes and display switches are plain text runs. The selected
one is `TEXT_1` weight 600 with a short cyan rule under it that fades right — build it as a tight
`Column([text, rule])` so the underline belongs to the element and cannot desynchronise from it.
When one row carries two independent switches, only one underline may be cyan; the other is
neutral `LINE`.

**Underlined input.** `TextField(border=InputBorder.NONE, filled=False, bgcolor="transparent",
content_padding=only vertical)` in a tight `Column` over a 1px `Container`; on focus that container
becomes `ACCENT`, on blur `LINE_INPUT`. Multiline fields auto-grow. Never a plate, never a radius.

**Selects.** `ft.Dropdown` cannot be de-Materialised; use an underlined text row that opens a
`PopupMenuButton`, and style the menu as an *Overlay*.

**Dot path.** Any sequence — the eight profile sections, publish gates, review steps — is drawn as
dots on a single fading hairline rather than listed as rows or stacked as an accordion: written =
12px solid at 50%, current = cyan radial with a pulsing glow, empty = 10px hollow ring in `BAD` at
20%. Names beneath in serif, status beneath that in `caption`. **Prefer this to any list of steps,
checklist, or expander stack.** On the character editor it is both the navigation and the
completeness meter, which is why the accordion is gone.

**Ghost preview.** A character with no profile, or one not selected for a scene, renders their real
art at 42% — the ghost of themselves — not a placeholder icon. Full strength when chosen.

**Disclosure.** `Session notes, not sent to the model ⌄` — a `ui` text row at the bottom of the
frame that expands label/value rows separated by fading rules. Never a table.

**Overlay.** Confirmations, the lore editor, the sprite editor, the memory-suggestion review: a
full-frame `page.overlay` container filled with `BG` at 52px gutter, an eyebrow, a serif headline,
the fields as underlined inputs, and text actions at the bottom. `ft.AlertDialog` with a
`RoundedRectangleBorder` is a box and is not used.

**Pulse.** Flet has no keyframes. One helper owns it, so scarcity is enforced by there being one
call site per screen:

```python
async def pulse(control: ft.Control, lo=0.35, hi=0.9, half=1.4):
    control.animate_opacity = ft.Animation(int(half * 1000), ft.AnimationCurve.EASE_IN_OUT)
    while control.page:
        for value in (hi, lo):
            control.opacity = value
            control.update()
            await asyncio.sleep(half)
```

Started with `page.run_task`, and skipped entirely when the reduce-motion setting is on.

---

## 6. Motion

Two behaviours carry the whole app. Do not add a third without a reason you can state in one line.

- **Pulse** (2.4–4s) marks **exactly one thing per screen**: what is ready, or what is blocking.
  Never two kinds of pulse in view. That scarcity is what makes it mean something.
- **Drift** (7–9s, ±6px vertical) is for large art only.
- **Bars animate on change**, 600ms `EASE_OUT_CUBIC`, previous fill → new fill.
- **Route changes** crossfade ~180ms. Re-rendering the *same* route does not transition. The
  existing `AnimatedSwitcher` in `screen()` is the right mechanism; keep it.
- **Hover** raises text `MUTED → TEXT_1` and lifts art 2px, ~160ms. Nothing changes colour at its
  border, because nothing has a border. The old `hoverable()` lift-and-glow-and-brighten-the-card
  is retired.
- **Streaming** shows the pulsing dot plus the word "answering" beside the speaker's name, and a
  block cursor at the end of the text. No progress ring.
- **Reduce motion** must kill all of the above; verify it catches anything new you add.

---

## 7. Voice

The copy is half the design. A screen written in the old app's voice will look wrong even with
perfect layout.

- **Sentence case, full stops.** "Nine met, four scenes running." not "9 Characters / 4 Sessions".
- **Spell small numbers in prose, set large ones as numerals.** *"Eleven messages now fall outside
  the history window."*
- **Say what happens next, not what a thing is.** "Return to the archive →", "Begin the scene →",
  "Open the lorebook →" — a verb and a destination. Never "Save" alone, never "New World" as a
  title-cased button.
- **Warm, never cute.** No exclamation marks, no jokes, no second-person scolding. *"Nothing has
  moved since."* is the register.
- **State guarantees plainly.** "Nothing is written to the database until the first message."
  "Private notes — never sent in scene prompts." Removing anxiety is a feature, and in an app that
  silently truncates history it is the feature.
- **Names of things are proper nouns** and get the serif: Eden Castle, the archive, Lirael.
- **Empty states are written, not diagrammed.** Every generated headline needs an authored
  fallback.
- **No emoji, and no icons standing in for words.** The old square icon buttons carried meaning
  only through a tooltip; a text action carries it in the open.

---

## 8. Screens as precedent

When building something new, find the closest screen and inherit its shape.

| If the new screen is… | Follow | Because |
| --- | --- | --- |
| A hub / "where was I" surface | **Home** | Backdrop art + one generated hook + a resume thread and a list thread |
| About one subject | **World** | Art bleeding off a corner, `display_xl` name, text tabs, three threads |
| A browse-many surface | **World → Characters** | Reachable responsive grid of transparent 16:9 tiles |
| The conversation itself | **Chat, rolling** | Typeset dialogue — speaker in serif, prose beneath, user turns indented against a vertical rule that fades at both ends. No bubbles, no avatars, no nameplate |
| The conversation as a scene | **Chat, visual novel** | Full-bleed backdrop, art bleeding off the bottom, and the scrim *is* the dialog box — which is why the four dialog-box themes are gone |
| A long authoring form | **Character editor** | Dot path as both section switcher and completeness meter; underlined inputs; art bleeding off the left. Never an accordion |
| A go/no-go decision | **Scene setup** | The comparison is the screen: cast as ghostable portraits, a verdict sentence, cost and guarantee under the action |
| A collection of facts | **Memory** | Hero count, threads per memory type, review queue as the one pulsing thing |
| A settings surface | **Settings** | No art: carried by a reactive headline about the connection, underlined inputs, numerals with fading bars |
| A dense list the writer scans | **Notes browser** | The one place per-row rules are permitted (Rule 1's second exception) |
| Anything modal | **Overlay** | A dialog is a screen, not a card |

**Not yet designed:** the notes AI workspace and the persona screens. Apply §1–§7 by analogy —
eyebrows, fading rules, serif quantities, no boxes — and **ask before inventing a new layout
archetype for them.**

---

## 9. Constraints that outlive the design

- **Nothing below `app/ui/` changes for visual work.** `repository.py`, `models.py`,
  `prompt_builder.py`, `database.py`, `providers/` and `services/` stay as they are. Everything a
  screen shows already exists: `list_worlds()`, `list_characters()`, `count_messages()`,
  `list_memories()`, `ChatService.stream_reply()`, `prompt_builder`'s section list. If a screen
  seems to need new data, first check whether a repository function already returns it.
- **One new read is expected and allowed:** the screens now state how much history is actually
  sent, so they need the history-window setting alongside `count_messages()`. Read it; do not
  change how the prompt is built.
- **Every `tooltip`, `aria`-equivalent, keyboard shortcut (`Ctrl+K`), `Escape` handler and focus
  behaviour survives a restyle.** Retiring an icon button means moving its tooltip text into the
  visible label, not dropping it.
- **Fonts are vendored and offline.** Newsreader and IBM Plex Sans live in `assets/fonts/` and are
  registered in `theme.FONTS`. No network calls, ever.
- **Layout is ratios, not absolutes.** The window resizes; express the 1440×900 composition as
  rows, columns and `expand` with the stated gutters, and let the content column grow. The only
  hard numbers are gutters, portrait box sizes and rule thicknesses.
- **Art is placeholder until commissioned.** Build the element at the stated aspect ratio and make
  the no-art fallback deliberate: a masked 45° hatch with a mono caption, never a broken image.
- **The session-background slot currently holds logotypes.** Every file under
  `assets/worlds/*/session_backgrounds/` is a wordmark, not a room, which is why chat backdrops
  read as branding. Until real scene art exists, crop the world cover past its baked-in lettering.
  Do not design around the logo.

---

## 10. Pre-flight checklist

Run this against any new or changed screen before calling it done.

**Structure**
- [ ] No `bgcolor` panel, no `border`, no `border_radius` on any content container.
- [ ] Every hairline fades at at least one end, and consecutive rules end at different verticals.
- [ ] Transparent character art preserves alpha; opaque backdrops use masks whose radial reaches
      its final stop inside its own box. Check the corners for a rectangle.
- [ ] At least one piece of art bleeds off a frame edge.
- [ ] Every block is introduced by an 11px uppercase eyebrow.
- [ ] Three or fewer threads below the headline; the rest is behind `⌄` or on another screen.
- [ ] The screen remains fully reachable at 960×640 and its primary action stays available.

**Type & colour**
- [ ] Every quantity is in Newsreader; nothing numeric is in IBM Plex Sans.
- [ ] At most one hero numeral.
- [ ] Cyan appears on at most: the primary action, the one ready thing, the active tab underline.
- [ ] No colour outside §3. No per-world accent.
- [ ] Nothing carrying a fact is in `FAINT`; labels and captions are `MUTED_2` or better.
- [ ] The headline wraps, not clips, at text scale 1.4.

**Voice**
- [ ] The headline is a reactive sentence in sentence case, generated from the database, with an
      authored empty-state fallback.
- [ ] Every state shown in colour or dimming is also written in words, at full strength.
- [ ] Actions are verb + destination.
- [ ] The screen says what the model will actually remember, if it touches a scene.

**Motion**
- [ ] Exactly one pulsing element, and it is the thing that is ready or blocking.
- [ ] Any bar that can change animates from its previous value.
- [ ] Reduce motion kills every animation added here.

**Correctness**
- [ ] No changes outside `app/ui/` (plus `assets/fonts/`).
- [ ] Every pre-existing tooltip, shortcut and focus behaviour survived.
- [ ] Resizes cleanly — no fixed pixel widths outside the stated gutters and art boxes.

---

## Appendix — the one-paragraph brief

*Paste this at the top of a task when you only have room for one paragraph:*

> Character Chat's UI has no boxes. Screens sit directly on `#0F1315`; art bleeds off the frame
> under a radial shader mask; groups are introduced by an 11px uppercase `#85949A` eyebrow and
> separated by hairlines that fade before the ends. Newsreader carries headlines, names and every
> quantity; IBM Plex Sans carries everything else. One pale cyan `#79CDD4` marks the primary action
> and the single thing that is ready — which is also the only pulsing element on the screen. There
> are no per-world accents, no bubbles, no pills, no square icon buttons and no accordions: the
> conversation is typeset dialogue, actions are text on a gradient rule, and the character profile
> is a dot path. Headlines are reactive sentences generated from the database ("Eden Castle is
> still mid-scene."), every state is written in words as well as colour, and the screen always says
> how much history the model is actually being sent. Screen gutter 52px, 30–46px between blocks,
> content remains reachable at supported window sizes, no changes below `app/ui/`.
