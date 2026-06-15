# UofT Badminton Booker

Small Playwright helper for UofT recreation booking pages.

It does not bypass reCAPTCHA. It opens or connects to a real browser, waits until the configured time, opens one worker tab per court, selects the configured date/court in each tab, refreshes the booking page, clicks the matching `Book Now` button when it appears, then stops the other workers and leaves the browser open for you to finish any captcha/confirmation step.

## Setup

```bash
cd /Users/grealish/Downloads/uoft-badminton-booker
npm install
npm run install:browsers
cp .env.example .env
```

Edit `.env`:

```txt
BOOKING_URL=...
TARGET_SLOT=8 - 8:50 PM
TARGET_DATE=2026-06-16
TARGET_FACILITIES=Court 01-AC-Badminton,Court 02-AC-Badminton,Court 03-AC-Badminton
START_AT=19:59:55
```

## Recommended Flow

```bash
npm start
```

The script opens a visible Chromium window. Log in once, then press Enter in the terminal. It will open three tabs, select the target date and one court per tab, wait until `START_AT`, refresh until your slot appears, and click the first available one.

## Test One Click

```bash
npm run test:click
```

This opens one browser tab, selects `TEST_FACILITY` plus the configured date, clicks exactly one matching `Book Now` button, waits a few seconds, and prints whether success/failure/captcha UI appeared. If `TEST_SLOT` is blank, it uses `TARGET_SLOT`.

## Connect To Your Own Chrome

Start Chrome with remote debugging:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/uoft-booking-chrome
```

Open the booking page and log in in that Chrome window, then run:

```bash
npm run start:cdp
```

## Notes

- Keep the browser visible near 8 PM so you can solve reCAPTCHA quickly.
- `REFRESH_MS=500` to `1000` is a reasonable range.
- If the site changes the slot text, inspect the button's `data-slot-text` and update `TARGET_SLOT`.
