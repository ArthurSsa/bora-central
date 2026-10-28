// Fase 0 (ADR 0001, D2): a prévia do navegador sai igual à exportação da
// fábrica? As mesmas 20 cenas desenhadas pelo Konva num Edge sem janela (o que
// o Studio vai usar) e pelo PhotoCraft (o que a fábrica entrega), com os
// mesmos arquivos de fonte. Compara pixel a pixel e linha a linha.
//
//   npm run fidelidade [-- --saida <pasta>]
//
// Sem rede e sem modelo. Escreve em <saida>: navegador/*.png, fabrica/*.png,
// lado-a-lado/*.png (as piores) e resultado.json; e imprime a tabela.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { RAIZ_WORKER } from '../src/config.ts';
import { baselineDaFabrica, exportarCena, type Cena, type Objeto, type ObjetoTexto } from '../src/cena.ts';
import { escreverPng, lerPngRgba } from '../src/png.ts';

// ---------- as cenas ----------

const FEED = { largura: 1080, altura: 1350 }, STORY = { largura: 1080, altura: 1920 }, CAPA = { largura: 1280, altura: 720 };
const T = (id: string, o: Partial<ObjetoTexto> & Pick<ObjetoTexto, 'x' | 'y' | 'largura' | 'texto' | 'tamanho'>): ObjetoTexto =>
  ({ tipo: 'texto', id, fonte: 'Manrope', peso: 700, cor: '#FFFFFF', alinhamento: 'left', entrelinha: 1.2, ...o });

export function cenasDeTeste(): Cena[] {
  const c = (nome: string, f: { largura: number; altura: number }, fundo: string, objetos: Objeto[]): Cena => ({ versao: 1, nome, ...f, fundo, objetos });
  const faixa = (y: number, cor = '#A4E830'): Objeto => ({ tipo: 'forma', id: 'faixa', x: 72, y, largura: 140, altura: 14, cor });
  const logo: Objeto = { tipo: 'imagem', id: 'logo', x: 860, y: 1200, largura: 140, altura: 70, arquivo: 'logo.png' };
  return [
    c('01-titulo-curto', FEED, '#1E2A3A', [faixa(240), T('titulo', { x: 72, y: 280, largura: 936, texto: 'Turma nova', tamanho: 110 })]),
    c('02-titulo-3-linhas', FEED, '#1E2A3A', [faixa(240), T('titulo', { x: 72, y: 280, largura: 936, texto: 'Turma nova do laboratório de redes: inscrições até sexta', tamanho: 92 })]),
    c('03-titulo-e-apoio', FEED, '#1E2A3A', [T('titulo', { x: 72, y: 300, largura: 936, texto: 'A fornada sai às 7h', tamanho: 96 }), T('apoio', { x: 72, y: 440, largura: 936, texto: 'Venha buscar o pão quente', tamanho: 40, peso: 500 }), logo]),
    c('04-centro', FEED, '#2B1A12', [T('titulo', { x: 72, y: 420, largura: 936, texto: 'Por que o nosso pão leva 36 horas pra ficar pronto', tamanho: 80, alinhamento: 'center' })]),
    c('05-direita', FEED, '#F4F1EA', [T('titulo', { x: 72, y: 420, largura: 936, texto: 'Três jeitos de usar o pão amanhecido', tamanho: 84, alinhamento: 'right', cor: '#15181C' })]),
    c('06-anton', FEED, '#15181C', [T('titulo', { x: 72, y: 300, largura: 936, texto: 'AULA ABERTA DE FERMENTAÇÃO NO SÁBADO', tamanho: 120, fonte: 'Anton', peso: 400, cor: '#E8A33D' })]),
    c('07-anton-centro', FEED, '#E8A33D', [T('titulo', { x: 72, y: 380, largura: 936, texto: 'INSCRIÇÕES ATÉ SEXTA', tamanho: 140, fonte: 'Anton', peso: 400, alinhamento: 'center', cor: '#15181C' })]),
    c('08-texto-corrido', FEED, '#FFFFFF', [T('texto', { x: 72, y: 200, largura: 936, peso: 500, tamanho: 38, cor: '#1E2A3A', entrelinha: 1.4,
      texto: 'Começar pesado demais na primeira semana. Pular o aquecimento. Treinar todo dia sem descanso. Copiar o treino de quem treina há anos. Desistir quando o resultado demora. Não beber água durante o treino.' })]),
    c('09-pesos', FEED, '#1E2A3A', [300, 400, 500, 600, 700, 800].map((peso, i) => T(`peso-${peso}`, { x: 72, y: 160 + i * 170, largura: 936, texto: `Peso ${peso}: pão de fermentação natural`, tamanho: 54, peso }))),
    c('10-quebra-manual', FEED, '#1E2A3A', [T('titulo', { x: 72, y: 300, largura: 936, texto: 'Primeira linha\nSegunda linha bem mais comprida que a primeira\nTerceira', tamanho: 72 })]),
    c('11-palavra-longa', FEED, '#1E2A3A', [T('titulo', { x: 72, y: 300, largura: 600, texto: 'Inconstitucionalissimamente falando, fermentação', tamanho: 72 })]),
    c('12-caixa-estreita', FEED, '#1E2A3A', [T('titulo', { x: 72, y: 300, largura: 420, texto: 'Venha buscar o pão quente às sete da manhã', tamanho: 64 })]),
    c('13-pequeno', FEED, '#1E2A3A', [T('rodape', { x: 72, y: 1240, largura: 600, texto: '@fermentovivo.demo · Rua das Flores, 120', tamanho: 28, peso: 500 })]),
    c('14-story-titulo', STORY, '#2B1A12', [faixa(420, '#E8A33D'), T('titulo', { x: 72, y: 460, largura: 936, texto: 'Bastidor da madrugada na padaria', tamanho: 110 })]),
    c('15-story-centro-longo', STORY, '#1E2A3A', [T('titulo', { x: 90, y: 600, largura: 900, alinhamento: 'center', tamanho: 72, peso: 800,
      texto: 'Cada repetição feita com pressa ensina ao corpo um movimento que depois vai cobrar o preço' })]),
    c('16-capa', CAPA, '#1E2A3A', [T('titulo', { x: 64, y: 150, largura: 600, texto: 'Como montei um time sem saber programar', tamanho: 84 }), { tipo: 'forma', id: 'lado', x: 700, y: 0, largura: 580, altura: 720, cor: '#A4E830' }]),
    c('17-capa-anton', CAPA, '#15181C', [T('titulo', { x: 64, y: 120, largura: 620, texto: 'O ERRO QUE TODO INICIANTE COMETE', tamanho: 96, fonte: 'Anton', peso: 400, cor: '#FFFFFF' })]),
    c('18-acentos', FEED, '#1E2A3A', [T('titulo', { x: 72, y: 300, largura: 936, texto: 'Ação, emoção, pão, coração: àquela época já é você', tamanho: 76 })]),
    c('19-numeros', FEED, '#1E2A3A', [T('titulo', { x: 72, y: 300, largura: 936, texto: 'R$ 12,90 · 36h · 7h às 19h · 100% natural', tamanho: 70 })]),
    c('20-entrelinha-justa', FEED, '#1E2A3A', [T('titulo', { x: 72, y: 300, largura: 936, texto: 'Organização vem antes de talento, sempre', tamanho: 96, entrelinha: 1.0 })]),
  ];
}

// ---------- o navegador ----------

const PAGINA = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Manrope'; src: url('/fontes/Manrope[wght].ttf') format('truetype'); font-weight: 200 800; }
@font-face { font-family: 'Anton'; src: url('/fontes/Anton-Regular.ttf') format('truetype'); font-weight: 400; }
body { margin: 0 }</style><div id="palco"></div><script src="/konva.js"></script>`;

/**
 * Desenha uma cena com o Konva (roda dentro da página) e devolve o PNG e as
 * linhas de cada texto. Com `baselines` (fonte|peso → base da primeira linha
 * na fábrica, em proporção do tamanho), cada texto desce ou sobe até a base
 * da primeira linha cair onde a fábrica põe: o Konva centraliza a linha na
 * entrelinha; o PhotoCraft põe a base a uma distância fixa do topo da caixa.
 */
function desenharNoKonva({ cena, baselines }: { cena: Cena; baselines: Record<string, number> | null }) {
  const K = (window as unknown as { Konva: any }).Konva;
  // A distância, no Konva, do meio da linha até a linha de base (o Konva desenha com textBaseline "middle").
  const meioAteABase = (fonte: string, peso: number, tamanho: number) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${peso} ${tamanho}px "${fonte}"`;
    ctx.textBaseline = 'alphabetic';
    const acimaDaBase = ctx.measureText('H').actualBoundingBoxAscent;
    ctx.textBaseline = 'middle';
    return acimaDaBase - ctx.measureText('H').actualBoundingBoxAscent;
  };
  return (async () => {
    for (const o of cena.objetos) if (o.tipo === 'texto') await document.fonts.load(`${o.peso} ${o.tamanho}px "${o.fonte}"`);
    const stage = new K.Stage({ container: 'palco', width: cena.largura, height: cena.altura });
    const layer = new K.Layer();
    stage.add(layer);
    layer.add(new K.Rect({ x: 0, y: 0, width: cena.largura, height: cena.altura, fill: cena.fundo }));
    const linhas: Record<string, string[]> = {};
    for (const o of cena.objetos) {
      if (o.tipo === 'texto') {
        const base = baselines?.[`${o.fonte}|${o.peso}`];
        const dy = base == null ? 0 : base * o.tamanho - (o.entrelinha * o.tamanho) / 2 - meioAteABase(o.fonte, o.peso, o.tamanho);
        const t = new K.Text({ x: o.x, y: o.y + dy, width: o.largura, text: o.texto, fontFamily: o.fonte, fontStyle: String(o.peso), fontSize: o.tamanho,
          fill: o.cor, align: o.alinhamento, lineHeight: o.entrelinha, wrap: 'word' });
        layer.add(t);
        linhas[o.id] = t.textArr.map((l: { text: string }) => l.text.replace(/\s+$/, ''));
      } else if (o.tipo === 'forma') {
        layer.add(new K.Rect({ x: o.x, y: o.y, width: o.largura, height: o.altura, fill: o.cor }));
      } else {
        const img = new Image();
        img.src = '/img/' + o.arquivo;
        await img.decode();
        layer.add(new K.Image({ x: o.x, y: o.y, width: o.largura, height: o.altura, image: img }));
      }
    }
    layer.draw();
    const png = stage.toDataURL({ pixelRatio: 1, mimeType: 'image/png' });
    stage.destroy();
    return { png, linhas };
  })();
}

// ---------- a comparação ----------

type Img = { largura: number; altura: number; rgba: Uint8Array };
const LIMIAR = 48;
const difere = (a: Img, b: Img, i: number) => Math.max(Math.abs(a.rgba[i] - b.rgba[i]), Math.abs(a.rgba[i + 1] - b.rgba[i + 1]), Math.abs(a.rgba[i + 2] - b.rgba[i + 2])) > LIMIAR;

/** Fração de pixels diferentes, na peça inteira e só nas caixas de texto. */
export function compararImagens(a: Img, b: Img, caixasDeTexto: Array<[number, number, number, number]>) {
  if (a.largura !== b.largura || a.altura !== b.altura) throw new Error('tamanhos diferentes');
  const naCaixa = new Uint8Array(a.largura * a.altura);
  for (const [x, y, w, h] of caixasDeTexto) {
    for (let yy = Math.max(0, y); yy < Math.min(a.altura, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(a.largura, x + w); xx++) naCaixa[yy * a.largura + xx] = 1;
  }
  let dif = 0, difTexto = 0, total = 0, totalTexto = 0;
  for (let p = 0; p < a.largura * a.altura; p++) {
    const d = difere(a, b, p * 4);
    total++; if (d) dif++;
    if (naCaixa[p]) { totalTexto++; if (d) difTexto++; }
  }
  return { geral: dif / total, texto: totalTexto ? difTexto / totalTexto : 0 };
}

/** A primeira linha de pixels com tinta (diferente do fundo) dentro da caixa: mede o deslocamento vertical. */
function topoDaTinta(img: Img, [x, y, w, h]: [number, number, number, number], fundo: number[]): number | null {
  for (let yy = Math.max(0, y); yy < Math.min(img.altura, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.largura, x + w); xx++) {
      const i = (yy * img.largura + xx) * 4;
      if (Math.max(Math.abs(img.rgba[i] - fundo[0]), Math.abs(img.rgba[i + 1] - fundo[1]), Math.abs(img.rgba[i + 2] - fundo[2])) > LIMIAR) return yy;
    }
  }
  return null;
}

/** As duas imagens lado a lado e, à direita, a diferença em vermelho; na metade do tamanho. */
function ladoALado(a: Img, b: Img): Buffer {
  const k = 2, w = Math.floor(a.largura / k), h = Math.floor(a.altura / k);
  const rgb = new Uint8Array(w * 3 * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y * k) * a.largura + x * k) * 4;
    for (const [j, img] of [[0, a], [1, b]] as const) for (let c = 0; c < 3; c++) rgb[(y * w * 3 + j * w + x) * 3 + c] = img.rgba[i + c];
    const d = difere(a, b, i);
    const cinza = Math.round((a.rgba[i] + a.rgba[i + 1] + a.rgba[i + 2]) / 6);
    rgb.set(d ? [255, 40, 40] : [cinza, cinza, cinza], (y * w * 3 + 2 * w + x) * 3);
  }
  return escreverPng({ largura: w * 3, altura: h, rgb });
}

// ---------- o teste ----------

const hexParaRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

async function principal() {
  const i = process.argv.indexOf('--saida');
  const saida = i > 0 ? path.resolve(process.argv[i + 1]) : path.join(tmpdir(), 'fidelidade');
  for (const p of ['navegador', 'fabrica', 'lado-a-lado', 'img']) mkdirSync(path.join(saida, p), { recursive: true });

  // O "logo" das cenas: um PNG com transparência e borda suave, desenhado aqui.
  const L = 140, A = 70, rgba = new Uint8Array(L * A * 4);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
    const dx = (x - 105) / 30, dy = (y - 35) / 30, circulo = Math.max(0, Math.min(1, (1 - Math.hypot(dx, dy)) * 30));
    const quadrado = x < 64 && y > 4 && y < 66 ? 1 : 0;
    rgba.set([255, 255, 255, Math.round(255 * Math.max(circulo, quadrado))], (y * L + x) * 4);
  }
  writeFileSync(path.join(saida, 'img', 'logo.png'), escreverPng({ largura: L, altura: A, rgba }));

  const fontes = path.join(RAIZ_WORKER, '.ferramentas', 'fontes');
  const konva = path.join(RAIZ_WORKER, 'node_modules', 'konva', 'konva.min.js');
  const servidor = createServer((req, res) => {
    const u = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const arq = u === '/konva.js' ? konva : u.startsWith('/fontes/') ? path.join(fontes, path.basename(u)) : u.startsWith('/img/') ? path.join(saida, 'img', path.basename(u)) : null;
    if (u === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGINA); return; }
    if (!arq || !existsSync(arq)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': arq.endsWith('.js') ? 'text/javascript' : arq.endsWith('.ttf') ? 'font/ttf' : 'image/png' });
    res.end(readFileSync(arq));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const origem = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
  const nav = await chromium.launch({ executablePath: exe, headless: true });
  const resultados = [];
  try {
    const page = await nav.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(origem + '/');
    for (const cena of cenasDeTeste()) {
      const fab = exportarCena(cena, path.join(saida, 'fabrica'), path.join(saida, 'img'));
      const textos = cena.objetos.filter((o): o is ObjetoTexto => o.tipo === 'texto');
      const baselines = Object.fromEntries(textos.map((t) => [`${t.fonte}|${t.peso}`, baselineDaFabrica(t.fonte, t.peso)]));
      const b = lerPngRgba(readFileSync(fab.png));
      // Sem o alinhamento da linha de base: o Konva como vem.
      const cru = await page.evaluate(desenharNoKonva, { cena, baselines: null });
      const aCru = lerPngRgba(Buffer.from(cru.png.split(',')[1], 'base64'));
      const doNav = await page.evaluate(desenharNoKonva, { cena, baselines });
      const pngNav = Buffer.from(doNav.png.split(',')[1], 'base64');
      writeFileSync(path.join(saida, 'navegador', `${cena.nome}.png`), pngNav);
      const a = lerPngRgba(pngNav);
      // A caixa de cada texto: da largura do objeto e da altura que o maior dos dois lados ocupou.
      const caixas = textos.map((t) => {
        const f = fab.textos.find((x) => x.id === t.id)!;
        const linhas = Math.max(f.linhas.length, doNav.linhas[t.id].length);
        return [t.x, t.y - Math.round(t.tamanho * 0.3), t.largura, Math.round(linhas * t.tamanho * t.entrelinha + t.tamanho * 0.6)] as [number, number, number, number];
      });
      const d = compararImagens(a, b, caixas);
      const dCru = compararImagens(aCru, b, caixas);
      const fundo = hexParaRgb(cena.fundo);
      const porTexto = textos.map((t, k) => {
        const f = fab.textos.find((x) => x.id === t.id)!;
        // Do topo do objeto pra baixo: acima dele pode haver uma faixa, que não é deste texto.
        const daCaixa: [number, number, number, number] = [caixas[k][0], t.y, caixas[k][2], caixas[k][1] + caixas[k][3] - t.y];
        const ta = topoDaTinta(a, daCaixa, fundo), tb = topoDaTinta(b, daCaixa, fundo);
        return { id: t.id, linhasNavegador: doNav.linhas[t.id], linhasFabrica: f.linhas, mesmasLinhas: JSON.stringify(doNav.linhas[t.id]) === JSON.stringify(f.linhas),
          deslocamentoVertical: ta != null && tb != null ? tb - ta : null };
      });
      writeFileSync(path.join(saida, 'lado-a-lado', `${cena.nome}.png`), ladoALado(a, b));
      resultados.push({ cena: cena.nome, geral: d.geral, texto: d.texto, textoSemAlinhar: dCru.texto, textos: porTexto });
    }
  } finally {
    await nav.close();
    servidor.close();
  }
  writeFileSync(path.join(saida, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  console.log('| Cena | Nos textos, sem alinhar | Nos textos, alinhado | Na peça, alinhado | Mesmas linhas | Deslocamento que sobrou (px) |\n|---|---|---|---|---|---|');
  for (const r of resultados) {
    console.log(`| ${r.cena} | ${pct(r.textoSemAlinhar)} | ${pct(r.texto)} | ${pct(r.geral)} | ${r.textos.every((t) => t.mesmasLinhas) ? 'sim' : 'não'} | ${r.textos.map((t) => t.deslocamentoVertical ?? '?').join(', ')} |`);
  }
  const media = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(`\nMédia nos textos: ${pct(media(resultados.map((r) => r.textoSemAlinhar)))} sem alinhar → ${pct(media(resultados.map((r) => r.texto)))} alinhado; pior: ${pct(Math.max(...resultados.map((r) => r.texto)))}.`);
  console.log(`\nPastas: ${saida}`);
}

if (process.argv[1] && process.argv[1].endsWith('fidelidade.ts')) {
  principal().catch((e) => { console.error(e); process.exit(1); });
}
