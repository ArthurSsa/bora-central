// A imagem gerada vira objeto do Studio (ADR 0001, D5; tarefa 8): o gerador
// entrega uma figura achatada sobre fundo liso, e a ArtCraft faz dela um
// objeto que se mexe, muda de tamanho e muda de cor.
//
//   recortar  — o fundo sai (PhotoCraft): fundo liso por varinha mágica nos
//               quatro cantos; fundo cheio pela seleção do assunto. O PNG fica
//               só com a área do objeto, e a caixa dele vem junto.
//   vetorizar — estilos chapados (flat, ilustração) viram SVG (VectorCraft,
//               imageTrace) sem a cor do fundo e com poucas cores; cada cor
//               pode ser trocada por uma da paleta da marca (recolor.apply).
//   julgar    — o que conta como "aproveitável": o recorte não pegou a imagem
//               inteira nem quase nada, e o vetor ficou leve e com as cores
//               que se pediu.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import { areaDoAlfa } from './camadas.ts';
import { escreverPng, lerPngRgba } from './png.ts';

type Rgba = { largura: number; altura: number; rgba: Uint8Array };
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * A cor do fundo, quando ele é liso: os quatro cantos (um quadrado de 8 px em
 * cada) com a mesma cor, até `tolerancia` por canal. Fundo cheio (foto, cena)
 * devolve null.
 */
export function corDoFundoLiso(img: Rgba, tolerancia = 18): string | null {
  const lado = Math.max(1, Math.min(8, Math.floor(Math.min(img.largura, img.altura) / 10)));
  const cantos = [[0, 0], [img.largura - lado, 0], [0, img.altura - lado], [img.largura - lado, img.altura - lado]];
  const amostras: number[][] = [];
  for (const [x0, y0] of cantos) for (let y = y0; y < y0 + lado; y++) for (let x = x0; x < x0 + lado; x++) {
    const i = (y * img.largura + x) * 4;
    amostras.push([img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]);
  }
  const media = [0, 1, 2].map((c) => amostras.reduce((s, a) => s + a[c], 0) / amostras.length);
  const longe = amostras.some((a) => a.some((v, c) => Math.abs(v - media[c]) > tolerancia));
  return longe ? null : hex(media[0], media[1], media[2]);
}

/** A cor da paleta mais perto (distância no RGB, que basta pra trocar uma cor de ilustração pela da marca). */
export function corMaisPerto(cor: string, paleta: string[]): string {
  const [r, g, b] = rgb(cor);
  return paleta.reduce((melhor, p) => {
    const [pr, pg, pb] = rgb(p), [mr, mg, mb] = rgb(melhor);
    return (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2 < (mr - r) ** 2 + (mg - g) ** 2 + (mb - b) ** 2 ? p : melhor;
  });
}

export type Recorte = { arquivo: string; area: [number, number, number, number]; fundoLiso: string | null; fracao: number };

/**
 * Tira o fundo e grava `saida` (PNG só com a área do objeto). Fundo liso: a
 * varinha mágica nos quatro cantos, contígua, esconde o fundo pela máscara.
 * Fundo cheio: a seleção do assunto do PhotoCraft.
 */
export function recortar(entrada: string, saida: string): Recorte {
  const cli = acharCli('photocraft');
  const original = lerPngRgba(readFileSync(entrada));
  const fundo = corDoFundoLiso(original);
  const cheio = saida.replace(/\.png$/i, '.cheio.png');
  const args = ['run', entrada, '--cmd', 'layer.new.layerFromBackground', '--params', '{}'];
  if (fundo) {
    const { largura: w, altura: h } = original;
    for (const [k, [x, y]] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].entries()) {
      args.push('--cmd', 'select.magicWand', '--params', JSON.stringify({ x, y, tolerance: 24, contiguous: true, mode: k === 0 ? 'replace' : 'add' }));
    }
    args.push('--cmd', 'layer.layerMask.hideSelection', '--params', '{}');
  } else {
    args.push('--cmd', 'layer.removeBackground', '--params', JSON.stringify({ refine: true }));
  }
  args.push('--cmd', 'file.saveACopy', '--params', JSON.stringify({ path: cheio }));
  execFileSync(cli, args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const img = lerPngRgba(readFileSync(cheio));
  rmSync(cheio, { force: true });
  const area = areaDoAlfa(img) ?? [0, 0, 1, 1];
  const rgba = new Uint8Array(area[2] * area[3] * 4);
  for (let l = 0; l < area[3]; l++) rgba.set(img.rgba.subarray(((area[1] + l) * img.largura + area[0]) * 4, ((area[1] + l) * img.largura + area[0] + area[2]) * 4), l * area[2] * 4);
  writeFileSync(saida, escreverPng({ largura: area[2], altura: area[3], rgba }));
  let opacos = 0;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 128) opacos++;
  return { arquivo: saida, area, fundoLiso: fundo, fracao: opacos / (img.largura * img.altura) };
}

export type Vetor = { arquivo: string; caminhos: number; cores: string[]; bytes: number };

/**
 * Vetoriza a imagem no VectorCraft, sem a cor do fundo e com até `cores`
 * cores; com `paleta`, troca cada cor pela da paleta mais perto. Só pra
 * estilos chapados: foto vetorizada vira mancha.
 */
export function vetorizar(entrada: string, saida: string, o: { cores?: number; fundo?: string | null; paleta?: string[] } = {}): Vetor {
  const cli = acharCli('vectorcraft');
  const img = lerPngRgba(readFileSync(entrada));
  const params: Record<string, unknown> = { mode: 'color', palette: 'limited', colors: o.cores ?? 6 };
  if (o.fundo) Object.assign(params, { ignoreWhite: true, ignoreColor: o.fundo.toLowerCase() });
  const linhas = (args: string[]) => execFileSync(cli, args, { encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] })
    .split(/\r?\n/).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const r = linhas(['run', '--cmd', 'file.new', '--params', JSON.stringify({ width: img.largura, height: img.altura }),
    '--cmd', 'file.place', '--params', JSON.stringify({ path: path.resolve(entrada), link: false }),
    '--cmd', 'imageTrace.makeAndExpand', '--params', JSON.stringify({ params }),
    '--cmd', 'recolor.colors', '--params', '{}', '--export', path.resolve(saida)]);
  const trace = r.find((l) => l.command === 'imageTrace.makeAndExpand')?.result ?? {};
  let cores: string[] = (r.find((l) => l.command === 'recolor.colors')?.result.colors ?? []).map((c: { hex: string }) => c.hex.toUpperCase());
  if (o.paleta?.length && cores.length) {
    const mapa = Object.fromEntries(cores.map((c) => [c, corMaisPerto(c, o.paleta!)]));
    // O recolor só age no que está selecionado.
    linhas(['run', '--in', path.resolve(saida), '--cmd', 'select.all', '--cmd', 'recolor.apply', '--params', JSON.stringify({ map: mapa }), '--export', path.resolve(saida)]);
    cores = [...new Set(Object.values(mapa))];
  }
  return { arquivo: saida, caminhos: trace.paths ?? 0, cores, bytes: readFileSync(saida).length };
}

/** Aproveitável: o recorte pegou um objeto (nem a imagem inteira, nem um farelo) e o vetor, quando há, ficou leve. */
export function julgarObjeto(r: Recorte, v?: Vetor | null): string | null {
  if (r.fracao > 0.92) return 'o recorte pegou a imagem inteira: o fundo não saiu';
  if (r.fracao < 0.02) return 'o recorte quase não pegou nada';
  if (v && v.bytes > 400_000) return `o vetor ficou pesado (${Math.round(v.bytes / 1000)} KB)`;
  if (v && v.caminhos > 1500) return `o vetor ficou com ${v.caminhos} caminhos: a imagem não é chapada`;
  return null;
}
