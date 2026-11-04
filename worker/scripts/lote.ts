// O lote de medição de custo (tarefa 1 do plano "Bora até Fevereiro"): 3
// rodadas de cada tipo de peça que só tinha 1, divididas entre três marcas
// (padaria de demonstração, Moacyr e Virtuex), pela fábrica com o Claude.
//
//   npm run lote                          confere tudo, sem gastar nada
//   npm run lote -- --enfileirar 1        enfileira a metade 1 (imagens: post com a pessoa, carrossel, capa)
//   npm run lote -- --enfileirar 2        enfileira a metade 2 (material e motion: cartaz, guia, abertura)
//   npm run lote -- --situacao            como está cada pedido do lote e quanto já gastou
//
// Opções: --orcamento <US$> (o que ainda cabe na noite; padrão 5, o teto do
// bloco) e --registro <arquivo> (onde ficam os ids; padrão
// docs/medidas/lotes/<hoje>.json).
//
// Cada pedido sai com UMA tentativa: medir custo não é refazer até dar certo.
// Por isso o lote só enfileira com a fábrica desligada — ligada, ela pegaria
// o pedido antes de a tentativa única ser gravada (aconteceu em 27/10). Depois
// de enfileirar, ligue a fábrica (npm run fabrica:ligar).
//
// Os pedidos são feitos por uma conta de equipe de teste, que só é da equipe
// enquanto o script roda. Ninguém publica nada: as peças ficam "para aprovar".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { lerConfig, RAIZ_REPO } from '../src/config.ts';

const PADARIA = 'b0a00000-0000-4000-8000-00000000de31';
const MOACYR = 'ae7dc7bf-f54a-421d-b701-bf9e576ddc91';
const VIRTUEX = 'b35a8828-e213-4883-9259-f23143b9bfdf';
const CHAVE_PUBLICA = 'sb_publishable_G_FuzadzmX2BwkRO81H3mw_xoYnthod';
const EMAIL_EQUIPE = 'equipe-teste@fabrica-bora.test';

export type PedidoDoLote = { metade: 1 | 2; peca: string; cliente: string; marca: string; tipo: string; briefing: Record<string, unknown> };

/**
 * Os 18 pedidos. Os textos da padaria são os da pauta dela; os do Moacyr e da
 * Virtuex são neutros, da área de cada um (sem inventar estratégia de cliente
 * real). O "post com a pessoa" vai 3 vezes na padaria: é a única marca com
 * foto da pessoa no banco de fotos.
 */
export function pedidosDoLote(fotoDaPadaria: string | null): PedidoDoLote[] {
  const p = (metade: 1 | 2, peca: string, cliente: string, marca: string, tipo: string, briefing: Record<string, unknown>): PedidoDoLote => ({ metade, peca, cliente, marca, tipo, briefing });
  return [
    p(1, 'post com a pessoa', PADARIA, 'padaria', 'post-feed', { texto: 'A fornada sai às 7h: venha buscar o pão quente', foto_marca: fotoDaPadaria, jeito: 'auto' }),
    p(1, 'post com a pessoa', PADARIA, 'padaria', 'post-feed', { texto: 'Bastidor da madrugada na padaria', foto_marca: fotoDaPadaria, jeito: 'foto' }),
    p(1, 'post com a pessoa', PADARIA, 'padaria', 'post-feed', { texto: 'Por que o nosso pão leva 36 horas pra ficar pronto', foto_marca: fotoDaPadaria, jeito: 'recorte' }),
    p(1, 'carrossel', PADARIA, 'padaria', 'carrossel', { texto: 'Três jeitos de usar o pão amanhecido', slides: 5 }),
    p(1, 'carrossel', MOACYR, 'Moacyr', 'carrossel', { texto: 'Não existe atalho pra liderar um time. Liderança se aprende fazendo. Organização vem antes de talento. Feedback toda semana', slides: 5 }),
    p(1, 'carrossel', VIRTUEX, 'Virtuex', 'carrossel', { texto: 'Três sinais de que a empresa precisa de um sistema. Planilha que ninguém atualiza. Retrabalho toda semana. Decisão sem número', slides: 5 }),
    p(1, 'capa', PADARIA, 'padaria', 'capa', { texto: 'Por que o nosso pão leva 36 horas pra ficar pronto' }),
    p(1, 'capa', MOACYR, 'Moacyr', 'capa', { texto: 'Como montei um time de produto sem saber programar' }),
    p(1, 'capa', VIRTUEX, 'Virtuex', 'capa', { texto: 'Como organizar a empresa sem viver de planilha' }),
    p(2, 'cartaz', PADARIA, 'padaria', 'cartaz', { texto: 'Aula aberta de fermentação no sábado', folha: 'a4' }),
    p(2, 'cartaz', MOACYR, 'Moacyr', 'cartaz', { texto: 'Liderança se aprende fazendo', folha: 'a4' }),
    p(2, 'cartaz', VIRTUEX, 'Virtuex', 'cartaz', { texto: 'Seu processo, sem planilha', folha: 'a4' }),
    p(2, 'guia em PDF', PADARIA, 'padaria', 'material', { texto: 'Cinco cuidados pra o pão durar a semana. Guardar em saco de pano. Não guardar na geladeira. Fatiar só na hora. Congelar o que sobrar. Esquentar no forno antes de servir.', formato: 'guia', paginas: 6 }),
    p(2, 'guia em PDF', MOACYR, 'Moacyr', 'material', { texto: 'Quatro hábitos de quem lidera bem. Dar feedback toda semana. Organizar antes de cobrar. Ouvir antes de decidir. Aprender fazendo.', formato: 'guia', paginas: 6 }),
    p(2, 'guia em PDF', VIRTUEX, 'Virtuex', 'material', { texto: 'Quatro passos pra organizar a empresa. Mapear o processo. Tirar o retrabalho. Medir o que importa. Revisar todo mês.', formato: 'guia', paginas: 6 }),
    p(2, 'abertura animada', PADARIA, 'padaria', 'reel', { texto: 'A fornada sai às 7h', formato: 'abertura' }),
    p(2, 'abertura animada', MOACYR, 'Moacyr', 'reel', { texto: 'Liderança se aprende fazendo', formato: 'abertura' }),
    p(2, 'abertura animada', VIRTUEX, 'Virtuex', 'reel', { texto: 'Tecnologia que simplifica', formato: 'abertura' }),
  ];
}

type Registro = { data: string; pedidos: Array<{ id: string; metade: number; peca: string; marca: string; chave?: string }> };
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' });
const arg = (nome: string) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; };

/** A conta de equipe de teste, com uma senha nova só na memória; deixa de ser equipe no fim. */
async function comoEquipe(admin: SupabaseClient, url: string): Promise<{ sb: SupabaseClient; soltar: () => Promise<void> }> {
  const senha = randomBytes(24).toString('base64url');
  const lista = await admin.auth.admin.listUsers({ perPage: 1000 });
  let uid = lista.data.users.find((u) => u.email === EMAIL_EQUIPE)?.id;
  if (uid) await admin.auth.admin.updateUserById(uid, { password: senha });
  else uid = (await admin.auth.admin.createUser({ email: EMAIL_EQUIPE, password: senha, email_confirm: true })).data.user!.id;
  await admin.from('profiles').update({ is_agency: true }).eq('id', uid);
  const sb = createClient(url, CHAVE_PUBLICA, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL_EQUIPE, password: senha });
  if (error) throw error;
  return { sb, soltar: async () => { await admin.from('profiles').update({ is_agency: false }).eq('id', uid!); } };
}

async function principal() {
  const cfg = lerConfig();
  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const registro = path.resolve(arg('--registro') ?? path.join(RAIZ_REPO, 'docs', 'medidas', 'lotes', `${hoje()}.json`));
  const lido: Registro = existsSync(registro) ? JSON.parse(readFileSync(registro, 'utf8')) : { data: hoje(), pedidos: [] };

  // --situacao: cada pedido do lote, o estado e o custo de todas as rodadas dele.
  if (process.argv.includes('--situacao')) {
    if (!lido.pedidos.length) { console.log(`Nenhum pedido no registro ${registro}.`); return; }
    const ids = lido.pedidos.map((p) => p.id);
    // --esperar: só responde quando nenhum pedido do lote está na fila ou rodando (até 90 min).
    if (process.argv.includes('--esperar')) {
      const ate = Date.now() + 90 * 60_000;
      for (;;) {
        const { data } = await admin.from('jobs').select('estado').in('pedido_id', ids);
        if ((data ?? []).every((j) => !['na_fila', 'rodando'].includes(j.estado)) || Date.now() > ate) break;
        await new Promise((r) => setTimeout(r, 20_000));
      }
    }
    const { data: jobs } = await admin.from('jobs').select('pedido_id, rodada, estado, custo_usd, erro').in('pedido_id', ids);
    let total = 0;
    console.log('| # | Peça | Marca | Estado | Custo | Motivo da falha |\n|---|---|---|---|---|---|');
    lido.pedidos.forEach((p, i) => {
      // A linha do ajuste conta só a rodada de ajuste; a da peça, só a produção (o ajuste usa o mesmo pedido).
      const rodada = p.peca.endsWith('· ajuste') ? 'ajuste' : 'producao';
      const js = (jobs ?? []).filter((j) => j.pedido_id === p.id && j.rodada === rodada);
      const custo = js.reduce((s, j) => s + Number(j.custo_usd), 0);
      total += custo;
      const falhou = js.find((j) => j.estado === 'falhou');
      console.log(`| ${i + 1} | ${p.peca} | ${p.marca} | ${js.map((j) => j.estado).join(', ') || '—'} | US$ ${custo.toFixed(3)} | ${falhou?.erro ? String(falhou.erro).slice(0, 120) : ''} |`);
    });
    console.log(`\nGasto do lote: US$ ${total.toFixed(2)}`);
    return;
  }

  // A conferência: sempre roda, e é tudo que roda sem --enfileirar.
  const problemas: string[] = [];
  const avisos: string[] = [];
  if (cfg.agente !== 'claude') problemas.push(`a fábrica está no modo ${cfg.agente}; o lote mede o Claude`);
  if (Math.abs(cfg.tetoUsd - 0.5) > 1e-9) problemas.push(`FABRICA_TETO_USD é ${cfg.tetoUsd}; o lote pede 0,50 por rodada`);
  const { data: foto } = await admin.from('marca_elementos').select('id').eq('cliente_id', PADARIA).eq('tipo', 'foto').order('criado_em').limit(1);
  const pedidos = pedidosDoLote(foto?.[0]?.id ?? null);
  if (!foto?.[0]) problemas.push('a padaria não tem foto no banco de fotos (o post com a pessoa precisa)');
  const { data: clientes } = await admin.from('clientes').select('id, nome, marca').in('id', [PADARIA, MOACYR, VIRTUEX]);
  for (const id of [PADARIA, MOACYR, VIRTUEX]) {
    const c = clientes?.find((x) => x.id === id);
    if (!c) { problemas.push(`cliente ${id} não existe`); continue; }
    if (!c.marca?.conjuntos?.length) avisos.push(`${c.nome} está sem marca (sem conjuntos de cor): a fábrica deriva as cores e usa a fonte padrão`);
  }
  const { data: sinais } = await admin.rpc('sinais_da_fabrica');
  const ligada = (sinais ?? []).some((s: { segundos_sem_sinal: number }) => Number(s.segundos_sem_sinal) <= 90);
  const { data: naFila } = await admin.from('jobs').select('id').in('estado', ['na_fila', 'rodando']);
  if (naFila?.length) avisos.push(`há ${naFila.length} job(s) na fila ou rodando: entram antes do lote e somam no gasto`);

  // --extras: os 3 ajustes em texto livre (post, carrossel e capa da padaria, que o lote já fez)
  // e 1 reel do vídeo gravado que está no balde da padaria. Também uma tentativa cada.
  if (process.argv.includes('--extras')) {
    if (ligada) throw new Error('a fábrica está ligada: desligue antes de enfileirar (npm run fabrica:desligar)');
    if (lido.pedidos.some((p) => p.metade === 3)) throw new Error('os extras já foram enfileirados hoje');
    const orc = Number(arg('--orcamento') ?? 2);
    if (4 * cfg.tetoUsd > orc + 1e-9) throw new Error(`os extras podem gastar até US$ ${(4 * cfg.tetoUsd).toFixed(2)}, e o orçamento é US$ ${orc.toFixed(2)}`);
    const daPadaria = (peca: string) => lido.pedidos.find((p) => p.marca === 'padaria' && p.peca === peca);
    const ajustes: Array<[string, string]> = [
      ['post com a pessoa', 'Troca o título por "Pão quente às 7h" e deixa o resto como está.'],
      ['carrossel', 'Deixa o último slide mais curto, só com a chamada pra salvar o post.'],
      ['capa', 'Põe "36 horas" em destaque no título das três opções.'],
    ];
    const { data: pasta } = await admin.storage.from('pedidos').list(`${'b0a00000-0000-4000-8000-00000000de30'}/${PADARIA}/uploads`, { limit: 50 });
    const brutos = [];
    for (const d of pasta ?? []) {
      const { data: f } = await admin.storage.from('pedidos').list(`b0a00000-0000-4000-8000-00000000de30/${PADARIA}/uploads/${d.name}`);
      for (const x of f ?? []) if (/^bruto\.(mp4|mov|m4v|webm)$/.test(x.name)) brutos.push(`b0a00000-0000-4000-8000-00000000de30/${PADARIA}/uploads/${d.name}/${x.name}`);
    }
    const { sb, soltar } = await comoEquipe(admin, cfg.supabaseUrl);
    try {
      for (const [peca, texto] of ajustes) {
        const base = daPadaria(peca);
        if (!base) { console.log(`sem ${peca} da padaria no lote: ajuste pulado`); continue; }
        const { data: job, error } = await sb.rpc('pedir_ajuste', { p_pedido: base.id, p_texto: texto, p_atalhos: [] });
        if (error) { console.log(`ajuste de ${peca} falhou: ${error.message}`); continue; }
        await admin.from('jobs').update({ max_tentativas: 1 }).eq('id', job).eq('estado', 'na_fila');
        lido.pedidos.push({ id: base.id, metade: 3, peca: `${peca} · ajuste`, marca: 'padaria', chave: `ajuste|${peca}` });
        console.log(`ajuste de ${peca}: job ${job}`);
      }
      if (brutos[0]) {
        const { data: id, error } = await sb.rpc('criar_pedido', { p_cliente: PADARIA, p_tipo: 'reel',
          p_briefing: { texto: 'Um recado rápido pra quem acompanha a padaria', formato: 'bruto', anexo: brutos[0] } });
        if (error) console.log(`reel falhou: ${error.message}`);
        else {
          await admin.from('jobs').update({ max_tentativas: 1 }).eq('pedido_id', id).eq('estado', 'na_fila');
          lido.pedidos.push({ id, metade: 3, peca: 'reel do vídeo gravado', marca: 'padaria', chave: 'reel' });
          console.log(`reel (com o vídeo de teste no balde): ${id}`);
        }
      } else console.log('sem vídeo gravado no balde da padaria: reel pulado');
    } finally {
      await soltar();
      writeFileSync(registro, JSON.stringify(lido, null, 1) + '\n');
    }
    console.log('Agora ligue a fábrica: npm run fabrica:ligar');
    return;
  }

  const metade = Number(arg('--enfileirar'));
  const orcamento = Number(arg('--orcamento') ?? 5);
  // Os da metade que ainda não foram pedidos; só entram quantos cabem no orçamento pelo pior caso
  // (uma rodada no teto cada). O resto fica pra quando o gasto de verdade liberar espaço.
  const chave = (p: { peca: string; marca: string }, i: number) => `${p.peca}|${p.marca}|${i}`;
  const daMetade = pedidos.filter((p) => p.metade === metade).map((p, i) => ({ p, k: chave(p, i) }));
  const pedidosAntes = new Set(lido.pedidos.filter((r) => r.metade === metade).map((r) => r.chave));
  const faltam = daMetade.filter((x) => !pedidosAntes.has(x.k));
  const cabem = Math.floor((orcamento + 1e-9) / cfg.tetoUsd);
  const escolhidos = metade === 1 || metade === 2 ? faltam.slice(0, cabem) : [];
  const pior = escolhidos.length * cfg.tetoUsd;
  console.log(`Lote: ${pedidos.length} pedidos (${pedidos.filter((p) => p.metade === 1).length} na metade 1, ${pedidos.filter((p) => p.metade === 2).length} na metade 2).`);
  console.log(`Fábrica: ${ligada ? 'ligada' : 'desligada'} · teto por rodada US$ ${cfg.tetoUsd} · modelo ${cfg.modelo}.`);
  for (const a of avisos) console.log(`aviso: ${a}`);
  for (const p of problemas) console.log(`problema: ${p}`);

  if (!process.argv.includes('--enfileirar')) {
    console.log(problemas.length ? `\n${pedidos.length - problemas.length} de ${pedidos.length}: corrija os problemas antes de enfileirar.` : `\n${pedidos.length} de ${pedidos.length} prontos. Nada foi gastado.`);
    process.exitCode = problemas.length ? 1 : 0;
    return;
  }
  if (problemas.length) throw new Error('não enfileiro com problema na conferência');
  if (!(metade === 1 || metade === 2)) throw new Error('diga qual metade: --enfileirar 1 ou --enfileirar 2');
  if (ligada) throw new Error('a fábrica está ligada: desligue (npm run fabrica:desligar), enfileire e ligue de novo — ligada, ela pega o pedido antes da tentativa única ser gravada');
  if (!faltam.length) throw new Error(`a metade ${metade} já foi toda enfileirada (${pedidosAntes.size} pedidos no registro)`);
  if (!escolhidos.length) throw new Error(`nenhum pedido cabe: o orçamento de US$ ${orcamento.toFixed(2)} não cobre uma rodada no teto (US$ ${cfg.tetoUsd})`);
  if (escolhidos.length < faltam.length) console.log(`O orçamento cobre ${escolhidos.length} de ${faltam.length} pelo pior caso; o resto entra depois, com o que sobrar.`);

  const { sb, soltar } = await comoEquipe(admin, cfg.supabaseUrl);
  try {
    for (const { p, k } of escolhidos) {
      const { data: id, error } = await sb.rpc('criar_pedido', { p_cliente: p.cliente, p_tipo: p.tipo, p_briefing: p.briefing });
      if (error) { console.log(`falhou ao pedir ${p.peca} (${p.marca}): ${error.message}`); continue; }
      // Uma tentativa só: a fábrica está desligada, então o job ainda está na fila.
      await admin.from('jobs').update({ max_tentativas: 1 }).eq('pedido_id', id).eq('estado', 'na_fila');
      lido.pedidos.push({ id, metade, peca: p.peca, marca: p.marca, chave: k });
      console.log(`pedido ${p.peca} (${p.marca}): ${id}`);
    }
  } finally {
    await soltar();
    mkdirSync(path.dirname(registro), { recursive: true });
    writeFileSync(registro, JSON.stringify(lido, null, 1) + '\n');
  }
  console.log(`\nEnfileirados ${lido.pedidos.filter((p) => p.metade === metade).length}. Pior caso US$ ${pior.toFixed(2)}. Agora ligue a fábrica: npm run fabrica:ligar`);
}

if (process.argv[1] && process.argv[1].endsWith('lote.ts')) {
  principal().catch((e) => { console.error(`erro: ${(e as Error).message}`); process.exit(1); });
}
