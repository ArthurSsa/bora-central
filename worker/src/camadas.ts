// As camadas de cada imagem, pro Studio da Central: o PSD que a fábrica salvou
// vira uma lista de camadas (posição, tamanho, tipo, texto, cor) e um PNG
// recortado por camada. A tela monta a peça empilhando esses PNGs, e o que a
// equipe mexe lá volta pra fábrica como uma rodada de edição em cima do PSD.
//
//   camadas/<base>/camadas.json   a lista, de cima pra baixo (a ordem do PSD)
//   camadas/<base>/<id>.png       a camada sozinha, só a área que ela ocupa
//
// Sobem com papel 'camada': o cliente não lê (o balde só deixa ele ver saida/),
// e a rodada de ajuste não baixa (ela só quer os editáveis).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import { escreverPng, lerPngRgba } from './png.ts';
import { conferirSaida, type SaidaConferida } from './verificar.ts';

export type TipoDeCamada = 'texto' | 'imagem' | 'forma' | 'fundo';

export type TextoDaCamada = {
  conteudo: string;
  fonte: string;
  peso: number;
  /** Em px do documento (o PSD é de 72 ppi: ponto e pixel são o mesmo). */
  tamanho: number;
  cor: string;
  alinhamento: 'left' | 'center' | 'right' | 'justify';
  /** A caixa onde o texto quebra linha, em px do documento; null quando é texto de ponto. */
  caixa: [number, number, number, number] | null;
};

export type Camada = {
  id: number;
  nome: string;
  tipo: TipoDeCamada;
  /** A área que a camada ocupa de fato (o alfa do PNG), em px do documento. */
  x: number;
  y: number;
  largura: number;
  altura: number;
  visivel: boolean;
  opacidade: number;
  /** O PNG recortado, relativo à pasta do job; null quando a camada não tem pixel nenhum. */
  arquivo: string | null;
  texto?: TextoDaCamada;
  /** A cor da forma (camada de preenchimento) ou do fundo liso. */
  cor?: string;
};

export type Camadas = {
  versao: 1;
  base: string;
  largura: number;
  altura: number;
  psd: string;
  png: string;
  camadas: Camada[];
};

type CamadaDoInfo = {
  id: number; name: string; kind: string; visible: boolean; opacity: number;
  bounds: [number, number, number, number] | null;
};

const hex = (c: number[]) => '#' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const hex255 = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

const ALINHA: Record<string, TextoDaCamada['alinhamento']> = { Left: 'left', Center: 'center', Right: 'right', Justify: 'justify' };

function tipoDe(l: CamadaDoInfo, ultima: boolean, largura: number, altura: number): TipoDeCamada {
  if (l.kind === 'Type') return 'texto';
  if (l.kind === 'Fill' || l.kind === 'Shape') return 'forma';
  const cheia = l.bounds && l.bounds[0] <= 0 && l.bounds[1] <= 0 && l.bounds[2] >= largura && l.bounds[3] >= altura;
  if (l.kind === 'Pixel' && ultima && (l.name === 'Background' || cheia)) return 'fundo';
  return 'imagem';
}

/** O texto como o PhotoCraft guarda: o primeiro trecho manda na fonte e na cor. */
export function textoDoInfo(r: {
  text: string; transform?: number[]; shape?: unknown;
  runs: Array<{ style: { font_family: string; weight: number; size_pt: number; color: { c: number[] } } }>;
  paragraphs?: Array<{ style: { align: string } }>;
}, pxPorPt = 1): TextoDaCamada {
  const s = r.runs[0].style;
  const [, , , , tx = 0, ty = 0] = r.transform ?? [];
  const box = r.shape && typeof r.shape === 'object' && 'Box' in r.shape ? (r.shape as { Box: { x: number; y: number; width: number; height: number } }).Box : null;
  return {
    conteudo: r.text,
    fonte: s.font_family,
    peso: s.weight,
    tamanho: s.size_pt * pxPorPt,
    cor: hex(s.color.c),
    alinhamento: ALINHA[r.paragraphs?.[0]?.style.align ?? 'Left'] ?? 'left',
    caixa: box ? [tx + box.x, ty + box.y, box.width, box.height] : null,
  };
}

/** A área de alfa > 0 de um RGBA; null quando não há pixel nenhum. */
export function areaDoAlfa(img: { largura: number; altura: number; rgba: Uint8Array }): [number, number, number, number] | null {
  let x0 = img.largura, y0 = img.altura, x1 = -1, y1 = -1;
  for (let y = 0; y < img.altura; y++) {
    const linha = y * img.largura * 4;
    for (let x = 0; x < img.largura; x++) {
      if (img.rgba[linha + x * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

function recortarRgba(img: { largura: number; rgba: Uint8Array }, [x, y, w, h]: number[]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let l = 0; l < h; l++) out.set(img.rgba.subarray(((y + l) * img.largura + x) * 4, ((y + l) * img.largura + x + w) * 4), l * w * 4);
  return out;
}

/** A cor do miolo da forma: a média do que é opaco, sem a borda suavizada. */
function corDoOpaco(rgba: Uint8Array): string | undefined {
  let n = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 255) continue;
    n++; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2];
  }
  return n ? hex255(r / n, g / n, b / n) : undefined;
}

/**
 * Lê as camadas de um PSD e grava o PNG recortado de cada uma em
 * <pastaJob>/camadas/<base>/. Uma chamada só ao PhotoCraft: as camadas saem
 * em PNG do tamanho da peça (é de onde vem a área de quem não tem bounds, como
 * a faixa de preenchimento), e o texto de cada camada de texto vem junto.
 */
export function lerCamadas(pastaJob: string, psdRel: string, pngRel: string): Camadas {
  const cli = acharCli('photocraft');
  const psd = path.join(pastaJob, psdRel);
  const base = path.basename(psdRel, '.psd');
  const info = JSON.parse(execFileSync(cli, ['info', psd, '--compact'], { encoding: 'utf8', timeout: 60_000 }));
  const lista = info.layers as CamadaDoInfo[];
  // Grupo muda a ordem e o que "mover" quer dizer: por ora, a peça com grupo não vai pro Studio.
  const grupo = lista.find((l) => !['Type', 'Smart Object', 'Fill', 'Pixel', 'Shape'].includes(l.kind));
  if (grupo) throw new Error(`a camada "${grupo.name}" é do tipo ${grupo.kind}, que o Studio ainda não edita`);

  const pasta = path.join(pastaJob, 'camadas', base);
  const tmp = path.join(pastaJob, '.trabalho', `camadas-${base}`);
  rmSync(pasta, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  mkdirSync(tmp, { recursive: true });

  const args = ['run', psd, '--cmd', 'file.export.layersToFiles', '--params', JSON.stringify({ dir: tmp, format: 'png', prefix: 'c', visibleOnly: false })];
  const textos = lista.filter((l) => l.kind === 'Type');
  for (const t of textos) args.push('--cmd', 'type.info', '--params', JSON.stringify({ layer: t.id }));
  const linhas = execFileSync(cli, args, { encoding: 'utf8', timeout: 120_000 }).split(/\r?\n/).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const arquivos: string[] = linhas.find((l) => l.command === 'file.export.layersToFiles')?.result.files ?? [];
  if (arquivos.length !== lista.length) throw new Error(`o PhotoCraft exportou ${arquivos.length} camadas de ${lista.length}`);
  const infoDoTexto = new Map<number, TextoDaCamada>();
  for (const l of linhas) if (l.command === 'type.info') infoDoTexto.set(l.result.layer, textoDoInfo(l.result, l.result.pxPerPt ?? 1));

  const camadas: Camada[] = lista.map((l, i) => {
    const arq = path.isAbsolute(arquivos[i]) ? arquivos[i] : path.resolve(arquivos[i]);
    const img = lerPngRgba(readFileSync(arq));
    const area = areaDoAlfa(img);
    const tipo = tipoDe(l, i === lista.length - 1, info.width, info.height);
    const c: Camada = {
      id: l.id, nome: l.name, tipo, visivel: l.visible, opacidade: l.opacity,
      x: area?.[0] ?? 0, y: area?.[1] ?? 0, largura: area?.[2] ?? 0, altura: area?.[3] ?? 0,
      arquivo: null,
    };
    if (area) {
      const rgba = recortarRgba(img, area);
      c.arquivo = `camadas/${base}/${l.id}.png`;
      writeFileSync(path.join(pastaJob, c.arquivo), escreverPng({ largura: area[2], altura: area[3], rgba }));
      if (tipo === 'forma' || tipo === 'fundo') c.cor = corDoOpaco(rgba);
    }
    const t = infoDoTexto.get(l.id);
    if (t) c.texto = t;
    return c;
  });
  rmSync(tmp, { recursive: true, force: true });

  const doc: Camadas = { versao: 1, base, largura: info.width, altura: info.height, psd: psdRel, png: pngRel, camadas };
  writeFileSync(path.join(pasta, 'camadas.json'), JSON.stringify(doc, null, 1));
  return doc;
}

/**
 * As camadas de todas as imagens da peça que têm PSD (post, slides, capas).
 * Não reprova nada: peça sem camadas só não abre no Studio — o aviso diz por quê.
 */
export function camadasDaPeca(pastaJob: string, conferidas: SaidaConferida[]): { conferidas: SaidaConferida[]; avisos: string[] } {
  const saida: SaidaConferida[] = [];
  const avisos: string[] = [];
  for (const psd of conferidas.filter((c) => /^editavel\/[^/]+\.psd$/.test(c.caminho))) {
    const base = path.basename(psd.caminho, '.psd');
    const png = `saida/${base}.png`;
    if (!existsSync(path.join(pastaJob, png))) continue;
    try {
      const doc = lerCamadas(pastaJob, psd.caminho, png);
      const comArquivo = doc.camadas.filter((c) => c.arquivo);
      for (const c of [`camadas/${base}/camadas.json`, ...comArquivo.map((c) => c.arquivo!)]) {
        saida.push({ ...conferirSaida(pastaJob, { caminho: c }), papel: 'camada' });
      }
    } catch (e) {
      avisos.push(`${base}: sem camadas pro Studio (${(e as Error).message})`);
    }
  }
  return { conferidas: saida, avisos };
}
