# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: **marine planners / chartering-and-scheduling teams** at coastal oil-and-gas operators (Indian oil companies — IOCL/HPCL/BPCL for crude and refined products; Petronet/GAIL for LNG). They sit at a desk or in an operations room and decide, for a rolling month, which vessels move which cargoes between refineries, terminals and import sources so nothing runs dry.

Secondary (because this is presented as a client-facing product): **operations leaders and executives** evaluating the tool — they must trust it as real operational software and be impressed by it in a boardroom.

## Product Purpose

Plan and continuously **re-plan** coastal marine movements of crude, LNG and refined products so every demand node stays supplied with **no stock-outs**, at minimum total cost, and recommend contracting **spot voyage-charters** for specific movements when the owned/TC fleet is the binding constraint. It turns a monthly lifting/movement plan into an executable, versioned schedule and absorbs disruptions with minimal-change recovery.

## Positioning

Not a static scheduler or a spreadsheet. Two coupled optimisation problems — annual **charter mix** (Time vs Voyage) and the operational **Maritime Inventory Routing Problem** — solved with **hard feasibility** (delivery and no-stockout are hard constraints, surfaced as an explicit "achievable / shortfall + binding cause" verdict, never a silent under-delivery), and **true per-voyage minimal-edit dynamic replanning** (destroy only the voyages a disruption invalidates, repair the rest). It shows *why* a plan is or isn't achievable and *exactly* what a recovery changes.

## Operating Context

Monthly planning horizon (Jul–Aug demo). Three **isolated streams** (Crude / LNG / POL), each with its own network, fleet and plan. Real maritime constraints modelled: segregated tankers (clean "white oil" vs dedicated "black oil" for FO — never mixed), compartment/product compatibility including the jet (ATF) last-3-cargoes rule, berth/draft limits, laden/ballast legs. Plans are **versioned** (draft → active → superseded) with compare and rollback. Planners run "what-if" **disruption scenarios** (revised demand, sudden spot cargo, port/berth closure, vessel off-hire) and publish a recovery. Multi-pickup / multi-drop voyages with a per-compartment cargo manifest.

## Capabilities and Constraints

- Stack: React 19 + Tailwind v4 (shadcn HSL tokens) frontend; Express + better-sqlite3; a deterministic **heuristic optimiser** (greedy + seeded multi-start) with **HiGHS-WASM** for LP-dual shadow prices; all-TypeScript, runs from `npm run dev`, deploys via Google AI Studio from GitHub.
- Screens: Command Center (KPIs, exception queue, recommended decisions), Operational Plan (vessel-voyage Gantt + achievability, charter recs, binding constraints), Live Fleet / AIS map, Replanning Workbench (scenario compose → draft → publish/rollback), Tank Farm (per-tank gauges), Network Forecast (inventory projection), Master Data (editable tables + CSV import), Settings.
- The engine is heuristic (not provably optimal) and deterministic for a seed.

## Brand Commitments

Own identity — no mandated brand system. Product name: **Marine Scheduler**. Free rein on screen structure and information architecture; the underlying data model, optimiser and workflows must be preserved.

## Evidence on Hand

All network, fleet, demand and plan data is **illustrative/synthetic** (a plausible Indian coastal network seeded in `src/db/seed.ts`), structurally grounded but **not real operational data**. Future work must not present it as a real operator's live data, and must not fabricate real customers, contracts, prices or benchmarks.

## Product Principles

1. **Feasibility is non-negotiable.** Never a silent stock-out or under-delivery; always an explicit achievable/shortfall verdict with the binding cause.
2. **Every recommendation is specific and actionable** — a charter names the vessel class, cargo, route and deadline; a recovery names exactly which voyages change.
3. **The plan is a living thing** — versioned, comparable, and continuously re-plannable with minimal disruption, not a one-shot output.
4. **Trustworthy to operators, compelling to executives** — the same screen must read as rigorous marine operations software and impress in a demo.
5. **Domain truth over generic dashboard** — vessels, compartments, tanks, berths and cargo rules are modelled honestly; the interface should speak the language of marine operations.

## Accessibility & Inclusion

Web, desktop-first (planner workstation), keyboard operable, WCAG AA contrast; dense data must stay legible.
