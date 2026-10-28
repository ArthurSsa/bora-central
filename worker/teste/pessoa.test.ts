// A pessoa no post:
//   - o rosto certo (o da pessoa, não o tatuado no braço), os retângulos presos
//     na foto, o recorte julgado, e o encaixe que esconde o corte do recorte;
//   - com o PhotoCraft e as fotos de teste (teste/fotos/, fora do git — sem
//     elas, pula): o post pelo roteiro com a pessoa passa na conferência; a
//     foto com a cabeça cortada é recusada antes de gastar nada; e texto por
//     cima do rosto é reprovado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fontesInstaladas } from '../src/apps.ts';
import { acharCli, RAIZ_REPO, RAIZ_WORKER, type Config } from '../src/config.ts';
import { conferirPessoa, encaixeDaFoto, encaixeDoRecorte, escolherRosto, julgarRecorte, POST, retangulosDaPessoa, type AnaliseDaPessoa } from '../src/pessoa.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { produzir } from '../src/worker.ts';
import { BEATRIZ } from './marcas.ts';

const FOTOS = path.join(RAIZ_WORKER, 'teste', 'fotos');
const INTEIRA = path.join(FOTOS, 'pexels-33650386.jpg');
const CORTADA = path.join(FOTOS, 'pexels-33650403.jpg');
let instaladas: string[] = [];
try { instaladas = fontesInstaladas(); } catch { /* sem PhotoCraft */ }
const semFoto = !instaladas.includes('Manrope') ? 'PhotoCraft ou Manrope fora da máquina' : !existsSync(INTEIRA) || !existsSync(CORTADA) ? 'sem as fotos de teste em teste/fotos/' : false;

const ANALISE: AnaliseDaPessoa = {
  foto: 'entrada/pessoa/foto.png', largura: 1600, altura: 2400, cabecaCortada: false,
  rosto: { rect: [916, 733, 238, 272], score: 0.9, olhos: [[943, 842], [1027, 829]] },
  recorte: { arquivo: 'entrada/pessoa/recorte.png', area: [756, 615, 598, 1168], cobreRosto: 0.96, cobreTopo: 1, ok: true, motivo: null },
};

test('o rosto é o da pessoa: o tatuado no braço, menor e com nota baixa, fica de fora', () => {
  const r = escolherRosto([
    { score: 0.57, rect: [1153, 1337, 150, 206] },
    { score: 0.89, rect: [913, 709, 245, 295], landmarks: { rightEye: [937, 830], leftEye: [1022, 815] } },
  ]);
  assert.deepEqual(r?.rect, [913, 709, 245, 295]);
  assert.equal(r?.olhos.length, 2);
  assert.equal(escolherRosto([{ score: 0.4, rect: [0, 0, 10, 10] }]), null);
});

test('os retângulos do corpo e da cabeça saem do rosto e ficam dentro da foto', () => {
  const { corpo, cabeca } = retangulosDaPessoa([913, 709, 245, 295], 1600, 2400);
  for (const [x, y, w, h] of [corpo, cabeca]) assert.ok(x >= 0 && y >= 0 && x + w <= 1600 && y + h <= 2400);
  assert.equal(corpo[1] + corpo[3], 2400, 'o corpo vai até embaixo');
  assert.ok(cabeca[1] < 709 - 200, 'a cabeça sobe acima da testa (boné, cabelo)');
});

test('o recorte só vale com o rosto e o alto da cabeça dentro, e sem a cena inteira', () => {
  assert.equal(julgarRecorte({ cobreRosto: 0.96, cobreTopo: 1, fracaoDaFoto: 0.2 }), null);
  assert.match(julgarRecorte({ cobreRosto: 0.7, cobreTopo: 1, fracaoDaFoto: 0.2 })!, /70% do rosto/);
  assert.match(julgarRecorte({ cobreRosto: 0.95, cobreTopo: 0.1, fracaoDaFoto: 0.2 })!, /alto da cabeça/);
  assert.match(julgarRecorte({ cobreRosto: 0.95, cobreTopo: 1, fracaoDaFoto: 0.9 })!, /cena inteira/);
});

test('encaixe do recorte: rosto grande na altura combinada, e a borda de baixo do recorte nunca aparece', () => {
  const e = encaixeDoRecorte(ANALISE);
  assert.equal(e.rosto[1], 440);
  assert.ok(Math.abs(e.rosto[3] - POST.altura * 0.22) < 2, `rosto com ${e.rosto[3]} px`);
  const [, ay, , ah] = ANALISE.recorte.area;
  const fundoNoPost = 440 + (ay + ah - ANALISE.rosto.rect[1]) * e.escala;
  assert.ok(fundoNoPost >= POST.altura, `o recorte acaba em ${fundoNoPost}, dentro do post`);
  // Recorte que encosta na borda direita da foto vai pra borda direita do post.
  const naBorda = encaixeDoRecorte({ ...ANALISE, recorte: { ...ANALISE.recorte, area: [900, 615, 700, 1168] } });
  assert.equal(Math.round(naBorda.esquerda + 700 * naBorda.escala), POST.largura);
});

test('encaixe da foto: cobre o post inteiro, e o texto vai pro lado oposto ao rosto', () => {
  const e = encaixeDaFoto(ANALISE);
  const [cx, cy] = e.centro;
  assert.ok(cx - (1600 * e.escala) / 2 <= 0 && cx + (1600 * e.escala) / 2 >= POST.largura);
  assert.ok(cy - (2400 * e.escala) / 2 <= 0 && cy + (2400 * e.escala) / 2 >= POST.altura);
  assert.equal(e.textoEmBaixo, true);
});

const pedido = { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'A fornada sai às 7h: venha buscar o pão quente' }, publicar_em: null };
const fazer = (raiz: string, id: string, foto: string, briefing: Record<string, unknown> = pedido.briefing) => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  return produzir({
    cfg: { pastaJobs: raiz, tetoUsd: 1 } as Config, job: { id }, skill: skills.get('post-feed')!, skills,
    pedido: { ...pedido, briefing }, cliente: BEATRIZ, instaladas, agente: rodarRoteiro,
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {},
    arquivos: [{ nome: 'pessoa/origem.jpg', conteudo: readFileSync(foto) }],
  });
};

test('post com a pessoa pelo roteiro: recorte por padrão, foto inteira quando pedido, os dois passam na conferência', { skip: semFoto, timeout: 180_000 }, async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'pessoa-'));
  for (const jeito of ['auto', 'foto'] as const) {
    const r = await fazer(raiz, `pessoa-${jeito}`, INTEIRA, { ...pedido.briefing, jeito });
    const psd = JSON.parse(execFileSync(acharCli('photocraft'), ['info', path.join(r.pastaJob, 'editavel', 'post.psd'), '--compact'], { encoding: 'utf8' }));
    const nomes = psd.layers.map((l: { name: string }) => l.name);
    assert.ok(nomes.includes(jeito === 'auto' ? 'pessoa' : 'foto'), nomes.join(' | '));
    // O rosto na peça entregue: achado de novo, inteiro e sem texto por cima.
    const c = conferirPessoa(r.pastaJob);
    assert.deepEqual(c.erros, []);
    assert.ok(c.rosto![3] > 150, `rosto pequeno: ${c.rosto}`);
    // A pessoa vira camada que o Studio move.
    const camadas = JSON.parse(readFileSync(path.join(r.pastaJob, 'camadas', 'post', 'camadas.json'), 'utf8'));
    assert.ok(camadas.camadas.some((x: { nome: string; tipo: string }) => x.nome === (jeito === 'auto' ? 'pessoa' : 'foto') && x.tipo === 'imagem'));
  }
});

test('foto com a cabeça cortada é recusada antes do agente, com o motivo pro cliente', { skip: semFoto, timeout: 120_000 }, async () => {
  await assert.rejects(fazer(mkdtempSync(path.join(tmpdir(), 'pessoa-')), 'cortada', CORTADA), /cabeça cortada/);
});

test('texto por cima do rosto é reprovado na conferência', { skip: semFoto, timeout: 120_000 }, async () => {
  const r = await fazer(mkdtempSync(path.join(tmpdir(), 'pessoa-')), 'por-cima', INTEIRA);
  const rosto = conferirPessoa(r.pastaJob).rosto!;
  const psd = path.join(r.pastaJob, 'editavel', 'post.psd');
  execFileSync(acharCli('photocraft'), ['run', psd, '--cmd', 'type.create', '--params',
    JSON.stringify({ text: 'Texto em cima', x: rosto[0], y: rosto[1] + rosto[3] / 2, font: 'Manrope', size: 60, color: '#FFFFFF' }),
    '--cmd', 'file.saveACopy', '--params', JSON.stringify({ path: path.join(r.pastaJob, 'saida', 'post.png') }), '--out', psd]);
  assert.match(conferirPessoa(r.pastaJob).erros.join(' | '), /"Texto em cima" cobre o rosto/);
});
