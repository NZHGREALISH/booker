import 'dotenv/config';
import {
  askQuestion,
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

const BOOKING_SLOT_MENU = [
  '7 - 7:55 AM',
  '8 - 8:55 AM',
  '9 - 9:55 AM',
  '10 - 10:55 AM',
  '11 - 11:55 AM',
  '12 - 12:55 PM',
  '1 - 1:55 PM',
  '2 - 2:55 PM',
  '3 - 3:55 PM',
  '5 - 5:55 PM',
  '6 - 6:55 PM',
  '7 - 7:55 PM',
  '8 - 8:50 PM',
];

if (process.env.SKIP_BOOKER_MAIN !== 'true') {
  await main();
}

async function main() {
  const config = {
    bookingUrl: requiredEnv('BOOKING_URL'),
    targetSlots: csvEnv('TARGET_SLOTS', optionalSingleEnv('TARGET_SLOT')),
    targetDate: process.env.TARGET_DATE?.trim() || '',
    targetDateText: process.env.TARGET_DATE_TEXT?.trim() || '',
    targetFacilities: csvEnv('TARGET_FACILITIES', []),
    startAt: process.env.START_AT?.trim() || '',
    refreshMs: Number(process.env.REFRESH_MS || 650),
    timeoutSeconds: Number(process.env.TIMEOUT_SECONDS || 180),
    loopUntilSuccess: boolEnv('LOOP_UNTIL_SUCCESS', true),
    selectDateMenu: boolEnv('SELECT_DATE_MENU', true),
    selectSlotsMenu: boolEnv('SELECT_SLOTS_MENU', true),
    selectPollingMenu: boolEnv('SELECT_POLLING_MENU', true),
    bookingOpensHours: Number(process.env.BOOKING_OPENS_HOURS || 48),
    pollingLeadSeconds: Number(process.env.POLLING_LEAD_SECONDS || 5),
    bookingResultTimeoutMs: Number(process.env.BOOKING_RESULT_TIMEOUT_MS || 120000),
    mode: process.env.BOOKER_MODE || 'persistent',
    cdpUrl: process.env.CDP_URL || 'http://127.0.0.1:9222',
    userDataDir: process.env.USER_DATA_DIR || '.browser-profile',
    chromeExecutablePath: process.env.CHROME_EXECUTABLE_PATH?.trim() || '',
  };

  validateConfig(config);
  if (config.selectDateMenu) {
    const selectedDate = await chooseTargetDate(config);
    config.targetDate = selectedDate.isoDate;
    config.targetDateText = selectedDate.dateText;
  }
  if (config.selectSlotsMenu) {
    config.targetSlots = await chooseTargetSlots(config.targetSlots);
  }
  if (config.selectPollingMenu) {
    config.startAt = await choosePollingStart(config);
  }
  validateTargetSlots(config);

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
}

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
  if (!Number.isFinite(value.pollingLeadSeconds) || value.pollingLeadSeconds < 0) {
    throw new Error('POLLING_LEAD_SECONDS must be a number >= 0.');
  }
  if (!Number.isFinite(value.bookingOpensHours) || value.bookingOpensHours <= 0) {
    throw new Error('BOOKING_OPENS_HOURS must be a number > 0.');
  }
  if (value.targetFacilities.length === 0) {
    throw new Error('TARGET_FACILITIES must contain at least one court name.');
  }
  if (!value.selectDateMenu && !value.targetDate && !value.targetDateText) {
    throw new Error('TARGET_DATE/TARGET_DATE_TEXT must be set when SELECT_DATE_MENU=false.');
  }
  if (!value.selectSlotsMenu) {
    validateTargetSlots(value);
  }
}

function validateTargetSlots(value) {
  if (value.targetSlots.length === 0) {
    throw new Error('TARGET_SLOTS/TARGET_SLOT must contain at least one slot.');
  }
}

function optionalSingleEnv(name) {
  const value = process.env[name]?.trim();
  return value ? [value] : [];
}

async function choosePollingStart(config) {
  const firstPrioritySlot = config.targetSlots[0];
  const startBeforeOpen = bookingOpenPollingStart(
    config.targetDate,
    firstPrioritySlot,
    config.bookingOpensHours,
    config.pollingLeadSeconds,
  );
  const startBeforeOpenLabel = formatDateTimeForDisplay(startBeforeOpen);

  while (true) {
    console.log('\nSelect polling start:');
    console.log('  1. Start now');
    console.log(`  2. Start ${config.pollingLeadSeconds}s before "${firstPrioritySlot}" opens (${startBeforeOpenLabel})`);

    const answer = (await askQuestion('Choose polling start [default: 1]: ')).trim();
    if (!answer || answer === '1') {
      console.log('Polling will start immediately.');
      return '';
    }
    if (answer === '2') {
      console.log(`Polling will start at ${startBeforeOpenLabel}.`);
      return startBeforeOpen;
    }
    console.log('Invalid selection. Choose 1 or 2.');
  }
}

export function bookingOpenPollingStart(targetDateIso, slotText, opensHours, leadSeconds) {
  const bookingTime = parseBookingSlotStartDate(targetDateIso, slotText);
  const start = new Date(bookingTime);
  start.setHours(start.getHours() - opensHours);
  start.setSeconds(start.getSeconds() - leadSeconds);
  return start;
}

export function parseBookingSlotStartDate(targetDateIso, slotText) {
  const date = parseLocalIsoDate(targetDateIso);
  const time = parseSlotStartTime(slotText);
  date.setHours(time.hour24, 0, 0, 0);
  return date;
}

function parseSlotStartTime(slotText) {
  const match = /^(\d{1,2})\s*-\s*.+?\s*(AM|PM)$/i.exec(slotText.trim());
  if (!match) {
    throw new Error(`Could not parse slot start time from "${slotText}".`);
  }

  let hour = Number(match[1]);
  const period = match[2].toUpperCase();
  if (period === 'AM') {
    hour = hour === 12 ? 0 : hour;
  } else {
    hour = hour === 12 ? 12 : hour + 12;
  }
  return { hour24: hour };
}

function formatDateTimeForDisplay(date) {
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function chooseTargetDate(config) {
  const choices = buildDateChoices();
  const defaultText = config.targetDateText || config.targetDate || choices[0].dateText;

  while (true) {
    console.log('\nSelect target date:');
    choices.forEach((choice, index) => {
      console.log(`  ${index + 1}. ${choice.label} - ${choice.isoDate} (${choice.dateText})`);
    });

    const answer = (await askQuestion(`Choose date [default: ${defaultText}]: `)).trim();
    if (!answer) {
      if (config.targetDate || config.targetDateText) {
        const fallback = {
          isoDate: config.targetDate || choices[0].isoDate,
          dateText: config.targetDateText || formatBookingDateText(parseLocalIsoDate(config.targetDate)),
        };
        console.log(`Using default date: ${fallback.isoDate} (${fallback.dateText})`);
        return fallback;
      }
      console.log(`Using default date: ${choices[0].isoDate} (${choices[0].dateText})`);
      return choices[0];
    }

    if (/^[1-3]$/.test(answer)) {
      const selected = choices[Number(answer) - 1];
      console.log(`Using selected date: ${selected.isoDate} (${selected.dateText})`);
      return selected;
    }

    console.log('Invalid selection. Choose 1, 2, or 3.');
  }
}

export function buildDateChoices(baseDate = new Date()) {
  return [
    { label: 'Today', offsetDays: 0 },
    { label: 'Tomorrow', offsetDays: 1 },
    { label: 'Day after tomorrow', offsetDays: 2 },
  ].map((choice) => {
    const date = new Date(baseDate);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + choice.offsetDays);
    return {
      ...choice,
      isoDate: formatLocalIsoDate(date),
      dateText: formatBookingDateText(date),
    };
  });
}

function parseLocalIsoDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value || '');
  if (!match) {
    return new Date();
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
}

export function formatLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatBookingDateText(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function chooseTargetSlots(defaultSlots) {
  const defaultText = defaultSlots.length ? defaultSlots.join(', ') : 'none';

  while (true) {
    console.log('\nSelect target time slots, in priority order:');
    BOOKING_SLOT_MENU.forEach((slot, index) => {
      console.log(`  ${String(index + 1).padStart(2, ' ')}. ${slot}`);
    });
    console.log('\nExamples:');
    console.log('  13,12,11   -> 8 PM, then 7 PM, then 6 PM');
    console.log('  11-13      -> 6 PM, then 7 PM, then 8 PM');
    console.log('  pm         -> all PM slots');
    console.log('  all        -> all slots');

    const answer = (await askQuestion(`Choose slots [default: ${defaultText}]: `)).trim();
    if (!answer) {
      if (defaultSlots.length > 0) {
        console.log(`Using default slots: ${defaultSlots.join(', ')}`);
        return defaultSlots;
      }
      console.log('Please choose at least one slot.');
      continue;
    }

    try {
      const selected = parseSlotMenuSelection(answer);
      console.log(`Using selected slots: ${selected.join(', ')}`);
      return selected;
    } catch (error) {
      console.log(`Invalid selection: ${error.message}`);
    }
  }
}

export function parseSlotMenuSelection(answer) {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === 'all') {
    return BOOKING_SLOT_MENU;
  }
  if (trimmed === 'am') {
    return BOOKING_SLOT_MENU.filter((slot) => slot.endsWith('AM'));
  }
  if (trimmed === 'pm') {
    return BOOKING_SLOT_MENU.filter((slot) => slot.endsWith('PM'));
  }

  const selected = [];
  const seen = new Set();
  for (const rawPart of answer.split(',')) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }

    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const step = start <= end ? 1 : -1;
      for (let current = start; current !== end + step; current += step) {
        addSlotByIndex(current, selected, seen);
      }
      continue;
    }

    if (/^\d+$/.test(part)) {
      addSlotByIndex(Number(part), selected, seen);
      continue;
    }

    const exact = BOOKING_SLOT_MENU.find((slot) => slot.toLowerCase() === part.toLowerCase());
    if (exact) {
      addSlot(exact, selected, seen);
      continue;
    }

    throw new Error(`"${part}" is not a slot number, range, or exact slot text.`);
  }

  if (selected.length === 0) {
    throw new Error('no slots selected');
  }
  return selected;
}

function addSlotByIndex(index, selected, seen) {
  if (!Number.isInteger(index) || index < 1 || index > BOOKING_SLOT_MENU.length) {
    throw new Error(`slot number ${index} is out of range`);
  }
  addSlot(BOOKING_SLOT_MENU[index - 1], selected, seen);
}

function addSlot(slot, selected, seen) {
  if (seen.has(slot)) {
    return;
  }
  seen.add(slot);
  selected.push(slot);
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

  const target = startAt instanceof Date ? startAt : nextLocalTime(startAt);
  const waitMs = target.getTime() - Date.now();
  if (waitMs <= 0) {
    console.log(`Polling start ${target.toLocaleString()} has already passed; polling now.`);
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
