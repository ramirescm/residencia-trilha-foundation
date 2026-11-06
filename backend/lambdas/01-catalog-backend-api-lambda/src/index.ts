import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { getProductsRepository } from "./repositories/index.js";
import type { ProductInput } from "./repositories/types.js";

type JsonBody = Record<string, unknown>;

type ProductRequest = {
  name?: string;
  description?: string;
  priceCents?: number;
  stock?: number;
  images?: Array<{
    fileName?: string;
    contentType?: string;
  }>;
};

type JwtClaims = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

const s3 = new S3Client({});

const json = (
  statusCode: number,
  body: JsonBody,
  correlationId?: string,
): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": process.env.ALLOWED_ORIGIN ?? "*",
    "access-control-allow-headers": "Content-Type,Authorization",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    ...(correlationId && {
      "x-correlation-id": correlationId,
      "access-control-expose-headers": "x-correlation-id",
    }),
  },
  body: JSON.stringify(body),
});

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

const parseBody = (event: APIGatewayProxyEvent): ProductRequest => {
  if (!event.body) return {};

  return JSON.parse(
    event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body,
  ) as ProductRequest;
};

const claimsFrom = (event: APIGatewayProxyEvent): JwtClaims => {
  const claims = event.requestContext.authorizer?.claims;
  return (claims ?? {}) as JwtClaims;
};

const requireUser = (event: APIGatewayProxyEvent): string => {
  const claims = claimsFrom(event);
  if (typeof claims.sub !== "string") {
    throw new HttpError("Authenticated user identity is missing.", 401);
  }
  return claims.sub;
};

const safeFileName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, "-");

const validateProduct = (input: ProductRequest) => {
  if (
    !input.name ||
    !Number.isInteger(input.priceCents) ||
    (input.priceCents ?? 0) <= 0 ||
    !Number.isInteger(input.stock) ||
    (input.stock ?? -1) < 0
  ) {
    throw new HttpError(
      "name, a positive priceCents and a non-negative stock are required.",
      400,
    );
  }
};

const productIdFrom = (path?: string | null): string | null => {
  if (!path) return null;
  const match = path.match(/^\/products\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const createImageUploads = async ({
  productId,
  sellerId,
  images,
}: {
  productId: string;
  sellerId: string;
  images?: ProductRequest["images"];
}) => {
  const validImages = (images ?? [])
    .filter((image) => image.fileName)
    .slice(0, 8);
  if (validImages.length === 0) return [];

  const bucket = process.env.PRODUCT_IMAGES_BUCKET;
  if (!bucket)
    throw new Error("PRODUCT_IMAGES_BUCKET is required for image uploads.");

  const expiresIn = Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 900);
  return Promise.all(
    validImages.map(async (image) => {
      const key = `${sellerId}/${productId}/${randomUUID()}-${safeFileName(image.fileName as string)}`;
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: image.contentType ?? "application/octet-stream",
      });
      return {
        bucket,
        key,
        expiresIn,
        uploadUrl: await getSignedUrl(s3, command, { expiresIn }),
      };
    }),
  );
};

const withImageUrls = async <
  T extends { imageKeys: string[]; imageKey?: string | null },
>(
  product: T,
) => {
  const imageKeys = product.imageKeys?.length
    ? product.imageKeys
    : product.imageKey
      ? [product.imageKey]
      : [];
  if (imageKeys.length === 0)
    return { ...product, imageKeys: [], imageUrls: [] };
  const bucket = process.env.PRODUCT_IMAGES_BUCKET;
  if (!bucket) return { ...product, imageKeys, imageUrls: [] };
  const expiresIn = Number(process.env.DOWNLOAD_URL_TTL_SECONDS ?? 3600);
  return {
    ...product,
    imageKeys,
    imageUrls: await Promise.all(
      imageKeys.map((key) =>
        getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
          expiresIn,
        }),
      ),
    ),
  };
};

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const correlationId = event.requestContext?.requestId ?? context.awsRequestId;
  const reply = (statusCode: number, body: JsonBody) =>
    json(statusCode, body, correlationId);

  try {
    const method = event.httpMethod;
    const path = event.path;
    if (!method || !path) {
      throw new Error("API Gateway Lambda proxy integration is required.");
    }
    log("info", "catalog-request-received", correlationId, { method, path });

    const repository = await getProductsRepository();

    if (method === "GET" && path === "/products") {
      requireUser(event);
      const products = await repository.list();
      return reply(200, {
        items: await Promise.all(products.map(withImageUrls)),
      });
    }

    if (method === "POST" && path === "/products") {
      const sellerId = requireUser(event);
      const input = parseBody(event);
      validateProduct(input);

      const id = randomUUID();
      const imageUploads = await createImageUploads({
        productId: id,
        sellerId,
        images: input.images,
      });
      const product: ProductInput = {
        id,
        name: input.name as string,
        description: input.description ?? "",
        priceCents: input.priceCents as number,
        stock: input.stock as number,
        sellerId,
        imageKeys: imageUploads.map((upload) => upload.key),
        createdAt: new Date().toISOString(),
      };

      const created = await repository.create(product);
      log("info", "product-created", correlationId, {
        productId: id,
        sellerId,
      });
      return reply(201, {
        product: await withImageUrls(created),
        imageUploads,
      });
    }

    const productId = productIdFrom(path);
    if (productId && method === "PUT") {
      const userId = requireUser(event);
      const current = await repository.findById(productId);
      if (!current) throw new HttpError("Product not found.", 404);
      if (current.sellerId !== userId)
        throw new HttpError("You can only edit your own products.", 403);
      const input = parseBody(event);
      validateProduct(input);
      const imageUploads = await createImageUploads({
        productId,
        sellerId: userId,
        images: input.images,
      });
      const updated: ProductInput = {
        ...current,
        name: input.name as string,
        description: input.description ?? "",
        priceCents: input.priceCents as number,
        stock: input.stock as number,
        imageKeys: [
          ...current.imageKeys,
          ...imageUploads.map((upload) => upload.key),
        ].slice(0, 8),
      };
      const saved = await repository.update(updated);
      log("info", "product-updated", correlationId, { productId, userId });
      return reply(200, { product: await withImageUrls(saved), imageUploads });
    }

    if (productId && method === "DELETE") {
      const userId = requireUser(event);
      const current = await repository.findById(productId);
      if (!current) throw new HttpError("Product not found.", 404);
      if (current.sellerId !== userId)
        throw new HttpError("You can only remove your own products.", 403);
      await repository.remove(productId);
      if (current.imageKeys.length > 0 && process.env.PRODUCT_IMAGES_BUCKET) {
        await Promise.all(
          current.imageKeys.map((key) =>
            s3.send(
              new DeleteObjectCommand({
                Bucket: process.env.PRODUCT_IMAGES_BUCKET,
                Key: key,
              }),
            ),
          ),
        );
      }
      log("info", "product-removed", correlationId, { productId, userId });
      return reply(200, { removed: true });
    }

    return reply(404, { message: "Route not found." });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown error");
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    log(
      statusCode >= 500 ? "error" : "warn",
      "catalog-request-failed",
      correlationId,
      {
        statusCode,
        message: failure.message,
        stack: statusCode >= 500 ? failure.stack : undefined,
      },
    );
    return reply(statusCode, {
      message: statusCode === 500 ? "Internal server error." : failure.message,
    });
  }
};
