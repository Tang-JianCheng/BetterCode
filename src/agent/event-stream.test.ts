import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventStream } from './event-stream.js';

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

test('event stream preserves buffered and asynchronous event order', async () => {
  const stream = createEventStream<number>(async emit => {
    emit(1);
    emit(2);
    await Promise.resolve();
    emit(3);
  });

  assert.deepEqual(await collect(stream), [1, 2, 3]);
});

test('event stream supports an empty producer', async () => {
  const stream = createEventStream<string>(async () => undefined);
  assert.deepEqual(await collect(stream), []);
});

test('event stream forwards producer failures to the consumer', async () => {
  const stream = createEventStream<number>(async emit => {
    emit(1);
    throw new Error('boom');
  });
  const iterator = stream[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: 1, done: false });
  await assert.rejects(() => iterator.next(), /boom/);
});
