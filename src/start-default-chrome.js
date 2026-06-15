import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { askQuestion } from './lib.js';

const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = new URL(cdpUrl).port || '9222';

await main();

async function main() {
  if (await isCdpReady()) {
    console.log(`Using existing Chrome debug session at ${cdpUrl}.`);
    await runBooker();
    return;
  }

  console.log('Starting your default Google Chrome profile in debug mode...');
  let chromeProcess = startChromeDebug();

  if (!await waitForCdp(6000)) {
    console.log('\nChrome debug port did not open.');
    console.log('This usually means regular Chrome is already running and reused the old non-debug session.');
    const answer = (await askQuestion('Quit Chrome and restart it in debug mode now? [Y/n] ')).trim().toLowerCase();
    if (answer && !['y', 'yes'].includes(answer)) {
      console.log('Cancelled. Quit Chrome manually, then run npm run start:default-chrome again.');
      process.exitCode = 1;
      return;
    }

    await quitChrome();
    await delay(1500);
    chromeProcess = startChromeDebug();

    if (!await waitForCdp(10000)) {
      console.error(`Could not connect to Chrome debug endpoint at ${cdpUrl}.`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Chrome debug session ready at ${cdpUrl}.`);
  await runBooker();

  // Keep the Chrome process alive. If it was reused, this may already be detached.
  chromeProcess?.unref?.();
}

function startChromeDebug() {
  return spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], {
    detached: true,
    stdio: 'ignore',
  });
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCdpReady()) {
      return true;
    }
    await delay(250);
  }
  return false;
}

async function isCdpReady() {
  try {
    const response = await fetch(`${cdpUrl}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function quitChrome() {
  await new Promise((resolve) => {
    const child = spawn('osascript', ['-e', 'tell application "Google Chrome" to quit'], {
      stdio: 'ignore',
    });
    child.on('exit', resolve);
    child.on('error', resolve);
  });
}

async function runBooker() {
  await new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/booker.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BOOKER_MODE: 'cdp',
        CDP_URL: cdpUrl,
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
