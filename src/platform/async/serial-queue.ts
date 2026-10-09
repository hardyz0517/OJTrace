/** Each owner creates its own queue; a key is held until the task settles. */
export function createKeyedSerialQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const operation = (tails.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(task);
    tails.set(key, operation);
    void operation
      .finally(() => {
        if (tails.get(key) === operation) tails.delete(key);
      })
      .catch(() => undefined);
    return operation;
  };
}
