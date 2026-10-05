import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const prefix = String(body?.prefix || "").trim().toUpperCase();
    if (!/^[A-F0-9]{5}$/.test(prefix)) {
      return new Response("Invalid SHA-1 prefix", { status: 400, headers: corsHeaders });
    }

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "Trameli-Password-Security",
      },
    });

    if (!response.ok) {
      return new Response("Password breach service unavailable", { status: 503, headers: corsHeaders });
    }

    return new Response(await response.text(), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Invalid request", { status: 400, headers: corsHeaders });
  }
});
