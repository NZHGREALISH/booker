import { spawn } from 'node:child_process';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeUserDataDir = path.resolve(process.env.CHROME_USER_DATA_DIR || '.chrome-debug-profile');

await runBooker();

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
