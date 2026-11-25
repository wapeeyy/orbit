// Upstash Redis melalui REST (Vercel → Storage → Upstash Redis mengisi env ni sendiri)
function cfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export const kvConfigured = () => cfg() !== null;

async function cmd<T>(...args: (string | number)[]): Promise<T> {
  const c = cfg();
  if (!c) throw new Error("Database (Upstash Redis) is not connected");
  const res = await fetch(c.url, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const j = await res.json();
  if (j.error) throw new Error(`Redis: ${j.error}`);
  return j.result as T;
}

/** SET hanya jika belum wujud. true = berjaya (kali pertama). */
export async function setOnce(key: string, value: string, ttlSec: number) {
  return (await cmd<string | null>("SET", key, value, "NX", "EX", ttlSec)) === "OK";
}

export async function kvGet(key: string) {
  return cmd<string | null>("GET", key);
}

/** Count up a key that expires after ttlSec (the window starts on the first hit). */
export async function kvIncr(key: string, ttlSec: number) {
  const n = await cmd<number>("INCR", key);
  if (n === 1) await cmd("EXPIRE", key, ttlSec);
  return n;
}
