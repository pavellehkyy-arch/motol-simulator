// Motol Simulator – krátkodobé přihlašovací údaje k TURN relay pro online závod (WebRTC).
// Pustí jen přihlášeného hráče s přezdívkou (can_walk_online). Tajné klíče jsou v secrets Supabase:
//   Cloudflare Realtime TURN: CF_TURN_KEY_ID + CF_TURN_API_TOKEN
//   nebo Metered.ca:          METERED_DOMAIN (např. motol.metered.live) + METERED_API_KEY
// Bez klíčů vrátí jen veřejné STUN servery (hráči za přísným NATem se pak nemusí spojit).
const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const TTL = 3600;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

type Ice = { urls: string | string[]; username?: string; credential?: string };

function clean(list: unknown): Ice[] {
  const a = Array.isArray(list) ? list : list ? [list] : [];
  return a.filter((s: any) => s && (typeof s.urls === "string" || Array.isArray(s.urls)))
    .map((s: any) => ({ urls: s.urls, ...(s.username ? { username: String(s.username) } : {}), ...(s.credential ? { credential: String(s.credential) } : {}) }));
}

async function cloudflare(id: string, token: string): Promise<Ice[]> {
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: TTL }),
  });
  if (!r.ok) throw new Error("cf " + r.status);
  const j = await r.json();
  // port 53 prohlížeče často blokují, vynech ho
  return clean(j.iceServers).map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }));
}

async function metered(domain: string, key: string): Promise<Ice[]> {
  const r = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error("metered " + r.status);
  return clean(await r.json());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  // smí jen ten, kdo smí online (přihlášený, s přezdívkou, ne zamítnutou)
  const ok = await fetch(`${url}/rest/v1/rpc/can_walk_online`, {
    method: "POST",
    headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" },
    body: "{}",
  }).then((r) => (r.ok ? r.json() : false)).catch(() => false);
  if (ok !== true) return json({ error: "denied" }, 403);

  let turn: Ice[] = [];
  try {
    const cfId = Deno.env.get("CF_TURN_KEY_ID"), cfTok = Deno.env.get("CF_TURN_API_TOKEN");
    const mDom = Deno.env.get("METERED_DOMAIN"), mKey = Deno.env.get("METERED_API_KEY");
    if (cfId && cfTok) turn = await cloudflare(cfId, cfTok);
    else if (mDom && mKey) turn = await metered(mDom, mKey);
  } catch (e) {
    console.error("turn", String(e));
  }
  return json({ iceServers: turn.length ? turn : STUN, relay: turn.length > 0, ttl: TTL });
});
