// O VectorCraft na fábrica — sempre pelo CLI (`run`), sem janela.
//
//   - o logo vetorial (SVG, PDF, AI, EPS) que a equipe sobe na Marca vira PNG
//     nítido do tamanho que a peça pede, nas cores dele e em versões de uma
//     cor só, uma na cor de texto de cada conjunto: logo com uma parte da cor
//     do fundo some, e a versão de uma cor é o que o manual de marca manda
//     usar nesse caso;
//   - o cartaz para imprimir: A4 ou A3 com 3 mm de sangria, o fundo do
//     conjunto passando do corte, título que encolhe até caber, o logo; sai
//     em PDF pra gráfica (com TrimBox e BleedBox e marcas de corte), PNG pro
//     WhatsApp, e editável em .vectorcraft e .ai.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import type { ParametrosAgente } from './agente.ts';
import type { Elemento } from './fila.ts';
import { contraste, type Conjunto } from './marca.ts';
import { dimensoesPng } from './verificar.ts';

export const EXTENSAO_VETORIAL = /\.(svg|pdf|ai|eps)$/i;
const PT_POR_MM = 72 / 25.4;
export const SANGRIA_PT = 3 * PT_POR_MM;
export const MARGEM_SEGURA_PT = 15 * PT_POR_MM;
export const FORMATOS_CARTAZ = {
  a4: { nome: 'A4', largura: 210 * PT_POR_MM, altura: 297 * PT_POR_MM },
  a3: { nome: 'A3', largura: 297 * PT_POR_MM, altura: 420 * PT_POR_MM },
} as const;
export type FormatoCartaz = keyof typeof FORMATOS_CARTAZ;

type Passo = { command: string; params?: Record<string, unknown> };

/**
 * Roda passos num documento (aberto de `entrada`, ou novo) e devolve o
 * resultado de cada um. Um passo que falha para tudo: o VectorCraft diz qual.
 */
export function rodarNoVectorCraft(entrada: string | null, passos: Passo[], pasta: string): unknown[] {
  mkdirSync(pasta, { recursive: true });
  const arq = path.join(pasta, `vectorcraft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jsonl`);
  writeFileSync(arq, passos.map((p) => JSON.stringify(p)).join('\n') + '\n');
  let saida: string;
  try {
    saida = execFileSync(acharCli('vectorcraft'), ['run', ...(entrada ? ['--in', entrada] : []), '--commands', arq],
      { encoding: 'utf8', timeout: 5 * 60_000, stdio: ['ignore', 'pipe', 'pipe'], cwd: pasta });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`VectorCraft: ${(err.stderr || err.stdout || err.message).trim().split(/\r?\n/).slice(-3).join(' ')}`);
  }
  // Com --in, a primeira linha é a abertura do arquivo: não é um dos passos.
  const linhas = saida.split(/\r?\n/).filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as { step?: string; command?: string; result?: unknown; error?: unknown })
    .filter((l) => l.step !== 'open');
  const falhou = linhas.find((l) => l.error);
  if (falhou) throw new Error(`VectorCraft: ${falhou.command ?? 'passo'} falhou: ${JSON.stringify(falhou.error)}`);
  return linhas.map((l) => l.result);
}

type Caixa = { x: number; y: number; width: number; height: number };

/** A caixa que junta todas as camadas do documento: o tamanho do desenho em pontos. */
function caixaDaArte(inspecao: { layers?: Array<{ bounds?: Caixa }> }): Caixa | null {
  const cs = (inspecao.layers ?? []).map((l) => l.bounds).filter((b): b is Caixa => !!b && b.width > 0 && b.height > 0);
  if (!cs.length) return null;
  const x0 = Math.min(...cs.map((b) => b.x)), y0 = Math.min(...cs.map((b) => b.y));
  const x1 = Math.max(...cs.map((b) => b.x + b.width)), y1 = Math.max(...cs.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export type LogoPreparado = { arquivo: string; largura: number; altura: number; cores: string[]; mono: Record<string, string> };

/**
 * O logo vetorial em PNG transparente com o lado maior em `ladoPx`, nas cores
 * dele, e uma versão de uma cor pra cada tinta pedida (a cor de texto dos
 * conjuntos). Os arquivos saem em `pasta`, com `nome` na frente.
 */
export function prepararLogoVetorial(original: string, pasta: string, nome: string, tintas: string[], ladoPx = 1200): LogoPreparado {
  const trabalho = path.join(pasta, '.vectorcraft');
  const [cores, inspecao] = rodarNoVectorCraft(original, [
    { command: 'recolor.colors', params: {} },
    { command: 'document.inspect', params: { depth: 1 } },
  ], trabalho) as [{ colors: Array<{ hex: string }> }, { layers?: Array<{ bounds?: Caixa }> }];
  const caixa = caixaDaArte(inspecao);
  if (!caixa) throw new Error(`o logo ${path.basename(original)} não tem desenho que o VectorCraft enxergue`);
  const escala = ladoPx / Math.max(caixa.width, caixa.height);
  const exportar = (arquivo: string): Passo => ({
    command: 'document.export',
    params: { path: arquivo, format: 'png', useArtboards: false, scale: escala, background: 'transparent' },
  });
  const arquivo = path.join(pasta, `${nome}.png`);
  rodarNoVectorCraft(original, [exportar(arquivo)], trabalho);
  const dim = dimensoesPng(readFileSync(arquivo));
  if (!dim) throw new Error(`o PNG do logo ${nome} saiu inválido`);
  const hexes = [...new Set(cores.colors.map((c) => c.hex.toUpperCase()))];
  const mono: Record<string, string> = {};
  for (const tinta of [...new Set(tintas.map((t) => t.toUpperCase()))]) {
    const arq = path.join(pasta, `${nome}-mono-${tinta.slice(1)}.png`);
    rodarNoVectorCraft(original, [
      { command: 'select.all', params: {} },
      { command: 'recolor.apply', params: { map: Object.fromEntries(hexes.map((h) => [h, tinta])) } },
      exportar(arq),
    ], trabalho);
    mono[tinta] = arq;
  }
  return { arquivo, largura: dim.largura, altura: dim.altura, cores: hexes, mono };
}

/**
 * Qual arquivo do logo vai sobre este conjunto: o de cores, a não ser que uma
 * das cores dele quase desapareça no fundo (contraste abaixo de 1,6:1) — aí a
 * versão de uma cor, na tinta do conjunto, que já lê sobre ele.
 */
export function logoParaOFundo(l: { arquivo: string; cores?: string[]; mono?: Record<string, string> }, c: Conjunto): string {
  const some = (l.cores ?? []).some((cor) => contraste(cor, c.fundo) < 1.6);
  return (some && l.mono?.[c.tinta.toUpperCase()]) || l.arquivo;
}

/**
 * Os elementos vetoriais da marca (SVG, PDF, AI, EPS) viram PNG antes do
 * agente começar, com as versões de uma cor nas tintas dos conjuntos. Os
 * caminhos continuam relativos à pasta do job, como os outros elementos.
 */
export function prepararElementos(pastaJob: string, elementos: Elemento[], tintas: string[]): Elemento[] {
  const rel = (a: string) => path.relative(pastaJob, a).split(path.sep).join('/');
  return elementos.map((e) => {
    if (!EXTENSAO_VETORIAL.test(e.arquivo)) return e;
    const abs = path.join(pastaJob, e.arquivo);
    const nome = path.basename(abs).replace(/\.[^.]+$/, '');
    const l = prepararLogoVetorial(abs, path.dirname(abs), nome, tintas);
    return { ...e, arquivo: rel(l.arquivo), largura: l.largura, altura: l.altura, cores: l.cores,
      mono: Object.fromEntries(Object.entries(l.mono).map(([k, v]) => [k, rel(v)])) };
  });
}

// ---------- o cartaz ----------

/** Peso numérico pro nome de estilo que as fontes estáticas usam. */
const ESTILO_DO_PESO: Array<[number, string]> = [[400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];
export const estiloDoPeso = (peso: number) => ESTILO_DO_PESO.reduce((a, b) => (Math.abs(b[0] - peso) < Math.abs(a[0] - peso) ? b : a))[1];

/** Onde o logo vai no cartaz, em pontos [x, y, largura, altura]: canto de baixo, à direita, dentro da margem. */
export function caixaDoLogo(formato: FormatoCartaz): [number, number, number, number] {
  const { largura: W, altura: H } = FORMATOS_CARTAZ[formato];
  const k = W / FORMATOS_CARTAZ.a4.largura;
  return [W - MARGEM_SEGURA_PT - 140 * k, H - MARGEM_SEGURA_PT - 64 * k, 140 * k, 64 * k];
}

export type Cartaz = {
  formato: FormatoCartaz;
  conjunto: Conjunto;
  fonte: string;
  pesos: { titulo: number; texto: number };
  impacto: boolean;
  alinhamento: 'left' | 'center';
  titulo: string;
  apoio: string | null;
  assinatura: string | null;
  logo: string | null;
};

/**
 * Monta o cartaz e salva tudo em `pastaJob`: saida/cartaz.pdf (com sangria e
 * marcas de corte), saida/cartaz.png (1080 px de largura, só a área do
 * corte), editavel/cartaz.vectorcraft e editavel/cartaz.ai.
 *
 * O desenho: o fundo do conjunto até a sangria; a barra de destaque no topo;
 * o título numa caixa que encolhe o texto até caber; o apoio embaixo dele; a
 * assinatura e o logo no pé. Tudo de texto fica 15 mm pra dentro do corte —
 * a gráfica corta com folga de 1 a 2 mm.
 */
export function montarCartaz(pastaJob: string, o: Cartaz): { pdf: string; png: string; vectorcraft: string; ai: string } {
  const { largura: W, altura: H } = FORMATOS_CARTAZ[o.formato];
  const k = W / FORMATOS_CARTAZ.a4.largura;
  const m = MARGEM_SEGURA_PT;
  const c = o.conjunto;
  const centro = o.alinhamento === 'center';
  const justify = centro ? 'center' : 'left';
  const ref = (n: number) => `$${n}.id`;
  const passos: Passo[] = [
    { command: 'file.new', params: { width: `${o.formato === 'a4' ? 210 : 297} mm`, height: `${o.formato === 'a4' ? 297 : 420} mm`, units: 'Millimeters', name: 'cartaz' } },
    { command: 'document.setup', params: { bleed: SANGRIA_PT } },
    // 2: o fundo, passando do corte até o fim da sangria
    { command: 'shape.rectangle', params: { x: -SANGRIA_PT, y: -SANGRIA_PT, width: W + 2 * SANGRIA_PT, height: H + 2 * SANGRIA_PT } },
    { command: 'paint.setFill', params: { color: c.fundo, ids: [ref(2)] } },
    { command: 'paint.setStroke', params: { none: true, ids: [ref(2)] } },
    // 5: a barra de destaque
    { command: 'shape.rectangle', params: { x: centro ? (W - 120 * k) / 2 : m, y: m, width: 120 * k, height: 10 * k } },
    { command: 'paint.setFill', params: { color: c.destaque, ids: [ref(5)] } },
    { command: 'paint.setStroke', params: { none: true, ids: [ref(5)] } },
  ];
  const titulo = o.impacto ? o.titulo.toUpperCase() : o.titulo;
  passos.push({ command: 'text.create', params: {
    x: m, y: H * 0.26, text: titulo, size: (o.impacto ? 92 : 76) * k, font: o.fonte, style: estiloDoPeso(o.pesos.titulo),
    color: c.tinta, justify, area: { width: W - 2 * m, height: H * 0.38, fit: 'shrinkText', fitMinPercent: 30 },
  } });
  if (o.apoio) passos.push({ command: 'text.create', params: {
    x: m, y: H * 0.68, text: o.apoio, size: 28 * k, font: o.fonte, style: estiloDoPeso(o.pesos.texto),
    color: c.tinta, justify, area: { width: W - 2 * m, height: H * 0.12, fit: 'shrinkText', fitMinPercent: 50 },
  } });
  const pe = H - m;
  if (o.assinatura) passos.push({ command: 'text.create', params: {
    x: m, y: pe - 22 * k, text: o.assinatura, size: 16 * k, font: o.fonte, style: estiloDoPeso(o.pesos.texto),
    color: c.tinta, area: { width: W * 0.55, height: 22 * k, fit: 'shrinkText', fitMinPercent: 60 },
  } });
  if (o.logo) passos.push({ command: 'file.place', params: { path: o.logo, rect: caixaDoLogo(o.formato), link: false } });

  const pdf = path.join(pastaJob, 'saida', 'cartaz.pdf');
  const png = path.join(pastaJob, 'saida', 'cartaz.png');
  const vectorcraft = path.join(pastaJob, 'editavel', 'cartaz.vectorcraft');
  const ai = path.join(pastaJob, 'editavel', 'cartaz.ai');
  for (const p of [pdf, vectorcraft]) mkdirSync(path.dirname(p), { recursive: true });
  passos.push(
    { command: 'select.none', params: {} },
    { command: 'document.exportPdf', params: { path: pdf, bleed: { useDocument: true }, marks: { trim: true, kind: 'roman' }, preserveEditing: false } },
    { command: 'document.export', params: { path: png, format: 'png', artboard: 0, scale: 1080 / W, background: c.fundo } },
    { command: 'file.saveCopy', params: { path: vectorcraft, format: 'vectorcraft' } },
    { command: 'file.saveCopy', params: { path: ai, format: 'ai' } },
  );
  const resultados = rodarNoVectorCraft(null, passos, path.join(pastaJob, '.trabalho'));
  const sobrou = resultados.find((r) => (r as { overflow?: unknown[] } | null)?.overflow?.length);
  if (sobrou) throw new Error('um texto não coube no cartaz nem no menor tamanho; encurte o pedido');
  return { pdf, png, vectorcraft, ai };
}

/** O cartaz do pedido, igual pro roteiro e pro Claude: a folha vem do pedido, o logo e a assinatura da marca. */
export function cartazDoPedido(p: ParametrosAgente, o: { titulo: string; apoio?: string | null; conjunto: Conjunto }) {
  const logo = p.dados.elementos.find((e) => e.tipo === 'logo' && e.largura);
  return montarCartaz(p.pastaJob, {
    formato: folhaDoPedido(p.dados.briefing),
    conjunto: o.conjunto,
    fonte: p.dados.fonte,
    pesos: p.dados.pesos,
    impacto: p.dados.impacto,
    alinhamento: p.dados.alinhamento,
    titulo: o.titulo,
    apoio: o.apoio?.trim() || null,
    assinatura: [p.dados.instagram, p.dados.registro].filter(Boolean).join(' · ') || null,
    logo: logo ? path.join(p.pastaJob, logoParaOFundo(logo, o.conjunto)) : null,
  });
}

export const folhaDoPedido = (briefing: Record<string, unknown>): FormatoCartaz => (briefing.folha === 'a3' ? 'a3' : 'a4');

// ---------- o que a conferência lê ----------

/** As caixas de uma página de PDF, em pontos: [x0, y0, x1, y1]. */
export function caixasDoPdf(pdf: Buffer): { trim: number[] | null; bleed: number[] | null; media: number[] | null } {
  const texto = pdf.toString('latin1');
  const caixa = (nome: string) => {
    const m = texto.match(new RegExp(`/${nome}\\s*\\[\\s*([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s*\\]`));
    return m ? m.slice(1, 5).map(Number) : null;
  };
  return { trim: caixa('TrimBox'), bleed: caixa('BleedBox'), media: caixa('MediaBox') };
}

/** Os textos do documento, com a caixa de cada um, e as fontes que ele usa. */
export function textosDoDocumento(arquivo: string, pasta: string): { caixas: Caixa[]; fontes: string[] } {
  const [insp, info] = rodarNoVectorCraft(arquivo, [
    { command: 'document.inspect', params: { kind: 'Type' } },
    { command: 'document.info', params: { category: 'fonts' } },
  ], pasta) as [{ nodes?: Array<{ bounds?: Caixa }> }, { fonts?: Array<string | { family?: string; name?: string }> }];
  const fontes = (info.fonts ?? []).map((f) => (typeof f === 'string' ? f : f.family ?? f.name ?? '')).filter(Boolean);
  return { caixas: (insp.nodes ?? []).map((n) => n.bounds).filter((b): b is Caixa => !!b), fontes };
}
