/**
 * 序列化执行所有 acme.sh 相关任务，避免并发签发/续期互相干扰。
 */
let tail: Promise<unknown> = Promise.resolve();

export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(fn, fn);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
