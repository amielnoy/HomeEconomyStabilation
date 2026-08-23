import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('opens the savings directory before any bank report is loaded', async ({ homePage }) => {
  await expect(homePage.emptyState).toBeVisible();
  await homePage.savingsDirectory.open();

  await expect(homePage.page).toHaveURL(/#savings-directory$/);
  await expect(homePage.emptyState).toBeHidden();
  await expect(homePage.savingsDirectory.root).toBeVisible();
  await expect(homePage.savingsDirectory.cards).toHaveCount(15);
  await expect(homePage.savingsDirectory.officialToolsHeading).toBeVisible();
  await expect(homePage.savingsDirectory.supportOrganizationsHeading).toBeVisible();
  await expect(homePage.savingsDirectory.paamonimLink).toBeVisible();
  await expect(homePage.savingsDirectory.mekimiLink).toBeVisible();
  await expect(homePage.savingsDirectory.paamonimWhatsAppLink).toBeVisible();
  await expect(homePage.savingsDirectory.companiesHeading).toBeVisible();
});

test('preserves the directory while switching to French', async ({ homePage }) => {
  await homePage.savingsDirectory.open();
  await homePage.language.choose('fr');

  await expect(homePage.html).toHaveAttribute('lang', 'fr');
  await expect(homePage.savingsDirectory.root).toBeVisible();
  await expect(homePage.savingsDirectory.title).toHaveText('Retraite, fonds de formation et placements');
  await expect(homePage.savingsDirectory.disclaimer).toContainText('ni un classement ni une recommandation');
  await expect(homePage.savingsDirectory.supportOrganizationsHeading)
    .toHaveText('Organismes d’aide à la gestion du budget familial');
});

test('returns from the directory to the correct empty state', async ({ homePage }) => {
  await homePage.savingsDirectory.open();
  await homePage.savingsDirectory.goBack();

  await expect(homePage.page).not.toHaveURL(/#savings-directory$/);
  await expect(homePage.savingsDirectory.root).toBeHidden();
  await expect(homePage.emptyState).toBeVisible();
});
