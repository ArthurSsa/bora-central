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
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import { contraste } from './marca.ts';
import { fontesDoProjeto, quadroDoProjeto } from './motion.ts';
import { lerPng, type Imagem } from './png.ts';
import { lerWav, listar, loudnessIntegrado, silencioMaisLongo, sondar } from './video.ts';
import type { SaidaConferida } from './verificar.ts';

export type RegraDeMarca = { cores: string[]; fontes: string[] };
export type Resultado = { erros: string[]; avisos: string[] };

type Rgb = [number, number, number];
export type Caixa = [number, number, number, number]; // x0, y0, x1, y1

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

// ---------- vídeo ----------

/**
 * A conferência do reel. O que se mede:
 *   - formato: 1080×1920 com áudio; a prévia até 15 s; o reel mais curto que
 *     o bruto (é o mesmo vídeo, sem as pausas) e com pelo menos 3 s;
 *   - tamanho: até 50 MB — o limite por arquivo do Supabase gratuito; passou,
 *     não sobe;
 *   - som: -16 LUFS ±1 (o padrão dos Reels), medido num WAV exportado com a
 *     mesma normalização, e nenhum silêncio acima de 1,2 s sobrando;
 *   - legendas: cada PNG só com cores da marca, texto legível sobre a caixa,
 *     e dentro da área que o Instagram não cobre (10% a 80% da altura).
 */
export function conferirVideo(
  pastaJob: string,
  saidas: SaidaConferida[],
  regra: { cores: string[]; segundosBruto: number; medirSom: (wav: string) => void },
): Resultado {
  const erros: string[] = [];
  const avisos: string[] = [];
  for (const s of saidas.filter((x) => x.caminho.endsWith('.mp4'))) {
    const v = sondar(path.join(pastaJob, s.caminho));
    if (!v.temAudio) erros.push(`${s.caminho}: saiu sem som`);
    if (v.bytes > 50 * 1024 * 1024) erros.push(`${s.caminho}: ${(v.bytes / 1048576).toFixed(0)} MB; o Storage aceita até 50 MB por arquivo`);
    if (s.caminho.endsWith('previa.mp4') && v.segundos > 15.5) erros.push(`${s.caminho}: a prévia tem ${v.segundos} s; são 15`);
    if (s.caminho.endsWith('reel.mp4')) {
      if (v.segundos < 3) erros.push(`${s.caminho}: só ${v.segundos} s — cortou demais`);
      if (v.segundos > regra.segundosBruto + 0.5) erros.push(`${s.caminho}: ${v.segundos} s, mais longo que o bruto (${regra.segundosBruto} s)`);
    }
  }

  const wav = path.join(pastaJob, '.trabalho', 'som-final.wav');
  regra.medirSom(wav);
  const som = lerWav(readFileSync(wav));
  const lufs = loudnessIntegrado(som);
  if (!(lufs >= -17 && lufs <= -15)) erros.push(`o som saiu em ${lufs.toFixed(1)} LUFS; os Reels pedem -16`);
  const mudo = silencioMaisLongo(som);
  if (mudo > 1.2) erros.push(`sobrou um trecho mudo de ${mudo} s`);

  const paleta = regra.cores.map(hexParaRgb);
  for (const arq of listar(path.join(pastaJob, 'editavel', 'legendas'), /\.png$/)) {
    const img = lerPng(readFileSync(arq));
    const nome = 'legenda ' + path.basename(arq);
    let x0 = img.largura, y0 = img.altura, x1 = 0, y1 = 0;
    const grupos = new Map<number, { n: number; r: number; g: number; b: number }>();
    let opacos = 0;
    for (let y = 0; y < img.altura; y++) for (let x = 0; x < img.largura; x++) {
      const i = y * img.largura + x;
      if (img.alfa[i] < 200) continue;
      opacos++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      const [r, g, b] = [img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2]];
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const gr = grupos.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      gr.n++; gr.r += r; gr.g += g; gr.b += b;
      grupos.set(k, gr);
    }
    if (!opacos) { erros.push(`${nome}: está vazia`); continue; }
    if (x0 < img.largura * 0.05 || x1 > img.largura * 0.95 || y0 < img.altura * 0.1 || y1 > img.altura * 0.8) {
      erros.push(`${nome}: fora da área segura (${x0}, ${y0}, ${x1}, ${y1})`);
    }
    const cores = [...grupos.values()].filter((g) => g.n / opacos >= 0.01).sort((a, b) => b.n - a.n)
      .map((g) => [g.r / g.n, g.g / g.n, g.b / g.n]);
    // A borda da letra mistura texto e caixa: tom no caminho entre duas cores da marca vale.
    const aceita = (c: number[]) => paleta.some((p) => distancia(p, c) <= 18)
      || paleta.some((a, i) => paleta.slice(i + 1).some((b) => distanciaAoSegmento(c, a, b) <= 14));
    for (const c of cores) if (!aceita(c)) erros.push(`${nome}: a cor ${rgbParaHex(c)} não é da paleta`);
    if (cores.length >= 2) {
      const razao = contraste(rgbParaHex(cores[0]), rgbParaHex(cores[1]));
      if (razao < 3) erros.push(`${nome}: texto sobre a caixa dá ${razao.toFixed(1)}:1; precisa de 3:1`);
    } else {
      avisos.push(`${nome}: só uma cor — sem texto?`);
    }
  }
  return { erros: [...new Set(erros)], avisos };
}

// ---------- motion ----------

/**
 * A conferência do motion. O vídeo não tem PSD nem som; o que se mede:
 *   - formato: 1080×1920, a duração que a cena manda (±0,25 s), até 50 MB,
 *     a prévia até 3,5 s;
 *   - fonte: todo texto do projeto (.ecproj é JSON) na família da marca;
 *   - quadros: o EffectCraft desenha do projeto os momentos em que a tela
 *     está parada, e neles toda cor que ocupa espaço é da paleta, o que não é
 *     fundo fica entre 5% e 95% da largura e 10% e 80% da altura, e o texto
 *     tem contraste com o fundo. No carrossel em vídeo, a área da imagem
 *     aprovada não conta — ela já passou pela conferência como post.
 */
export function conferirMotion(
  pastaJob: string,
  saidas: SaidaConferida[],
  regra: { cores: string[]; fonte: string; projeto: string; segundos: number; momentos: number[]; areaDaImagem?: Caixa | null },
): Resultado {
  const erros: string[] = [];
  const avisos: string[] = [];
  for (const s of saidas.filter((x) => x.caminho.endsWith('.mp4'))) {
    const v = sondar(path.join(pastaJob, s.caminho));
    if (v.bytes > 50 * 1024 * 1024) erros.push(`${s.caminho}: ${(v.bytes / 1048576).toFixed(0)} MB; o Storage aceita até 50 MB por arquivo`);
    if (s.caminho.endsWith('previa.mp4') && v.segundos > 3.5) erros.push(`${s.caminho}: a prévia tem ${v.segundos} s; são 3`);
    if (s.caminho.endsWith('reel.mp4') && Math.abs(v.segundos - regra.segundos) > 0.25) erros.push(`${s.caminho}: ${v.segundos} s; a cena tem ${regra.segundos}`);
  }

  const familia = regra.fonte.replace(/\s+/g, '').toLowerCase();
  for (const f of fontesDoProjeto(readFileSync(regra.projeto, 'utf8'))) {
    if (!f.replace(/\s+/g, '').toLowerCase().startsWith(familia)) erros.push(`texto em "${f}"; a fonte da marca é "${regra.fonte}"`);
  }

  const paleta = regra.cores.map(hexParaRgb);
  const aceita = (c: number[]) => paleta.some((p) => distancia(p, c) <= 16)
    || paleta.some((a, i) => paleta.slice(i + 1).some((b) => distanciaAoSegmento(c, a, b) <= 14));
  const trabalho = path.join(pastaJob, '.trabalho');
  mkdirSync(trabalho, { recursive: true });
  for (const t of regra.momentos) {
    const arq = path.join(trabalho, `quadro-${t}.png`);
    quadroDoProjeto(regra.projeto, t, arq);
    const img = lerPng(readFileSync(arq));
    const nome = `quadro em ${t} s`;
    const fora = regra.areaDaImagem ? [regra.areaDaImagem] : [];
    // Num quadro de motion os detalhes são pequenos: a barra de destaque é
    // 0,14% da tela. O mínimo aqui é 0,05% — uns mil pixels.
    const cores = coresQueOcupam(img, fora, 0.0005);
    for (const { cor, fatia } of cores) {
      if (!aceita(cor)) erros.push(`${nome}: a cor ${rgbParaHex(cor)} ocupa ${(fatia * 100).toFixed(1)}% e não é da paleta`);
    }
    // O que não é fundo: onde está, e se lê sobre ele.
    const fundo = cores[0]?.cor;
    if (!fundo) continue;
    let x0 = img.largura, y0 = img.altura, x1 = 0, y1 = 0;
    for (let y = 0; y < img.altura; y++) for (let x = 0; x < img.largura; x++) {
      const i = (y * img.largura + x) * 3;
      if (distancia([img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]], fundo) < 40) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 < x0) { erros.push(`${nome}: só tem o fundo`); continue; }
    if (x0 < img.largura * 0.05 || x1 > img.largura * 0.95 || y0 < img.altura * 0.1 || y1 > img.altura * 0.8) {
      erros.push(`${nome}: fora da área segura (${x0}, ${y0}, ${x1}, ${y1}); o Instagram cobre o topo e a parte de baixo`);
    }
    if (!regra.areaDaImagem && cores.length >= 2) {
      const razao = contraste(rgbParaHex(cores[1].cor), rgbParaHex(fundo));
      if (razao < 3) erros.push(`${nome}: ${rgbParaHex(cores[1].cor)} sobre ${rgbParaHex(fundo)} dá ${razao.toFixed(1)}:1; precisa de 3:1`);
    }
  }
  return { erros: [...new Set(erros)], avisos };
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
