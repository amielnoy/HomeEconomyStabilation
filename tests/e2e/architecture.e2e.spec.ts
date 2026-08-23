import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test.beforeEach(async ({ architecturePage }) => {
  await architecturePage.open();
});

test('documents the application architecture and links back to the product', async ({ architecturePage }) => {
  await expect(architecturePage.page).toHaveTitle('Home Economy — Architecture');
  await expect(architecturePage.title).toContainText('Home Economy');
  await expect(architecturePage.sections).toHaveCount(9);
  await expect(architecturePage.diagram).toHaveAttribute('role', 'img');
  await expect(architecturePage.applicationLink).toHaveAttribute('href', './mazan-habait.html');
});

test('is responsive and has no serious or critical WCAG A/AA violations', async ({ architecturePage }) => {
  await architecturePage.useMobileViewport();
  const overflow = await architecturePage.hasHorizontalOverflow();
  expect(overflow).toBe(false);

  const results = await new AxeBuilder({ page: architecturePage.page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'))
    .toEqual([]);
});
