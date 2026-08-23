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
