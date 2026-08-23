import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.savingsDirectory.open();
});

test('shows support organizations and the WhatsApp channel before commercial providers', async ({ homePage }) => {
  const directory = homePage.savingsDirectory;

  await expect(directory.supportOrganizationsHeading).toBeVisible();
  await expect(directory.paamonimLink).toHaveAttribute('href', 'https://www.paamonim.org/');
  await expect(directory.mekimiLink).toHaveAttribute('href', 'https://mekimi.org.il/home/');
  await expect(directory.paamonimWhatsAppLink)
    .toHaveAttribute('href', 'https://www.whatsapp.com/channel/0029Vaf1Mru17EmsEzCjnf3G');
  await expect(directory.paamonimLink).toContainText('פעמונים');
  await expect(directory.mekimiLink).toContainText('מקימי');
  await expect(directory.paamonimWhatsAppLink).toContainText('ערוץ WhatsApp של פעמונים');
  await expect(directory.disclaimer).toContainText('אינה דירוג או המלצה');
  await expect(directory.disclaimer).toContainText('תנאי הזכאות והשירות');
  expect(await directory.supportOrganizationsComeBeforeCompanies()).toBe(true);
});

test('keeps the support section understandable in every interface language', async ({ homePage }) => {
  const headings = {
    he: 'ארגוני סיוע בכלכלת הבית',
    en: 'Household-finance support organizations',
    fr: 'Organismes d’aide à la gestion du budget familial',
    am: 'የቤተሰብ ኢኮኖሚ ድጋፍ ድርጅቶች',
  } as const;

  for (const [locale, heading] of Object.entries(headings)) {
    await homePage.language.choose(locale as keyof typeof headings);
    await expect(homePage.savingsDirectory.supportOrganizationsHeading).toHaveText(heading);
    await expect(homePage.savingsDirectory.paamonimLink).toBeVisible();
    await expect(homePage.savingsDirectory.mekimiLink).toBeVisible();
    await expect(homePage.savingsDirectory.paamonimWhatsAppLink).toBeVisible();
  }
});
