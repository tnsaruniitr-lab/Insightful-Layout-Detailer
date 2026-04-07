import { logger } from "./logger";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export function fireAndForget(docId: number): void {
  setImmediate(() => {
    import("../workflows/ingestion")
      .then(({ runIngestionGraph }) => runIngestionGraph(docId))
      .catch(async (err: unknown) => {
        logger.error({ err, docId }, "Unhandled error in ingestion graph fire-and-forget");
        try {
          await db
            .update(documentsTable)
            .set({
              rawTextStatus: "error",
              errorMessage: err instanceof Error ? err.message : "Unexpected ingestion failure",
            })
            .where(eq(documentsTable.id, docId));
        } catch (dbErr: unknown) {
          logger.error({ dbErr, docId }, "Failed to mark document as error after fire-and-forget failure");
        }
      });
  });
}
