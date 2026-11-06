import { Pool, type QueryResultRow } from "pg";
import { getDatabaseSecret } from "../database-secret.js";
import type { Product, ProductsRepository } from "./types.js";

let pool: Promise<Pool> | undefined;

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when DATA_SOURCE=rds.`);
  return value;
};

const getPool = (): Promise<Pool> => {
  if (pool) return pool;
  pool = getDatabaseSecret().then(
    (secret) =>
      new Pool({
        host: required("DB_HOST"),
        port: Number(process.env.DB_PORT ?? 5432),
        database: required("DB_NAME"),
        user: secret.username,
        password: secret.password,
        ssl:
          process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
        max: 2,
      }),
  );
  return pool;
};

type ProductRow = QueryResultRow & {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  stock: number;
  seller_id: string;
  image_keys: string[] | null;
  created_at: Date;
};

const mapProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  description: row.description,
  priceCents: row.price_cents,
  stock: row.stock,
  sellerId: row.seller_id,
  imageKeys: Array.isArray(row.image_keys) ? row.image_keys : [],
  createdAt: row.created_at.toISOString(),
});

export class RdsProductsRepository implements ProductsRepository {
  async list(): Promise<Product[]> {
    const result = await (
      await getPool()
    ).query<ProductRow>(`
      SELECT id, name, description, price_cents, stock, seller_id, image_keys, created_at
      FROM products
      ORDER BY created_at DESC
    `);

    return result.rows.map(mapProduct);
  }

  async create(product: Product): Promise<Product> {
    const result = await (
      await getPool()
    ).query<ProductRow>(
      `
        INSERT INTO products (
          id, name, description, price_cents, stock, seller_id, image_keys, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        RETURNING id, name, description, price_cents, stock, seller_id, image_keys, created_at
      `,
      [
        product.id,
        product.name,
        product.description,
        product.priceCents,
        product.stock,
        product.sellerId,
        JSON.stringify(product.imageKeys),
        product.createdAt,
      ],
    );

    return mapProduct(result.rows[0]);
  }

  async findById(productId: string): Promise<Product | null> {
    const result = await (
      await getPool()
    ).query<ProductRow>(
      `SELECT id, name, description, price_cents, stock, seller_id, image_keys, created_at FROM products WHERE id = $1`,
      [productId],
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }

  async update(product: Product): Promise<Product> {
    const result = await (
      await getPool()
    ).query<ProductRow>(
      `UPDATE products SET name = $2, description = $3, price_cents = $4, stock = $5, image_keys = $6::jsonb, updated_at = NOW() WHERE id = $1 RETURNING id, name, description, price_cents, stock, seller_id, image_keys, created_at`,
      [
        product.id,
        product.name,
        product.description,
        product.priceCents,
        product.stock,
        JSON.stringify(product.imageKeys),
      ],
    );
    return mapProduct(result.rows[0]);
  }

  async remove(productId: string): Promise<void> {
    await (
      await getPool()
    ).query("DELETE FROM products WHERE id = $1", [productId]);
  }
}
