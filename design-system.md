# Home Economy Design System

The system is implemented in `design-system.css` and is intentionally small enough to use in the standalone HTML app.

## Foundations

- `--ds-space-1` through `--ds-space-7`: 4px spacing scale.
- `--ds-space-8` and `--ds-space-10`: larger section spacing.
- `--ds-radius-xs` through `--ds-radius-xl`, plus `--ds-radius-pill`: shape scale.
- `--ds-control-sm`, `--ds-control-md`, `--ds-control-touch`: control-height scale. The mobile value is 48px.
- `--ds-text-xs` through `--ds-text-xl` and the leading tokens: interface type scale.
- `--ds-font-body` and `--ds-font-display`: product typography.
- `--ds-text`, `--ds-text-secondary`, `--ds-text-muted`: semantic text roles.
- `--ds-surface`, `--ds-surface-subtle`, `--ds-bg`: surface roles.
- `--ds-action`, `--ds-action-soft`, `--ds-focus`: interaction roles.
- `--ds-positive`, `--ds-warning`, `--ds-critical` and their soft counterparts: adaptive status roles for light and dark themes.

## Primitives

- `.ds-surface`: bordered, elevated surface for a standalone panel. Existing `.card` sections share this recipe.
- `.ds-title`: display heading style.
- `.ds-button`: action control. Add `data-variant="primary|quiet|destructive"` and optionally `data-size="sm"`. Existing `.btn`, `.primary`, `.quiet`, `.destructive`, and `.sm` names are supported as migration aliases.
- `.ds-field`: text, number, date, and select control.
- `.ds-field--compact`: compact select/input variant for toolbars.
- `.ds-status`: semantic status. Add `data-tone="positive|warning|critical"`.
- `.ds-link-card`: keyboard-accessible linked card for trusted external resources.
- `.ds-focus`: focus ring utility for custom interactive controls.
- `.locale-picker`: accessible language selector with a leading globe icon.

All interactive recipes define hover, active, disabled and keyboard-focus states. They respect increased-contrast, forced-colors and reduced-motion preferences. Reusable visual recipes live only in `design-system.css`; the page stylesheet owns composition and responsive layout.

## Financial agent pattern

The eight financial agents use a page-level pattern built from the same tokens:

- `.agents` is the section surface and owns the translated heading and privacy/approval note.
- `.agent-grid` uses two equal columns on wider screens and one column below 700px.
- `.agent-card` is a compact derived-result surface. Its modifier communicates emphasis: `--quiet`, `--info`, `--action`, `--warning`, or `--critical`.
- `.agent-dot` is a redundant visual cue; status meaning must remain present in the heading and sentence, never in color alone.
- `.agent-body` contains short, plain-language findings. Lists are capped in the view while the pure engine may return more findings.
- `.agent-opportunity` separates each measurable saving candidate. Annual and one-time estimates must use explicit labels and may never be added into one total.
- Savings evidence uses a native keyboard-operable `details` element. The card discloses evidence count, confidence and that the estimate is not a promise; it must not expose an automatic cancellation button.
- Stable savings selectors are `agent-savings`, `savings-opportunity-summary`, `savings-opportunity` and `savings-opportunity-details`.

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

## Transaction categorization pattern

Each transaction row uses the native `.ds-field`-compatible category select identified by `transaction-category-select`. The visible selection follows a predictable policy: an explicit user override wins, then an approved matching rule, then incoming-money detection, and finally the honest `other` fallback.

- Transfers or withdrawals explicitly described as moving money between accounts use the neutral savings/transfers category rather than being counted as spending.
- Maintenance (מזונות) is its own category, not part of housing: it is an obligation to another household rather than a cost of running this one, and folded into housing it made both figures unreadable. The rule reads money leaving only — maintenance arriving is the receiving household's income. A blank or ambiguous outgoing description remains `other`; the interface must not imply confidence that the available evidence does not support.
- Changing the select is an explicit user action and may feed the learning agent. A proposed reusable rule still requires separate approval.
- Category meaning is conveyed by translated text as well as the colored dot. Color never replaces the selected label.
- A row that carries money out is coloured across every field, not only in its amount cell: a household scans a month by the line, and a charge that announced itself in one cell and looked ordinary in the other five was read as ordinary. The amount keeps its weight, which is what still separates it inside the row. Rows that brought money in are left alone — money arriving is not spending and must not be dressed as it.
- `cards` is a screen of its own: what is on each card, one card at a time, newest first, the way an issuer prints it. The combo box names the cards in the reader's own language, sorted, with every card first. It answers the question a bill asks — recognise these charges before paying them — which is not the question the dashboard's table answers.
- Every figure that stands for money is written with its sign and coloured by direction: `--crit-text` when it leaves, `--good-text` when it arrives. That covers the rows that carry money — a transaction, a card summary line, a recurring charge — and the spending breakdown and its table, where every figure is a charge and none of them used to say so. The dot beside the category on a money row carries the same direction: `--crit` for spending, `--good` for money arriving, the neutral for a transfer between the household's own accounts. The categorical slot hues stay in the charts and category lists, where telling one category from another is the job. Beside an amount they misread: the third slot is a green close to the income green, and every category past the eighth shares the grey that also stands for `other`.
- Existing persisted rule sets are merged with new safe defaults by match/category identity, preserving user rules and manual overrides.

## Card summary line

The transactions table opens on the account as the bank describes it: statement rows, and one `card-group-row` per issuer carrying the full sum that card was charged. The `f-view` select offers the itemised list beside it, so nothing is hidden behind a default.

- The summary line is a control (`cardgroup-toggle`): it opens the charges in place as ordinary transaction rows, keeps `aria-expanded` honest, shows a focus ring, and is touch-sized on coarse pointers. A card's sum with no way through to its charges would hide the detail rather than fold it.
- An opened charge is marked by an accent border on its inline-start edge in both the wide table and the stacked mobile layout — the relationship is drawn, never implied by order alone.
- The category cell reads `credit` — a folded card is a card's bill, whoever issued it, and that is what the settlement line on the statement is filed as everywhere else in the app. Naming the one category the charges happened to share said "leisure" about a card; naming none of them said "mixed", which is not something a household can act on. The charges underneath keep the categories they earned: folding a card names the line that stands for the spending, it does not recategorise it.
- Folding changes how a month reads, never what it came to: the totals line counts the charges themselves in both views.
- Charges are folded only where a statement row stands beside them. A card-only import stays itemised, because there is no settlement line for the summary to be read against.

## Saying a row is spending

Every transaction row carries a quiet control beside its amount that turns that one row round. Which side of a statement a figure belongs on is the reader's judgement about a file, and it is wrong often enough — a card report read as a statement, an issuer that books an insurance premium as a credit — that a household needs a way to say so about a single row without evidence, a file or a bulk rewrite.

- It sits with the amount, because that is the figure it changes, and stays at `opacity: 0` until the row is hovered or the control is focused: a visible control on every row of a long table reads as part of the data. On coarse pointers it is always visible and 44px.
- Its accessible name carries the row's description, so a reader who cannot see which row the arrow sits in still knows what it is about.
- Said once it can be said back, and a category the customer chose moves with the row.

## Correcting a misread import

Where the app can tell that saved rows were read the wrong way round — money arriving, on a row carrying no running balance, from neither the card reader nor a hand-typed entry — it offers to turn them round in the transactions header, where the household is looking at them. The count is on the button, so the offer says how much of the month it is about before it is taken.

- It asks twice, the way deleting everything does: it rewrites rows the customer did not choose one at a time.
- A category the customer chose moves across to the corrected row; the correction changes the direction of the money and nothing else about the row.
- The offer disappears once taken rather than sitting there inviting a second run — which is only true because the button recipe now honours `hidden`.
- A balance is what protects real money: a statement row carries the account's balance after it, so a salary, an allowance or a refund the bank reported is never touched.

## Quick-add pattern

`btn-quick-add` is a floating action button on every populated dashboard, opening the `quick-add` dialog. It exists for the money a statement will never report — cash, paying a person — which used to cost opening the drawer, finding a section inside it and filling five fields, and so went unrecorded.

- The dialog is a native `<dialog>` opened with `showModal()`: focus is trapped, Escape closes it and the backdrop comes free. It opens with the cursor in the amount, which is the only figure the customer has in mind, and today's date already filled in.
- Expenses only. Money arriving is on a statement, and offering an income category on the quick path would invite a household to record its salary twice.
- The chosen category is stored as an override, exactly as choosing one on a transaction row is: it outranks any rule that would have claimed the description.
- The same expense recorded twice is the mistake two taps make easiest, so a repeat is named rather than added.
- The button clears the safe-area inset and the page reserves room below its last row for it, at 56px and 60px on coarse pointers.

## Savings goal pattern

`goals` is a screen of its own, opened from the header beside the savings directory and closed back to the dashboard — goals are the one thing here not read from a statement, and a household opens them to plan rather than to review. It opens with nothing imported at all, because naming what you are saving towards does not wait for a bank. Only one screen stands at a time: opening another closes it, and the header button carries `aria-pressed`.


`goals` lists what the household is saving towards. The target and the amount put aside are figures the household enters: no statement says which transfer belonged to which goal, so nothing here is inferred from transactions — a progress bar built on a guess is worse than no progress bar.

- Each goal is one block: name and share saved, a bar, and in words underneath what is left and what reaching it asks of this month. The bar is a length; the sentence carries the two numbers it stands for, so the goal is readable without seeing colour.
- The fields stay on the row rather than behind an edit mode. The amount saved is the number a household changes most often, and a screen that hides it behind a pencil asks for a click a month.
- A goal reached is marked and sinks to the bottom rather than disappearing — it is the household's evidence that the screen works.
- The arithmetic never produces something unshowable: a target of zero is not divided by, a share stops at full, and a target month already passed is named rather than spread over the months it does not have.
- A goal name is free text the customer typed and is redacted at the persistence boundary exactly as a description is.

## Financial plan pattern

`plan` reads the selected month the way a household worksheet asks for it: income, fixed spending, variable spending, money set aside, and the line left over. Every figure is summed from transactions already imported — the app holds no target of its own, and a plan that invented one would be guessing at what this household meant to spend.

- Each section carries its own total in the direction colour, and each line its amount and how many transactions it came from. A section with nothing in it says so rather than disappearing, so the four parts of the month stay on the page whatever it contained.
- Fixed and variable is the recurring-charge agent's answer, not a property of a row: a charge is fixed because the same business stood in an earlier month. One definition of "recurring" on the page, never two that drift.
- Money set aside counts as money that left. It is not spent, but it is not available either, and leaving it out would report a surplus the household cannot touch.
- A card settlement, once the card's own report has been imported, gets its own section and is left out of every total — the charges it paid for are already in the spending sections, and counting it too adds a household's card spending to its month a second time. The section says so in words, and it is not drawn at all in a month that has none. Without card detail the settlement is the only record of that spending and counts as ordinary spending.
- A section the month left empty is headed with a plain unsigned zero: the signed formatter renders `+0.00 ₪`, which at the head of an expense section reads as money that arrived.
- A month that spent more than it earned is named a shortfall in words; the figure is never handed over as a negative number sitting where money to spend goes.
- Income and spending are drawn as two bars on one scale, not one bar in two colours — side by side the segments would read as parts of a whole, and they are two lengths to compare. The figure carries an `aria-label` naming both amounts.
- Income lines are named by payee and are customer data: they go in with `textContent`, never as markup.

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

## Licensed adviser registries

The directory links to official pension-adviser and investment-adviser registries instead of ranking or endorsing named professionals. Copy must not infer independence from a licence alone.

- Separate pension advice, investment advice, marketing and agency roles in the wording.
- Ask users to verify active licence status, compensation, affiliations, price and scope in writing.
- Registry links use the same HTTPS and opener-isolation rules as every external directory card.
- Named professionals requested by a user are visibly labelled as requested listings, never as verified, ranked or endorsed entries.
- Stable selectors are `independent-advisors-section`, `advisor-pension-registry-link`, `advisor-investment-registry-link`, `advisor-dorit-gov-ari-link` and `advisor-checklist`.

## Internationalization

- Supported locales are Hebrew (`he`), English (`en`), Amharic (`am`), and French (`fr`).

## Mobile navigation and settings

- Below 600px, bank and card import remain visible in the compact header. Recommendations, savings, language, settings and backup live behind the translated `mobile-menu-toggle` control.
- On a populated dashboard, the safe-to-spend guide precedes the month selector so the primary decision number stays in the first viewport.
- Settings use four native, keyboard-operable disclosure groups: budgets, categories and rules, data and privacy, and manual transactions. The dashboard budget action opens its relevant group directly.
- The drawer header stays visible while scrolling. The dialog makes the background inert, traps keyboard focus, closes with Escape or the scrim, and restores focus to the visible opener.
- The card-source chooser records which card a report came from, and is shown to the customer rather than used in any calculation. It is a native `<dialog>` opened with `showModal()`, so the browser provides the focus trap, the Escape key and page inertness instead of a second hand-rolled modal. Focus is still restored to the opener explicitly, because WebKit does not restore it on close. Each choice is a `<button type="submit">` inside a `method="dialog"` form, so the answer arrives as the dialog's return value and a dismissal is indistinguishable from Escape by design. The return value is cleared when the dialog opens, since a dialog otherwise keeps the value it last closed with.
- `.picker` is a page component rather than a design-system recipe: it is used in one place and composes the existing `.btn` recipe for its dismissal control.
- Stable automation selectors include `mobile-menu-toggle`, `secondary-actions`, and `settings-section-*`.
- Locale resources live in `resources/<locale>.json`; every locale must expose all keys in `he.json`.
- Components use logical CSS properties (`inline-start`, `inline-end`) so layouts mirror automatically.
- Hebrew uses RTL. English, Amharic, and French use LTR.
- Amharic switches both body and display typography to Noto Sans Ethiopic.
- Language names are always displayed in their native form in the selector.
- Money remains ILS in every interface language; locale only changes number and date presentation.

## Rules

1. Use semantic tokens instead of raw colors and spacing values. Raw theme values belong only in the light/dark theme definitions.
2. Use one surface level per section; do not nest cards inside cards.
3. Use `ds-button` for new actions and `ds-field` for new inputs/selects. `.btn` is a supported migration alias, not a second recipe.
4. Every interactive control must retain a visible `:focus-visible` state.
5. Keep layout recipes in the page stylesheet; keep reusable visual language here.
6. Respect `prefers-reduced-motion` for transitions and animation.
7. Every named region and interactive control exposes a semantic `data-testid`; repeated results use a stable collection ID and Page Objects consume them with `getByTestId`.
8. Do not use color as the only carrier of warning, critical, clear, or approval state.
9. On mobile, keep every visible approval control at least 44×44 CSS pixels and preserve a single-column reading order for agent cards.
10. Dynamic financial sentences use translation keys with named parameters; merchant names and amounts remain user data and must be inserted as text, never executable markup.
11. Every new user journey or component must be reflected in `TEST_PLAN.md`; contract coverage verifies that every test suite remains listed.
