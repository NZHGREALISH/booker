import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function csvEnv(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function validateCommonConfig(value) {
  if (!['persistent', 'cdp'].includes(value.mode)) {
    throw new Error('BOOKER_MODE must be either persistent or cdp.');
  }
  if (!value.targetDate && !value.targetDateText) {
    throw new Error('Set TARGET_DATE as YYYY-MM-DD, or set TARGET_DATE_TEXT.');
  }
}

export async function openBrowser(value) {
  if (value.mode === 'cdp') {
    const browser = await chromium.connectOverCDP(value.cdpUrl);
    return { browser, context: browser.contexts()[0], close: async () => browser.close() };
  }

  const userDataDir = path.resolve(value.userDataDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  return { context, close: async () => context.close() };
}

export async function pickPage(browserState, value) {
  const pages = browserState.context.pages();
  if (value.mode === 'cdp' && pages.length > 0) {
    const matching = pages.find((p) => p.url().includes('recreation.utoronto.ca'));
    return matching || pages[0];
  }
  return pages[0] || await browserState.context.newPage();
}

export async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input, output });
  await rl.question(prompt);
  rl.close();
}

export async function selectDate(page, value) {
  const parsed = parseIsoDate(value.targetDate);
  const selectors = [];

  if (parsed) {
    selectors.push(
      `.single-date-select-button[data-year="${parsed.year}"][data-month="${parsed.month}"][data-day="${parsed.day}"]`,
    );
  }
  if (value.targetDateText) {
    selectors.push(`.single-date-select-button[data-date-text="${cssString(value.targetDateText)}"]`);
  }

  for (const selector of selectors) {
    const dateButton = page.locator(selector).filter({ visible: true }).first();
    if (await isClickable(dateButton)) {
      const text = await dateButton.getAttribute('data-date-text').catch(() => value.targetDateText || value.targetDate);
      console.log(`Selecting date: ${text}`);
      await dateButton.click();
      await page.waitForTimeout(700);
      return;
    }
  }

  throw new Error(`Could not find visible target date button for ${value.targetDate || value.targetDateText}.`);
}

export function parseIsoDate(value) {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!match) {
    throw new Error('TARGET_DATE must use YYYY-MM-DD.');
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export async function selectFacility(page, facilityName) {
  console.log(`Selecting facility: ${facilityName}`);
  const facilityTab = page.locator('#tabBookingFacilities button', {
    hasText: facilityName,
  }).first();

  try {
    await facilityTab.waitFor({ state: 'visible', timeout: 5000 });
    await facilityTab.click();
    await page.waitForTimeout(700);
  } catch {
    throw new Error(`Could not select facility tab "${facilityName}".`);
  }
}

export async function clickTargetSlotIfAvailable(page, targetSlot, facilityName, state = { winner: null }) {
  if (state.winner) {
    return false;
  }

  const byDataSlot = page.locator(`button[data-slot-text="${cssString(targetSlot)}"]`).first();
  if (await isClickable(byDataSlot)) {
    if (state.winner) {
      return false;
    }
    state.winner = { page, facilityName, targetSlot };
    await byDataSlot.click();
    return true;
  }

  const byAria = page.locator(`button[aria-label*="${cssString(targetSlot)}"]`, {
    hasText: /Book Now/i,
  }).first();
  if (await isClickable(byAria)) {
    if (state.winner) {
      return false;
    }
    state.winner = { page, facilityName, targetSlot };
    await byAria.click();
    return true;
  }

  const opensCount = await page.getByText(/Opens at/i).count().catch(() => 0);
  const bookNowCount = await page.getByRole('button', { name: /Book Now/i }).count().catch(() => 0);
  console.log(`  ${facilityName} not ready yet; opens=${opensCount}, bookNowButtons=${bookNowCount}`);
  return false;
}

export async function isClickable(locator) {
  if (await locator.count().catch(() => 0) === 0) {
    return false;
  }
  if (!await locator.isVisible().catch(() => false)) {
    return false;
  }
  if (!await locator.isEnabled().catch(() => false)) {
    return false;
  }
  return true;
}

export function cssString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
