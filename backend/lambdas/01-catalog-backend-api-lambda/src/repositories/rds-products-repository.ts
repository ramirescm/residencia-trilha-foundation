import {
  Pool,
  type QueryResultRow,
} from "../../node_modules/@types/pg/index.js";
import type { Product, ProductsRepository } from "./types.js";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 2,
});

type ProductRow = QueryResultRow & {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  stock: number;
  seller_id: string;
  image_key: string | null;
  created_at: Date;
};

const mapProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  description: row.description,
  priceCents: row.price_cents,
  stock: row.stock,
  sellerId: row.seller_id,
  imageKeys: row.image_key ? [row.image_key] : [],
  createdAt: row.created_at.toISOString(),
});

export class RdsProductsRepository implements ProductsRepository {
  async list(): Promise<Product[]> {
    const result = await pool.query<ProductRow>(`
      SELECT id, name, description, price_cents, stock, seller_id, image_key, created_at
      FROM products
      ORDER BY created_at DESC
    `);

    return result.rows.map(mapProduct);
  }

  async create(product: Product): Promise<Product> {
    const result = await pool.query<ProductRow>(
      `
        INSERT INTO products (
          id, name, description, price_cents, stock, seller_id, image_key, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, name, description, price_cents, stock, seller_id, image_key, created_at
      `,
      [
        product.id,
        product.name,
        product.description,
        product.priceCents,
        product.stock,
        product.sellerId,
        product.imageKeys[0] ?? null,
        product.createdAt,
      ],
    );

    return mapProduct(result.rows[0]);
  }

  async findById(productId: string): Promise<Product | null> {
    const result = await pool.query<ProductRow>(
      `SELECT id, name, description, price_cents, stock, seller_id, image_key, created_at FROM products WHERE id = $1`,
      [productId],
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }

  async update(product: Product): Promise<Product> {
    const result = await pool.query<ProductRow>(
      `UPDATE products SET name = $2, description = $3, price_cents = $4, stock = $5, image_key = $6 WHERE id = $1 RETURNING id, name, description, price_cents, stock, seller_id, image_key, created_at`,
      [
        product.id,
        product.name,
        product.description,
        product.priceCents,
        product.stock,
        product.imageKeys[0] ?? null,
      ],
    );
    return mapProduct(result.rows[0]);
  }

  async remove(productId: string): Promise<void> {
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  }
}
