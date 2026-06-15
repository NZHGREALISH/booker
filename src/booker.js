import 'dotenv/config';
import {
  boolEnv,
  clickTargetSlotIfAvailable,
  csvEnv,
  openBrowser,
  pickPage,
  requiredEnv,
  selectDate,
  selectFacility,
  validateCommonConfig,
  waitForEnter,
  waitForBookingOutcome,
  waitForSlotsToSettle,
} from './lib.js';

const config = {
  bookingUrl: requiredEnv('BOOKING_URL'),
  targetSlots: csvEnv('TARGET_SLOTS', optionalSingleEnv('TARGET_SLOT')),
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
  loopUntilSuccess: boolEnv('LOOP_UNTIL_SUCCESS', true),
  bookingResultTimeoutMs: Number(process.env.BOOKING_RESULT_TIMEOUT_MS || 120000),
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
console.log('3. Keep the browser visible for captcha/confirmation after a click.');
console.log(`4. Target slots, in priority order: ${config.targetSlots.join(', ')}\n`);

await waitForEnter('Press Enter when the page is ready...');

const workerPages = await createWorkerPages(browserState.context, page, config);
await prepareWorkers(workerPages, config);

await waitUntilStart(config.startAt);
await raceWorkers(workerPages, config);

console.log('\nDone. Browser left open so you can finish captcha/confirmation if shown.');

function validateConfig(value) {
  validateCommonConfig(value);
  if (!Number.isFinite(value.refreshMs) || value.refreshMs < 250) {
    throw new Error('REFRESH_MS must be a number >= 250.');
  }
  if (!Number.isFinite(value.timeoutSeconds) || value.timeoutSeconds < 1) {
    throw new Error('TIMEOUT_SECONDS must be a positive number. Set LOOP_UNTIL_SUCCESS=true to ignore it.');
  }
  if (!Number.isFinite(value.bookingResultTimeoutMs) || value.bookingResultTimeoutMs < 1000) {
    throw new Error('BOOKING_RESULT_TIMEOUT_MS must be a number >= 1000.');
  }
  if (value.targetFacilities.length === 0) {
    throw new Error('TARGET_FACILITIES must contain at least one court name.');
  }
  if (value.targetSlots.length === 0) {
    throw new Error('TARGET_SLOTS/TARGET_SLOT must contain at least one slot.');
  }
}

function optionalSingleEnv(name) {
  const value = process.env[name]?.trim();
  return value ? [value] : [];
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
  const state = { winner: null, activeAttempt: null };
  const stop = () => {
    for (const worker of workers) {
      worker.stopped = true;
    }
  };

  await Promise.all(workers.map(async (worker) => {
    const result = await pollAndClick(worker, value, state);
    if (result) {
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

  while (!worker.stopped && !state.winner && (value.loopUntilSuccess || Date.now() < deadline)) {
    attempt += 1;
    if (state.activeAttempt) {
      await page.waitForTimeout(value.refreshMs);
      continue;
    }

    console.log(`[${new Date().toLocaleTimeString()}] ${facilityName} attempt ${attempt}: checking slot...`);

    const clicked = await clickTargetSlotIfAvailable(page, value.targetSlots, facilityName, state);
    if (clicked) {
      console.log(`Clicked Book Now for "${clicked.slotText}" on ${facilityName}; waiting for booking result...`);
      await page.bringToFront();
      const outcome = await waitForBookingOutcome(page, value.bookingResultTimeoutMs);
      console.log(`Booking result for ${facilityName} ${clicked.slotText}: ${outcome.status}`);

      if (outcome.status === 'success') {
        state.winner = { page, facilityName, targetSlot: clicked.slotText };
        return state.winner;
      }

      state.activeAttempt = null;
      await refreshSlots(worker, value);
      await page.waitForTimeout(value.refreshMs);
      continue;
    }

    await refreshSlots(worker, value);
    await page.waitForTimeout(value.refreshMs);
  }

  if (!worker.stopped) {
    console.log(`${facilityName} timed out after ${value.timeoutSeconds}s without a successful booking.`);
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
    await waitForSlotsToSettle(page, 1500);
    return;
  }

  console.log(`${facilityName} slot refresh function missing; reloading page.`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await selectDate(page, value);
  await selectFacility(page, facilityName);
  await waitForSlotsToSettle(page, 1500);
}
