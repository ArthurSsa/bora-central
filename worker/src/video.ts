// O que a fábrica faz com vídeo fora dos apps: transcrever, ler áudio e
// medir volume.
//
// TRANSCRIÇÃO. O FilmCraft publicado vem sem reconhecimento de voz ("built
// without the whisper feature"), mas aceita uma transcrição pronta
// (transcript.set) e faz o resto em cima dela: cortar pausas e vícios, gerar
// legendas. Quem transcreve é o whisper.cpp — o mesmo Whisper, rodando na
// máquina, sem o áudio do cliente sair da Bora. Ele só lê WAV 16 kHz; quem
// converte o vídeo do celular pra isso é o próprio FilmCraft.
//
// VOLUME. O padrão dos Reels é -16 LUFS (BS.1770). O FilmCraft normaliza na
// exportação; a conferência mede o resultado por conta própria — se a
// normalização falhar em silêncio, é aqui que aparece. Sem ffmpeg: menos uma
// coisa pra instalar no servidor.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { RAIZ_WORKER, acharCli } from './config.ts';
import { abrirMcp } from './mcp-cru.ts';

export const TICKS_POR_SEGUNDO = 254016000000;

export function acharWhisper(): { cli: string; modelo: string } {
  const base = path.join(RAIZ_WORKER, '.ferramentas', 'whisper');
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const cli = process.env.WHISPER_CLI
    ?? [path.join(base, 'bin', 'Release', exe), path.join(base, 'bin', exe)].find(existsSync)
    ?? exe;
  const modelo = process.env.WHISPER_MODELO ?? path.join(base, 'modelos', 'ggml-base.bin');
  return { cli, modelo };
}

export type Palavra = { texto: string; inicio: number; fim: number };

/**
 * As palavras a partir da saída completa do whisper.cpp (-ojf). Cada token
 * traz o horário dele; palavra nova começa no token que começa com espaço.
 * (O modo de uma palavra por trecho, -ml 1, corta letra acentuada no meio
 * dos bytes e devolve "laboratã" — por isso não é usado.)
 */
export function palavrasDoWhisper(saida: { transcription: Array<{ tokens: Array<{ text: string; offsets: { from: number; to: number } }> }> }): Palavra[] {
  const palavras: Palavra[] = [];
  for (const trecho of saida.transcription) {
    for (const tk of trecho.tokens) {
      if (/^\[_/.test(tk.text)) continue; // [_BEG_], [_TT_123]: marcadores, não fala
      const ultima = palavras[palavras.length - 1];
      if ((tk.text.startsWith(' ') || !ultima) && /\S/.test(tk.text)) {
        palavras.push({ texto: tk.text.trim(), inicio: tk.offsets.from / 1000, fim: tk.offsets.to / 1000 });
      } else if (ultima) {
        ultima.texto += tk.text;
        ultima.fim = tk.offsets.to / 1000;
      }
    }
  }
  return palavras.filter((p) => p.texto);
}

/**
 * Encosta cada palavra no som. O whisper estica o fim da palavra por cima da
 * pausa que vem depois ("laboratório." terminando 1 s depois de a voz parar),
 * e aí o corte de pausas do FilmCraft, que se guia pelas palavras, não vê a
 * pausa inteira. Aqui o começo anda pra frente e o fim pra trás enquanto a
 * janela de 50 ms ali for silêncio.
 */
export function ajustarAoSom(palavras: Palavra[], { taxa, canais }: Audio, limiteDb = -45): Palavra[] {
  const janela = 0.05;
  const silencio = (t: number) => {
    const ini = Math.max(0, Math.floor(t * taxa)), fim = Math.min(canais[0].length, Math.floor((t + janela) * taxa));
    if (fim <= ini) return true;
    let s = 0;
    for (let i = ini; i < fim; i++) s += canais[0][i] * canais[0][i];
    return 10 * Math.log10(s / (fim - ini) + 1e-12) < limiteDb;
  };
  return palavras.map((p) => {
    let { inicio, fim } = p;
    while (fim - janela > inicio + 0.08 && silencio(fim - janela)) fim -= janela;
    while (inicio + janela < fim - 0.08 && silencio(inicio)) inicio += janela;
    return { ...p, inicio: Math.round(inicio * 1000) / 1000, fim: Math.round(fim * 1000) / 1000 };
  });
}

/** Abre o vídeo no FilmCraft e exporta o áudio em WAV mono 16 kHz, que é o que o whisper lê. */
export async function audioParaTranscrever(pastaTrabalho: string, video: string): Promise<string> {
  const fc = acharCli('filmcraft');
  const projeto = path.join(pastaTrabalho, 'transcrever.fcproj');
  const mcp = await abrirMcp({ type: 'stdio', command: fc, args: ['mcp', '--data-dir', path.join(pastaTrabalho, '.filmcraft')] });
  try {
    const imp = await mcp.chamar('media_import', { paths: [video] });
    if (imp.erro) throw new Error(`importar o vídeo: ${imp.texto}`);
    const { items: [item] } = JSON.parse(imp.texto);
    for (const [id, params] of [['file.newSequenceFromClip', { items: [item] }], ['file.saveAs', { path: projeto }]] as const) {
      const r = await mcp.chamar('command_run', { id, params });
      if (r.erro) throw new Error(`${id}: ${r.texto}`);
    }
  } finally {
    mcp.fechar();
  }
  const wav = path.join(pastaTrabalho, 'audio-16k.wav');
  execFileSync(fc, ['--project', projeto, 'export', wav, '--format', 'wav', '--settings',
    JSON.stringify({ audio: { sample_rate: 16000, channels: 1, bits: 16, codec: 'pcm' } })], { stdio: 'ignore', timeout: 10 * 60_000 });
  return wav;
}

export async function transcrever(pastaTrabalho: string, video: string, idioma = 'pt'): Promise<Palavra[]> {
  const wav = await audioParaTranscrever(pastaTrabalho, video);
  const { cli, modelo } = acharWhisper();
  const saida = path.join(pastaTrabalho, 'transcricao');
  execFileSync(cli, ['-m', modelo, '-f', wav, '-l', idioma, '-ojf', '-of', saida, '-np'], { stdio: 'ignore', timeout: 30 * 60_000 });
  const palavras = palavrasDoWhisper(JSON.parse(readFileSync(`${saida}.json`, 'utf8')));
  return ajustarAoSom(palavras, lerWav(readFileSync(wav)));
}

/** A transcrição no formato do transcript.set do FilmCraft (tempos em ticks). */
export function transcricaoParaFilmCraft(palavras: Palavra[], idioma = 'pt') {
  return {
    language: idioma,
    speakers: [{ name: 'Pessoa' }],
    words: palavras.map((p) => ({ text: p.texto, start: Math.round(p.inicio * TICKS_POR_SEGUNDO), end: Math.round(p.fim * TICKS_POR_SEGUNDO), speaker: 0 })),
  };
}

// ---------- áudio ----------

export type Audio = { taxa: number; canais: number[][] };

/** WAV PCM 16/24/32 bits ou float 32, qualquer número de canais. */
export function lerWav(buf: Buffer): Audio {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('não é WAV');
  let pos = 12;
  let formato = 1, nCanais = 1, taxa = 48000, bits = 16;
  let dados: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const tam = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      formato = buf.readUInt16LE(pos + 8);
      nCanais = buf.readUInt16LE(pos + 10);
      taxa = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
      if (formato === 0xfffe) formato = buf.readUInt16LE(pos + 32); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      dados = buf.subarray(pos + 8, Math.min(buf.length, pos + 8 + tam));
    }
    pos += 8 + tam + (tam % 2);
  }
  if (!dados) throw new Error('WAV sem dados');
  const passo = bits / 8;
  const quadros = Math.floor(dados.length / (passo * nCanais));
  const canais = Array.from({ length: nCanais }, () => new Array<number>(quadros));
  for (let i = 0; i < quadros; i++) {
    for (let c = 0; c < nCanais; c++) {
      const o = (i * nCanais + c) * passo;
      canais[c][i] = formato === 3 ? dados.readFloatLE(o)
        : bits === 16 ? dados.readInt16LE(o) / 32768
        : bits === 24 ? dados.readIntLE(o, 3) / 8388608
        : dados.readInt32LE(o) / 2147483648;
    }
  }
  return { taxa, canais };
}

/** Filtro biquad aplicado num sinal inteiro. */
function biquad(x: number[], b: number[], a: number[]): number[] {
  const y = new Array<number>(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/**
 * Loudness integrado (ITU-R BS.1770-4 / EBU R128): filtro K (prateleira +
 * passa-alta), blocos de 400 ms com 75% de sobreposição, porta absoluta de
 * -70 LUFS e relativa de -10 LU. Os coeficientes saem da taxa do arquivo, e
 * não da tabela de 48 kHz — o áudio pode chegar em outra taxa.
 */
export function loudnessIntegrado({ taxa, canais }: Audio): number {
  const K = (f0: number, Q: number, ganho: number, tipo: 'prateleira' | 'passa-alta') => {
    const k = Math.tan(Math.PI * f0 / taxa);
    if (tipo === 'prateleira') {
      const vh = 10 ** (ganho / 20), vb = vh ** 0.4996667741545416;
      const a0 = 1 + k / Q + k * k;
      return { b: [(vh + vb * k / Q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / Q + k * k) / a0], a: [1, 2 * (k * k - 1) / a0, (1 - k / Q + k * k) / a0] };
    }
    const a0 = 1 + k / Q + k * k;
    return { b: [1, -2, 1], a: [1, 2 * (k * k - 1) / a0, (1 - k / Q + k * k) / a0] };
  };
  const p1 = K(1681.974450955533, 0.7071752369554196, 3.999843853973347, 'prateleira');
  const p2 = K(38.13547087602444, 0.5003270373238773, 0, 'passa-alta');
  const filtrados = canais.slice(0, 2).map((c) => biquad(biquad(c, p1.b, p1.a), p2.b, p2.a)); // L/R pesam 1
  const tamBloco = Math.round(taxa * 0.4), salto = Math.round(taxa * 0.1);
  const blocos: number[] = [];
  for (let ini = 0; ini + tamBloco <= filtrados[0].length; ini += salto) {
    let soma = 0;
    for (const c of filtrados) {
      let s = 0;
      for (let i = ini; i < ini + tamBloco; i++) s += c[i] * c[i];
      soma += s / tamBloco;
    }
    blocos.push(soma);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const acimaAbs = blocos.filter((z) => lufs(z) > -70);
  if (!acimaAbs.length) return -Infinity;
  const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const relativo = lufs(media(acimaAbs)) - 10;
  const validos = acimaAbs.filter((z) => lufs(z) > relativo);
  return lufs(media(validos));
}

/** O maior trecho em que nada passa de `limiteDb` (em janelas de 50 ms), em segundos. */
export function silencioMaisLongo({ taxa, canais }: Audio, limiteDb = -45): number {
  const janela = Math.round(taxa * 0.05);
  let maior = 0, atual = 0;
  for (let ini = 0; ini + janela <= canais[0].length; ini += janela) {
    let s = 0;
    for (const c of canais) for (let i = ini; i < ini + janela; i++) s += c[i] * c[i];
    const db = 10 * Math.log10(s / (janela * canais.length) + 1e-12);
    atual = db < limiteDb ? atual + 0.05 : 0;
    maior = Math.max(maior, atual);
  }
  return Math.round(maior * 100) / 100;
}

export type Sonda = { segundos: number; largura: number; altura: number; temAudio: boolean; bytes: number };

export function sondar(arquivo: string): Sonda {
  const j = JSON.parse(execFileSync(acharCli('filmcraft'), ['--compact', 'probe', arquivo], { encoding: 'utf8', timeout: 60_000 }));
  return {
    segundos: Math.round((j.duration / TICKS_POR_SEGUNDO) * 100) / 100,
    largura: j.video?.width ?? 0,
    altura: j.video?.height ?? 0,
    temAudio: Array.isArray(j.audio_streams) && j.audio_streams.length > 0,
    bytes: j.file_size ?? 0,
  };
}

/** Os arquivos de uma pasta que batem com um padrão, em ordem. */
export const listar = (pasta: string, padrao: RegExp) =>
  existsSync(pasta) ? readdirSync(pasta).filter((n) => padrao.test(n)).sort().map((n) => path.join(pasta, n)) : [];
