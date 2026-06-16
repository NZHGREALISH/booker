import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { askQuestion } from './lib.js';

const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeUserDataDir = path.resolve(process.env.CHROME_USER_DATA_DIR || '.chrome-debug-profile');

await main();

async function main() {
  if (isProfileLocked()) {
    console.log(`The booking Chrome profile is already in use: ${chromeUserDataDir}`);
    const answer = (await askQuestion('Close the existing booking Chrome window and continue? [Y/n] ')).trim().toLowerCase();
    if (answer && !['y', 'yes'].includes(answer)) {
      console.log('Cancelled. Close the existing booking Chrome window, then run ./run again.');
      process.exitCode = 1;
      return;
    }

    await closeBookingChrome();
    await waitForProfileUnlock(8000);
  }

  await runBooker();
}

async function runBooker() {
  console.log(`Starting Google Chrome with persistent booking profile: ${chromeUserDataDir}`);

  await new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/booker.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BOOKER_MODE: 'persistent',
        USER_DATA_DIR: chromeUserDataDir,
        CHROME_EXECUTABLE_PATH: chromePath,
      },
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exitCode = code ?? 0;
      }
      resolve();
    });
  });
}

function isProfileLocked() {
  return fs.existsSync(path.join(chromeUserDataDir, 'SingletonLock')) ||
    fs.existsSync(path.join(chromeUserDataDir, 'SingletonSocket'));
}

async function closeBookingChrome() {
  await new Promise((resolve) => {
    const child = spawn('pkill', ['-f', `--user-data-dir=${chromeUserDataDir}`], {
      stdio: 'ignore',
    });
    child.on('exit', resolve);
    child.on('error', resolve);
  });
}

async function waitForProfileUnlock(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProfileLocked()) {
      return;
    }
    await delay(250);
  }

  console.log('Profile still appears locked. If Chrome is closed, removing stale lock files and continuing.');
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    fs.rmSync(path.join(chromeUserDataDir, name), { force: true });
  }
}
