// O teste dos geradores (tarefas 4 e 6): 10 pedidos de imagem da padaria de
// demonstração, 3 variações cada, em cada modelo; e 3 clipes de 5 s. Mede o
// custo que o provedor informa e o tempo, e passa cada imagem pelo pipeline
// da tarefa 8 (src/objeto.ts) pra contar quantas viram objeto aproveitável.
//
//   npm run geradores                       sem RUNWARE_API_KEY: o plano e o custo estimado, sem chamar nada
//   npm run geradores -- --saida <pasta>    com a chave: gera, até o teto
//
// Opções: --teto <US$> (padrão 5; para antes de passar), --modelos
// seedream4,recraftV4 (padrão), --sem-clipes.
//
// A chave fica no worker/.env (RUNWARE_API_KEY=...), nunca no código nem no chat.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { lerConfig } from '../src/config.ts';
import { gerarClipe, gerarImagem, MODELOS, pedidoDaMarca, type NomeDoModelo } from '../src/geracao.ts';
import { julgarObjeto, recortar, vetorizar } from '../src/objeto.ts';

const PADARIA = 'b0a00000-0000-4000-8000-00000000de31';

/** Os 10 pedidos: assuntos da pauta e do dia a dia da padaria, nos três estilos do v2. */
export const PEDIDOS: Array<{ assunto: string; estilo: 'flat' | 'foto' | '3d' }> = [
  { assunto: 'a round sourdough bread loaf with a scored top', estilo: 'flat' },
  { assunto: 'a croissant', estilo: 'flat' },
  { assunto: 'a wooden bread basket with three small breads', estilo: 'flat' },
  { assunto: 'a wood-fired bakery oven', estilo: 'flat' },
  { assunto: 'a cup of coffee next to a slice of toasted bread', estilo: 'foto' },
  { assunto: 'a sourdough loaf cut in half showing the crumb', estilo: 'foto' },
  { assunto: 'a jar of sourdough starter with bubbles', estilo: 'foto' },
  { assunto: 'a baguette', estilo: '3d' },
  { assunto: 'a stack of three pancakes with honey', estilo: '3d' },
  { assunto: 'a rolling pin and a small bag of flour', estilo: '3d' },
];

export const CLIPES = [
  'slow push-in on a golden sourdough loaf on a wooden table, warm morning light, steam rising, no people, no text',
  'flour falling in slow motion over a wooden surface, warm light, no people, no text',
  'a bakery oven door opening with warm glow inside, no people, no text',
];

const arg = (nome: string) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; };

async function principal() {
  const cfg = lerConfig();
  const chave = process.env.RUNWARE_API_KEY ?? '';
  const teto = Number(arg('--teto') ?? 5);
  const modelos = (arg('--modelos') ?? 'seedream4,recraftV4').split(',') as NomeDoModelo[];
  const comClipes = !process.argv.includes('--sem-clipes');
  const saida = path.resolve(arg('--saida') ?? path.join(tmpdir(), 'geradores'));

  // As cores e o fundo saem da marca da padaria, como sairiam no produto.
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const { data: cli } = await sb.from('clientes').select('marca, cor').eq('id', PADARIA).single();
  const conj = (cli?.marca?.conjuntos ?? [])[0] ?? {};
  const cores: string[] = [...new Set([...(cli?.marca?.paleta ?? []).map((p: { cor: string }) => p.cor), cli?.cor].filter(Boolean))].slice(0, 5);
  const fundo = String(conj.fundo ?? '#F4EBDD');

  const estimativa = modelos.reduce((s, m) => s + PEDIDOS.length * 3 * MODELOS[m].usdPorUnidade, 0) + (comClipes ? CLIPES.length * MODELOS.kling25TurboPro.usdPorUnidade : 0);
  console.log(`Plano: ${PEDIDOS.length} pedidos × 3 variações em ${modelos.map((m) => MODELOS[m].nome).join(' e ')}${comClipes ? `, e ${CLIPES.length} clipes de 5 s no ${MODELOS.kling25TurboPro.nome}` : ''}.`);
  console.log(`Paleta da padaria: ${cores.join(', ')} · fundo pedido: ${fundo}`);
  console.log(`Custo estimado pelos preços publicados: US$ ${estimativa.toFixed(2)} · teto: US$ ${teto.toFixed(2)}`);
  if (!chave) {
    console.log('\nSem RUNWARE_API_KEY no ambiente: nada foi chamado. Ponha a chave no worker/.env e rode de novo.');
    return;
  }
  if (estimativa > teto) console.log(`A estimativa passa do teto: o teste para quando o gasto informado chegar perto de US$ ${teto.toFixed(2)}.`);

  mkdirSync(saida, { recursive: true });
  let gasto = 0;
  const imagens: Array<Record<string, unknown>> = [];
  const clipes: Array<Record<string, unknown>> = [];
  const baixar = async (url: string, arquivo: string) => { const r = await fetch(url); writeFileSync(arquivo, Buffer.from(await r.arrayBuffer())); };
  try {
    for (const modelo of modelos) {
      const m = MODELOS[modelo];
      for (const [k, p] of PEDIDOS.entries()) {
        if (gasto + 3 * m.usdPorUnidade > teto) { console.log(`teto: parei antes de ${m.nome} #${k + 1}`); break; }
        const pedido = pedidoDaMarca({ assunto: p.assunto, estilo: p.estilo, cores, fundo });
        const [w, h] = m.tamanhos[0];
        try {
          const gerados = await gerarImagem({ chave, modelo, pedido, largura: w, altura: h, n: 3 });
          for (const [v, g] of gerados.entries()) {
            const custo = g.custoUsd ?? m.usdPorUnidade;
            gasto += custo;
            const base = path.join(saida, `${modelo}-${String(k + 1).padStart(2, '0')}-${v + 1}`);
            await baixar(g.url, `${base}.png`);
            const r = recortar(`${base}.png`, `${base}-recorte.png`);
            const vet = p.estilo === 'flat' ? vetorizar(`${base}.png`, `${base}.svg`, { cores: 6, fundo: r.fundoLiso, paleta: cores }) : null;
            const problema = julgarObjeto(r, vet);
            imagens.push({ modelo: m.nome, pedido: k + 1, estilo: p.estilo, variacao: v + 1, custoUsd: custo, custoInformado: g.custoUsd != null, ms: g.ms,
              fundoLiso: r.fundoLiso, fracao: Math.round(r.fracao * 100) / 100, vetor: vet ? { caminhos: vet.caminhos, cores: vet.cores.length, kb: Math.round(vet.bytes / 1000) } : null,
              aproveitavel: !problema, motivo: problema });
          }
          console.log(`${m.nome} #${k + 1} (${p.estilo}): ${gerados.length} imagens em ${(gerados[0]?.ms ?? 0) / 1000} s · gasto US$ ${gasto.toFixed(3)}`);
        } catch (e) {
          imagens.push({ modelo: m.nome, pedido: k + 1, estilo: p.estilo, erro: (e as Error).message });
          console.log(`${m.nome} #${k + 1}: falhou (${(e as Error).message})`);
        }
      }
    }
    if (comClipes) {
      const m = MODELOS.kling25TurboPro;
      for (const [k, pedido] of CLIPES.entries()) {
        if (gasto + m.usdPorUnidade > teto) { console.log(`teto: parei antes do clipe ${k + 1}`); break; }
        try {
          const g = await gerarClipe({ chave, modelo: 'kling25TurboPro', pedido, largura: 720, altura: 1280, segundos: 5 });
          gasto += g.custoUsd ?? m.usdPorUnidade;
          await baixar(g.url, path.join(saida, `clipe-${k + 1}.mp4`));
          clipes.push({ clipe: k + 1, custoUsd: g.custoUsd, ms: g.ms });
          console.log(`clipe ${k + 1}: ${(g.ms / 1000).toFixed(0)} s · gasto US$ ${gasto.toFixed(3)}`);
        } catch (e) {
          clipes.push({ clipe: k + 1, erro: (e as Error).message });
          console.log(`clipe ${k + 1}: falhou (${(e as Error).message})`);
        }
      }
    }
  } finally {
    writeFileSync(path.join(saida, 'resultado.json'), JSON.stringify({ data: new Date().toISOString(), gasto, imagens, clipes }, null, 1));
  }

  // O resumo por modelo: custo médio por imagem, tempo e quantas viraram objeto aproveitável.
  console.log('\n| Modelo | Imagens | Custo médio | Tempo médio por pedido | Aproveitáveis |\n|---|---|---|---|---|');
  for (const modelo of modelos) {
    const xs = imagens.filter((i) => i.modelo === MODELOS[modelo].nome && !i.erro);
    if (!xs.length) continue;
    const media = (f: (i: Record<string, unknown>) => number) => xs.reduce((s, i) => s + f(i), 0) / xs.length;
    console.log(`| ${MODELOS[modelo].nome} | ${xs.length} | US$ ${media((i) => Number(i.custoUsd)).toFixed(4)} | ${(media((i) => Number(i.ms)) / 1000).toFixed(1)} s | ${xs.filter((i) => i.aproveitavel).length} de ${xs.length} |`);
  }
  console.log(`\nGasto total: US$ ${gasto.toFixed(2)} · pastas e resultado.json em ${saida}`);
}

if (process.argv[1] && process.argv[1].endsWith('geradores.ts')) {
  principal().catch((e) => { console.error(`erro: ${(e as Error).message}`); process.exit(1); });
}
