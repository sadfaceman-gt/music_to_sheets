/** Pure helpers for the WebGPU setup guide (Design 15.1): detect the browser and OS, list the steps to try. */

export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
export type OsName = 'linux' | 'windows' | 'mac' | 'android' | 'ios' | 'other';

export interface BrowserEnv {
  browser: BrowserName;
  os: OsName;
}

/** Browser and OS from a user-agent string. Edge and Opera say "Chrome" too, so Edge is tested first. */
export function detectBrowser(ua: string): BrowserEnv {
  let os: OsName = 'other';
  if (/Android/i.test(ua)) os = 'android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'ios';
  else if (/Windows/i.test(ua)) os = 'windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'mac';
  else if (/Linux|X11|CrOS/i.test(ua)) os = 'linux';

  let browser: BrowserName = 'other';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'edge';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'firefox';
  else if (/Chrome\/|Chromium\/|CriOS\//.test(ua)) browser = 'chrome';
  else if (/Safari\//.test(ua)) browser = 'safari';
  return { browser, os };
}

const BROWSER_LABEL: Record<BrowserName, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  other: 'your browser',
};
const OS_LABEL: Record<OsName, string> = {
  linux: 'Linux',
  windows: 'Windows',
  mac: 'macOS',
  android: 'Android',
  ios: 'iOS',
  other: 'your system',
};

export function describeEnv(env: BrowserEnv): string {
  return `${BROWSER_LABEL[env.browser]} on ${OS_LABEL[env.os]}`;
}

/** Steps to try for turning WebGPU on, for the detected browser and OS. A page can't do this itself. */
export function webGpuSteps(env: BrowserEnv): string[] {
  const { browser, os } = env;
  if (browser === 'firefox') {
    return [
      'Update Firefox to the latest version.',
      'Open about:config and accept the warning.',
      'Search for dom.webgpu.enabled and set it to true.',
      'Restart Firefox, then use "Check again" below.',
    ];
  }
  if (browser === 'chrome' || browser === 'edge') {
    const name = BROWSER_LABEL[browser];
    const flags = browser === 'edge' ? 'edge://flags' : 'chrome://flags';
    if (os === 'linux') {
      return [
        `Update ${name} to the latest version.`,
        `Open ${flags} and set "Vulkan" (#enable-vulkan) to Enabled.`,
        `In ${flags} set "Unsafe WebGPU Support" (#enable-unsafe-webgpu) to Enabled.`,
        'Make sure your graphics driver supports Vulkan (Mesa or the vendor driver).',
        `Relaunch ${name}, then use "Check again" below.`,
      ];
    }
    if (os === 'windows' || os === 'mac') {
      return [
        `Update ${name} to the latest version.`,
        'Open the browser settings, search for "hardware acceleration" and turn "Use graphics acceleration when available" on.',
        'Update your graphics driver.',
        `Relaunch ${name}, then use "Check again" below.`,
      ];
    }
    return [`Update ${name} to the latest version.`, 'Turn on hardware acceleration in the browser settings.', 'Then use "Check again" below.'];
  }
  if (browser === 'safari') {
    return ['Update Safari and macOS to the latest versions.', 'Then use "Check again" below, or use Chrome or Firefox.'];
  }
  return ['Use a recent Chrome, Edge or Firefox, then use "Check again" below.'];
}
