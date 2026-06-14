import 'dotenv/config';
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';

const config = {
  bookingUrl: requiredEnv('BOOKING_URL'),
  targetSlot: requiredEnv('TARGET_SLOT'),
  targetFacility: process.env.TARGET_FACILITY?.trim() || '',
  startAt: process.env.START_AT?.trim() || '',
  refreshMs: Number(process.env.REFRESH_MS || 650),
  timeoutSeconds: Number(process.env.TIMEOUT_SECONDS || 180),
  mode: process.env.BOOKER_MODE || 'persistent',
  cdpUrl: process.env.CDP_URL || 'http://127.0.0.1:9222',
  userDataDir: process.env.USER_DATA_DIR || '.browser-profile',
};

validateConfig(config);

const browserState = await openBrowser(config);
const page = await pickPage(browserState, config);

await page.goto(config.bookingUrl, { waitUntil: 'domcontentloaded' });
await page.bringToFront();

console.log('\nBrowser is open.');
console.log('1. Log in if needed.');
console.log('2. Confirm the booking date/facility, or let TARGET_FACILITY choose the tab.');
console.log('3. Keep the browser visible for captcha/confirmation after the click.\n');

await waitForEnter('Press Enter when the page is ready...');

if (config.targetFacility) {
  await selectFacility(page, config.targetFacility);
}

await waitUntilStart(config.startAt);
await pollAndClick(page, config);

console.log('\nDone. Browser left open so you can finish captcha/confirmation if shown.');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function validateConfig(value) {
  if (!Number.isFinite(value.refreshMs) || value.refreshMs < 250) {
    throw new Error('REFRESH_MS must be a number >= 250.');
  }
  if (!Number.isFinite(value.timeoutSeconds) || value.timeoutSeconds < 1) {
    throw new Error('TIMEOUT_SECONDS must be a positive number.');
  }
  if (!['persistent', 'cdp'].includes(value.mode)) {
    throw new Error('BOOKER_MODE must be either persistent or cdp.');
  }
}

async function openBrowser(value) {
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

async function pickPage(browserState, value) {
  const pages = browserState.context.pages();
  if (value.mode === 'cdp' && pages.length > 0) {
    const matching = pages.find((p) => p.url().includes('recreation.utoronto.ca'));
    return matching || pages[0];
  }
  return pages[0] || await browserState.context.newPage();
}

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input, output });
  await rl.question(prompt);
  rl.close();
}

async function selectFacility(page, facilityName) {
  console.log(`Selecting facility: ${facilityName}`);
  const facilityTab = page.locator('#tabBookingFacilities button', {
    hasText: facilityName,
  }).first();

  try {
    await facilityTab.waitFor({ state: 'visible', timeout: 5000 });
    await facilityTab.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500);
  } catch {
    console.log(`Could not select facility tab "${facilityName}". Continuing with current page selection.`);
  }
}

async function waitUntilStart(startAt) {
  if (!startAt) {
    return;
  }

  const target = nextLocalTime(startAt);
  const waitMs = target.getTime() - Date.now();
  if (waitMs <= 0) {
    console.log(`START_AT ${startAt} has already passed; polling now.`);
    return;
  }

  console.log(`Waiting until ${target.toLocaleString()} to start polling...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function nextLocalTime(hhmmss) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmmss);
  if (!match) {
    throw new Error('START_AT must use HH:mm or HH:mm:ss.');
  }

  const [, hh, mm, ss = '0'] = match;
  const target = new Date();
  target.setHours(Number(hh), Number(mm), Number(ss), 0);
  if (target.getTime() < Date.now() - 1000) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

async function pollAndClick(page, value) {
  const deadline = Date.now() + value.timeoutSeconds * 1000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    console.log(`[${new Date().toLocaleTimeString()}] attempt ${attempt}: checking slot...`);

    const clicked = await clickTargetSlotIfAvailable(page, value.targetSlot);
    if (clicked) {
      console.log(`Clicked Book Now for "${value.targetSlot}".`);
      await page.bringToFront();
      return;
    }

    await page.reload({ waitUntil: 'domcontentloaded' }).catch(async (error) => {
      console.log(`Reload failed: ${error.message}`);
      await page.waitForTimeout(value.refreshMs);
    });
    await page.waitForTimeout(value.refreshMs);
  }

  console.log(`Timed out after ${value.timeoutSeconds}s without finding "${value.targetSlot}".`);
}

async function clickTargetSlotIfAvailable(page, targetSlot) {
  const byDataSlot = page.locator(`button[data-slot-text="${cssString(targetSlot)}"]`).first();
  if (await isClickable(byDataSlot)) {
    await byDataSlot.click();
    return true;
  }

  const byAria = page.locator(`button[aria-label*="${cssString(targetSlot)}"]`, {
    hasText: /Book Now/i,
  }).first();
  if (await isClickable(byAria)) {
    await byAria.click();
    return true;
  }

  const opensCount = await page.getByText(/Opens at/i).count().catch(() => 0);
  const bookNowCount = await page.getByRole('button', { name: /Book Now/i }).count().catch(() => 0);
  console.log(`  not ready yet; opens=${opensCount}, bookNowButtons=${bookNowCount}`);
  return false;
}

async function isClickable(locator) {
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

function cssString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
