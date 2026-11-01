const { chromium } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');

(async () => {
  // Discover regular Chrome, never the separate Chrome Beta profile.
  const portFile = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort');
  const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  console.log('Connecting to regular Chrome. Approve its debugging prompt once.');
  const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${endpoint}`, { timeout: 120000 });
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    do {
      // Reload the test module so changes are picked up without reconnecting.
      const testPath = require.resolve('../tests/player-smoke.cjs');
      delete require.cache[testPath];
      const passed = await require(testPath)(browser, { foreground: process.argv.includes('--foreground') });
      process.exitCode = passed ? 0 : 1;
      console.log(passed ? 'All enabled smoke checks passed. See results.json for any skips.' : 'Smoke checks failed. See .artifacts/smoke/results.json.');
      if (process.argv.includes('--once')) break;
      const command = await prompt.question('Connection stays open. Enter to rerun, or q to disconnect: ');
      if (command.trim().toLowerCase() === 'q') break;
    } while (true);
  } finally {
    prompt.close();
    await browser.close(); // Disconnect Playwright; leave the user's Chrome running.
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
