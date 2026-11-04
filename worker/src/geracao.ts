// Geração de imagem e de vídeo por IA (ADR 0001, D4; tarefas 4 e 6): uma
// interface só, com um adaptador por provedor. A chave mora no ambiente do
// worker (RUNWARE_API_KEY), nunca no navegador. Todo resultado traz o custo
// que o provedor informou e quanto tempo levou.
//
// Provedor escolhido pra testar: Runware (docs/medidas/geradores-precos.md).
// Formato da API conferido em https://runware.ai/docs/models-api/introduction
// e /task-polling (03/11/2026): POST https://api.runware.ai/v1, corpo em
// array de tarefas, Authorization: Bearer <chave>.
import { randomUUID } from 'node:crypto';

export const RUNWARE = 'https://api.runware.ai/v1';

/** Os modelos do teste, com os ids da Runware (das páginas /docs/models/<modelo>). */
export const MODELOS = {
  seedream4: { id: 'bytedance:5@0', nome: 'Seedream 4.0', tipo: 'imagem', usdPorUnidade: 0.03, tamanhos: [[1024, 1024], [1728, 2304], [2048, 2048]] },
  recraftV4: { id: 'recraft:v4@0', nome: 'Recraft V4', tipo: 'imagem', usdPorUnidade: 0.04, tamanhos: [[1024, 1024], [896, 1152], [768, 1344]] },
  recraftV41Flash: { id: 'recraft:v4.1@flash', nome: 'Recraft V4.1 Flash', tipo: 'imagem', usdPorUnidade: 0.007, tamanhos: [[1024, 1024], [896, 1152]] },
  kling25TurboPro: { id: 'klingai:6@1', nome: 'Kling 2.5 Turbo Pro', tipo: 'video', usdPorUnidade: 0.35, tamanhos: [[720, 1280], [1280, 720], [1080, 1920]] },
} as const;
export type NomeDoModelo = keyof typeof MODELOS;

export type Gerado = { url: string; custoUsd: number | null; ms: number; uuid: string };

type Tarefa = Record<string, unknown> & { taskType: string; taskUUID: string };
type Resposta = { data?: Array<Record<string, unknown>>; errors?: Array<{ code?: string; message?: string }>; error?: { message?: string } };

async function chamar(chave: string, tarefas: Tarefa[]): Promise<Resposta> {
  const r = await fetch(RUNWARE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(tarefas),
  });
  const corpo = (await r.json().catch(() => ({}))) as Resposta;
  const erro = corpo.error?.message ?? corpo.errors?.map((e) => e.message ?? e.code).join('; ');
  if (!r.ok || (erro && !corpo.data?.length)) throw new Error(`Runware ${r.status}: ${erro ?? 'resposta sem dados'}`);
  return corpo;
}

/**
 * Gera `n` imagens de um pedido. O pedido já vem escrito a partir da marca
 * (estilo, cores, o que evitar) por quem chama: o usuário nunca escreve isso.
 */
export async function gerarImagem(o: { chave: string; modelo: NomeDoModelo; pedido: string; largura: number; altura: number; n: number }): Promise<Gerado[]> {
  const m = MODELOS[o.modelo];
  const inicio = performance.now();
  const r = await chamar(o.chave, [{
    taskType: 'imageInference', taskUUID: randomUUID(), model: m.id, positivePrompt: o.pedido,
    width: o.largura, height: o.altura, numberResults: o.n, outputType: 'URL', outputFormat: 'PNG', includeCost: true,
  }]);
  const ms = Math.round(performance.now() - inicio);
  return (r.data ?? []).filter((d) => d.imageURL).map((d) => ({
    url: String(d.imageURL), custoUsd: typeof d.cost === 'number' ? d.cost : null, ms, uuid: String(d.imageUUID ?? ''),
  }));
}

/**
 * Gera um clipe (texto → vídeo) e espera ficar pronto: a Runware devolve na
 * hora só o recebimento, e o resultado sai de getResponse (consultas com
 * espera crescente, como a documentação pede).
 */
export async function gerarClipe(o: { chave: string; modelo: NomeDoModelo; pedido: string; largura: number; altura: number; segundos: 5 | 10; limiteMs?: number }): Promise<Gerado> {
  const m = MODELOS[o.modelo];
  const uuid = randomUUID();
  const inicio = performance.now();
  await chamar(o.chave, [{
    taskType: 'videoInference', taskUUID: uuid, model: m.id, positivePrompt: o.pedido,
    width: o.largura, height: o.altura, duration: o.segundos, outputFormat: 'MP4', includeCost: true, deliveryMethod: 'async',
  }]);
  const limite = inicio + (o.limiteMs ?? 10 * 60_000);
  let espera = 5_000;
  for (;;) {
    await new Promise((ok) => setTimeout(ok, espera));
    espera = Math.min(espera * 1.5, 20_000);
    const r = await chamar(o.chave, [{ taskType: 'getResponse', taskUUID: uuid }]);
    const d = (r.data ?? []).find((x) => x.taskUUID === uuid);
    if (d?.status === 'success' && d.videoURL) {
      return { url: String(d.videoURL), custoUsd: typeof d.cost === 'number' ? d.cost : null, ms: Math.round(performance.now() - inicio), uuid };
    }
    if (r.errors?.length) throw new Error(`o clipe falhou: ${r.errors.map((e) => e.message ?? e.code).join('; ')}`);
    if (performance.now() > limite) throw new Error(`o clipe não ficou pronto em ${Math.round((o.limiteMs ?? 600_000) / 60_000)} min`);
  }
}

/**
 * O pedido ao gerador a partir da marca, com as regras do ADR: fundo liso pra
 * recortar, nenhum texto dentro da imagem (o texto é objeto do Studio),
 * nenhuma pessoa reconhecível.
 */
export function pedidoDaMarca(o: { assunto: string; estilo: 'flat' | 'foto' | '3d'; cores: string[]; fundo: string }): string {
  const estilo = {
    flat: 'flat vector illustration, simple shapes, solid colors, no gradients, no outlines',
    foto: 'professional product photo, soft studio light, shallow depth of field',
    '3d': 'soft 3D render, clay style, rounded shapes, soft shadows',
  }[o.estilo];
  return `${o.assunto}. ${estilo}. Color palette: ${o.cores.join(', ')}. Plain solid ${o.fundo} background, object centered with empty margin around it. No text, no letters, no logo, no watermark, no people.`;
}
