import { describe, expect, it } from 'vitest';
import { detectBrowser, webGpuSteps } from '../../src/app/webgpuGuide';

const UA = {
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('detectBrowser', () => {
  it('tells browsers and systems apart from the user agent', () => {
    expect(detectBrowser(UA.chromeLinux)).toEqual({ browser: 'chrome', os: 'linux' });
    expect(detectBrowser(UA.chromeWin)).toEqual({ browser: 'chrome', os: 'windows' });
    expect(detectBrowser(UA.edgeWin)).toEqual({ browser: 'edge', os: 'windows' });
    expect(detectBrowser(UA.firefoxLinux)).toEqual({ browser: 'firefox', os: 'linux' });
    expect(detectBrowser(UA.safariMac)).toEqual({ browser: 'safari', os: 'mac' });
    expect(detectBrowser('')).toEqual({ browser: 'other', os: 'other' });
  });
});

describe('webGpuSteps', () => {
  it('Chrome on Linux points at chrome://flags, Vulkan and Unsafe WebGPU', () => {
    const text = webGpuSteps(detectBrowser(UA.chromeLinux)).join('\n');
    expect(text).toContain('chrome://flags');
    expect(text).toContain('Vulkan');
    expect(text).toContain('Unsafe WebGPU');
  });
  it('Chrome on Windows and macOS talks about updating and hardware acceleration', () => {
    for (const ua of [UA.chromeWin, UA.chromeMac]) {
      const text = webGpuSteps(detectBrowser(ua)).join('\n');
      expect(text).toContain('hardware acceleration');
      expect(text).not.toContain('Vulkan');
    }
  });
  it('Firefox points at dom.webgpu.enabled', () => {
    expect(webGpuSteps(detectBrowser(UA.firefoxLinux)).join('\n')).toContain('dom.webgpu.enabled');
  });
});
