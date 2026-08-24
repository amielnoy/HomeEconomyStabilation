---
name: home-economy-design-system
description: Improve or extend the Home Economy product design system, shared UI recipes, responsive behavior, or visual accessibility. Use for design-system reviews and component styling in this repository; do not use for feature logic that has no visual-system impact.
---

# Home Economy Design System

Treat `design-system.css` as the source of truth for tokens and reusable visual recipes. Read `design-system.md` before changing it. Keep page composition and feature-specific layout in `mazan-habait.html`.

Preserve the public `.btn` and `.card` migration aliases until their callers are deliberately migrated. New reusable actions and fields should use `.ds-button` and `.ds-field`; use semantic variants and tones instead of inline colors. Keep light, dark, increased-contrast, forced-colors, reduced-motion, RTL/LTR, French and Amharic behavior aligned.

Do not rename or remove `data-testid` values as a styling cleanup. Maintain at least 48px touch targets on mobile, visible keyboard focus, text-based meaning in addition to color, and logical CSS properties for directional layout.

After material changes:

1. Extend `tests/contract/design-system-contract.test.ts` for structural invariants.
2. Add observable browser coverage through the existing fixtures, Page Objects and `@step` reporting when interaction or computed appearance changes.
3. Update `design-system.md`, `TEST_PLAN.md`, and `Architecture.html` when their contracts change.
4. Run the build, Vitest, and the relevant Desktop Chromium, Android Chromium and iOS WebKit Playwright journeys. Perform a visual check at desktop and mobile sizes; computed-style assertions alone do not establish good hierarchy.
