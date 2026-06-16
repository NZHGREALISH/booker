import { spawn } from 'node:child_process';

await new Promise((resolve) => {
  const child = spawn(process.execPath, ['src/booker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOOKER_MODE: 'persistent',
      USER_DATA_DIR: process.env.USER_DATA_DIR || '.browser-profile',
      CHROME_EXECUTABLE_PATH: '',
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
