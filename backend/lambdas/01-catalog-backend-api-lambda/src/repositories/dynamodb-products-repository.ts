import * as AWSXRay from "aws-xray-sdk-core";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Product, ProductsRepository } from "./types.js";

type ProductItem = Product & {
  pk: string;
  entityType: "PRODUCT";
};

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

const toProduct = (item: ProductItem): Product => ({
  id: item.id,
  name: item.name,
  description: item.description,
  priceCents: item.priceCents,
  stock: item.stock,
  sellerId: item.sellerId,
  imageKeys: item.imageKeys ?? (item.imageKey ? [item.imageKey] : []),
  createdAt: item.createdAt,
});

export class DynamoDbProductsRepository implements ProductsRepository {
  async list(): Promise<Product[]> {
    const result = await client.send(
      new ScanCommand({
        TableName: tableName(),
        FilterExpression: "entityType = :product",
        ExpressionAttributeValues: { ":product": "PRODUCT" },
      }),
    );
    return (result.Items ?? [])
      .map((item) => toProduct(item as ProductItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(product: Product): Promise<Product> {
    const item: ProductItem = {
      ...product,
      pk: `PRODUCT#${product.id}`,
      entityType: "PRODUCT",
    };
    await client.send(
      new PutCommand({
        TableName: tableName(),
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    return product;
  }

  async findById(productId: string): Promise<Product | null> {
    const result = await client.send(
      new GetCommand({
        TableName: tableName(),
        Key: { pk: `PRODUCT#${productId}` },
        ConsistentRead: true,
      }),
    );
    return result.Item ? toProduct(result.Item as ProductItem) : null;
  }

  async update(product: Product): Promise<Product> {
    const item: ProductItem = {
      ...product,
      pk: `PRODUCT#${product.id}`,
      entityType: "PRODUCT",
    };
    await client.send(new PutCommand({ TableName: tableName(), Item: item }));
    return product;
  }

  async remove(productId: string): Promise<void> {
    await client.send(
      new DeleteCommand({
        TableName: tableName(),
        Key: { pk: `PRODUCT#${productId}` },
      }),
    );
  }
}
