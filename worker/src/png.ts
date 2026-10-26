// Leitor de PNG mínimo, só pro que a conferência de marca precisa: 8 bits por
// canal, sem entrelaçamento — o que o PhotoCraft exporta. Uma dependência de
// imagem inteira (com binário nativo, no caso das rápidas) pra ler pixel de
// uma peça por vez seria mais coisa pra instalar no servidor do que isto.
import { deflateSync, inflateSync } from 'node:zlib';

export type Imagem = { largura: number; altura: number; rgb: Uint8Array; alfa: Uint8Array };

const CANAIS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function lerPng(buf: Buffer): Imagem {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('não é PNG');
  let pos = 8;
  let largura = 0, altura = 0, bits = 0, tipo = 0, entrelacado = 0;
  const dados: Buffer[] = [];
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos);
    const nome = buf.toString('ascii', pos + 4, pos + 8);
    const corpo = buf.subarray(pos + 8, pos + 8 + tam);
    if (nome === 'IHDR') {
      largura = corpo.readUInt32BE(0); altura = corpo.readUInt32BE(4);
      bits = corpo[8]; tipo = corpo[9]; entrelacado = corpo[12];
    } else if (nome === 'IDAT') dados.push(corpo);
    else if (nome === 'IEND') break;
    pos += 12 + tam;
  }
  const canais = CANAIS[tipo];
  if (bits !== 8 || !canais || entrelacado) throw new Error(`PNG fora do formato esperado (bits ${bits}, tipo ${tipo}, entrelaçado ${entrelacado})`);

  const cru = inflateSync(Buffer.concat(dados));
  const linha = largura * canais;
  const px = new Uint8Array(altura * linha);
  for (let y = 0; y < altura; y++) {
    const filtro = cru[y * (linha + 1)];
    const ini = y * (linha + 1) + 1;
    for (let x = 0; x < linha; x++) {
      const a = x >= canais ? px[y * linha + x - canais] : 0;
      const b = y > 0 ? px[(y - 1) * linha + x] : 0;
      const c = x >= canais && y > 0 ? px[(y - 1) * linha + x - canais] : 0;
      let v = cru[ini + x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * linha + x] = v & 0xff;
    }
  }
  // RGB composto sobre branco (peça de feed não tem transparência) e, à parte,
  // o alfa — a legenda do reel é transparente fora da caixa, e a conferência
  // dela olha só o que aparece.
  const rgb = new Uint8Array(largura * altura * 3);
  const alfaOut = new Uint8Array(largura * altura);
  for (let i = 0; i < largura * altura; i++) {
    const o = i * canais;
    const [r, g, b] = canais >= 3 ? [px[o], px[o + 1], px[o + 2]] : [px[o], px[o], px[o]];
    const a8 = canais === 4 ? px[o + 3] : canais === 2 ? px[o + 1] : 255;
    const alfa = a8 / 255;
    alfaOut[i] = a8;
    rgb[i * 3] = Math.round(r * alfa + 255 * (1 - alfa));
    rgb[i * 3 + 1] = Math.round(g * alfa + 255 * (1 - alfa));
    rgb[i * 3 + 2] = Math.round(b * alfa + 255 * (1 - alfa));
  }
  return { largura, altura, rgb, alfa: alfaOut };
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = ~0; for (const x of b) c = TABELA_CRC[(c ^ x) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

/** PNG RGB de 8 bits, sem filtro: o bastante pra prévia de página, que já vem de um app. */
export function escreverPng(img: Pick<Imagem, 'largura' | 'altura' | 'rgb'>): Buffer {
  const { largura, altura, rgb } = img;
  const bruto = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * largura * 3, largura * 3).copy(bruto, y * (largura * 3 + 1) + 1);
  const bloco = (tipo: string, dados: Buffer) => {
    const cab = Buffer.alloc(4); cab.writeUInt32BE(dados.length);
    const fim = Buffer.alloc(4); fim.writeUInt32BE(crc(Buffer.concat([Buffer.from(tipo), dados])));
    return Buffer.concat([cab, Buffer.from(tipo), dados, fim]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr), bloco('IDAT', deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]);
}

/** Um recorte retangular da imagem: a página sem a sangria em volta. */
export function recortar(img: Imagem, x: number, y: number, largura: number, altura: number): Imagem {
  const rgb = new Uint8Array(largura * altura * 3);
  const alfa = new Uint8Array(largura * altura);
  for (let l = 0; l < altura; l++) {
    rgb.set(img.rgb.subarray(((y + l) * img.largura + x) * 3, ((y + l) * img.largura + x + largura) * 3), l * largura * 3);
    alfa.set(img.alfa.subarray((y + l) * img.largura + x, (y + l) * img.largura + x + largura), l * largura);
  }
  return { largura, altura, rgb, alfa };
}
