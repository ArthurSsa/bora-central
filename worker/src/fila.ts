// Tudo o que o worker fala com o Supabase. Entra com service_role, que passa
// por cima do RLS — por isso cada escrita aqui filtra pelo id do job E pelo
// worker que o segura: um worker que perdeu o lease não escreve por cima de
// quem pegou o job depois dele.
//
// Nenhuma hora sai daqui: início, fim e prazo do lease são do relógio do banco
// (pegar_job, gatilho jobs_tocar, renovar_lease). O primeiro teste de ponta a
// ponta saiu com duração negativa por causa de um worker 6 s atrasado.
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from './config.ts';
import type { ClienteParaMarca } from './marca.ts';
import type { SaidaConferida } from './verificar.ts';

export type Job = {
  id: string;
  pedido_id: string;
  conta_id: string;
  cliente_id: string;
  rodada: string;
  skill: string | null;
  entrada: Record<string, unknown>;
  estado: string;
  tentativas: number;
  max_tentativas: number;
};

export type Pedido = { id: string; tipo: string; titulo: string | null; briefing: Record<string, unknown>; publicar_em: string | null };

export type Custos = {
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_leitura: number;
  tokens_cache_escrita: number;
  custo_usd: number;
  render_segundos: number;
};

export const BALDE = 'pedidos';

export function conectar(cfg: Config): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function ok<T>(r: { data: T; error: { message: string } | null }, onde: string): T {
  if (r.error) throw new Error(`${onde}: ${r.error.message}`);
  return r.data;
}

export async function pegarJob(sb: SupabaseClient, cfg: Config): Promise<Job | null> {
  const linhas = ok(await sb.rpc('pegar_job', { p_worker: cfg.workerId, p_lease_segundos: cfg.leaseSegundos }), 'pegar_job') as Job[];
  return linhas[0] ?? null;
}

/**
 * Estende o lease. Devolve false se o job não é mais deste worker — cancelado
 * pela Bora, ou retomado por outro depois de um lease vencido. Quem chama
 * aborta o agente nesse caso.
 */
export async function renovarLease(sb: SupabaseClient, cfg: Config, job: Job): Promise<boolean> {
  // O prazo é calculado no banco: o relógio do worker pode estar atrasado.
  return ok(
    await sb.rpc('renovar_lease', { p_job: job.id, p_worker: cfg.workerId, p_segundos: cfg.leaseSegundos }),
    'renovar lease',
  ) === true;
}

export async function anotar(sb: SupabaseClient, cfg: Config, job: Job, campos: { etapa?: string; progresso?: number; previsto_para?: string | null }) {
  ok(await sb.from('jobs').update(campos).eq('id', job.id).eq('worker_id', cfg.workerId), 'anotar etapa');
}

export async function evento(
  sb: SupabaseClient,
  job: Job,
  mensagem: string,
  extra: { nivel?: 'info' | 'aviso' | 'erro'; dados?: unknown; visivel?: boolean } = {},
) {
  // O log nunca derruba o job: um evento perdido é chato, um job perdido por
  // causa do log é absurdo.
  const { error } = await sb.from('job_eventos').insert({
    job_id: job.id,
    mensagem,
    nivel: extra.nivel ?? 'info',
    dados: extra.dados ?? null,
    visivel_cliente: extra.visivel ?? false,
  });
  if (error) console.error(`[${job.id}] evento perdido: ${error.message}`);
}

export async function carregarContexto(sb: SupabaseClient, job: Job): Promise<{ pedido: Pedido; cliente: ClienteParaMarca }> {
  const pedido = ok(
    await sb.from('pedidos').select('id, tipo, titulo, briefing, publicar_em').eq('id', job.pedido_id).single(),
    'ler pedido',
  ) as Pedido;
  const cliente = ok(
    await sb.from('clientes').select('nome, nome_preferido, cor, marca, registro_profissional').eq('id', job.cliente_id).single(),
    'ler cliente',
  ) as ClienteParaMarca;
  return { pedido, cliente };
}

export type Ajuste = { texto: string | null; atalhos: string[] };

/**
 * Os ajustes que valem para esta rodada, do mais antigo ao atual. Cada ajuste
 * parte da versão anterior, então a versão nova carrega todos os de antes: o
 * roteiro (que refaz do zero) precisa da lista inteira; o Claude, que abre o
 * PSD anterior, precisa saber o que já foi feito pra não desfazer.
 */
export async function historicoDeAjustes(sb: SupabaseClient, job: Job): Promise<Ajuste[]> {
  if (job.rodada !== 'ajuste') return [];
  const linhas = ok(
    await sb.from('jobs').select('id, entrada, estado').eq('pedido_id', job.pedido_id).eq('rodada', 'ajuste').order('criado_em'),
    'ler ajustes',
  ) as Array<{ id: string; entrada: { texto?: string | null; atalhos?: string[] }; estado: string }>;
  return linhas
    .filter((l) => l.estado === 'pronto' || l.id === job.id)
    .map((l) => ({ texto: l.entrada.texto ?? null, atalhos: l.entrada.atalhos ?? [] }));
}

/** O editável da versão de que o ajuste parte. */
export async function baixarEditavelBase(sb: SupabaseClient, job: Job, relativo: string): Promise<Buffer | null> {
  const base = job.entrada.base_job as string | undefined;
  if (!base) return null;
  const caminho = [job.conta_id, job.cliente_id, job.pedido_id, base, relativo].join('/');
  const { data, error } = await sb.storage.from(BALDE).download(caminho);
  if (error) throw new Error(`baixar a versão anterior (${relativo}): ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** pedidos/<conta>/<cliente>/<pedido>/<job>/<saida|editavel>/<arquivo> — o RLS do balde lê essa ordem. */
export function caminhoNoBalde(job: Job, relativo: string): string {
  return [job.conta_id, job.cliente_id, job.pedido_id, job.id, relativo].join('/');
}

export async function subir(sb: SupabaseClient, job: Job, arquivoLocal: string, saida: SaidaConferida): Promise<string> {
  const caminho = caminhoNoBalde(job, saida.caminho);
  ok(
    await sb.storage.from(BALDE).upload(caminho, readFileSync(arquivoLocal), { contentType: saida.mime, upsert: true }),
    `subir ${saida.caminho}`,
  );
  return caminho;
}

// O custo de cada tentativa SOMA ao que já estava: uma tentativa que queimou
// tokens e falhou também entra na conta do pedido.
async function somarCustos(sb: SupabaseClient, job: Job, custos: Custos): Promise<Custos> {
  const atual = ok(
    await sb.from('jobs').select('tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo_usd, render_segundos').eq('id', job.id).single(),
    'ler custos',
  ) as Custos;
  return Object.fromEntries(
    Object.entries(custos).map(([k, v]) => [k, Number(atual[k as keyof Custos] ?? 0) + v]),
  ) as Custos;
}

export async function concluir(sb: SupabaseClient, cfg: Config, job: Job, saidas: object[], custos: Custos) {
  const somados = await somarCustos(sb, job, custos);
  ok(
    await sb.from('jobs').update({
      estado: 'pronto',
      etapa: 'pronto',
      progresso: 100,
      saidas,
      erro: null,
      lease_ate: null,
      ...somados,
    }).eq('id', job.id).eq('worker_id', cfg.workerId),
    'concluir job',
  );
  ok(await sb.from('pedidos').update({ estado: 'para_aprovar' }).eq('id', job.pedido_id), 'pedido para aprovar');
}

/** Deu errado: volta pra fila enquanto houver tentativa, senão falha de vez. */
export async function devolverOuFalhar(sb: SupabaseClient, cfg: Config, job: Job, erro: string, custos: Custos) {
  const somados = await somarCustos(sb, job, custos);
  const acabou = job.tentativas >= job.max_tentativas;
  ok(
    await sb.from('jobs').update({
      estado: acabou ? 'falhou' : 'na_fila',
      etapa: acabou ? 'precisa da equipe' : 'tentando de novo',
      erro,
      worker_id: null,
      lease_ate: null,
      ...somados,
    }).eq('id', job.id).eq('worker_id', cfg.workerId),
    'devolver job',
  );
  // Ajuste que falhou de vez não tira do cliente a versão que ele já tinha:
  // o pedido volta a esperar aprovação, com a rodada anterior valendo.
  if (acabou && job.rodada === 'ajuste') {
    ok(await sb.from('pedidos').update({ estado: 'para_aprovar' }).eq('id', job.pedido_id), 'pedido');
  }
  return acabou;
}
