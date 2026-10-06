/** Observe actual locale completion. Never write cookies, retry an action or forge DOM state. */
export async function waitForAuditLocale(page, path, locale) {
  if (locale !== 'en' && locale !== 'tr') throw new TypeError('Unsupported audit locale');
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError('An application path is required');
  }

  // Network idleness alone does not prove that React committed a server action.
  // Check the selected document language AND the settled control in one observation.
  await page.waitForFunction(expected => {
    const toggle = document.querySelector('.locale-toggle');
    return document.documentElement.lang === expected
      && toggle?.getAttribute('aria-busy') === 'false'
      && !document.querySelector('.locale-error');
  }, locale, { timeout: 10000 });

  // Retain the stronger, existing server-rendered checks where those markers exist.
  const selector = path === '/module/audit'
    ? `.audit-live-page[data-audit-locale="${locale}"]`
    : ['/module/engagement', '/module/workforce-planning', '/module/ai-assistant'].includes(path)
      ? `.gov-shell[data-governance-locale="${locale}"]`
      : null;
  if (selector) await page.locator(selector).waitFor({ timeout: 10000 });
}
