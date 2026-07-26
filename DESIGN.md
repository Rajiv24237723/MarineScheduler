---
name: Marine Scheduler
description: A data-dense operations control-tower for coastal oil, gas and LNG marine logistics, drawn like an admiralty sea chart.
colors:
  background: "hsl(210 73% 13%)"
  foreground: "hsl(205 22% 93%)"
  card: "hsl(210 70% 16%)"
  popover: "hsl(210 68% 15%)"
  primary: "hsl(188 51% 53%)"
  primary-foreground: "hsl(200 68% 10%)"
  secondary: "hsl(208 44% 22%)"
  secondary-foreground: "hsl(205 22% 95%)"
  muted: "hsl(209 42% 20%)"
  muted-foreground: "hsl(205 22% 68%)"
  accent: "hsl(208 44% 23%)"
  destructive: "hsl(7 72% 62%)"
  border: "hsl(208 55% 25%)"
  ring: "hsl(188 62% 55%)"
  ok: "#35b08f"
  warn: "#e0b24a"
  bad: "#e26a5a"
  sea-cyan: "#49b4c4"
  sea-teal: "#2f9fb0"
  sea-green: "#35b08f"
  sea-amber: "#e0b24a"
  sea-red: "#e26a5a"
  sea-sand: "#d8c4a0"
  sea-line: "#123a5c"
typography:
  display:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "0"
    fontFeature: "tabular-nums"
  title:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.5625rem"
    fontWeight: 600
    letterSpacing: "0.16em"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    fontFeature: "tabular-nums"
rounded:
  chip: "3px"
  md: "6px"
spacing:
  hairline: "1px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "24px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  kpi-plate:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    padding: "12px 14px"
---

# Design System: Marine Scheduler

## Overview

**Creative North Star: "The Admiralty Sea Chart"**

Marine Scheduler reads like a modern bathymetric chart rendered on a screen: a deep-ocean field, hairline graticule lines dividing every readout, and a single cyan depth-contour accent that carries all action. Everything sits on one continuous dark ground (`hsl(210 73% 13%)`) with panels raised by a half-step of lightness rather than by shadow. The mood is calm, dense, and instrument-like — a planner should feel they are reading soundings off a chart, not clicking through a generic admin dashboard. Numbers are the subject; the chrome recedes.

This is the "Bathymetric Blue" world. It fully replaced an earlier "Signal Code" system built on nautical signal flags; the flag metaphor is gone, though the primitive components still carry their old export names (`StreamFlag`, `Pennant`, `CodeBlock`) to stay drop-in. Where a filename or class says "flag" or "signal", read "sounding chip" and "chart tick" — the shipped visuals are chart marks, not flags.

The system is desktop-first and unapologetically data-dense, which the product demands: marine planners read KPIs, exception queues and vessel Gantts side by side for a rolling month across three isolated streams. Legibility at density is the governing constraint (WCAG AA), so contrast is engineered, not decorative — the cyan action color clears ~6.94:1 on its dark foreground.

**Key Characteristics:**
- One deep-ocean ground; panels lift by tonal step, never by heavy shadow.
- A single cyan accent for every action and active state.
- Serif (Newsreader) for titles and hero numbers; the numbers read as chart soundings.
- Hairline borders function as chart graticule; KPI strips are one panel split by `gap-px`.
- Status color routes only through a muted sea palette (ok / warn / bad), never raw Tailwind hues.

## Colors

A cool, desaturated blue field with one cyan accent and a muted three-state chart palette; warm sand appears only inside data marks.

### Primary
- **Depth-Contour Cyan** (`hsl(188 51% 53%)`, raw `#49b4c4`): the sole accent. Every action button (`bg-primary` + dark `text-primary-foreground`), every active nav item (`bg-cyan-500/10` + cyan text/icon), the focus-visible ring, text selection, the top progress bar, inline plan-version numbers, and info toasts. It is the only color allowed to mean "act here" or "you are here." Its dark companion **Contour Ink** (`hsl(200 68% 10%)`) is the text that rides on top of it.

### Neutral
- **Deep-Ocean Ground** (`hsl(210 73% 13%)`): the single app background under every screen.
- **Chart Panel** (`hsl(210 70% 16%)`): cards, headers, KPI plates, modals — one tonal step above the ground. Usually applied at partial alpha (`bg-card/50`–`/80`) so the ground shows through.
- **Muted / Accent Surface** (`hsl(209 42% 20%)` / `hsl(208 44% 23%)`): secondary buttons, hover fills, selected switches.
- **Chart Foreground** (`hsl(205 22% 93%)`): primary text; **Muted Foreground** (`hsl(205 22% 68%)`) for labels and secondary text.
- **Graticule Border** (`hsl(208 55% 25%)`): every hairline divider, card edge, and internal KPI-plate seam. Border and input share this value.

### Tertiary — Sea-Chart Data Palette
Raw hex, used only inside data marks (Gantt bars, stop dots, stream chips, legend squares) — never for chrome.
- **Sea Cyan** (`#49b4c4`): POL stream identity; the accent's raw form.
- **Sea Green** (`#35b08f`): CRUDE stream; DISCHARGE stop markers; identical to the `ok` state.
- **Sea Amber** (`#e0b24a`): LNG stream; identical to the `warn` state.
- **Sea Sand** (`#d8c4a0`): LOAD stop markers on the voyage Gantt — the only warm color in the system, reserved for this one mark.
- **Sea Red** (`#e26a5a`): critical marks; identical to the `bad` state.
- **Sea Teal / Sea Line** (`#2f9fb0` / `#123a5c`): secondary chart strokes and axis lines.

### Status
- **OK** (`#35b08f`), **Warn** (`#e0b24a`), **Bad** (`#e26a5a`): the only channel for status meaning, exposed as `text-ok` / `bg-warn/10` / `border-bad/25` utilities. **Coral** (`hsl(7 72% 62%)`, `--destructive`) is the same red family for destructive-action and alert-badge chrome.

### Named Rules
**The One Contour Rule.** Cyan is the only accent. If a control needs to signal "primary action" or "active," it uses cyan; nothing else in the system is allowed to. Secondary actions stay neutral (`bg-muted`).

**The Muted-Sea Rule.** Status meaning routes only through `ok` / `warn` / `bad` (and `destructive` for alert chrome). Never reach for raw Tailwind `emerald`, `red`, `amber`, or `green`. The palette is deliberately desaturated to read as chart states, not traffic lights.

## Typography

**Display Font:** Newsreader (with Georgia, "Times New Roman", serif)
**Body Font:** Inter (with ui-sans-serif, system-ui)
**Label/Mono Font:** JetBrains Mono (with ui-monospace) for inline figures

**Character:** A serif-for-meaning, sans-for-machinery pairing. Newsreader gives titles and the large KPI numbers a chart-cartouche gravity; Inter runs the dense UI; JetBrains Mono keeps tabular figures aligned. The serif hero numbers are the signature move — a KPI reads like a sounding printed on a chart.

### Hierarchy
- **Display** (Newsreader 500, ~1.5rem/`text-2xl`, tabular-nums): hero KPI "sounding" numbers on plate strips and the plan-signal band. `h1`–`h4` are Newsreader 500 by base rule.
- **Page Title** (Newsreader 500, ~1.5rem/`text-2xl`): the serif page heading in the sub-header and view titles.
- **Card Title** (Newsreader 500, sentence case, `leading-none`): every `CardTitle`. Sentence case, never Title Case.
- **Body** (Inter 400, 0.875rem/`text-sm`, line-height 1.5): default UI text, table cells, descriptions.
- **Inline Figure** (JetBrains Mono 500, tabular-nums): vessel names, version numbers, shadow prices, readout values — anything that should align in a column.
- **Micro-Label** (Inter 600, ~9–10px, uppercase, letter-spacing 0.16–0.18em): KPI plate labels, nav group headers, readout captions, stream label. Exposed via the `.font-cond` hook (a legacy class name now defined as letter-spaced sans).

### Named Rules
**The Sounding-Number Rule.** Big numbers are serif (Newsreader) and tabular; small figures inline in text are mono (JetBrains). A KPI value is never set in Inter.

**The Sentence-Case Rule.** Titles and labels are sentence case; only the micro-label tier is uppercase (and only via letter-spacing, never bold caps at reading size).

## Layout

A fixed full-height shell: a 256px (`w-64`) left sidebar and a fluid main column, both `h-screen`, no page scroll — panels scroll internally. The sidebar holds a 64px (`h-16`) serif wordmark row with a stream sounding chip, a three-up stream switcher (CRUDE / LNG / POL), and grouped navigation (My Work, Planning, Execution, Inventory, Data & Administration) with letter-spaced group labels.

The main column stacks two header rows — a 64px (`h-16`) global context header carrying operating-plan readouts plus the primary CTA top-right, then a 56px (`h-14`) sub-header with the serif page title — over a scrolling `p-8` content area. A faint cyan radial gradient (`from-primary/[0.07]`) washes the top 300px for depth. Content enters with `animate-fade-in-up` on tab change.

Spacing rhythm is tight: cards pad at 24px (`p-6`), panel headers at 10–16px, KPI plates at 12–14px. Grids collapse responsively (KPI strips `grid-cols-3 lg:grid-cols-6`, dashboard body `xl:grid-cols-5`). Density is the point; whitespace is rationed.

## Elevation & Depth

Depth is tonal, not cast. Surfaces lift by stepping lightness (ground 13% → card 16%) and by hairline borders, not by drop shadows. The only shadows in the system are functional overlays: modals (`shadow-2xl`) and toasts (`shadow-xl`) float above the plane, and headers carry a barely-there `shadow-sm`. Backdrop blur (`backdrop-blur-md`) on the sidebar and headers reinforces the layered-glass feel over the gradient wash.

### Named Rules
**The Tonal-Lift Rule.** A panel is distinguished from its background by a lightness step and a hairline border, not by a shadow. Reserve `box-shadow` for true overlays (modal, toast) that leave the document plane.

## Shapes

One radius governs almost everything: 6px (`--radius: 0.375rem`, `rounded-md`) on cards, buttons, inputs, plates, chips, and modals. The only tighter corner is the stream sounding chip and legend squares at 2–3px, which read as small chart marks. Borders are always hairline (1px) at partial alpha (`border-border/60`–`/80`) so they behave as chart graticule rather than hard frames. Full-round (`rounded-full`) appears only on the alert badge, the loading spinner, and Gantt stop dots.

### Named Rules
**The Graticule Rule.** Borders are 1px chart rulings, not containers. KPI plate strips are a single panel divided by `gap-px` over a `bg-border/40` seam — the plates are cells of one instrument, not floating cards.

## Components

### Buttons
- **Shape:** 6px corners (`rounded-md`).
- **Primary:** cyan fill with dark ink (`bg-primary` + `text-primary-foreground`), padding ~8px 16px (`px-4 py-2`), `text-xs`/`text-sm` medium. Hover dims to `bg-primary/90`; disabled drops to `opacity-50`. The only cyan-filled control on screen.
- **Secondary:** neutral fill (`bg-muted` → hover `bg-accent`) with a hairline border, foreground text. Used for "Versions", modal secondary actions.
- **Active press:** global rule nudges every button `translateY(0.5px) scale(0.994)` on `:active`; `.lift` opts a surface into a `-1px` hover raise.

### Chips / Pills
- **Achievability pill:** rounded-md, tinted status wash with matching border and a Pennant tick — `bg-ok/10 text-ok border-ok/25` or `bg-bad/10 text-bad border-bad/25`, uppercase micro-label type.
- **Stream sounding chip (`StreamFlag`):** a ~1.35:1 plate at 3px radius carrying the stream initial (P/C/L) in its own stream color, over a 12%-tint fill with a 1px same-color border, mono type. Identity mark, not a button.

### Cards / Containers
- **Corner:** 6px (`rounded-md`), `overflow-hidden`, `relative`.
- **Background:** `bg-card/50` over the ground; headers deepen to `bg-card/70`–`/80`.
- **Border:** single hairline `border-border/80`.
- **Shadow:** none at rest (see Elevation).
- **Padding:** 24px header/content (`p-6`); compact panels use `px-4 py-2.5` headers.
- **Title:** Newsreader 500, sentence case.

### Inputs / Fields
- **Style:** `bg-background/50` (or `bg-card/50`), 1px `border-border/80`, `rounded-md`, ~6px 12px padding, mono for numeric/CSV fields.
- **Focus:** hairline shifts to `focus:border-cyan-500/50`; the global `:focus-visible` paints a 2px cyan ring at `rgb(73 180 196 / 0.8)` with 2px offset.
- **Range inputs:** `accent-cyan-500`.

### Navigation
- **Style:** grouped, letter-spaced uppercase group labels; items are left-aligned icon + label rows, `rounded-md`, `text-sm` medium.
- **States:** default muted foreground; hover `bg-muted` + brighter text; active `bg-cyan-500/10` with `text-cyan-300` and a `text-cyan-400` icon. Active state is the only cyan in the rail.

### KPI Plate Strip (signature)
A single bordered panel split into 3–6 cells by `gap-px` over a `bg-border/40` seam. Each cell: uppercase micro-label (optionally prefixed by a `CodeBlock` legend square colored by status), then a Newsreader `text-2xl` tabular number. This is the flagship "sounding plate" pattern — read the strip as one instrument, not a row of cards.

### Chart Marks (signature)
- **Pennant:** a small triangular SVG chart tick colored by urgency (`critical` red / `warn` amber / `ok` green / `info` cyan). Flags exceptions and achievability.
- **Voyage Gantt:** a translucent product-colored bar (product keeps its own data color) with round stop dots — **LOAD = sea sand** (`#d8c4a0`), **DISCHARGE = sea green** (`#35b08f`) — over a dashed weekly graticule axis.
- **CodeBlock:** a 2px legend square used to key a KPI plate to its status color.

### Modals & Toasts
- **Modal:** centered, `rounded-md`, `bg-card`, hairline border, `shadow-2xl`, `animate-scale-in`; dark blurred scrim (`bg-black/60 backdrop-blur-sm`); sticky serif-ish header with an X close.
- **Toast:** bottom-right, `rounded-md`, `bg-card/95 backdrop-blur`, `shadow-xl`, `animate-toast-in`, status-tinted border and icon (`ok` / `bad` / cyan info).

## Do's and Don'ts

### Do:
- **Do** carry every action and active state on cyan (`hsl(188 51% 53%)`); primary buttons are `bg-primary` + `text-primary-foreground`.
- **Do** set hero KPI numbers and titles in Newsreader serif with tabular figures, and inline figures in JetBrains Mono.
- **Do** build KPI strips as one bordered panel divided by `gap-px`, not as separate floating cards.
- **Do** route all status through `ok` / `warn` / `bad` utilities and flag severity with a `Pennant`.
- **Do** keep corners at 6px (`rounded-md`) and borders hairline; lift panels by tonal step, not shadow.
- **Do** use sentence case for titles and reserve uppercase for the letter-spaced micro-label tier.

### Don't:
- **Don't** introduce a second accent color for actions; if it acts, it is cyan.
- **Don't** use raw Tailwind `emerald` / `red` / `amber` / `green` for status — use the muted sea palette.
- **Don't** put drop shadows on resting surfaces; shadows belong only to overlays (modal, toast).
- **Don't** set a KPI value in Inter, or a body label in serif.
- **Don't** revive the retired Signal Code flag metaphor; the marks are chart soundings and ticks now, despite the legacy `SignalFlag` filename and exports.
- **Don't** spend sea sand (`#d8c4a0`) anywhere but the LOAD stop marker — it is the system's only warm note.
