// O DesignCraft na fábrica: material de várias páginas, sempre pelo CLI.
//
//   - o guia: A5, de 6 a 12 páginas — capa, uma ideia do pedido por página e
//     a página final com o contato. PDF leve, pra baixar e mandar no WhatsApp;
//   - o folheto dobrável: A4 deitado, frente e verso, três painéis por lado —
//     capa, verso com o contato, aba, e três ideias por dentro. PDF/X-4 pra
//     gráfica: 3 mm de sangria, marcas de corte, cor em CMYK;
//   - os dois: PNG de cada página (sem a sangria), editável em .designcraft e
//     em IDML (abre no InDesign).
//
// O DesignCraft não encolhe texto pra caber: o tamanho de cada caixa sai de
// uma conta pelo comprimento do texto, e se ainda sobrar texto fora (o
// `document.inspect` diz quais), a caixa refaz com a letra 12% menor.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParametrosAgente } from './agente.ts';
import { acharCli } from './config.ts';
import type { Conjunto } from './marca.ts';
import { escreverPng, lerPng, recortar } from './png.ts';
import { estiloDoPeso, logoParaOFundo } from './vetor.ts';

const PT_POR_MM = 72 / 25.4;
const mm = (v: number) => v * PT_POR_MM;

export const MODELOS = {
  guia: { nome: 'Guia', largura: mm(148), altura: mm(210), sangria: 0, margem: mm(15), pdf: 'saida/guia.pdf', base: 'guia' },
  folheto: { nome: 'Folheto dobrável', largura: mm(297), altura: mm(210), sangria: mm(3), margem: mm(10), pdf: 'saida/folheto.pdf', base: 'folheto' },
} as const;
export type Modelo = keyof typeof MODELOS;
/** Largura das prévias: o guia como post (1080), o folheto aberto com folga pra ler. */
export const LARGURA_PREVIA: Record<Modelo, number> = { guia: 1080, folheto: 1684 };

/**
 * Roda um script no DesignCraft e devolve o resultado de cada passo. Um passo
 * que falha para tudo e diz qual foi.
 */
export function rodarNoDesignCraft(passos: Array<[string, Record<string, unknown>]>, pasta: string): unknown[] {
  mkdirSync(pasta, { recursive: true });
  const arq = path.join(pasta, `designcraft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
  writeFileSync(arq, passos.map(([id, p]) => `${id} ${JSON.stringify(p)}`).join('\n') + '\n');
  let saida: string;
  try {
    saida = execFileSync(acharCli('designcraft'), ['script', arq], { encoding: 'utf8', timeout: 5 * 60_000, stdio: ['ignore', 'pipe', 'pipe'], cwd: pasta });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    let motivo = (err.stderr || err.message).trim();
    try { const j = JSON.parse(err.stdout ?? ''); if (j.error) motivo = `${j.failedCommand}: ${JSON.stringify(j.error)}`; } catch { /* fica a mensagem do processo */ }
    throw new Error(`DesignCraft: ${motivo.split(/\r?\n/).slice(-3).join(' ')}`);
  }
  return (JSON.parse(saida) as { results: unknown[] }).results;
}

/** A cor como sai na gráfica: o hex levado pro CMYK do DesignCraft (FOGRA39) e de volta pra tela. */
export type CorImpressa = { cmyk: { c: number; m: number; y: number; k: number }; impressa: string };

export function coresNaImpressao(hexes: string[], pasta: string): Record<string, CorImpressa> {
  const unicos = [...new Set(hexes.map((h) => h.toUpperCase()))];
  const passos: Array<[string, Record<string, unknown>]> = [];
  for (const [i, h] of unicos.entries()) {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
    passos.push(['color.convert', { color: { model: 'rgb', r, g, b }, to: 'cmyk' }]);
    passos.push(['color.convert', { color: { model: 'cmyk', c: `$${2 * i}.c`, m: `$${2 * i}.m`, y: `$${2 * i}.y`, k: `$${2 * i}.k` }, to: 'rgb' }]);
  }
  const r = rodarNoDesignCraft(passos, pasta) as Array<{ c: number; m: number; y: number; k: number; r: number; g: number; b: number }>;
  const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return Object.fromEntries(unicos.map((h, i) => {
    const cmyk = r[2 * i], volta = r[2 * i + 1];
    return [h, { cmyk: { c: cmyk.c * 100, m: cmyk.m * 100, y: cmyk.y * 100, k: cmyk.k * 100 }, impressa: `#${hex(volta.r)}${hex(volta.g)}${hex(volta.b)}`.toUpperCase() }];
  }));
}

export type Material = {
  modelo: Modelo;
  /** Guia: quantas páginas (capa e fim incluídos). */
  paginas: number;
  conjunto: Conjunto;
  fonte: string;
  pesos: { titulo: number; texto: number };
  impacto: boolean;
  alinhamento: 'left' | 'center';
  titulo: string;
  apoio: string | null;
  /** Uma por página do miolo (guia) ou por painel de dentro (folheto). */
  ideias: string[];
  chamada: string | null;
  assinatura: string | null;
  logo: string | null;
};

type Caixa = { chave: string; pagina: number; rect: [number, number, number, number]; texto: string; tamanho: number; peso: number; cor: 'Tinta' | 'Destaque'; centro?: boolean };

/** O tamanho de partida de uma caixa: o maior que deixa o texto em poucas linhas. */
function tamanhoInicial(texto: string, largura: number, altura: number, maximo: number): number {
  // Uma letra média ocupa ~0,55 do tamanho; a linha, ~1,2 dele.
  for (let t = maximo; t > 8; t -= 1) {
    const porLinha = Math.max(1, Math.floor(largura / (t * 0.55)));
    const linhas = texto.split('\n').reduce((s, p) => s + Math.max(1, Math.ceil(p.length / porLinha)), 0);
    if (linhas * t * 1.2 <= altura * 0.9) return t;
  }
  return 8;
}

/** As caixas de texto de cada página, nas coordenadas da página (pontos, y pra baixo). */
export function caixasDoMaterial(o: Material): { caixas: Caixa[]; logos: Array<{ pagina: number; x: number; y: number; largura: number }>; barras: Array<{ pagina: number; rect: [number, number, number, number] }>; paginas: number } {
  const md = MODELOS[o.modelo];
  const { largura: W, altura: H, margem: m } = md;
  const caixas: Caixa[] = [];
  const logos: Array<{ pagina: number; x: number; y: number; largura: number }> = [];
  const barras: Array<{ pagina: number; rect: [number, number, number, number] }> = [];
  const centro = o.alinhamento === 'center';
  const titulo = o.impacto ? o.titulo.toUpperCase() : o.titulo;
  const caixa = (c: Omit<Caixa, 'tamanho'> & { maximo: number }) => {
    const [x0, y0, x1, y1] = c.rect;
    caixas.push({ ...c, tamanho: tamanhoInicial(c.texto, x1 - x0, y1 - y0, c.maximo) });
  };

  if (o.modelo === 'guia') {
    const n = o.paginas;
    // A capa.
    barras.push({ pagina: 0, rect: [m, m, m + 70, m + 6] });
    caixa({ chave: 'titulo', pagina: 0, rect: [m, H * 0.28, W - m, H * 0.66], texto: titulo, maximo: o.impacto ? 52 : 44, peso: o.pesos.titulo, cor: 'Tinta', centro });
    if (o.apoio) caixa({ chave: 'apoio', pagina: 0, rect: [m, H * 0.68, W - m, H * 0.80], texto: o.apoio, maximo: 16, peso: o.pesos.texto, cor: 'Tinta', centro });
    if (o.assinatura) caixa({ chave: 'assinatura-capa', pagina: 0, rect: [m, H - m - 16, W * 0.62, H - m], texto: o.assinatura, maximo: 10, peso: o.pesos.texto, cor: 'Tinta' });
    if (o.logo) logos.push({ pagina: 0, x: W - m - 90, y: H - m - 40, largura: 90 });
    // O miolo: uma ideia por página, com o número dela.
    for (let i = 1; i < n - 1; i++) {
      const ideia = o.ideias[i - 1] ?? '';
      barras.push({ pagina: i, rect: [m, m, m + 36, m + 4] });
      caixa({ chave: `num-${i}`, pagina: i, rect: [m, m + 14, W - m, m + 44], texto: String(i).padStart(2, '0'), maximo: 22, peso: o.pesos.titulo, cor: 'Destaque' });
      caixa({ chave: `ideia-${i}`, pagina: i, rect: [m, H * 0.22, W - m, H - m - 30], texto: ideia, maximo: 34, peso: o.pesos.titulo, cor: 'Tinta' });
      caixa({ chave: `pag-${i}`, pagina: i, rect: [W - m - 60, H - m - 14, W - m, H - m], texto: `${i + 1}/${n}`, maximo: 9, peso: o.pesos.texto, cor: 'Tinta' });
    }
    // O fim: a chamada e quem é.
    const fim = n - 1;
    caixa({ chave: 'chamada', pagina: fim, rect: [m, H * 0.30, W - m, H * 0.62], texto: o.chamada || 'Fale com a gente.', maximo: 30, peso: o.pesos.titulo, cor: 'Tinta', centro: true });
    if (o.assinatura) caixa({ chave: 'assinatura-fim', pagina: fim, rect: [m, H * 0.64, W - m, H * 0.72], texto: o.assinatura, maximo: 13, peso: o.pesos.texto, cor: 'Tinta', centro: true });
    if (o.logo) logos.push({ pagina: fim, x: (W - 110) / 2, y: H * 0.76, largura: 110 });
    return { caixas, logos, barras, paginas: n };
  }

  // O folheto: três painéis por lado. Por fora (página 1): a aba, o verso e a
  // capa, da esquerda pra direita. Por dentro (página 2): as três ideias.
  const p = W / 3;
  const painel = (k: number): [number, number, number, number] => [k * p + m, m, (k + 1) * p - m, H - m];
  const [ax0, , ax1] = painel(0), [vx0, , vx1] = painel(1), [cx0, , cx1] = painel(2);
  // A capa.
  barras.push({ pagina: 0, rect: [cx0, m, cx0 + 60, m + 5] });
  caixa({ chave: 'titulo', pagina: 0, rect: [cx0, H * 0.24, cx1, H * 0.66], texto: titulo, maximo: o.impacto ? 40 : 34, peso: o.pesos.titulo, cor: 'Tinta', centro });
  if (o.apoio) caixa({ chave: 'apoio', pagina: 0, rect: [cx0, H * 0.68, cx1, H * 0.80], texto: o.apoio, maximo: 13, peso: o.pesos.texto, cor: 'Tinta', centro });
  if (o.logo) logos.push({ pagina: 0, x: cx1 - 80, y: H - m - 36, largura: 80 });
  // O verso: a chamada e quem é.
  caixa({ chave: 'chamada', pagina: 0, rect: [vx0, H * 0.30, vx1, H * 0.58], texto: o.chamada || 'Fale com a gente.', maximo: 22, peso: o.pesos.titulo, cor: 'Tinta', centro: true });
  if (o.assinatura) caixa({ chave: 'assinatura', pagina: 0, rect: [vx0, H * 0.60, vx1, H * 0.70], texto: o.assinatura, maximo: 11, peso: o.pesos.texto, cor: 'Tinta', centro: true });
  if (o.logo) logos.push({ pagina: 0, x: (vx0 + vx1) / 2 - 45, y: H * 0.74, largura: 90 });
  // A aba (a primeira coisa que se vê ao abrir): a quarta ideia em diante, ou o apoio.
  const resto = o.ideias.slice(3).join('\n');
  caixa({ chave: 'aba', pagina: 0, rect: [ax0, H * 0.20, ax1, H - m - 10], texto: resto || o.apoio || titulo, maximo: 18, peso: o.pesos.texto, cor: 'Tinta' });
  // Por dentro: uma ideia por painel, com o número.
  for (let k = 0; k < 3; k++) {
    const [x0, y0, x1] = painel(k);
    barras.push({ pagina: 1, rect: [x0, y0, x0 + 30, y0 + 4] });
    caixa({ chave: `num-${k + 1}`, pagina: 1, rect: [x0, y0 + 12, x1, y0 + 40], texto: String(k + 1).padStart(2, '0'), maximo: 20, peso: o.pesos.titulo, cor: 'Destaque' });
    caixa({ chave: `ideia-${k + 1}`, pagina: 1, rect: [x0, H * 0.20, x1, H - m], texto: o.ideias[k] ?? '', maximo: 22, peso: o.pesos.titulo, cor: 'Tinta' });
  }
  return { caixas, logos, barras, paginas: 2 };
}

export type MaterialPronto = { pdf: string; paginas: string[]; designcraft: string; idml: string; avisos: string[] };

/**
 * Monta o material e salva tudo em `pastaJob`: o PDF em saida/, uma prévia
 * por página (saida/pagina-01.png…), e os editáveis em editavel/.
 */
export function montarMaterial(pastaJob: string, o: Material): MaterialPronto {
  const md = MODELOS[o.modelo];
  const trabalho = path.join(pastaJob, '.trabalho', 'designcraft');
  const { caixas, logos, barras, paginas } = caixasDoMaterial(o);
  if (o.ideias.filter((x) => x.trim()).length < (o.modelo === 'guia' ? paginas - 2 : 3)) {
    throw new Error(`faltam ideias: ${o.modelo === 'guia' ? `o guia de ${paginas} páginas leva ${paginas - 2}` : 'o folheto leva 3'}, uma por ${o.modelo === 'guia' ? 'página' : 'painel'}`);
  }
  const c = o.conjunto;
  const avisos: string[] = [];
  // Na gráfica a cor vai em CMYK; no guia (tela), fica como é.
  const impressas = md.sangria ? coresNaImpressao([c.fundo, c.tinta, c.destaque], trabalho) : null;
  const corDe = (hex: string) => impressas ? impressas[hex.toUpperCase()].cmyk : hex;
  if (impressas) {
    for (const [hex, ci] of Object.entries(impressas)) {
      const dist = Math.hypot(...[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) - parseInt(ci.impressa.slice(k, k + 2), 16)));
      if (dist > 25) avisos.push(`na gráfica, ${hex} sai como ${ci.impressa} (é uma cor que o CMYK não alcança)`);
    }
  }

  const pdf = path.join(pastaJob, md.pdf);
  const designcraft = path.join(pastaJob, 'editavel', `${md.base}.designcraft`);
  const idml = path.join(pastaJob, 'editavel', `${md.base}.idml`);
  mkdirSync(path.dirname(pdf), { recursive: true });
  mkdirSync(path.dirname(designcraft), { recursive: true });

  const tamanhos = new Map(caixas.map((x) => [x.chave, x.tamanho]));
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const passos: Array<[string, Record<string, unknown>]> = [
      // O guia é pra tela (RGB); o folheto, pra gráfica.
      ['file.new', { intent: md.sangria ? 'print' : 'web', units: 'points', width: md.largura, height: md.altura, pages: paginas, facingPages: false, margins: md.margem, bleed: md.sangria }],
      ['swatch.create', { name: 'Fundo', color: corDe(c.fundo) }],
      ['swatch.create', { name: 'Tinta', color: corDe(c.tinta) }],
      ['swatch.create', { name: 'Destaque', color: corDe(c.destaque) }],
    ];
    const retangulo = (pagina: number, rect: [number, number, number, number], swatch: string) => {
      passos.push(['frame.create', { spread: pagina, rect, content: 'graphic' }]);
      passos.push(['object.fill', { swatch, ids: [`$${passos.length - 1}.id`] }]);
      passos.push(['object.stroke', { swatch: '[None]', ids: [`$${passos.length - 2}.id`] }]);
    };
    const s = md.sangria;
    for (let pg = 0; pg < paginas; pg++) retangulo(pg, [-s, -s, md.largura + s, md.altura + s], 'Fundo');
    for (const b of barras) retangulo(b.pagina, b.rect, 'Destaque');
    const historias: Record<string, number> = {};
    for (const x of caixas) {
      passos.push(['frame.create', { spread: x.pagina, rect: x.rect, content: 'text', text: x.texto }]);
      const criado = passos.length - 1;
      historias[x.chave] = criado;
      passos.push(['text.select', { story: `$${criado}.story`, anchor: 0, focus: Buffer.byteLength(x.texto) }]);
      passos.push(['type.char', { attrs: { fontFamily: o.fonte, fontStyle: estiloDoPeso(x.peso), size: tamanhos.get(x.chave), leading: { kind: 'auto' }, fill: x.cor } }]);
      // Meia linha entre parágrafos: na aba do folheto vão várias ideias numa caixa só.
      passos.push(['type.para', { attrs: { align: x.centro ? 'center' : 'left', hyphenate: false, spaceAfter: Math.round(tamanhos.get(x.chave)! * 0.5) } }]);
    }
    for (const l of logos) if (o.logo) passos.push(['file.place', { path: o.logo, spread: l.pagina, x: l.x, y: l.y, width: l.largura }]);
    passos.push(['edit.deselectAll', {}]);
    passos.push(['file.saveACopy', { path: designcraft }]);
    passos.push(['document.inspect', {}]);
    const r = rodarNoDesignCraft(passos, trabalho);
    const insp = r[r.length - 1] as { stories: Array<{ id: number; overset: boolean }> };
    const sobrando = new Set(insp.stories.filter((x) => x.overset).map((x) => x.id));
    const cheias = Object.entries(historias).filter(([, i]) => sobrando.has((r[i] as { story: number }).story)).map(([k]) => k);
    if (!cheias.length) break;
    if (tentativa === 7) throw new Error(`o texto não coube nem no menor tamanho (${cheias.join(', ')}); encurte o pedido`);
    for (const k of cheias) tamanhos.set(k, Math.max(7, Math.floor(tamanhos.get(k)! * 0.88)));
  }
  return exportar(pastaJob, o.modelo, avisos);
}

/** O que sai do .designcraft já montado: PDF, IDML e as prévias sem a sangria. */
function exportar(pastaJob: string, modelo: Modelo, avisos: string[]): MaterialPronto {
  const md = MODELOS[modelo];
  const trabalho = path.join(pastaJob, '.trabalho', 'designcraft');
  const designcraft = path.join(pastaJob, 'editavel', `${md.base}.designcraft`);
  const idml = path.join(pastaJob, 'editavel', `${md.base}.idml`);
  const pdf = path.join(pastaJob, md.pdf);
  const opcoesPdf = md.sangria ? { bleed: true, marks: { crop: true }, standard: 'x4' } : { bleed: false, marks: false, standard: 'none', compressImages: true };
  execFileSync(acharCli('designcraft'), ['script', '-', '--in', designcraft], {
    input: `file.exportPdf ${JSON.stringify({ path: pdf, ...opcoesPdf, title: md.nome })}\nfile.exportIdml ${JSON.stringify({ path: idml })}\n`,
    encoding: 'utf8', timeout: 5 * 60_000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const escala = LARGURA_PREVIA[modelo] / md.largura;
  const pastaPng = path.join(trabalho, 'paginas');
  rmSync(pastaPng, { recursive: true, force: true });
  execFileSync(acharCli('designcraft'), ['run', '--in', designcraft, '--scale', String(escala), '--all-pages', pastaPng], { stdio: 'ignore', timeout: 5 * 60_000 });
  const corte = Math.round(md.sangria * escala);
  const paginas: string[] = [];
  for (const [i, arq] of readdirSync(pastaPng).filter((n) => /\.png$/.test(n)).sort().entries()) {
    const img = lerPng(readFileSync(path.join(pastaPng, arq)));
    const destino = path.join(pastaJob, 'saida', `pagina-${String(i + 1).padStart(2, '0')}.png`);
    const w = Math.round(md.largura * escala), h = Math.round(md.altura * escala);
    writeFileSync(destino, escreverPng(corte || img.largura !== w || img.altura !== h ? recortar(img, corte, corte, Math.min(w, img.largura - corte), Math.min(h, img.altura - corte)) : img));
    paginas.push(destino);
  }
  return { pdf, paginas, designcraft, idml, avisos };
}

/** O material do pedido, igual pro roteiro e pro Claude: modelo e páginas do pedido, logo e assinatura da marca. */
export function materialDoPedido(p: ParametrosAgente, o: { titulo: string; apoio?: string | null; ideias: string[]; conjunto: Conjunto }) {
  const logo = p.dados.elementos.find((e) => e.tipo === 'logo' && e.largura);
  const modelo = modeloDoPedido(p.dados.briefing);
  return montarMaterial(p.pastaJob, {
    modelo,
    paginas: modelo === 'guia' ? p.dados.saidas.filter((s) => /^saida\/pagina-\d+\.png$/.test(s.caminho)).length : 2,
    conjunto: o.conjunto,
    fonte: p.dados.fonte,
    pesos: p.dados.pesos,
    impacto: p.dados.impacto,
    alinhamento: p.dados.alinhamento,
    titulo: o.titulo,
    apoio: o.apoio?.trim() || null,
    ideias: o.ideias,
    chamada: p.dados.chamada,
    assinatura: [p.dados.instagram, p.dados.registro].filter(Boolean).join(' · ') || null,
    logo: logo ? path.join(p.pastaJob, logoParaOFundo(logo, o.conjunto)) : null,
  });
}

/** O que a conferência lê do .designcraft: textos sobrando e o preflight (fonte que falta, imagem fraca). */
export function lerMaterial(arquivo: string, pasta: string): { sobrando: number; problemas: Array<{ severity: string; kind: string; message: string; page?: number }> } {
  const saida = execFileSync(acharCli('designcraft'), ['script', '-', '--in', arquivo], {
    input: 'document.inspect {}\npreflight.run {"minPpi": 150}\n', encoding: 'utf8', timeout: 5 * 60_000, stdio: ['pipe', 'pipe', 'pipe'], cwd: pasta,
  });
  const [insp, pre] = (JSON.parse(saida) as { results: unknown[] }).results as [{ stories: Array<{ overset: boolean }> }, { issues?: Array<{ severity: string; kind: string; message: string; page?: number }> } | Array<{ severity: string; kind: string; message: string; page?: number }>];
  return { sobrando: insp.stories.filter((s) => s.overset).length, problemas: Array.isArray(pre) ? pre : pre.issues ?? [] };
}

/** O validador de PDF/X-4 do próprio DesignCraft (inclui fonte visível não embutida). */
export function validarPdfX4(pdf: string): { valido: boolean; problemas: string[] } {
  try {
    const s = execFileSync(acharCli('designcraft'), ['validate-pdf', pdf], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const j = JSON.parse(s) as { valid: boolean; issues: string[] };
    return { valido: j.valid, problemas: j.issues };
  } catch (e) {
    const out = (e as { stdout?: string }).stdout ?? '';
    try { const j = JSON.parse(out) as { valid: boolean; issues: string[] }; return { valido: j.valid, problemas: j.issues }; } catch { return { valido: false, problemas: [(e as Error).message] }; }
  }
}

export const modeloDoPedido = (briefing: Record<string, unknown>): Modelo => (briefing.formato === 'folheto' ? 'folheto' : 'guia');
