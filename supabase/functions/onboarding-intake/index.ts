import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Recebe as respostas do formulario "Conhecendo Voce(s) e Seu Trabalho" e grava
// em public.onboarding_respostas usando a chave de servico (nunca exposta ao navegador).
//
// Aviso honesto: SHARED_SECRET tambem existe no HTML publico do formulario, entao
// ele filtra ruido, nao e autenticacao. A protecao real e que esta funcao so escreve
// (nunca le) e que a tabela so e legivel por membros da Bora via RLS.
//
// Implantada com verify_jwt = false (autenticacao propria).

const SHARED_SECRET = "bora-postar-2026";

const ALLOWED_ORIGINS = [
  "https://boraconhecer-arthurssas-projects.vercel.app",
];

const MAX_BYTES = 200_000;

function corsHeaders(origin: string): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(payload: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin") ?? "";
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ status: "error", message: "metodo nao permitido" }, 405, cors);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) {
      return json({ status: "error", message: "payload grande demais" }, 413, cors);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ status: "error", message: "json invalido" }, 400, cors);
  }

  if (body?.secret !== SHARED_SECRET) {
    return json({ status: "error", message: "nao autorizado" }, 401, cors);
  }

  const respostas = body?.respostas;
  if (!respostas || typeof respostas !== "object" || Array.isArray(respostas)) {
    return json({ status: "error", message: "respostas ausentes" }, 400, cors);
  }

  const preenchidas = Object.values(respostas as Record<string, unknown>)
    .filter((v) => typeof v === "string" && v.trim().length > 0).length;

  if (preenchidas === 0) {
    return json({ status: "ignorado", message: "formulario vazio" }, 200, cors);
  }

  const texto = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("onboarding_respostas")
    .insert({
      formulario: texto(body.formulario, 60) ?? "conhecendo-voce",
      versao: texto(body.versao, 20) ?? "v1",
      nome_informado: texto(body.nome, 120),
      respostas,
      origem: origin || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("falha ao gravar onboarding:", error.message);
    return json({ status: "error", message: "falha ao gravar" }, 500, cors);
  }

  return json({ status: "ok", id: data.id, respondidas: preenchidas }, 200, cors);
});
