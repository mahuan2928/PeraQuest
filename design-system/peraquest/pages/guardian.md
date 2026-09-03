# Page override — Guardian surfaces

Applies to 家庭サポートメモ, reporting, consent and subscription screens.
Overrides `../MASTER.md`; anything not stated here inherits from Master.

## Why this override exists

The guardian is the paying party and the consent holder. Their screens carry learning results,
personal data notices and billing. Playfulness reads as untrustworthy here — the same visual
language that makes the student surface feel like a game makes a billing screen feel unserious.

## Overrides

| Aspect | Master (student) | Guardian |
| --- | --- | --- |
| Display face | `M PLUS Rounded 1c` optional | **None.** Noto Sans JP throughout |
| Motion | Spring/overshoot allowed on rewards | Linear/ease-out only, ≤ 200ms. No overshoot, no stagger |
| `--lime` | Reward highlight | Do not use as a fill. Status is carried by text and `--green` / `--orange-strong` |
| Density | Standard/airy | Denser — a guardian scans a report, they do not explore it |
| Numerals | Oversized, animated | Static, tabular alignment |

## Additional requirements

- Every figure shown to a guardian states its **basis and period** ("直近7日", "検証済み学習イベント").
  A number without a stated basis invites a support question.
- Consent and subscription state must be visible on the surface, not one navigation away.
  Cancellation must be reachable from the same screen that shows the charge.
- Do not use color alone to convey pass/fail on a report. Pair with a label.
- Text size floor is 14px (0.875rem) here, not 12px — the guardian audience skews older than
  the student audience.
