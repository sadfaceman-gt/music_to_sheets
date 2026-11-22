/** Startup capability checks (Design 15.1). Browser-only, so it lives in app/, not core/. */

export type CheckStatus = 'supported' | 'unsupported' | 'error';

export interface CapabilityCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What the app does without it. */
  fallback: string;
}

async function checkWebGpu(): Promise<{ gpu: CapabilityCheck; f16: CapabilityCheck }> {
  const fallback = 'Separation and transcription run on WASM (CPU), several times slower.';
  const f16Fallback = 'Models run in fp32 on WebGPU, using more memory.';
  if (!('gpu' in navigator) || !navigator.gpu) {
    return {
      gpu: { id: 'webgpu', label: 'WebGPU', status: 'unsupported', detail: 'navigator.gpu is missing', fallback },
      f16: { id: 'shader-f16', label: 'shader-f16', status: 'unsupported', detail: 'needs WebGPU', fallback: f16Fallback },
    };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        gpu: { id: 'webgpu', label: 'WebGPU', status: 'unsupported', detail: 'no GPU adapter available', fallback },
        f16: { id: 'shader-f16', label: 'shader-f16', status: 'unsupported', detail: 'needs a GPU adapter', fallback: f16Fallback },
      };
    }
    const info = adapter.info;
    const name = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'adapter found';
    const hasF16 = adapter.features.has('shader-f16');
    return {
      gpu: { id: 'webgpu', label: 'WebGPU', status: 'supported', detail: name, fallback },
      f16: {
        id: 'shader-f16',
        label: 'shader-f16',
        status: hasF16 ? 'supported' : 'unsupported',
        detail: hasF16 ? 'adapter supports shader-f16' : 'adapter lacks shader-f16',
        fallback: f16Fallback,
      },
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      gpu: { id: 'webgpu', label: 'WebGPU', status: 'error', detail, fallback },
      f16: { id: 'shader-f16', label: 'shader-f16', status: 'error', detail: 'WebGPU check failed', fallback: f16Fallback },
    };
  }
}

function checkIsolation(): CapabilityCheck {
  const isolated = globalThis.crossOriginIsolated === true;
  const sab = typeof SharedArrayBuffer !== 'undefined';
  return {
    id: 'cross-origin-isolated',
    label: 'crossOriginIsolated',
    status: isolated ? 'supported' : 'unsupported',
    detail: `crossOriginIsolated = ${String(isolated)}, SharedArrayBuffer ${sab ? 'available' : 'missing'}`,
    fallback: 'Separation falls back to single-threaded WASM.',
  };
}

async function checkOpfs(): Promise<CapabilityCheck> {
  const fallback = 'Audio and stems are kept in IndexedDB instead, which is slower for large files.';
  if (!navigator.storage?.getDirectory) {
    return { id: 'opfs', label: 'OPFS', status: 'unsupported', detail: 'navigator.storage.getDirectory is missing', fallback };
  }
  try {
    await navigator.storage.getDirectory();
    return { id: 'opfs', label: 'OPFS', status: 'supported', detail: 'origin private file system opened', fallback };
  } catch (e) {
    return { id: 'opfs', label: 'OPFS', status: 'error', detail: e instanceof Error ? e.message : String(e), fallback };
  }
}

function checkDirectoryPicker(): CapabilityCheck {
  const ok = 'showDirectoryPicker' in window;
  return {
    id: 'directory-picker',
    label: 'Directory picker',
    status: ok ? 'supported' : 'unsupported',
    detail: ok ? 'window.showDirectoryPicker is available' : 'window.showDirectoryPicker is missing',
    fallback: 'Choose your sound folder with a folder upload instead; it is not remembered between visits.',
  };
}

export async function runCapabilityChecks(): Promise<CapabilityCheck[]> {
  const [{ gpu, f16 }, opfs] = await Promise.all([checkWebGpu(), checkOpfs()]);
  return [gpu, f16, checkIsolation(), opfs, checkDirectoryPicker()];
}
