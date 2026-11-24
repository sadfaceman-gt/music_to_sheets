import { MessageChannel } from 'node:worker_threads';
import * as Comlink from 'comlink';
import { describe, expect, it } from 'vitest';
import { ModelError } from '../../src/ml/beatthis/model.ts';

describe('ModelError across Comlink', () => {
  it('keeps its name and message on the main side (the client falls back on name === "ModelError")', async () => {
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(
      {
        async analyze() {
          throw new ModelError('The beat model failed its integrity check.');
        },
      },
      port1 as unknown as Comlink.Endpoint,
    );
    const remote = Comlink.wrap<{ analyze(): Promise<void> }>(port2 as unknown as Comlink.Endpoint);
    const err = await remote.analyze().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('ModelError');
    expect((err as Error).message).toBe('The beat model failed its integrity check.');
    port1.close();
    port2.close();
  });
});
