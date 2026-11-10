import pg from "pg";

// Postgres numeric columns arrive as strings. Cast quantities with ::float8 in SQL so every
// caller receives numbers regardless of driver configuration.
export interface Db {
  query<T extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function createPool(databaseUrl: string, caCert?: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    // With a CA certificate the server identity is verified; otherwise sslmode in the URL applies.
    ssl: caCert ? { ca: caCert, rejectUnauthorized: true } : undefined,
  });
}
