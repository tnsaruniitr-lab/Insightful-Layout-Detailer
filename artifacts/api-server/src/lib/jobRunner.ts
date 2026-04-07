import { logger } from "./logger";

export function fireAndForget(docId: number): void {
  setImmediate(() => {
    import("../workflows/ingestion")
      .then(({ runIngestionGraph }) => runIngestionGraph(docId))
      .catch((err: unknown) => {
        logger.error({ err, docId }, "Unhandled error in ingestion graph fire-and-forget");
      });
  });
}
