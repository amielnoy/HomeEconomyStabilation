import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Two defects in the header came from the stylesheet rather than from any component: a
   control whose text could not shrink and had nothing clipping it, and a narrow-width
   rule written above the wider rule it was meant to override, which cancelled it
   silently. Neither is visible in a component test — both are properties of the sheet. */

const root = resolve(__dirname, '../..');
const page = readFileSync(resolve(root, 'mazan-habait.html'), 'utf8');
const designSystem = readFileSync(resolve(root, 'design-system.css'), 'utf8');
const styles = page.slice(page.indexOf('<style'), page.indexOf('</style>'));

const indexOfMedia = (query: string): number => styles.indexOf(`@media ${query}`);

describe('responsive layout contract', () => {
  /* Equal specificity means the later rule wins. A narrow-width block placed above the
     wider block it refines is dead code that still looks correct in review. */
  it('declares the narrow-width header rules after the wider rules they override', () => {
    const narrow = indexOfMedia('(max-width:340px)');
    const wide = indexOfMedia('(max-width:600px)');
    const coarse = indexOfMedia('(max-width:600px), (pointer: coarse) and (max-width:900px)');

    expect(narrow, 'the narrow header block is missing').toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(wide);
    expect(narrow).toBeGreaterThan(coarse);
  });

  /* A grid track that is not minmax(0,…) refuses to go below its content, which is how a
     button ends up wider than the column it was given. */
  it('lets every header action track shrink below its content', () => {
    const tracks = [...styles.matchAll(/\.actions\{[^}]*grid-template-columns:([^;}]+)/g)]
      .map((match) => match[1]!.trim());

    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) {
      expect(track, `"${track}" has a track that cannot shrink`).not.toMatch(/(^|\s)1fr/);
    }
  });

  it('constrains the overflow of header actions that refuse to wrap', () => {
    expect(designSystem).toMatch(/white-space:\s*nowrap/);
    expect(styles, 'header actions may overflow their own box').toMatch(/\.actions\s*>\s*\.btn\{[^}]*overflow:hidden/);
  });

  /* A label that cannot be read in full is a control the customer cannot use. Wrapping it
     has to apply wherever the two uploads divide the width, not at one chosen breakpoint:
     the width at which a label stops fitting depends on the translation, and pinning it
     to a pixel is what cut the English and French labels on an ordinary phone. */
  it('lets a header action label wrap wherever the uploads divide the width', () => {
    const rule = /\.actions\s*>\s*\.btn:not\(\.mobile-menu-toggle\)\{[^}]*white-space:normal/;
    const match = rule.exec(styles);
    expect(match, 'no rule lets a header upload label wrap').not.toBeNull();

    /* The condition governing that rule is the property under test: confined to a very
       narrow breakpoint it never reaches the phone widths where the longer translations
       overflow, which is exactly how the English and French labels came to be cut. */
    const enclosing = [...styles.slice(0, match!.index).matchAll(/@media ([^{]+)\{/g)].pop();
    expect(enclosing, 'the wrapping rule sits outside any media query').toBeDefined();
    expect(enclosing![1]!).toContain('max-width:600px');
  });

  it('gives header controls no fixed pixel width to fight the grid with', () => {
    const headerRules = [...styles.matchAll(/\.actions\s*>\s*\.btn[^{]*\{([^}]*)\}/g)].map((match) => match[1]!);

    expect(headerRules.length).toBeGreaterThan(0);
    for (const rule of headerRules) {
      expect(rule, `"${rule.trim()}" pins a header control width`).not.toMatch(/(^|;)\s*width:\s*\d+px/);
    }
  });

  /* A rotated phone inflates the text of a page that already sizes itself, which pushes
     every label past the width this contract is protecting. */
  it('pins text sizing so rotating the phone does not inflate the labels', () => {
    expect(styles).toMatch(/-webkit-text-size-adjust:100%/);
    expect(styles).toMatch(/[^-]text-size-adjust:100%/);
  });
});
