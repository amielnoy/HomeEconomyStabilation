import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('captures campaign attribution without sending the bank report anywhere', async ({ homePage }) => {
  await homePage.open('?utm_source=google&utm_medium=cpc&utm_campaign=family-budget&gclid=test-click');

  const attribution = await homePage.marketing.readAttribution();
  expect(attribution.firstTouch).toMatchObject({
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'family-budget',
    gclid: 'test-click',
  });
  expect(attribution.lastTouch).toEqual(attribution.firstTouch);
});

test('tracks the primary CTA and opens the existing private file picker', async ({ homePage }) => {
  const chooser = await homePage.marketing.openPrimaryFileChooser();

  expect(chooser.isMultiple()).toBe(true);
  const events = await homePage.marketing.readEvents();
  expect(events.at(-1)).toMatchObject({
    name: 'marketing_primary_cta_clicked',
    details: { locale: 'he', placement: 'hero' },
  });
});

const localizedVersions = [
  { locale: 'he', dir: 'rtl', title: 'לראות לאן הכסף הולך. לדעת מה לעשות עכשיו.', cta: 'התחלת בדיקה חינמית' },
  { locale: 'en', dir: 'ltr', title: 'See where the money goes. Know what to do next.', cta: 'Start free check' },
  { locale: 'am', dir: 'ltr', title: 'ገንዘቡ የት እንደሚሄድ ይዩ። ቀጥሎ ምን ማድረግ እንዳለብዎ ይወቁ።', cta: 'ነፃ ምርመራ ጀምር' },
  { locale: 'fr', dir: 'ltr', title: 'Voir où va l’argent. Savoir quoi faire ensuite.', cta: 'Commencer le bilan gratuit' },
] as const;

for (const version of localizedVersions) {
  test(`renders the complete ${version.locale} marketing version on desktop and mobile`, async ({ homePage }) => {
    await homePage.language.choose(version.locale);

    await expect(homePage.html).toHaveAttribute('lang', version.locale);
    await expect(homePage.html).toHaveAttribute('dir', version.dir);
    await expect(homePage.marketing.title).toHaveText(version.title);
    await expect(homePage.marketing.primaryUpload).toHaveText(version.cta);
    await expect(homePage.marketing.finalUpload).toHaveText(version.cta);
    await expect(homePage.marketing.trustItems).toHaveCount(3);
    await expect(homePage.marketing.benefitCards).toHaveCount(3);

    await homePage.useMobileViewport();
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
    await expect(homePage.marketing.primaryUpload).toBeVisible();
    await expect(homePage.marketing.finalUpload).toBeVisible();
  });
}

test('keeps the marketing experience legible in dark mode', async ({ homePage }) => {
  await homePage.page.emulateMedia({ colorScheme: 'dark' });
  await homePage.reload();

  await expect(homePage.marketing.root).toBeVisible();
  await expect(homePage.marketing.preview).toBeVisible();
  await expect(homePage.marketing.primaryUpload).toBeVisible();
  const background = await homePage.marketing.bodyBackgroundColor();
  expect(background).not.toBe('rgb(237, 241, 241)');
});
