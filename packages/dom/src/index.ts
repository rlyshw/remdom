// Core primitives
export { createObserver, type DomObserver, type ObserverOptions } from "./observer.js";
export { DomApplier } from "./applier.js";
export { createInputCapture, type InputCapture, type InputCallback } from "./input-capture.js";
export { createInputDispatcher, type InputDispatcher } from "./input-dispatcher.js";

// Utilities
export { createNodeRegistry, RDID, type NodeRegistry } from "./node-registry.js";
export { serializeNode } from "./serialize.js";
