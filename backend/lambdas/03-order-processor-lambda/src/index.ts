import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { getOrderProcessor } from "./processors/index.js";
import type { OrderEvent } from "./processors/types.js";

const log = (
  level: "info" | "warn" | "error",
  message: string,
  correlationId: string,
  data: Record<string, unknown> = {},
) =>
  console[level === "error" ? "error" : "log"](
    JSON.stringify({
      level,
      message,
      correlationId,
      ...data,
      timestamp: new Date().toISOString(),
    }),
  );

const correlationIdFrom = (record: SQSRecord): string =>
  record.messageAttributes?.correlationId?.stringValue ??
  `missing-${record.messageId}`;

const required = (
  order: Record<string, unknown>,
  field: keyof OrderEvent,
): void => {
  if (
    order[field] === undefined ||
    order[field] === null ||
    order[field] === ""
  ) {
    throw new Error(`Order event field ${field} is required.`);
  }
};

const parseOrder = (record: SQSRecord): OrderEvent => {
  const order = JSON.parse(record.body) as Record<string, unknown>;
  const requiredFields: (keyof OrderEvent)[] = [
    "orderId",
    "buyerId",
    "sellerId",
    "productId",
    "quantity",
    "occurredAt",
    "idempotencyKey",
  ];
  requiredFields.forEach((field) => required(order, field));
  return order as OrderEvent;
};

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const processor = await getOrderProcessor();
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    const correlationId = correlationIdFrom(record);

    let orderId: string | undefined;
    try {
      const order = parseOrder(record);
      orderId = order.orderId;
      log("info", "order-processing-started", correlationId, {
        messageId: record.messageId,
        orderId: order.orderId,
        receiveCount: record.attributes.ApproximateReceiveCount,
      });
      const result = await processor.process(order);

      log("info", "order-processed", correlationId, {
        messageId: record.messageId,
        orderId: order.orderId,
        idempotencyKey: order.idempotencyKey,
        result,
      });
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error("Unknown error");
      log("error", "order-processing-failed", correlationId, {
        messageId: record.messageId,
        orderId,
        message: failure.message,
        cancellationReasons: (error as { CancellationReasons?: unknown })
          .CancellationReasons,
        stack: failure.stack,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
