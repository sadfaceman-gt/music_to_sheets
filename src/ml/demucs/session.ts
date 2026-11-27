/**
 * onnxruntime-web session for HT-Demucs in the separation worker (Design 7.4), as src/ml/beatthis/session.ts:
 * WebGPU only on a non-fallback adapter, else WASM. WASM threads leave the user's PC half its cores:
 * max(1, min(8, floor(hardwareConcurrency / 2))) when crossOriginIsolated, else 1. A WebGPU failure (at creation or on
 * a run) rebuilds the session on WASM, retries that segment and records why in `fallbackReason`.
 * graphOptimizationLevel 'basic' as demucs-web (its default for this model).
 */
import type { SegmentSession } from './processor.ts';

export type DemucsBackend = 'webgpu' | 'wasm';

export interface DemucsSession extends SegmentSession {
  /** Where the model runs now; 'wasm' after a WebGPU failure. */
  readonly backend: DemucsBackend;
  /** Why WebGPU was given up for WASM, or null. */
  readonly fallbackReason: string | null;
  release(): Promise<void>;
}

type Ort = typeof import('onnxruntime-web/wasm');
type OrtSession = Awaited<ReturnType<Ort['InferenceSession']['create']>>;
type Feeds = Parameters<OrtSession['run']>[0];

export function wasmThreads(): number {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
  return isolated ? Math.max(1, Math.min(8, Math.floor(cores / 2))) : 1; // facts-ok: thread cap, half the cores
}

async function loadOrt(backend: DemucsBackend): Promise<Ort> {
  // Same builds as Beat This!: 'webgpu' (has both providers) or plain 'wasm'; Vite emits their .wasm files.
  const ort = backend === 'webgpu' ? ((await import('onnxruntime-web/webgpu')) as unknown as Ort) : await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = wasmThreads();
  return ort;
}

/** A non-fallback WebGPU adapter exists (a software adapter runs the model far slower than WASM). */
export async function hasWebGpu(): Promise<boolean> {
  try {
    type Adapter = { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = (gpu ? await gpu.requestAdapter() : null) as Adapter | null;
    return !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false);
  } catch {
    return false;
  }
}

interface Opened {
  ort: Ort;
  session: OrtSession;
}

async function open(model: Uint8Array, backend: DemucsBackend): Promise<Opened> {
  const ort = await loadOrt(backend);
  const session = await ort.InferenceSession.create(model, { executionProviders: [backend], graphOptimizationLevel: 'basic' });
  return { ort, session };
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Creates a session on `prefer` (default: WebGPU if a real adapter exists, else WASM). */
export async function createDemucsSession(model: Uint8Array, prefer?: DemucsBackend): Promise<DemucsSession> {
  let backend: DemucsBackend = prefer ?? ((await hasWebGpu()) ? 'webgpu' : 'wasm');
  let fallbackReason: string | null = null;
  let current: Opened;
  try {
    current = await open(model, backend);
  } catch (e) {
    if (backend !== 'webgpu') throw e;
    fallbackReason = `WebGPU couldn't start the model (${describe(e)}); running on WASM.`;
    backend = 'wasm';
    current = await open(model, backend);
  }

  const handle: DemucsSession = {
    get backend() {
      return backend;
    },
    get fallbackReason() {
      return fallbackReason;
    },
    get inputNames() {
      return current.session.inputNames;
    },
    get outputNames() {
      return current.session.outputNames;
    },
    tensor(data, dims) {
      return new current.ort.Tensor('float32', data, dims);
    },
    async run(feeds) {
      try {
        return await current.session.run(feeds as Feeds);
      } catch (e) {
        if (backend !== 'webgpu') throw e;
        // WebGPU failed while running: rebuild on WASM and run these inputs again there.
        await current.session.release().catch(() => undefined);
        fallbackReason = `WebGPU failed while separating (${describe(e)}); running on WASM.`;
        backend = 'wasm';
        current = await open(model, backend);
        const again: Record<string, unknown> = {};
        for (const [name, t] of Object.entries(feeds)) {
          const { data, dims } = t as { data: Float32Array; dims: readonly number[] };
          again[name] = new current.ort.Tensor('float32', data, dims);
        }
        return await current.session.run(again as Feeds);
      }
    },
    async release() {
      await current.session.release().catch(() => undefined);
    },
  };
  return handle;
}
