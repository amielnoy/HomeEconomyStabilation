import type { Locator, Page } from '@playwright/test';
import { step } from './step';

export abstract class BasePage {
  readonly html = this.page.getByTestId('app-document');
  readonly body = this.page.getByTestId('app-body');
  readonly viewportMeta = this.page.getByTestId('viewport-meta');

  protected constructor(
    public readonly page: Page,
    private readonly path: string,
  ) {}

  @step('Open the page')
  async open(query = ''): Promise<void> {
    await this.page.goto(`${this.path}${query}`);
  }

  @step('Open a fresh page with cleared browser data')
  async openFresh(query = ''): Promise<void> {
    await this.open(query);
    await this.clearLocalStorage();
    await this.page.reload();
  }

  @step('Reload the page')
  async reload(): Promise<void> {
    await this.page.reload();
  }

  @step('Clear saved browser data')
  async clearLocalStorage(): Promise<void> {
    await this.page.evaluate(() => localStorage.clear());
  }

  @step('Resize the page to a mobile screen')
  async useMobileViewport(): Promise<void> {
    await this.page.setViewportSize({ width: 390, height: 844 });
  }

  @step('Check for horizontal page overflow')
  async hasHorizontalOverflow(): Promise<boolean> {
    return this.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  }

  /**
   * Every visible interactive element on the page, measured against the touch
   * minimum — as opposed to a hand-curated list, which is only ever as complete as
   * the last person to remember to extend it. The 19px "how did we calculate this"
   * disclosures were missed for exactly that reason.
   *
   * `exceptions` takes selectors that are deliberately below the minimum, so an
   * intentional exemption has to be written down rather than silently omitted.
   */
  @step('Check every visible interactive element against the touch minimum')
  async undersizedTouchTargets(
    { minimumSize = 44, exceptions = [] }: { minimumSize?: number; exceptions?: readonly string[] } = {},
  ): Promise<Array<{ selector: string; label: string; width: number; height: number }>> {
    return this.page.evaluate(({ minimum, skip }) => {
      const interactive = 'a[href], button, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"]), input:not([type="hidden"])';
      const describe = (node: Element): string => {
        const path = [];
        for (const part of [node.id && `#${node.id}`, node.getAttribute('data-testid') && `[data-testid="${node.getAttribute('data-testid')}"]`]) {
          if (part) path.push(part);
        }
        return path.join('') || node.tagName.toLowerCase();
      };
      return [...document.querySelectorAll(interactive)].flatMap((node) => {
        if (skip.some((selector) => node.matches(selector))) return [];
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') return [];
        if (box.width >= minimum && box.height >= minimum) return [];
        return [{
          selector: describe(node),
          label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 60) || '<unlabelled>',
          width: Math.round(box.width),
          height: Math.round(box.height),
        }];
      });
    }, { minimum: minimumSize, skip: [...exceptions] });
  }

  /**
   * Measured inside the page, one evaluation per locator, rather than element by element
   * over the wire. The settings drawer alone lists a control per default rule, and four
   * round trips each — visible, box, label, text — ran the drawer's journey past the
   * test timeout on WebKit: a scan that cannot finish reports nothing, which reads as a
   * page with no undersized target on it.
   */
  @step('Check that visible touch targets are large enough')
  async touchTargetsBelow(locator: Locator | readonly Locator[], minimumSize = 44): Promise<Array<{
    label: string;
    width: number;
    height: number;
  }>> {
    const locators = Array.isArray(locator) ? locator : [locator];
    const measured = await Promise.all(locators.map((item) => item.evaluateAll((nodes, minimum) => nodes
      .flatMap((node) => {
        const box = node.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || getComputedStyle(node).visibility === 'hidden') return [];
        if (box.width >= minimum && box.height >= minimum) return [];
        return [{
          label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 80) || '<unlabelled>',
          width: Math.round(box.width),
          height: Math.round(box.height),
        }];
      }), minimumSize)));
    return measured.flat();
  }

}
