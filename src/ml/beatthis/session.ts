/**
 * onnxruntime-web session for Beat This! in the analysis worker: WebGPU when navigator.gpu gives an adapter,
 * otherwise WASM (threaded when crossOriginIsolated). The WASM files are served by the site (no CDN): Vite emits them
 * from the runtime's own new URL(..., import.meta.url), under the base path, so they load under COEP require-corp.
 * Two onnxruntime-web builds are loaded lazily, only the one needed: 'onnxruntime-web/webgpu' (asyncify wasm, 29 MB,
 * has both providers) for WebGPU and 'onnxruntime-web/wasm' (15 MB) for plain WASM.
 */
import type { InferenceBackend } from '../../core/analysis/types.ts';
import { BT_WINDOW_FRAMES } from './chunks.ts';
import type { WindowRunner } from './chunks.ts';
import { BT_N_MELS } from './frontend.ts';
import { ModelError } from './model.ts';

export interface BeatThisSession {
  /** Where the model ran; changes to 'wasm' if a WebGPU run failed and the session was rebuilt on WASM. */
  backend: InferenceBackend;
  run: WindowRunner;
  release(): Promise<void>;
}

type Ort = typeof import('onnxruntime-web/wasm');
type OrtSession = Awaited<ReturnType<Ort['InferenceSession']['create']>>;

async function loadOrt(backend: InferenceBackend): Promise<Ort> {
  const threads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1; // facts-ok: thread cap
  try {
    // The 'bundle' builds embed their glue code and locate their .wasm with new URL(..., import.meta.url), which Vite
    // rewrites to the emitted, hashed file under the base path: no wasmPaths needed (setting one to a file of another
    // variant breaks the glue/wasm pairing).
    const ort = backend === 'webgpu' ? ((await import('onnxruntime-web/webgpu')) as unknown as Ort) : await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = threads;
    return ort;
  } catch (e) {
    throw new ModelError("The beat model's runtime couldn't be loaded.", { cause: e });
  }
}

async function hasWebGpu(): Promise<boolean> {
  try {
    type Adapter = { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = (gpu ? await gpu.requestAdapter() : null) as Adapter | null;
    // A software (fallback) adapter such as SwiftShader runs the model far slower than WASM: treat it as no WebGPU.
    return !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false);
  } catch {
    return false;
  }
}

async function open(model: Uint8Array, backend: InferenceBackend): Promise<{ ort: Ort; session: OrtSession }> {
  const ort = await loadOrt(backend);
  try {
    const session = await ort.InferenceSession.create(model, { executionProviders: [backend], graphOptimizationLevel: 'all' });
    return { ort, session };
  } catch (e) {
    throw new ModelError("The beat model couldn't be started.", { cause: e });
  }
}

/** Creates a session on `prefer` (default: WebGPU if available, else WASM). Throws ModelError when no backend works. */
export async function createSession(model: Uint8Array, prefer?: InferenceBackend): Promise<BeatThisSession> {
  let backend: InferenceBackend = prefer ?? ((await hasWebGpu()) ? 'webgpu' : 'wasm');
  let current: { ort: Ort; session: OrtSession };
  try {
    current = await open(model, backend);
  } catch (e) {
    if (backend !== 'webgpu') throw e;
    backend = 'wasm';
    current = await open(model, backend);
  }

  const runOn = async (c: { ort: Ort; session: OrtSession }, window: Float32Array): Promise<{ beat: Float32Array; downbeat: Float32Array }> => {
    const input = new c.ort.Tensor('float32', window, [1, BT_WINDOW_FRAMES, BT_N_MELS]);
    const out = await c.session.run({ spect: input });
    const beat = out['beat']?.data;
    const downbeat = out['downbeat']?.data;
    if (!(beat instanceof Float32Array) || !(downbeat instanceof Float32Array)) throw new Error('unexpected model outputs');
    // Copy: the runtime may reuse its output buffers on the next run.
    return { beat: beat.slice(), downbeat: downbeat.slice() };
  };

  const handle: BeatThisSession = {
    get backend() {
      return backend;
    },
    async run(window) {
      try {
        return await runOn(current, window);
      } catch (e) {
        if (backend === 'webgpu') {
          // The first run (or a later one) failed on WebGPU: rebuild on WASM and retry this window.
          await current.session.release().catch(() => undefined);
          backend = 'wasm';
          current = await open(model, backend);
          try {
            return await runOn(current, window);
          } catch (e2) {
            throw new ModelError('The beat model failed while running.', { cause: e2 });
          }
        }
        throw new ModelError('The beat model failed while running.', { cause: e });
      }
    },
    async release() {
      await current.session.release().catch(() => undefined);
    },
  };
  return handle;
}
