import 'dotenv/config';
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';

const config = {
  bookingUrl: requiredEnv('BOOKING_URL'),
  targetSlot: requiredEnv('TARGET_SLOT'),
  targetDate: process.env.TARGET_DATE?.trim() || '',
  targetDateText: process.env.TARGET_DATE_TEXT?.trim() || '',
  targetFacilities: csvEnv('TARGET_FACILITIES', [
    'Court 01-AC-Badminton',
    'Court 02-AC-Badminton',
    'Court 03-AC-Badminton',
  ]),
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
console.log('2. The script will auto-select the configured date and courts after you continue.');
console.log('3. Keep the browser visible for captcha/confirmation after the click.\n');

await waitForEnter('Press Enter when the page is ready...');

const workerPages = await createWorkerPages(browserState.context, page, config);
await prepareWorkers(workerPages, config);

await waitUntilStart(config.startAt);
await raceWorkers(workerPages, config);

console.log('\nDone. Browser left open so you can finish captcha/confirmation if shown.');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function csvEnv(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
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
  if (value.targetFacilities.length === 0) {
    throw new Error('TARGET_FACILITIES must contain at least one court name.');
  }
  if (!value.targetDate && !value.targetDateText) {
    throw new Error('Set TARGET_DATE as YYYY-MM-DD, or set TARGET_DATE_TEXT.');
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

async function createWorkerPages(context, firstPage, value) {
  const pages = [];
  for (let i = 0; i < value.targetFacilities.length; i += 1) {
    const page = i === 0 ? firstPage : await context.newPage();
    await page.goto(value.bookingUrl, { waitUntil: 'domcontentloaded' });
    pages.push({ page, facilityName: value.targetFacilities[i], stopped: false });
  }
  return pages;
}

async function prepareWorkers(workers, value) {
  for (const worker of workers) {
    console.log(`Preparing ${worker.facilityName}...`);
    await worker.page.bringToFront();
    await selectDate(worker.page, value);
    await selectFacility(worker.page, worker.facilityName);
  }
  await workers[0].page.bringToFront();
}

async function selectDate(page, value) {
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

function parseIsoDate(value) {
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

async function selectFacility(page, facilityName) {
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

async function raceWorkers(workers, value) {
  const state = { winner: null };
  const stop = () => {
    for (const worker of workers) {
      worker.stopped = true;
    }
  };

  await Promise.all(workers.map(async (worker) => {
    const result = await pollAndClick(worker, value, state);
    if (result) {
      if (!state.winner) {
        state.winner = result;
      }
      stop();
    }
  }));

  if (state.winner) {
    console.log(`Winner: ${state.winner.facilityName} for "${state.winner.targetSlot}".`);
    await state.winner.page.bringToFront();
  }
}

async function pollAndClick(worker, value, state) {
  const { page, facilityName } = worker;
  const deadline = Date.now() + value.timeoutSeconds * 1000;
  let attempt = 0;

  while (!worker.stopped && Date.now() < deadline) {
    attempt += 1;
    console.log(`[${new Date().toLocaleTimeString()}] ${facilityName} attempt ${attempt}: checking slot...`);

    const clicked = await clickTargetSlotIfAvailable(page, value.targetSlot, facilityName, state);
    if (clicked) {
      console.log(`Clicked Book Now for "${value.targetSlot}" on ${facilityName}.`);
      await page.bringToFront();
      return { page, facilityName, targetSlot: value.targetSlot };
    }

    await refreshSlots(worker, value);
    await page.waitForTimeout(value.refreshMs);
  }

  if (!worker.stopped) {
    console.log(`${facilityName} timed out after ${value.timeoutSeconds}s without finding "${value.targetSlot}".`);
  }
  return null;
}

async function refreshSlots(worker, value) {
  const { page, facilityName } = worker;
  const usedPageFunction = await page.evaluate(() => {
    if (typeof window.loadBookingSlots === 'function') {
      window.loadBookingSlots();
      return true;
    }
    return false;
  }).catch(() => false);

  if (usedPageFunction) {
    await page.waitForTimeout(150);
    return;
  }

  console.log(`${facilityName} slot refresh function missing; reloading page.`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await selectDate(page, value);
  await selectFacility(page, facilityName);
}

async function clickTargetSlotIfAvailable(page, targetSlot, facilityName, state) {
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
