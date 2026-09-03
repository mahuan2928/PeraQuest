# PeraQuest Design System — MASTER

Global source of truth for visual and interaction decisions. Page-specific files in
`design-system/peraquest/pages/` override this document; anything not overridden comes from here.

Generated 2026-09-03 with `ui-ux-pro-max` as an input, then **reconciled by hand against the
palette already implemented in `apps/web/src/styles.css`**. Where the tool's recommendation was
rejected, the reason and the measurement are recorded below — do not silently re-apply the raw
tool output over this file.

---

## 1. Direction

PeraQuest is a **learning RPG for Japanese Eiken Grade 3 candidates**, with a **guardian**
surface in the same client. Two audiences, one app:

| Surface | Audience | Tone |
| --- | --- | --- |
| Student (quest map, stage attempt, 冒険バッグ) | 小学高学年〜中学生 | Playful, tactile, rewarding |
| Guardian (家庭サポートメモ, reporting, subscription) | 保護者 | Calm, trustworthy, factual |

The implemented style is **neo-brutalist / retro-game**: 2px ink outlines, hard offset shadows
(`3px 3px 0`), warm paper ground, no soft blur shadows. Keep it. It reads as a game to a child
and as "deliberate" rather than "unfinished" to a parent, and it is cheap to render on the
low-end Android devices this audience actually uses.

**Rejected: `Glassmorphism` / `Minimalism` with blue-yellow-pink.** The tool proposed a
"Trust & Authority + Conversion" landing pattern (security badges, Contact Sales CTA, logo
carousel). That is a B2B lead-gen page, not a child's learning app. Ignored.

---

## 2. Color tokens

Base palette is the one already shipped. Two values are **corrected** for contrast; the
originals fail WCAG and the failures are reproducible (ratios measured 2026-09-03).

### Foundation (unchanged)

| Token | Hex | Role |
| --- | --- | --- |
| `--ink` | `#15251f` | Body text, outlines, hard shadows |
| `--paper` | `#fffdf6` | Card / surface |
| `--green` | `#006b4f` | Primary action fill |
| `--lime` | `#c8f23d` | Highlight / reward fill |

Verified pairs — all pass:

| Pair | Ratio | Requirement |
| --- | --- | --- |
| `--ink` on `--paper` | 15.67:1 | 4.5 (AAA) |
| `--ink` on app-shell gradient `#f7f4eb` | 14.51:1 | 4.5 (AAA) |
| `--ink` on `--lime` | 12.33:1 | 4.5 (AAA) |
| `--paper` on `--green` | 6.42:1 | 4.5 |

### Corrected

| Token | Was | Now | Why |
| --- | --- | --- | --- |
| `--orange-strong` | *(reused `--orange` `#ff6b35`)* | `#c2410c` | `#ff6b35` as text on paper = **2.79:1**, fails 4.5. White on `#ff6b35` = **2.84:1**, also fails. `#c2410c` gives 5.09:1 on paper and 5.18:1 with white. |
| `--orange` | `#ff6b35` | `#ff6b35` *(kept, fill only)* | Still valid as a **fill / border / shadow** color where the text sitting on it is `--ink` (5.63:1, passes). Never use it as a text color. |
| `--focus` | `#68bfff` | *(see focus ring below)* | `#68bfff` on paper = **1.97:1**, fails the 3:1 non-text requirement (WCAG 2.2 SC 1.4.11). Verified wired up at L44 as the global rule for `button:focus-visible, input:focus-visible, a:focus-visible` — so this affects every keyboard-focusable control in the app. |

Call sites to fix — `apps/web/src/styles.css`:

- L42 `.field-heading span` — `color: white; background: var(--orange)` → use `--orange-strong` as the fill, or switch the text to `--ink`.
- L83 `.demo-start-button` — inherits `color: white` from `.primary-action` and overrides the fill to
  `var(--orange)`. White on `#ff6b35` = **2.84:1**. This is the primary CTA on the first screen
  (`components/BirthMonthForm.vue`), so it is the most visible failure in the file. Fix to
  `--orange-strong` as the fill, or keep `#ff6b35` and switch the label to `--ink` (5.63:1).
- L76 `.landing-value-grid span` — `color: var(--orange)` → `--orange-strong`.
- L108 `.demo-metrics-card span` — `color: var(--orange)` → `--orange-strong`.
- L149 `.quest-node.current .quest-state-label` — `color: var(--orange)` → `--orange-strong`.
- L130 / L138 `box-shadow: 3px 3px 0 var(--orange)` and `border-color` — **leave as-is**, decorative fill, not text.

### Focus ring

No single hue clears 3:1 against paper, lime **and** green at once (`#0b6bbf` reaches 5.33 and
4.19 but collapses to 1.20 on green). Use a **two-tone ring** instead — one of the two edges
always has sufficient contrast, and it matches the hard-shadow aesthetic:

```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--paper), 0 0 0 5px var(--ink);
}
```

`--paper` on `--green` = 6.42:1; `--ink` on `--paper` = 15.67:1; `--ink` on `--lime` = 12.33:1.
Retire `--focus` or redefine it as this composite. Call sites:

- L44 `.birth-form input:focus, button:focus-visible, input:focus-visible, a:focus-visible` —
  the global focus rule. 4px outline at 1.97:1.
- L141 `.quest-node-button[aria-pressed="true"]` — `--focus` is also carrying the **selected**
  state on the quest map, not just focus. A selected node is therefore marked at 1.97:1 against
  paper. Give selection its own token (`--ink` outline, or a fill change), and keep the focus
  ring for focus only — a control that is both selected and focused must show both.
- L302 `.choice:has(input:focus-visible)` — hardcodes `#68bfff` instead of `var(--focus)`.
  Fix the duplication at the same time so there is one place to change.

### `--line`

`#c9c5b9` on paper = **1.70:1**. Acceptable for purely decorative rules. Where a border is the
*only* thing marking a control's boundary (inputs, tabs), use `--ink` at 2px — which the
neo-brutalist style already does elsewhere. Audit inputs specifically.

---

## 3. Typography

**Keep the shipped stack.** `apps/web/src/styles.css` already declares:

```css
font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
font-synthesis: none;
```

This is correct and must not be replaced by a Latin-only recommendation.

**Rejected: `Baloo 2` + `Comic Neue`.** The tool returned this pairing for the kids/education
query. `Baloo 2` ships `devanagari | latin | latin-ext | vietnamese` — **no Japanese subset**.
Every 漢字 and かな would fall back to an arbitrary system font, producing mixed-face text
(和欧混植の不整合) across devices. The curated pairing table in that skill is Latin-centric;
its raw `google-fonts.csv` (with subset data) is not, and is the layer to query for this product.

### Optional display face (student surfaces only)

If the game surfaces need more character than Noto Sans JP, use **`M PLUS Rounded 1c`**
(subsets: `japanese | latin | latin-ext | …`) for headings, quest titles, XP/coin numerals —
rounded gothic, unambiguously "game", full kana/kanji coverage. Body text stays Noto Sans JP.
`Klee One` (教科書体風, japanese subset) is an alternative worth testing specifically for
displaying English example sentences and vocabulary, since it mirrors the letterforms Japanese
students are taught from.

**Guardian surfaces use Noto Sans JP throughout — no display face.** See `pages/guardian.md`.

### Size floor

Body and label text must be **≥ 12px (0.75rem)**. `styles.css` currently has **57 declarations**
below that — `.74rem` ≈ 11.8px (×7), `.72rem` ≈ 11.5px (×15), `.7rem` ≈ 11.2px (×8),
`.68rem` ≈ 10.9px (×13), `.66rem` ≈ 10.6px (×6), `.64rem` ≈ 10.2px (×4), `.62rem` ≈ 9.9px (×4). For a product whose primary
user is a child, this is the highest-value typography fix in the file. Raise the floor and let
the layout reflow rather than shrinking text to fit.

Line height: 1.5 minimum for Japanese body text (CJK needs more leading than Latin at the same
size); 1.1–1.2 for large display numerals only.

---

## 4. Interaction and motion

Already correct in `styles.css` — keep and do not regress:

- `button { min-width: 44px; min-height: 44px; cursor: pointer; }`
- `.skip-link` present and reachable on focus
- `font-synthesis: none` (prevents faux-bold on Japanese faces)

To add:

- **`prefers-reduced-motion`** — every transition and any GSAP-style entrance must have a
  reduced-motion branch that renders the final state immediately. Not currently handled.
- Transitions 150–300ms. The existing `transform .16s, box-shadow .16s` on `.primary-action` is
  the right feel; reuse it rather than inventing new durations.
- Reward animations (XP, coin, badge) are the one place a spring/overshoot is justified. Do not
  apply overshoot easing to the guardian report tables.

---

## 5. Stack notes (Vue 3 + Vite, plain CSS)

There is **no Tailwind** in this project — `apps/web` uses a single `src/styles.css` with CSS
custom properties. Any recommendation that arrives as a `tailwind.config` fragment must be
translated into custom properties in `:root` before use.

Tokens live in `:root` in `apps/web/src/styles.css`. Keep semantic names (`--orange-strong`) rather
than raw hex at call sites.

---

## 6. Pre-delivery checklist

- [ ] No emoji used as icons (SVG only)
- [ ] Text contrast ≥ 4.5:1 — re-measure after any palette edit
- [ ] Non-text contrast ≥ 3:1 for focus rings and control boundaries
- [ ] `:focus-visible` ring visible on paper, lime **and** green
- [ ] No text below 12px
- [ ] `prefers-reduced-motion` honored
- [ ] Touch targets ≥ 44×44px with ≥ 8px spacing
- [ ] Responsive at 375 / 768 / 1024 / 1440
- [ ] Japanese text renders in the intended face on iOS, Android and Windows (no fallback drift)
