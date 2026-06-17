# Booker

A Playwright-based booking helper for web booking pages that expose date buttons, facility tabs, and `Book Now` slot buttons.

The script does not bypass reCAPTCHA or other confirmation steps. It automates the repetitive parts: selecting a date, selecting one or more facilities, polling for preferred time slots, clicking the first matching `Book Now` button, and continuing until the page reports a successful booking.

## Features

- Interactive date menu: today, tomorrow, or day after tomorrow, with concrete dates shown.
- Interactive time-slot menu with priority ordering.
- Multiple facility workers: one browser tab per configured facility.
- Polling start menu: start now, or start shortly before the selected booking slot opens.
- 48-hour opening-window calculation by default.
- Persistent Chrome profile for login reuse.
- Continues after no-spots or failure responses until a success alert appears.

## Setup

```bash
npm install
npm run install:browsers
cp .env.example .env
```

Edit `.env` for the booking page and facilities:

```txt
BOOKING_URL=<booking page URL>
TARGET_FACILITIES=Facility 1,Facility 2,Facility 3
TARGET_SLOTS=8 - 8:50 PM,7 - 7:55 PM,6 - 6:55 PM
SELECT_DATE_MENU=true
SELECT_SLOTS_MENU=true
SELECT_POLLING_MENU=true
BOOKING_OPENS_HOURS=48
POLLING_LEAD_SECONDS=5
LOOP_UNTIL_SUCCESS=true
```

`BOOKING_URL` is the real booking detail page URL. `TARGET_FACILITIES` must match the visible facility tab names on the page.

## Run

From this folder:

```bash
./run
```

Each run writes a timestamped log file under `logs/` while still printing output in the terminal.

Equivalent npm command:

```bash
npm run start:default-chrome
```

This starts Playwright's bundled browser with a persistent profile at `.browser-profile`. The first run may require login once. Future runs reuse the same profile and cookies.

## Startup Menus

Date menu:

```txt
Select target date:
  1. Today - 2026-06-15 (Jun 15, 2026)
  2. Tomorrow - 2026-06-16 (Jun 16, 2026)
  3. Day after tomorrow - 2026-06-17 (Jun 17, 2026)
```

Slot menu examples:

```txt
13,12,11   # 8 PM, then 7 PM, then 6 PM
11-13      # 6 PM, then 7 PM, then 8 PM
pm         # all PM slots
all        # all slots
```

Polling menu:

```txt
1. Start now
2. Start 5s before selected slot opens
```

The opening time is calculated as:

```txt
selected date + first-priority slot start time - BOOKING_OPENS_HOURS - POLLING_LEAD_SECONDS
```

For example, if the selected date is `Jun 17`, the first-priority slot is `1 - 1:55 PM`, `BOOKING_OPENS_HOURS=48`, and `POLLING_LEAD_SECONDS=5`, polling starts at `Jun 15 12:59:55 PM`.

## Browser Profile

This project uses a dedicated browser profile so the booking session can persist independently from your everyday browser:

```txt
.browser-profile
```

## Useful Commands

```bash
./run
npm run start
npm run start:default-chrome
npm run test:menu
npm run test:click
```

## Notes

- Keep the browser visible when confirmation or CAPTCHA may appear.
- `REFRESH_MS=500` to `1000` is usually a reasonable range.
- If the site changes slot labels, inspect the button's `data-slot-text` and update `TARGET_SLOTS`.
- If you want non-interactive runs, set the menu flags to `false` and provide explicit `.env` values.
