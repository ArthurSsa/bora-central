// Quanto custa cada tipo de peça, medido nas rodadas que a fábrica já fez:
// dólar do Claude, tokens, tempo dentro dos apps da ArtCraft e tempo até ficar
// pronta. E quanto custaria um mês típico de um cliente com esses números.
//
//   npm run custos                     a tabela no terminal (markdown)
//   npm run custos -- --mes "post=12,carrossel=4,reel=4,capa=2,cartaz=1" --ajustes 1
//
// Só lê. Rodada "com o Claude" é a que gastou token; a do roteiro, da edição do
// Studio e da entrega da equipe sai em "sem modelo" (custo zero de IA).
import { createClient } from '@supabase/supabase-js';
import { lerConfig } from '../src/config.ts';

type Job = {
  id: string; pedido_id: string; rodada: string; skill: string | null; estado: string; tentativas: number;
  custo_usd: number; tokens_entrada: number; tokens_saida: number; tokens_cache_leitura: number; tokens_cache_escrita: number;
  render_segundos: number; iniciado_em: string | null; terminado_em: string | null; atualizado_em: string;
};
type Pedido = { id: string; tipo: string; briefing: Record<string, unknown> };
type Evento = { job_id: string; dados: { ferramenta?: string; ms?: number } | null };

/** As ferramentas da fábrica, pelo app que roda dentro delas. */
const APP_DA_FERRAMENTA: Record<string, string> = {
  cartaz_da_marca: 'VectorCraft', material_da_marca: 'DesignCraft', post_com_pessoa: 'PhotoCraft',
  cena_da_marca: 'EffectCraft', montar_cena: 'EffectCraft', renderizar_motion: 'EffectCraft',
  exportar_video: 'FilmCraft + SoundCraft', desenhar_legendas: 'PhotoCraft',
};
const NOME_APP: Record<string, string> = {
  photocraft: 'PhotoCraft', effectcraft: 'EffectCraft', filmcraft: 'FilmCraft', lightcraft: 'LightCraft',
  vectorcraft: 'VectorCraft', designcraft: 'DesignCraft', soundcraft: 'SoundCraft',
};
const APP_DO_ROTEIRO: Record<string, string> = {
  'post-feed': 'PhotoCraft', carrossel: 'PhotoCraft', 'capa-thumbnail': 'PhotoCraft', 'post-feed-teste': 'PhotoCraft',
  'reel-de-bruto': 'FilmCraft', 'abertura-com-motion': 'EffectCraft', 'carrossel-em-video': 'EffectCraft',
  'cartaz-impressao': 'VectorCraft', 'guia-pdf': 'DesignCraft', 'folheto-dobravel': 'DesignCraft',
};

export function appDaFerramenta(ferramenta: string, skill: string | null): string | null {
  const mcp = ferramenta.match(/^mcp__([a-z]+)__(.+)$/);
  if (mcp) return mcp[1] === 'fabrica' ? APP_DA_FERRAMENTA[mcp[2]] ?? null : NOME_APP[mcp[1]] ?? mcp[1];
  if (ferramenta.startsWith('roteiro:')) return (skill && APP_DO_ROTEIRO[skill]) ?? 'PhotoCraft';
  return null;
}

/** O nome da peça como o cliente pede: o tipo, e o formato quando o tipo tem mais de um. */
export function nomeDaPeca(p: Pedido): string {
  const f = typeof p.briefing?.formato === 'string' ? p.briefing.formato : null;
  if (p.tipo === 'reel') return f === 'abertura' ? 'abertura animada' : f === 'carrossel' ? 'carrossel em vídeo' : 'reel do vídeo gravado';
  if (p.tipo === 'material') return f === 'folheto' ? 'folheto dobrável' : 'guia em PDF';
  if (p.tipo === 'post-feed') return p.briefing?.foto || p.briefing?.foto_marca ? 'post com a pessoa' : 'post';
  return p.tipo;
}

const usd = (v: number) => `US$ ${v.toFixed(3)}`;
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function principal() {
  const cfg = lerConfig();
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const arg = (nome: string) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; };

  const { data: jobs, error } = await sb.from('jobs').select('id, pedido_id, rodada, skill, estado, tentativas, custo_usd, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, render_segundos, iniciado_em, terminado_em, atualizado_em')
    .in('estado', ['pronto', 'falhou']).limit(5000);
  if (error) throw error;
  const { data: pedidos } = await sb.from('pedidos').select('id, tipo, briefing').in('id', [...new Set((jobs as Job[]).map((j) => j.pedido_id))]);
  const pedidoDe = new Map((pedidos as Pedido[]).map((p) => [p.id, p]));
  const eventos: Evento[] = [];
  const ids = (jobs as Job[]).map((j) => j.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('job_eventos').select('job_id, dados').in('job_id', ids.slice(i, i + 200)).not('dados', 'is', null);
    eventos.push(...((data ?? []) as Evento[]));
  }

  const comClaude = (j: Job) => Number(j.tokens_saida) > 0;
  const minutos = (j: Job) => j.iniciado_em ? (Date.parse(j.terminado_em ?? j.atualizado_em) - Date.parse(j.iniciado_em)) / 60_000 : 0;
  const linhas: string[] = [];
  const grupos = new Map<string, Job[]>();
  for (const j of jobs as Job[]) {
    const p = pedidoDe.get(j.pedido_id);
    if (!p) continue;
    const rodada = j.rodada === 'producao' ? '' : j.rodada === 'ajuste' ? ' · ajuste' : j.rodada === 'edicao' ? ' · edição no Studio' : ` · ${j.rodada}`;
    const chave = `${nomeDaPeca(p)}${rodada}|${comClaude(j) ? 'claude' : 'sem modelo'}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), j]);
  }

  linhas.push('## Por peça', '', '| Peça | Com | Rodadas | Custo médio | Custo máximo | Tokens de saída (média) | Tempo nos apps | Até ficar pronta | Falhou |', '|---|---|---|---|---|---|---|---|---|');
  const custoMedio = new Map<string, number>();
  for (const [chave, js] of [...grupos].sort((a, b) => a[0].localeCompare(b[0], 'pt'))) {
    const [peca, quem] = chave.split('|');
    const custos = js.map((j) => Number(j.custo_usd));
    if (quem === 'claude') custoMedio.set(peca, media(custos));
    linhas.push(`| ${peca} | ${quem === 'claude' ? 'Claude' : 'sem modelo'} | ${js.length} | ${usd(media(custos))} | ${usd(Math.max(...custos))} | ${Math.round(media(js.map((j) => Number(j.tokens_saida))))} | ${media(js.map((j) => Number(j.render_segundos))).toFixed(1)} s | ${media(js.map(minutos)).toFixed(1)} min | ${js.filter((j) => j.estado === 'falhou').length} |`);
  }

  // O tempo por app, só nas rodadas com o Claude (as do roteiro são testes).
  const skillDe = new Map((jobs as Job[]).map((j) => [j.id, j]));
  const porApp = new Map<string, { chamadas: number; ms: number }>();
  for (const e of eventos) {
    const j = skillDe.get(e.job_id);
    if (!j || !comClaude(j) || !e.dados?.ferramenta) continue;
    const app = appDaFerramenta(e.dados.ferramenta, j.skill);
    if (!app) continue;
    const a = porApp.get(app) ?? { chamadas: 0, ms: 0 };
    a.chamadas++; a.ms += Number(e.dados.ms ?? 0);
    porApp.set(app, a);
  }
  linhas.push('', '## Tempo por app (rodadas com o Claude)', '', '| App | Chamadas | Tempo total | Por chamada |', '|---|---|---|---|');
  for (const [app, a] of [...porApp].sort((x, y) => y[1].ms - x[1].ms)) {
    linhas.push(`| ${app} | ${a.chamadas} | ${(a.ms / 1000).toFixed(1)} s | ${(a.ms / a.chamadas / 1000).toFixed(2)} s |`);
  }

  // O mês típico, com o custo médio de cada peça e um ajuste em texto livre por peça.
  const mix = Object.fromEntries((arg('--mes') ?? 'post=12,carrossel=4,reel do vídeo gravado=4,capa=2,cartaz=1').split(',').map((x) => {
    const [k, v] = x.split('='); return [k.trim() === 'reel' ? 'reel do vídeo gravado' : k.trim(), Number(v)];
  }));
  const ajustes = Number(arg('--ajustes') ?? 1);
  const custoAjuste = media([...custoMedio].filter(([k]) => k.endsWith('· ajuste')).map(([, v]) => v));
  linhas.push('', `## Mês típico (${ajustes} ajuste com o Claude por peça, a ${usd(custoAjuste)} cada)`, '', '| Peça | Quantas | Custo médio | Subtotal |', '|---|---|---|---|');
  let total = 0, pecas = 0;
  const semMedida: string[] = [];
  for (const [peca, n] of Object.entries(mix)) {
    const c = custoMedio.get(peca);
    if (c == null) { semMedida.push(peca); continue; }
    const sub = n * (c + ajustes * custoAjuste);
    total += sub; pecas += n;
    linhas.push(`| ${peca} | ${n} | ${usd(c)} | ${usd(sub)} |`);
  }
  linhas.push(`| **total** | ${pecas} | | **${usd(total)}** |`);
  if (semMedida.length) linhas.push('', `Sem medida com o Claude ainda: ${semMedida.join(', ')}.`);
  console.log(linhas.join('\n'));
}

if (process.argv[1] && process.argv[1].endsWith('custos.ts')) {
  principal().catch((e) => { console.error(e); process.exit(1); });
}
