import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import * as AWSXRay from "aws-xray-sdk-core";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { OrderEvent, OrderProcessor, ProcessingResult } from "./types.js";

const client = DynamoDBDocumentClient.from(
  AWSXRay.captureAWSv3Client(new DynamoDBClient({})),
  {
    marshallOptions: { removeUndefinedValues: true },
  },
);

const tableName = () =>
  process.env.MARKETPLACE_TABLE_NAME ??
  (() => {
    throw new Error("MARKETPLACE_TABLE_NAME is required.");
  })();

export class DynamoDbOrderProcessor implements OrderProcessor {
  async process(order: OrderEvent): Promise<ProcessingResult> {
    const orderKey = `ORDER#${order.orderId}`;
    const existing = await client.send(
      new GetCommand({
        TableName: tableName(),
        Key: { pk: orderKey },
        ConsistentRead: true,
      }),
    );
    if (existing.Item?.status === "processed") {
      return { status: "duplicate", orderId: order.orderId };
    }
    if (existing.Item && existing.Item.status !== "pending") {
      throw new Error(
        `Order ${order.orderId} has unsupported status ${existing.Item.status}.`,
      );
    }

    const productKey = `PRODUCT#${order.productId}`;
    const createdAt = order.occurredAt;
    const orderWrite = existing.Item
      ? {
          Update: {
            TableName: tableName(),
            Key: { pk: orderKey },
            UpdateExpression:
              "SET #status = :processed, processedAt = :processedAt",
            ConditionExpression:
              "attribute_exists(pk) AND #status = :pending AND idempotencyKey = :idempotencyKey",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "pending",
              ":processed": "processed",
              ":processedAt": new Date().toISOString(),
              ":idempotencyKey": order.idempotencyKey,
            },
          },
        }
      : {
          Put: {
            TableName: tableName(),
            Item: {
              pk: orderKey,
              entityType: "ORDER",
              id: order.orderId,
              buyerId: order.buyerId,
              sellerId: order.sellerId,
              productId: order.productId,
              quantity: order.quantity,
              status: "processed",
              idempotencyKey: order.idempotencyKey,
              createdAt,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        };
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName(),
              Key: { pk: productKey },
              UpdateExpression:
                "SET stock = stock - :quantity, updatedAt = :updatedAt",
              ConditionExpression:
                "attribute_exists(pk) AND stock >= :quantity",
              ExpressionAttributeValues: {
                ":quantity": order.quantity,
                ":updatedAt": new Date().toISOString(),
              },
            },
          },
          orderWrite,
        ],
      }),
    );

    return {
      status: "processed",
      orderId: order.orderId,
      productId: order.productId,
      quantity: order.quantity,
    };
  }
}
