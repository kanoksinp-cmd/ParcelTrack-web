// ParcelTrack: อ่านข้อความจากภาพด้วย Google Cloud Vision (DOCUMENT_TEXT_DETECTION)
// ต้องตั้ง secret GOOGLE_VISION_API_KEY ใน Supabase (Edge Functions > Secrets) ก่อนใช้งาน
// ใช้ได้เฉพาะบัญชีเจ้าของ ParcelTrack (ตรวจด้วย public.pt_is_owner())
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type V = { x?: number; y?: number };
type Line = { text: string; left: number; top: number; right: number; bottom: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  const key = Deno.env.get("GOOGLE_VISION_API_KEY");
  if (!key) return reply({ error: "not-configured" }, 501);

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
  });
  const { data: isOwner, error: ownerErr } = await sb.rpc("pt_is_owner");
  if (ownerErr || !isOwner) return reply({ error: "forbidden" }, 403);

  let image = "";
  try { image = (await req.json()).image ?? ""; } catch { /* */ }
  if (!image || image.length > 20_000_000) return reply({ error: "ไม่มีภาพ หรือภาพใหญ่เกินไป" }, 400);

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: image },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["th", "en"] },
      }],
    }),
  });
  const out = await res.json().catch(() => null);
  const r = out?.responses?.[0];
  if (!res.ok || !r || r.error) return reply({ error: r?.error?.message || out?.error?.message || "Vision error" }, 502);

  const full = r.fullTextAnnotation;
  const page = full?.pages?.[0];
  const lines: Line[] = [];
  let cur: { text: string; xs: number[]; ys: number[] } | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) {
      lines.push({ text: cur.text.trim(), left: Math.min(...cur.xs), top: Math.min(...cur.ys), right: Math.max(...cur.xs), bottom: Math.max(...cur.ys) });
    }
    cur = null;
  };
  for (const b of page?.blocks ?? []) for (const p of b.paragraphs ?? []) for (const w of p.words ?? []) {
    const vs: V[] = w.boundingBox?.vertices ?? [];
    for (const s of w.symbols ?? []) {
      cur ??= { text: "", xs: [], ys: [] };
      cur.text += s.text ?? "";
      for (const v of vs) { cur.xs.push(v.x ?? 0); cur.ys.push(v.y ?? 0); }
      const br = s.property?.detectedBreak?.type;
      if (br === "SPACE" || br === "SURE_SPACE") cur.text += " ";
      if (br === "EOL_SURE_SPACE" || br === "LINE_BREAK") flush();
    }
  }
  flush();
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  return reply({ text: full?.text ?? lines.map((l) => l.text).join("\n"), lines, width: page?.width ?? 0, height: page?.height ?? 0 });
});
