import { existsSync } from 'node:fs';

const candidates = process.platform === 'win32'
  ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]
  : process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];

export function browserPath() {
  const configured = process.env.TRAMELI_BROWSER_PATH;
  if (configured) {
    if (!existsSync(configured)) throw new Error(`TRAMELI_BROWSER_PATH não existe: ${configured}`);
    return configured;
  }
  const detected = candidates.find(existsSync);
  if (!detected) {
    throw new Error('Chrome, Chromium ou Edge não encontrado. Configure TRAMELI_BROWSER_PATH.');
  }
  return detected;
}

export const headlessFlags = [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--no-first-run',
];
