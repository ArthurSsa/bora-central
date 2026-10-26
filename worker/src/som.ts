// O som dos vídeos, no SoundCraft — sempre pelo CLI, sem janela.
//
//   - a voz do reel passa por filtro de graves, de-esser e compressor: fala de
//     celular chega com ronco, chiado e sobe-e-desce de volume;
//   - a trilha da marca entra por baixo: abaixa nos trechos com fala e volta
//     nos respiros, pela automação de volume da faixa (é o que um editor faz à
//     mão, e fica visível na sessão pra quem abrir);
//   - a saída passa por um limitador em -2,5 dB (o pico entre amostras sobe
//     perto de 1 dB acima dele) e é ajustada até -16 LUFS em até seis
//     passadas: o SoundCraft mede cada exportação;
//   - a sessão é salva com o áudio dentro e vira editavel/som.zip, que abre no
//     SoundCraft de qualquer PC.
//
// A trilha é música que o cliente tem direito de usar, subida pela equipe na
// Marca. Nada aqui gera música.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import { lerWav, type Audio } from './video.ts';

export const ALVO_LUFS = -16;
const TAXA = 48000;

/** Quanto a trilha fica abaixo da voz, e nos respiros. "Música mais baixa" desce as duas 6 dB. */
export const NIVEIS_TRILHA = {
  normal: { respiro: -12, fala: -24, sozinha: 0 },
  baixa: { respiro: -18, fala: -30, sozinha: -6 },
};
export type NivelTrilha = keyof typeof NIVEIS_TRILHA;

export type Trecho = [number, number];

/**
 * Os trechos com fala, em segundos: as legendas (ou palavras) juntadas quando
 * a pausa entre elas é curta — a trilha subindo e descendo a cada palavra
 * ficaria pior do que parada.
 */
export function trechosDeFala(itens: Array<{ inicio: number; fim: number }>, juntarAte = 0.8): Trecho[] {
  const ordem = [...itens].filter((x) => x.fim > x.inicio).sort((a, b) => a.inicio - b.inicio);
  const trechos: Trecho[] = [];
  for (const { inicio, fim } of ordem) {
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && inicio - ultimo[1] <= juntarAte) ultimo[1] = Math.max(ultimo[1], fim);
    else trechos.push([inicio, fim]);
  }
  return trechos;
}

export type Ponto = { at: number; value: number };

/**
 * A curva de volume da trilha, em segundos e dB. Sem fala, ela vai no nível de
 * "sozinha". Com fala, desce 0,15 s antes de cada trecho e volta em 0,4 s
 * depois. No fim, some em 1,5 s.
 */
export function curvaDaTrilha(duracao: number, falas: Trecho[], nivel: NivelTrilha = 'normal'): Ponto[] {
  const n = NIVEIS_TRILHA[nivel];
  const base = falas.length ? n.respiro : n.sozinha;
  const pontos: Ponto[] = [{ at: 0, value: base }];
  for (const [a, b] of falas) {
    const desce = Math.max(0, a - 0.15);
    const sobe = Math.min(duracao, b + 0.4);
    pontos.push({ at: desce, value: base }, { at: a, value: n.fala }, { at: b, value: n.fala }, { at: sobe, value: base });
  }
  const fimFade = Math.max(0, duracao - 1.5);
  const ultimo = pontos[pontos.length - 1];
  pontos.push({ at: Math.max(fimFade, ultimo.at), value: ultimo.value }, { at: duracao, value: -60 });
  // Mesmo instante duas vezes (trechos encostados): fica o último valor.
  const unicos = new Map<number, number>();
  for (const p of pontos) unicos.set(Math.round(p.at * 1000) / 1000, p.value);
  return [...unicos].map(([at, value]) => ({ at, value })).sort((a, b) => a.at - b.at);
}

// ---------- WAV ----------

/** WAV PCM 16 bits, intercalado. */
export function escreverWav(arquivo: string, { taxa, canais }: Audio) {
  const quadros = canais[0].length;
  const buf = Buffer.alloc(44 + quadros * canais.length * 2);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(canais.length, 22);
  buf.writeUInt32LE(taxa, 24); buf.writeUInt32LE(taxa * canais.length * 2, 28); buf.writeUInt16LE(canais.length * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(quadros * canais.length * 2, 40);
  let o = 44;
  for (let i = 0; i < quadros; i++) for (const c of canais) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))), o); o += 2;
  }
  writeFileSync(arquivo, buf);
}

/** O pico de amostra mais alto, em dBFS. */
export function picoDb({ canais }: Audio): number {
  let max = 0;
  for (const c of canais) for (const v of c) max = Math.max(max, Math.abs(v));
  return max > 0 ? 20 * Math.log10(max) : -Infinity;
}

// ---------- SoundCraft ----------

const sc = (args: string[], timeout = 5 * 60_000) => execFileSync(acharCli('soundcraft'), args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A trilha do jeito que a mixagem usa: WAV 48 kHz 16 bits (o SoundCraft lê
 * MP3, OGG, FLAC, AIFF; converter antes tira a dúvida de cada formato),
 * repetida se for curta e cortada 2 s depois de onde o vídeo acaba — é ela
 * que vai dentro do editável, e o editável não precisa da música inteira.
 */
export function prepararTrilha(original: string, saida: string, duracao: number): string {
  const convertida = saida.replace(/\.wav$/i, '') + '.convertida.wav';
  sc(['convert', original, convertida, '--bit-depth', '16', '--rate', String(TAXA)]);
  const a = lerWav(readFileSync(convertida));
  rmSync(convertida, { force: true });
  const precisa = Math.ceil((duracao + 2) * a.taxa);
  if (!a.canais[0].length) throw new Error('a trilha está vazia');
  const canais = a.canais.map((c) => Array.from({ length: precisa }, (_, i) => c[i % c.length]));
  escreverWav(saida, { taxa: a.taxa, canais });
  return saida;
}

export type Mixagem = { mix: string; sessao: string; lufs: number; picoReal: number; passadas: number };

/**
 * Mixa a voz (quando há) e a trilha (quando há) em `pasta`: a sessão em
 * pasta/som.scraft (com "Audio Files" ao lado) e a mixagem em pasta/mix.wav,
 * com `duracao` segundos.
 */
export function mixarSom(o: {
  pasta: string;
  duracao: number;
  voz?: string | null;
  trilha?: string | null;
  falas?: Trecho[];
  nivel?: NivelTrilha;
}): Mixagem {
  if (!o.voz && !o.trilha) throw new Error('sem voz e sem trilha não há o que mixar');
  mkdirSync(o.pasta, { recursive: true });
  const fim = Math.round(o.duracao * TAXA);
  const amostra = (s: number) => Math.round(s * TAXA);
  // 16 bits: a cópia do áudio que vai dentro do editável fica com metade do tamanho.
  const base: string[] = [`session.new ${JSON.stringify({ name: 'som', bit_depth: 16 })}`];
  const faixas: string[] = [];
  if (o.voz) {
    base.push(`file.import_audio ${JSON.stringify({ path: o.voz })}`);
    const voz = path.basename(o.voz).replace(/\.[^.]+$/, '');
    faixas.push(voz);
    base.push(
      // Ronco e vento abaixo de 90 Hz saem; o "s" agudo é domado; a fala fica num volume só.
      `mix.insert ${JSON.stringify({ track: voz, plugin: 'eq_7band', params: { hpf_on: 1, hpf_freq: 90, hpf_slope: 2 } })}`,
      `mix.insert ${JSON.stringify({ track: voz, plugin: 'de_esser', params: { freq: 6500, threshold: -30, range: 8 } })}`,
      `mix.insert ${JSON.stringify({ track: voz, plugin: 'compressor', params: { threshold: -26, ratio: 3, attack: 8, release: 140, knee: 6, makeup: 4 } })}`,
    );
  }
  if (o.trilha) {
    base.push(`file.import_audio ${JSON.stringify({ path: o.trilha })}`);
    const trilha = path.basename(o.trilha).replace(/\.[^.]+$/, '');
    faixas.push(trilha);
    for (const p of curvaDaTrilha(o.duracao, o.falas ?? [], o.nivel)) {
      base.push(`automation.set_point ${JSON.stringify({ track: trilha, param: 'volume', at: amostra(p.at), value: p.value })}`);
    }
  }
  base.push(
    `track.new ${JSON.stringify({ kind: 'master', name: 'Saida' })}`,
    `mix.insert ${JSON.stringify({ track: 'Saida', plugin: 'maximizer', params: { threshold: 0, ceiling: -2.5, release: 80 } })}`,
  );

  const mix = path.join(o.pasta, 'mix.wav');
  const sessao = path.join(o.pasta, 'som.scraft');
  let ganho = 0;
  let medida = { lufs: 0, true_peak_db: 0 };
  let anterior: { ganho: number; lufs: number } | null = null;
  let passadas = 0;
  // O ganho entra como "trim" das faixas: a automação de volume da trilha fica
  // como está, e o limitador da saída segura o pico. Perto do teto o limitador
  // come parte do ganho, então cada passada aprende com a anterior quantos dB
  // de ganho rendem um LU (entre 1 e 4).
  for (; ; passadas++) {
    const linhas = [...base];
    if (ganho) linhas.push(`mix.trim ${JSON.stringify({ tracks: faixas, db: Math.max(-40, Math.min(24, ganho)) })}`);
    linhas.push(`file.bounce_mix ${JSON.stringify({ path: mix, start: 0, end: fim, bit_depth: 16, dither: true })}`);
    const script = path.join(o.pasta, 'mixar.txt');
    writeFileSync(script, linhas.join('\n') + '\n');
    const saida = sc(['script', script]);
    rmSync(script, { force: true });
    const linha = saida.split(/\r?\n/).find((l) => l.startsWith('file.bounce_mix:'));
    if (!linha) throw new Error(`o SoundCraft não exportou a mixagem: ${saida.slice(-300)}`);
    medida = JSON.parse(linha.slice('file.bounce_mix:'.length));
    if (Math.abs(medida.lufs - ALVO_LUFS) <= 0.5 || passadas === 5) break;
    const rende = anterior && Math.abs(medida.lufs - anterior.lufs) > 0.05
      ? Math.max(1, Math.min(4, (ganho - anterior.ganho) / (medida.lufs - anterior.lufs))) : 1;
    anterior = { ganho, lufs: medida.lufs };
    ganho += (ALVO_LUFS - medida.lufs) * rende;
  }

  // A sessão final, com o mesmo ganho, salva com o áudio dentro.
  const linhas = [...base];
  if (ganho) linhas.push(`mix.trim ${JSON.stringify({ tracks: faixas, db: Math.max(-40, Math.min(24, ganho)) })}`);
  linhas.push(`session.save_as ${JSON.stringify({ path: sessao, replace: true })}`);
  const script = path.join(o.pasta, 'salvar.txt');
  writeFileSync(script, linhas.join('\n') + '\n');
  sc(['script', script]);
  rmSync(script, { force: true });
  return { mix, sessao, lufs: medida.lufs, picoReal: medida.true_peak_db, passadas: passadas + 1 };
}

/** O áudio de um vídeo (ou de qualquer arquivo que o SoundCraft leia) em WAV. */
export function audioDe(arquivo: string, saida: string): Audio {
  sc(['convert', arquivo, saida, '--bit-depth', '16']);
  return lerWav(readFileSync(saida));
}

/**
 * A curva de volume da trilha, lida da sessão salva (o .scraft é JSON): é o
 * que a conferência usa pra ver se a trilha abaixa mesmo onde há fala.
 */
export function curvaDaSessao(sessao: string, faixa: string): Ponto[] {
  const j = JSON.parse(readFileSync(sessao, 'utf8')) as { sample_rate: number; tracks: Array<{ name: string; automation?: Array<{ param: string; points: Ponto[] }> }> };
  const t = j.tracks.find((x) => x.name === faixa);
  const vol = t?.automation?.find((a) => /volume/i.test(a.param));
  return (vol?.points ?? []).map((p) => ({ at: p.at / j.sample_rate, value: p.value }));
}

/** O valor da curva num instante, com rampa reta entre os pontos (como o SoundCraft toca). */
export function valorNaCurva(curva: Ponto[], t: number): number {
  if (!curva.length) return 0;
  if (t <= curva[0].at) return curva[0].value;
  for (let i = 1; i < curva.length; i++) {
    const [a, b] = [curva[i - 1], curva[i]];
    if (t <= b.at) return b.at === a.at ? b.value : a.value + ((b.value - a.value) * (t - a.at)) / (b.at - a.at);
  }
  return curva[curva.length - 1].value;
}

/**
 * A trilha abaixa mesmo onde há fala? No meio de cada trecho de fala (de pelo
 * menos meio segundo), a curva tem que estar 8 dB abaixo do nível dos
 * respiros. Devolve o que não passou.
 */
export function trilhaAbaixaNaFala(curva: Ponto[], falas: Trecho[]): string[] {
  if (!curva.length) return falas.length ? ['a trilha não tem curva de volume; ela não abaixa na fala'] : [];
  const dentro = (t: number) => falas.some(([a, b]) => t >= a - 0.2 && t <= b + 0.45);
  const respiros = curva.filter((p) => !dentro(p.at)).map((p) => p.value).filter((v) => v > -59);
  const respiro = respiros.length ? Math.max(...respiros) : curva[0].value;
  const erros: string[] = [];
  for (const [a, b] of falas) {
    if (b - a < 0.5) continue;
    const meio = (a + b) / 2;
    const v = valorNaCurva(curva, meio);
    if (v > respiro - 8) erros.push(`a trilha não abaixa na fala de ${a.toFixed(1)} s a ${b.toFixed(1)} s (${v.toFixed(0)} dB; os respiros estão em ${respiro.toFixed(0)} dB)`);
  }
  return erros;
}

// ---------- o editável ----------

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

/**
 * Um zip sem compressão (o WAV quase não comprime) com tudo de `pasta` que a
 * sessão usa: o .scraft e "Audio Files". Abre com o Windows, sem programa.
 */
export function zipar(pasta: string, saida: string) {
  const arquivos: string[] = [];
  const andar = (rel: string) => {
    for (const nome of readdirSync(path.join(pasta, rel))) {
      const r = rel ? `${rel}/${nome}` : nome;
      if (statSync(path.join(pasta, r)).isDirectory()) andar(r);
      else if (r === 'som.scraft' || r.startsWith('Audio Files/')) arquivos.push(r);
    }
  };
  andar('');
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const r of arquivos.sort()) {
    // O SoundCraft guarda a cópia em 32 bits; a original, que já está em 16
    // bits ao lado da sessão, é o mesmo som com metade do tamanho.
    const original = path.join(pasta, path.basename(r));
    const dados = readFileSync(r.startsWith('Audio Files/') && existsSync(original) ? original : path.join(pasta, r));
    const nome = Buffer.from(r, 'utf8');
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nome.length, 28); central.writeUInt32LE(offset, 42);
    locais.push(local, nome, dados);
    centrais.push(central, nome);
    offset += local.length + nome.length + dados.length;
  }
  const tamCentral = centrais.reduce((s, b) => s + b.length, 0);
  const fimZip = Buffer.alloc(22);
  fimZip.writeUInt32LE(0x06054b50, 0); fimZip.writeUInt16LE(arquivos.length, 8); fimZip.writeUInt16LE(arquivos.length, 10);
  fimZip.writeUInt32LE(tamCentral, 12); fimZip.writeUInt32LE(offset, 16);
  writeFileSync(saida, Buffer.concat([...locais, ...centrais, fimZip]));
}

/**
 * O som desta rodada: a trilha baixada, a não ser que um ajuste tenha pedido
 * "sem música"; "música mais baixa" traz a música de volta, mais baixa. Vale
 * o último atalho de música, somando todos os ajustes até aqui.
 */
export function somDaRodada(trilha: string | null, ajustes: Array<{ atalhos: string[] }>): { trilha: string | null; nivel: NivelTrilha } {
  let ligada = true;
  let nivel: NivelTrilha = 'normal';
  for (const a of ajustes) for (const t of a.atalhos) {
    if (t === 'sem música') ligada = false;
    if (t === 'música mais baixa') { ligada = true; nivel = 'baixa'; }
  }
  return { trilha: ligada ? trilha : null, nivel };
}

/** A trilha que o pedido usa, já em entrada/ (o worker baixa antes): null quando é sem música. */
export function trilhaDaEntrada(pastaJob: string): string | null {
  const pasta = path.join(pastaJob, 'entrada');
  if (!existsSync(pasta)) return null;
  const arq = readdirSync(pasta).find((n) => /^trilha\./.test(n));
  return arq ? path.join(pasta, arq) : null;
}

/** Copia o que precisa ficar ao lado da sessão antes de importar: o editável não pode apontar pra entrada/. */
export function copiarPara(pasta: string, arquivo: string, nome: string): string {
  mkdirSync(pasta, { recursive: true });
  const destino = path.join(pasta, nome);
  copyFileSync(arquivo, destino);
  return destino;
}
