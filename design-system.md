# Home Economy Design System

The system is implemented in `design-system.css` and is intentionally small enough to use in the standalone HTML app.

## Foundations

- `--ds-space-1` through `--ds-space-7`: 4px spacing scale.
- `--ds-space-8` and `--ds-space-10`: larger section spacing.
- `--ds-radius-sm`, `--ds-radius-md`, `--ds-radius-lg`, `--ds-radius-pill`: shape scale.
- `--ds-font-body` and `--ds-font-display`: product typography.
- `--ds-text`, `--ds-text-secondary`, `--ds-text-muted`: semantic text roles.
- `--ds-surface`, `--ds-surface-subtle`, `--ds-bg`: surface roles.
- `--ds-action`, `--ds-action-soft`, `--ds-focus`: interaction roles.

## Primitives

- `.ds-surface`: bordered, elevated surface for a standalone panel.
- `.ds-title`: display heading style.
- `.ds-button`: action control. Add `data-variant="primary|quiet"` and optionally `data-size="sm"`.
- `.ds-field`: text, number, date, and select control.
- `.ds-field--compact`: compact select/input variant for toolbars.
- `.ds-status`: semantic status. Add `data-tone="positive|warning|critical"`.
- `.ds-link-card`: keyboard-accessible linked card for trusted external resources.
- `.ds-focus`: focus ring utility for custom interactive controls.
- `.locale-picker`: accessible language selector with a leading globe icon.

## Financial agent pattern

The seven financial agents use a page-level pattern built from the same tokens:

- `.agents` is the section surface and owns the translated heading and privacy/approval note.
- `.agent-grid` uses two equal columns on wider screens and one column below 700px.
- `.agent-card` is a compact derived-result surface. Its modifier communicates emphasis: `--quiet`, `--info`, `--action`, `--warning`, or `--critical`.
- `.agent-dot` is a redundant visual cue; status meaning must remain present in the heading and sentence, never in color alone.
- `.agent-body` contains short, plain-language findings. Lists are capped in the view while the pure engine may return more findings.
- Approval controls use the existing pill button recipe and the stable test IDs `approve-learning-rule` and `apply-budget-suggestion`.

Agent cards do not perform remote calls. Findings are derived, while learned rules and suggested budgets require an explicit action before persistence. A quiet state is always rendered instead of leaving an empty card, so users can distinguish “checked and clear” from “not loaded”.

## Internationalization

- Supported locales are Hebrew (`he`), English (`en`), Amharic (`am`), and French (`fr`).
- Locale resources live in `resources/<locale>.json`; every locale must expose all keys in `he.json`.
- Components use logical CSS properties (`inline-start`, `inline-end`) so layouts mirror automatically.
- Hebrew uses RTL. English, Amharic, and French use LTR.
- Amharic switches both body and display typography to Noto Sans Ethiopic.
- Language names are always displayed in their native form in the selector.
- Money remains ILS in every interface language; locale only changes number and date presentation.

## Rules

1. Use semantic tokens instead of raw colors and spacing values.
2. Use one surface level per section; do not nest cards inside cards.
3. Use `ds-button` for actions and `ds-field` for inputs/selects.
4. Every interactive control must retain a visible `:focus-visible` state.
5. Keep layout recipes in the page stylesheet; keep reusable visual language here.
6. Respect `prefers-reduced-motion` for transitions and animation.
7. Every named region and interactive control exposes a semantic `data-testid`; repeated results use a stable collection ID and Page Objects consume them with `getByTestId`.
8. Do not use color as the only carrier of warning, critical, clear, or approval state.
9. On mobile, keep every visible approval control at least 44×44 CSS pixels and preserve a single-column reading order for agent cards.
10. Dynamic financial sentences use translation keys with named parameters; merchant names and amounts remain user data and must be inserted as text, never executable markup.
