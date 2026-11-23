import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "@/lib/dburl";

describe("resolveDatabaseUrl", () => {
  it("prefers DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a@h/db", POSTGRES_URL: "postgres://b@h/db" })).toBe("postgres://a@h/db");
  });
  it("falls back to the Vercel Supabase integration's POSTGRES_URL and strips unsupported params", () => {
    const url = resolveDatabaseUrl({
      POSTGRES_URL: "postgres://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x&pgbouncer=true",
    });
    expect(url).toBe("postgres://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require");
  });
  it("returns null when nothing is set", () => expect(resolveDatabaseUrl({})).toBeNull());
});
