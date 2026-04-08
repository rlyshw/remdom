/**
 * Isolate pool — placeholder for Phase 3.
 * For the prototype, app code runs in the same Node process (no sandboxing).
 * This module provides the interface that will later wrap isolated-vm or workerd.
 */

export interface Isolate {
  id: string;
  /** Execute a function in the isolate context */
  run(fn: (document: any, window: any) => void, document: any, window: any): void;
  destroy(): void;
}

let nextId = 0;

/**
 * Create a "fake" isolate that just runs code in-process.
 * Phase 3 will replace this with real sandboxing.
 */
export function createIsolate(): Isolate {
  const id = `isolate-${nextId++}`;

  return {
    id,
    run(fn, document, window) {
      fn(document, window);
    },
    destroy() {
      // No-op for prototype
    },
  };
}
