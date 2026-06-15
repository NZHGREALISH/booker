import 'dotenv/config';
import {
  clickTargetSlotIfAvailable,
  openBrowser,
  pickPage,
  requiredEnv,
  selectDate,
  selectFacility,
  validateCommonConfig,
  waitForEnter,
} from './lib.js';

const config = {
  bookingUrl: requiredEnv('BOOKING_URL'),
  targetSlot: process.env.TEST_SLOT?.trim() || requiredEnv('TARGET_SLOT'),
  targetDate: process.env.TEST_DATE?.trim() || process.env.TARGET_DATE?.trim() || '',
  targetDateText: process.env.TEST_DATE_TEXT?.trim() || process.env.TARGET_DATE_TEXT?.trim() || '',
  testFacility: process.env.TEST_FACILITY?.trim() || 'Court 03-AC-Badminton',
  mode: process.env.BOOKER_MODE || 'persistent',
  cdpUrl: process.env.CDP_URL || 'http://127.0.0.1:9222',
  userDataDir: process.env.USER_DATA_DIR || '.browser-profile',
};

validateCommonConfig(config);

const browserState = await openBrowser(config);
const page = await pickPage(browserState, config);

await page.goto(config.bookingUrl, { waitUntil: 'domcontentloaded' });
await page.bringToFront();

console.log('\nTest click browser is open.');
console.log('Log in if needed. This will click exactly one matching Book Now button.');
console.log(`Target date: ${config.targetDate || config.targetDateText}`);
console.log(`Target facility: ${config.testFacility}`);
console.log(`Target slot: ${config.targetSlot}\n`);

await waitForEnter('Press Enter to select date/facility and click the test slot...');

await selectDate(page, config);
await selectFacility(page, config.testFacility);

const clicked = await clickTargetSlotIfAvailable(page, config.targetSlot, config.testFacility);
if (!clicked) {
  throw new Error(`No clickable Book Now button found for "${config.targetSlot}" on ${config.testFacility}.`);
}

console.log('Clicked. Waiting 8 seconds to inspect resulting page state...');
await page.waitForTimeout(8000);

const result = await inspectBookingResult(page);
console.log(JSON.stringify(result, null, 2));
console.log('\nBrowser left open. If a booking succeeded, cancel it manually from the page.');

async function inspectBookingResult(page) {
  return {
    successAlertVisible: await page.locator('#alertBookingSuccess').isVisible().catch(() => false),
    failureAlertVisible: await page.locator('#alertBookingFailure').isVisible().catch(() => false),
    noSpotsAlertVisible: await page.locator('#alertBookingFailure-NoSpots').isVisible().catch(() => false),
    captchaConfirmVisible: await page.locator('#modalReCaptchaConfirm.show, #modalReCaptchaConfirm[style*="display: block"]').isVisible().catch(() => false),
    confirmButtonVisible: await page.locator('#btnReCaptchaConfirm').isVisible().catch(() => false),
    pageUrl: page.url(),
  };
}
