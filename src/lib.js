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

export function boolEnv(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'y', 'on'].includes(value);
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
  const launchOptions = {
    headless: false,
    viewport: { width: 1280, height: 900 },
  };
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...launchOptions,
  });
  return { context, close: async () => context.close() };
}

export async function pickPage(browserState, value) {
  const pages = browserState.context.pages();
  if (value.mode === 'cdp' && pages.length > 0) {
    const bookingHost = new URL(value.bookingUrl).hostname;
    const matching = pages.find((p) => {
      try {
        return new URL(p.url()).hostname === bookingHost;
      } catch {
        return false;
      }
    });
    return matching || pages[0];
  }
  return pages[0] || await browserState.context.newPage();
}

export async function waitForEnter(prompt) {
  await askQuestion(prompt);
}

export async function askQuestion(prompt) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
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

export async function clickTargetSlotIfAvailable(page, targetSlots, facilityName, state = {}) {
  if (state.winner || state.activeAttempt) {
    return false;
  }

  const requestedSlots = Array.isArray(targetSlots) ? targetSlots : [targetSlots];
  const matchedSlot = await findMatchingBookNowSlot(page, requestedSlots);
  if (matchedSlot) {
    const button = page.locator('button[data-slot-text]').nth(matchedSlot.index);
    if (await isClickable(button)) {
      if (state.winner || state.activeAttempt) {
        return false;
      }
      console.log(`  ${facilityName} matched slot "${matchedSlot.slotText}" via ${matchedSlot.reason} for requested "${matchedSlot.requestedSlot}"`);
      state.activeAttempt = { page, facilityName, targetSlot: matchedSlot.slotText };
      await clearBookingAlerts(page);
      await button.click();
      return matchedSlot;
    }
  }

  for (const targetSlot of requestedSlots) {
    const byDataSlot = page.locator(`button[data-slot-text="${cssString(targetSlot)}"]`).first();
    if (await isClickable(byDataSlot)) {
      if (state.winner || state.activeAttempt) {
        return false;
      }
      state.activeAttempt = { page, facilityName, targetSlot };
      await clearBookingAlerts(page);
      await byDataSlot.click();
      return { slotText: targetSlot, requestedSlot: targetSlot, reason: 'exact selector match' };
    }

    const byAria = page.locator(`button[aria-label*="${cssString(targetSlot)}"]`, {
      hasText: /Book Now/i,
    }).first();
    if (await isClickable(byAria)) {
      if (state.winner || state.activeAttempt) {
        return false;
      }
      state.activeAttempt = { page, facilityName, targetSlot };
      await clearBookingAlerts(page);
      await byAria.click();
      return { slotText: targetSlot, requestedSlot: targetSlot, reason: 'aria selector match' };
    }
  }

  const opensCount = await page.getByText(/Opens at/i).count().catch(() => 0);
  const bookNowCount = await page.getByRole('button', { name: /Book Now/i }).count().catch(() => 0);
  console.log(`  ${facilityName} not ready yet; opens=${opensCount}, bookNowButtons=${bookNowCount}`);
  if (bookNowCount > 0) {
    await logAvailableSlots(page, facilityName);
  }
  return false;
}

async function clearBookingAlerts(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.booking-detail-alert').forEach((element) => {
      element.style.display = 'none';
    });
  }).catch(() => {});
}

export async function waitForSlotsToSettle(page, timeout = 1500) {
  await page.waitForFunction(() => {
    const container = document.querySelector('#divBookingSlots');
    if (!container) {
      return false;
    }
    return container.querySelectorAll('button').length > 0 || container.textContent.trim().length > 0;
  }, undefined, { timeout }).catch(() => {});
}

async function findMatchingBookNowSlot(page, targetSlots) {
  const candidates = await getSlotCandidates(page);

  for (const targetSlot of targetSlots) {
    const target = normalizeSlotText(targetSlot);
    const exact = candidates.find((candidate) => (
      candidate.isBookNow &&
      candidate.enabled &&
      candidate.visible &&
      normalizeSlotText(candidate.slotText) === target
    ));
    if (exact) {
      return { ...exact, requestedSlot: targetSlot, reason: 'exact text match' };
    }
  }

  for (const targetSlot of targetSlots) {
    const loose = candidates.find((candidate) => (
      candidate.isBookNow &&
      candidate.enabled &&
      candidate.visible &&
      isLooseSlotMatch(candidate.slotText, targetSlot)
    ));
    if (loose) {
      return { ...loose, requestedSlot: targetSlot, reason: 'loose text match' };
    }
  }

  return null;
}

export async function waitForBookingOutcome(page, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let captchaLogged = false;

  while (Date.now() < deadline) {
    const outcome = await inspectBookingOutcome(page);
    if (outcome.success) {
      return { status: 'success', outcome };
    }
    if (outcome.noSpots) {
      return { status: 'no-spots', outcome };
    }
    if (outcome.failure) {
      return { status: 'failure', outcome };
    }
    if ((outcome.captcha || outcome.confirmButton) && !captchaLogged) {
      console.log('  Booking confirmation/captcha is visible. Waiting for manual completion...');
      captchaLogged = true;
    }
    await page.waitForTimeout(500);
  }

  return { status: 'timeout', outcome: await inspectBookingOutcome(page) };
}

export async function inspectBookingOutcome(page) {
  return {
    success: await page.locator('#alertBookingSuccess').isVisible().catch(() => false),
    failure: await page.locator('#alertBookingFailure').isVisible().catch(() => false),
    noSpots: await page.locator('#alertBookingFailure-NoSpots').isVisible().catch(() => false),
    captcha: await page.locator('#modalReCaptchaConfirm.show, #modalReCaptchaConfirm[style*="display: block"]').isVisible().catch(() => false),
    confirmButton: await page.locator('#btnReCaptchaConfirm').isVisible().catch(() => false),
  };
}

async function logAvailableSlots(page, facilityName) {
  const candidates = await getSlotCandidates(page);
  const printable = candidates
    .filter((candidate) => candidate.slotText)
    .map((candidate) => `${candidate.slotText} => ${candidate.text}${candidate.enabled ? '' : ' (disabled)'}`)
    .join(' | ');

  if (printable) {
    console.log(`  ${facilityName} slots: ${printable}`);
  }
}

async function getSlotCandidates(page) {
  return page.locator('button[data-slot-text]').evaluateAll((buttons) => buttons.map((button, index) => ({
    index,
    slotText: button.getAttribute('data-slot-text') || '',
    text: button.textContent.trim().replace(/\s+/g, ' '),
    enabled: !button.disabled && !button.classList.contains('disabled'),
    visible: !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
    isBookNow: /book now/i.test(button.textContent),
  }))).catch(() => []);
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

function normalizeSlotText(value) {
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .replace(/[–—]/g, '-');
}

function isLooseSlotMatch(actual, target) {
  const normalizedActual = normalizeSlotText(actual);
  const normalizedTarget = normalizeSlotText(target);

  if (normalizedActual === normalizedTarget) {
    return true;
  }

  if (/(am|pm)$/i.test(normalizedActual)) {
    return false;
  }

  const actualWithoutSuffix = normalizedActual.replace(/(am|pm)$/i, '');
  const targetWithoutSuffix = normalizedTarget.replace(/(am|pm)$/i, '');
  return actualWithoutSuffix === targetWithoutSuffix && /pm$/i.test(normalizedTarget);
}
