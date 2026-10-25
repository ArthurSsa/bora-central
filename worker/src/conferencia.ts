// A conferência de marca: o que um designer da Bora olharia antes de mandar a
// peça pro cliente, medido em vez de opinado.
//
//   fonte    todo texto na fonte da marca, e nada abaixo do peso 300 — fino
//            assim some na tela do celular, ainda mais sobre cor;
//   cor      toda cor que ocupa espaço na peça é da paleta — antialiasing e
//            sombra de borda não contam, foto não conta;
//   margem   nenhum texto dentro da faixa de 5% da borda, que o Instagram
//            corta ou cobre com a interface;
//   leitura  contraste do texto sobre o que está atrás dele, medido no pixel
//            da imagem exportada — não no que a camada diz que é.
//
// Reprovou, o job volta pra fila com o motivo escrito, e a próxima tentativa
// recebe esse motivo. É o "refaz sozinho antes de chamar a Bora".
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import { contraste } from './marca.ts';
import { lerPng, type Imagem } from './png.ts';
import type { SaidaConferida } from './verificar.ts';

export type RegraDeMarca = { cores: string[]; fontes: string[] };
export type Resultado = { erros: string[]; avisos: string[] };

type Rgb = [number, number, number];
type Caixa = [number, number, number, number]; // x0, y0, x1, y1

const hexParaRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};
const rgbParaHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const distancia = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** O que o PhotoCraft sabe de cada camada de texto do PSD. */
type Texto = { layer: number; caixa: Caixa; trechos: Array<{ familia: string; peso: number; tamanho: number; cor: Rgb }> };

function lerPsd(psd: string): { textos: Texto[]; fotos: Caixa[] } {
  const cli = acharCli('photocraft');
  const info = JSON.parse(execFileSync(cli, ['info', psd, '--compact'], { encoding: 'utf8', timeout: 60_000 }));
  // Camada de pixel que não é o fundo, ou objeto colocado: é foto ou elemento
  // do cliente, e a cor dela não é da conta da paleta.
  const fotos: Caixa[] = info.layers
    .filter((l: { kind: string; name: string; bounds: number[] | null }) => l.bounds && (l.kind === 'SmartObject' || (l.kind === 'Pixel' && l.name !== 'Background')))
    .map((l: { bounds: number[] }) => [l.bounds[0], l.bounds[1], l.bounds[0] + l.bounds[2], l.bounds[1] + l.bounds[3]] as Caixa);
  const ids: number[] = info.layers.filter((l: { kind: string }) => l.kind === 'Type').map((l: { id: number }) => l.id);
  if (!ids.length) return { textos: [], fotos };

  const args = ['run', psd];
  for (const id of ids) args.push('--cmd', 'type.info', '--params', JSON.stringify({ layer: id }));
  const saida = execFileSync(cli, args, { encoding: 'utf8', timeout: 60_000 });
  const textos = saida.split(/\r?\n/).filter((l) => l.includes('"type.info"')).map((l) => {
    const r = JSON.parse(l).result;
    return {
      layer: r.layer,
      caixa: r.bounds as Caixa,
      trechos: r.runs.map((t: { style: { font_family: string; weight: number; size_pt: number; color: { c: number[] } } }) => ({
        familia: t.style.font_family,
        peso: t.style.weight,
        tamanho: t.style.size_pt,
        cor: t.style.color.c.slice(0, 3).map((v) => v * 255) as Rgb,
      })),
    };
  });
  return { textos, fotos };
}

const dentro = (x: number, y: number, c: Caixa) => x >= c[0] && x < c[2] && y >= c[1] && y < c[3];
const sobrepoe = (a: Caixa, b: Caixa) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * As cores que ocupam espaço de verdade, fora das fotos. Tons vizinhos entram
 * no mesmo grupo (16 níveis por canal) e o grupo vale pela média: contando cor
 * exata, um degradê é mil faixas finas, nenhuma passa do mínimo, e um degradê
 * pra vermelho passaria inteiro.
 */
function coresQueOcupam(img: Imagem, fotos: Caixa[], minimo = 0.004): Array<{ cor: Rgb; fatia: number }> {
  const grupos = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = 0; y < img.altura; y++) for (let x = 0; x < img.largura; x++) {
    if (fotos.length && fotos.some((f) => dentro(x, y, f))) continue;
    const i = (y * img.largura + x) * 3;
    const [r, g, b] = [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const grupo = grupos.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    grupo.n++; grupo.r += r; grupo.g += g; grupo.b += b;
    grupos.set(k, grupo);
    total++;
  }
  return [...grupos.values()].filter((g) => g.n / total >= minimo).sort((a, b) => b.n - a.n)
    .map((g) => ({ cor: [g.r / g.n, g.g / g.n, g.b / g.n] as Rgb, fatia: g.n / total }));
}

/** O que está atrás do texto: a cor mais comum na caixa dele que não é a do próprio texto. */
function fundoAtras(img: Imagem, caixa: Caixa, corTexto: Rgb): Rgb | null {
  const conta = new Map<number, number>();
  const [x0, y0, x1, y1] = caixa.map(Math.round);
  for (let y = Math.max(0, y0); y < Math.min(img.altura, y1); y++) for (let x = Math.max(0, x0); x < Math.min(img.largura, x1); x++) {
    const i = (y * img.largura + x) * 3;
    const c = [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
    if (distancia(c, corTexto) < 60) continue;
    const k = (c[0] << 16) | (c[1] << 8) | c[2];
    conta.set(k, (conta.get(k) ?? 0) + 1);
  }
  const [k] = [...conta].sort((a, b) => b[1] - a[1])[0] ?? [];
  return k == null ? null : [(k >> 16) & 255, (k >> 8) & 255, k & 255];
}

export function conferirMarca(pastaJob: string, saidas: SaidaConferida[], regra: RegraDeMarca): Resultado {
  const erros: string[] = [];
  const avisos: string[] = [];
  const paleta = regra.cores.map(hexParaRgb);
  const fontes = new Set(regra.fontes.map((f) => f.toLowerCase()));
  const daPaleta = (c: number[], tolerancia = 14) => paleta.some((p) => distancia(p, c) <= tolerancia);
  // Degradê entre duas cores da marca passa por tons que não estão na paleta,
  // mas estão no caminho entre elas. Esses valem; um tom fora do caminho, não.
  const noCaminho = (c: number[]) => paleta.some((a, i) => paleta.slice(i + 1).some((b) => distanciaAoSegmento(c, a, b) <= 14));

  for (const png of saidas.filter((s) => s.mime === 'image/png' && s.papel === 'saida')) {
    const base = path.basename(png.caminho, '.png');
    const psd = path.join(pastaJob, 'editavel', `${base}.psd`);
    if (!existsSync(psd)) {
      erros.push(`${png.caminho}: falta o editável editavel/${base}.psd`);
      continue;
    }
    const img = lerPng(readFileSync(path.join(pastaJob, png.caminho)));
    const { textos, fotos } = lerPsd(psd);
    const borda = Math.round(Math.min(img.largura, img.altura) * 0.05);
    const nome = png.caminho;

    for (const t of textos) {
      for (const tr of t.trechos) {
        if (!fontes.has(tr.familia.toLowerCase())) erros.push(`${nome}: texto em "${tr.familia}"; a fonte da marca é ${regra.fontes.map((f) => `"${f}"`).join(' ou ')}`);
        if (tr.peso < 300) erros.push(`${nome}: texto no peso ${tr.peso}, fino demais pra ler no celular`);
        if (!daPaleta(tr.cor, 4)) erros.push(`${nome}: texto na cor ${rgbParaHex(tr.cor)}, que não é da paleta`);
      }
      const [x0, y0, x1, y1] = t.caixa;
      if (x0 < borda || y0 < borda || x1 > img.largura - borda || y1 > img.altura - borda) {
        erros.push(`${nome}: texto encostado na borda (${t.caixa.map(Math.round).join(', ')}); a área segura começa a ${borda} px`);
      }
      const tr0 = t.trechos[0];
      if (!tr0) continue;
      if (fotos.some((f) => sobrepoe(f, t.caixa))) {
        avisos.push(`${nome}: texto sobre foto — contraste não medido`);
        continue;
      }
      const atras = fundoAtras(img, t.caixa, tr0.cor);
      if (!atras) continue;
      const razao = contraste(rgbParaHex(tr0.cor), rgbParaHex(atras));
      const minimo = tr0.tamanho >= 40 ? 3 : 4.5;
      if (razao < minimo) erros.push(`${nome}: texto ${rgbParaHex(tr0.cor)} sobre ${rgbParaHex(atras)} dá ${razao.toFixed(1)}:1; precisa de ${minimo}:1`);
    }

    for (const { cor, fatia } of coresQueOcupam(img, fotos)) {
      if (!daPaleta(cor) && !noCaminho(cor)) erros.push(`${nome}: a cor ${rgbParaHex(cor)} ocupa ${(fatia * 100).toFixed(1)}% da peça e não é da paleta`);
    }
  }
  return { erros: [...new Set(erros)], avisos: [...new Set(avisos)] };
}

function distanciaAoSegmento(c: number[], a: number[], b: number[]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const comp = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (!comp) return distancia(c, a);
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / comp));
  return distancia(c, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]);
}

const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Os textos da entrega. A legenda tem o limite do Instagram (2.200 com as
 * hashtags) e o dele de hashtags (30); a marca que evita emoji não recebe
 * emoji nenhum. Os títulos do vídeo são dois, de até 100 caracteres (o limite
 * do YouTube).
 */
export function conferirTextos(pastaJob: string, saidas: SaidaConferida[], regra: { semEmoji: boolean }): Resultado {
  const erros: string[] = [];
  const avisos: string[] = [];
  for (const s of saidas.filter((x) => x.caminho.endsWith('.txt'))) {
    const texto = readFileSync(path.join(pastaJob, s.caminho), 'utf8').trim();
    if (regra.semEmoji && EMOJI.test(texto)) erros.push(`${s.caminho}: tem emoji, e a marca não usa`);
    if (s.caminho.endsWith('legenda.txt')) {
      const hashtags = texto.match(/#[\p{L}\p{N}_]+/gu) ?? [];
      if (texto.length > 2200) erros.push(`${s.caminho}: ${texto.length} caracteres; o Instagram corta em 2.200`);
      if (hashtags.length > 30) erros.push(`${s.caminho}: ${hashtags.length} hashtags; o Instagram aceita 30`);
      if (hashtags.length < 3) avisos.push(`${s.caminho}: só ${hashtags.length} hashtag(s)`);
      const primeira = texto.split('\n')[0];
      if (primeira.length > 125) avisos.push(`${s.caminho}: a primeira linha passa dos 125 caracteres que aparecem antes do "mais"`);
    }
    if (s.caminho.endsWith('titulos.txt')) {
      const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
      if (linhas.length !== 2) erros.push(`${s.caminho}: ${linhas.length} títulos; são dois, um por linha`);
      for (const l of linhas) if (l.length > 100) erros.push(`${s.caminho}: título com ${l.length} caracteres; o YouTube aceita 100`);
    }
  }
  return { erros, avisos };
}
