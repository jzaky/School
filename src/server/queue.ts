import "server-only";

// Web app entry point for queues. The implementation lives in ./queue-core so the worker can share it.
export { queue, flushEffects } from "./queue-core";
