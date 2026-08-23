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

## Safe-to-spend guide

`.spending-guide` is the first derived surface after month selection. It turns the payday agent into one prominent decision number, followed by weekly and daily guides. The expandable native `details` element must always disclose the inputs—current balance, expected commitments and expected income date—so the recommendation stays understandable and auditable.

- Positive allowance uses the normal ink color; a projected shortfall uses critical text and a plain-language recovery message, never color alone.
- Missing balance or recurring-income history is an explicit state. The view uses an em dash for values that cannot be calculated and does not manufacture an allowance.
- A projected shortfall displays zero as the actionable spending allowance and explains the actual gap in the adjacent sentence. `NaN`, `Infinity`, and negative recommended allowances must never reach the UI.
- Expected dates on days 29–31 clamp to the last valid day of a shorter month; visual copy must show that resolved date.
- The main result uses `aria-live="polite"`; explanation remains keyboard-operable through native `summary` behavior.
- At 700px the guide becomes one column; at 420px the rate and breakdown grids also become one column.
- Stable selectors use the `spending-guide-*` namespace.
- Sanity coverage exercises missing balance, missing recurring income and shortfall states on desktop Chromium, Android Chromium and iOS WebKit.
- Approval controls use the existing pill button recipe and the stable test IDs `approve-learning-rule` and `apply-budget-suggestion`.

Agent cards do not perform remote calls. Findings are derived, while learned rules and suggested budgets require an explicit action before persistence. A quiet state is always rendered instead of leaving an empty card, so users can distinguish “checked and clear” from “not loaded”.

## Consent pattern

`.consent-card` presents optional cloud-sync disclosure inside settings. It is informative infrastructure, not a precondition for local use.

- The checkbox is unchecked by default and the accept action remains disabled until a direct choice.
- Purpose, data categories, voluntariness, withdrawal, forecast limitations and non-waivable rights appear before the control.
- Accepting records a version, locale and timestamp only; it does not upload a report or collect a typed name, drawing, IP address or device fingerprint.
- The status uses `role="status"` and `aria-live="polite"`. Acceptance and withdrawal remain reversible, keyboard accessible and covered by `cloud-consent-*` test IDs.
- Copy must distinguish “consent recorded locally” from “cloud sync active”. Never imply that recording consent uploaded or protected data.

## Support organization link cards

The savings directory separates official tools, nonprofit household-finance support and commercial providers in that reading order. Paamonim and Mekimi use the existing `.ds-link-card` recipe with a neutral social-organization status; they must never inherit a positive “official” or promotional state.

- Organization descriptions state the available guidance without promising acceptance, outcomes or free service.
- The directory disclaimer makes each organization responsible for its current eligibility and service terms.
- Links use HTTPS, open only after an explicit action and retain `noopener noreferrer`.
- Stable automation selectors are `support-organizations-section`, `support-organizations-h`, `support-organization-paamonim-link`, `support-organization-mekimi-link` and `support-community-paamonim-whatsapp-link`.
- The WhatsApp destination is described as an updates channel, not as private financial counseling or guaranteed access to an expert.
- Copy and wrapping are tested in Hebrew, English, French and Amharic, including Android Chromium and iOS WebKit profiles.

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
11. Every new user journey or component must be reflected in `TEST_PLAN.md`; contract coverage verifies that every test suite remains listed.
