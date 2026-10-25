// A conferência mínima antes de qualquer coisa ir pro Storage: o arquivo existe,
// é do formato que diz ser e tem o tamanho que a skill prometeu.
//
// É o chão, não o teto. Contraste medido no pixel, texto cortado, legenda
// sobreposta e loudness entram no passo 7; aqui é o que impede o pior caso —
// o agente dizer "pronto" sem ter salvo nada, ou salvar 1080×1080 num pedido
// de 1080×1350.
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SaidaEsperada } from './skills.ts';
import { sondar } from './video.ts';

export type Dimensoes = { largura: number; altura: number };

export function dimensoesPng(buf: Buffer): Dimensoes | null {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(assinatura) || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

export function dimensoesPsd(buf: Buffer): Dimensoes | null {
  // 8BPS, versão 1 (PSD) ou 2 (PSB), 6 bytes reservados, canais, altura, largura.
  if (buf.length < 26 || buf.toString('ascii', 0, 4) !== '8BPS') return null;
  const versao = buf.readUInt16BE(4);
  if (versao !== 1 && versao !== 2) return null;
  return { largura: buf.readUInt32BE(18), altura: buf.readUInt32BE(14) };
}

export const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.psd': 'image/vnd.adobe.photoshop',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.fcproj': 'application/octet-stream',
  '.ecproj': 'application/json',
  '.srt': 'application/x-subrip',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

export type SaidaConferida = {
  caminho: string;
  papel: 'saida' | 'editavel';
  mime: string;
  bytes: number;
  largura?: number;
  altura?: number;
};

export function conferirSaida(pastaJob: string, esperada: SaidaEsperada): SaidaConferida {
  const arq = path.join(pastaJob, esperada.caminho);
  if (!existsSync(arq)) throw new Error(`a skill prometia ${esperada.caminho} e o arquivo não existe`);
  const bytes = statSync(arq).size;
  if (bytes === 0) throw new Error(`${esperada.caminho} está vazio`);
  const ext = path.extname(arq).toLowerCase();
  const papel = esperada.caminho.startsWith('editavel/') ? 'editavel' : 'saida';
  const conferida: SaidaConferida = { caminho: esperada.caminho, papel, mime: MIME[ext] ?? 'application/octet-stream', bytes };

  let dim: Dimensoes | null = null;
  if (ext === '.png' || ext === '.psd') {
    const buf = readFileSync(arq);
    dim = ext === '.png' ? dimensoesPng(buf) : dimensoesPsd(buf);
    if (!dim) throw new Error(`${esperada.caminho} não é um ${ext.slice(1).toUpperCase()} válido`);
    Object.assign(conferida, dim);
  } else if (ext === '.mp4') {
    // Vídeo é medido pelo próprio FilmCraft (probe), sem ffprobe no servidor.
    const v = sondar(arq);
    if (!v.largura) throw new Error(`${esperada.caminho} não é um vídeo que o FilmCraft abra`);
    dim = { largura: v.largura, altura: v.altura };
    Object.assign(conferida, dim);
  }
  if (esperada.largura && esperada.altura) {
    if (!dim) throw new Error(`não sei medir ${ext}, e a skill cobra ${esperada.largura}×${esperada.altura}`);
    if (dim.largura !== esperada.largura || dim.altura !== esperada.altura) {
      throw new Error(`${esperada.caminho} saiu ${dim.largura}×${dim.altura}; a skill cobra ${esperada.largura}×${esperada.altura}`);
    }
  }
  return conferida;
}
