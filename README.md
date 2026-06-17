# Booker

Booker is a local Playwright helper for booking pages with:

- date buttons
- facility tabs
- time-slot rows
- `Book Now` buttons

It does not bypass CAPTCHA or confirmation dialogs. It clicks only when the page shows a matching `Book Now` button, then waits for you to finish any manual confirmation.

## Quick Start

Install once:

```bash
npm install
npm run install:browsers
cp .env.example .env
```

Configure `.env`:

```txt
BOOKING_URL=<real booking page URL>
TARGET_FACILITIES=Facility 1,Facility 2,Facility 3
```

Run:

```bash
./run
```

The first time, a browser window opens. Log in manually, navigate if needed, then return to the terminal and press Enter when the page is ready. Login is saved in `.browser-profile`, so future runs should reuse the session.

## Daily Use

1. Run:

```bash
./run
```

2. Choose a date:

```txt
1. Today - 2026-06-16 (Jun 16, 2026)
2. Tomorrow - 2026-06-17 (Jun 17, 2026)
3. Day after tomorrow - 2026-06-18 (Jun 18, 2026)
```

3. Choose target slots by priority:

```txt
13,12,11
```

This means: try slot 13 first, then 12, then 11.

Useful slot choices:

```txt
13,12,11   -> 8 PM, then 7 PM, then 6 PM
11-13      -> 6 PM, then 7 PM, then 8 PM
pm         -> all PM slots
all        -> all slots
```

4. Choose polling start:

```txt
1. Start now
2. Start 5s before selected slot opens
```

Option 2 uses:

```txt
selected date + first priority slot start time - BOOKING_OPENS_HOURS - POLLING_LEAD_SECONDS
```

Example:

```txt
Selected date: Jun 17
First slot: 1 - 1:55 PM
BOOKING_OPENS_HOURS=48
POLLING_LEAD_SECONDS=5
Polling starts: Jun 15 12:59:55 PM
```

5. When the browser is open and logged in, press Enter in the terminal.

The script opens one tab per configured facility, selects the date and facility in each tab, then polls until one selected slot is successfully booked.

## Configuration

Important `.env` values:

```txt
BOOKING_URL=<real booking page URL>
TARGET_FACILITIES=Facility 1,Facility 2,Facility 3
TARGET_SLOTS=8 - 8:50 PM,7 - 7:55 PM,6 - 6:55 PM
SELECT_DATE_MENU=true
SELECT_SLOTS_MENU=true
SELECT_POLLING_MENU=true
BOOKING_OPENS_HOURS=48
POLLING_LEAD_SECONDS=5
REFRESH_MS=650
LOOP_UNTIL_SUCCESS=true
```

`TARGET_FACILITIES` must exactly match the facility tab names on the page.

`TARGET_SLOTS` must match the button `data-slot-text` values. The interactive menu uses the built-in slot list, so you usually do not need to edit this manually.

## Logs

Every `./run` saves a timestamped log:

```txt
logs/YYYY-MM-DD_HH-MM-SS.log
```

The same output still appears in the terminal.

## Commands

```bash
./run                  # recommended
npm run start          # start with Playwright profile
npm run test:menu      # test menu parsing
npm run test:click     # click one configured test slot
```

## Troubleshooting

If the browser asks you to log in:

- Log in once in the opened browser.
- Keep using `./run`; the session is saved in `.browser-profile`.

If it does not click even though there are `Book Now` buttons:

- Check the log for visible slot text.
- Make sure your selected slots match the page's `data-slot-text`.
- The script only clicks slots in your selected priority list.

If a CAPTCHA or confirmation appears:

- Complete it manually in the browser.
- The script waits for success, failure, or no-spots status.

If you want non-interactive runs:

```txt
SELECT_DATE_MENU=false
SELECT_SLOTS_MENU=false
SELECT_POLLING_MENU=false
START_AT=
```

Then provide explicit `TARGET_DATE`, `TARGET_DATE_TEXT`, and `TARGET_SLOTS`.
