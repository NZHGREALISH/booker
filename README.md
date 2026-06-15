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
TARGET_SLOTS=8 - 8:50 PM,7 - 7:55 PM,6 - 6:55 PM
SELECT_SLOTS_MENU=true
TARGET_DATE=2026-06-16
TARGET_FACILITIES=Court 01-AC-Badminton,Court 02-AC-Badminton,Court 03-AC-Badminton
START_AT=19:59:55
LOOP_UNTIL_SUCCESS=true
```

## Recommended Flow

```bash
npm start
```

The script first shows a numbered time-slot menu. Press Enter to use `TARGET_SLOTS`, or enter a priority list such as `13,12,11`, `11-13`, `pm`, or `all`. It then opens a visible Chromium window. Log in once, then press Enter in the terminal. It will open three tabs, select the target date and one court per tab, wait until `START_AT`, refresh until one of your selected slots appears, click the first available match by priority, and keep looping until the page reports booking success.

## Use Your Default Chrome Login

Run one command:

```bash
npm run start:default-chrome
```

It starts your normal Google Chrome profile with remote debugging, then connects the booking script to it, so your existing UofT login cookies should be available. If regular Chrome is already open and cannot accept the debug flag, the script will ask whether to quit Chrome and restart it in debug mode.

## Test One Click

```bash
npm run test:click
```

This opens one browser tab, selects `TEST_FACILITY` plus the configured date, clicks exactly one matching `Book Now` button, waits a few seconds, and prints whether success/failure/captcha UI appeared. If `TEST_SLOTS` is blank, it uses `TARGET_SLOTS`, then `TARGET_SLOT`.

## Connect To A Separate Chrome Profile

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
- If the site changes the slot text, inspect the button's `data-slot-text` and update `TARGET_SLOTS`.
