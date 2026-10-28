// O Studio da Central do lado da fábrica:
//   - o PNG com transparência vai e volta igual, e a área da camada sai do alfa;
//   - a edição vira os comandos certos, e o que o Studio não deveria deixar é recusado;
//   - com o PhotoCraft de verdade: o post pelo roteiro sai em camadas, a edição
//     (arrastar o logo, trocar o título, esconder o @, a faixa em outra cor da
//     marca) é aplicada no PSD, passa na conferência e as camadas novas mostram
//     o que foi feito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fontesInstaladas } from '../src/apps.ts';
import { RAIZ_REPO, type Config } from '../src/config.ts';
import { areaDoAlfa, type Camadas } from '../src/camadas.ts';
import { agenteDeEdicao, comandosDaEdicao, type Edicao } from '../src/edicao.ts';
import { escreverPng, lerPngRgba } from '../src/png.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { produzir } from '../src/worker.ts';
import { BEATRIZ } from './marcas.ts';

let instaladas: string[] = [];
try { instaladas = fontesInstaladas(); } catch { /* sem PhotoCraft */ }
const semFontes = !instaladas.includes('Manrope') ? 'PhotoCraft ou Manrope fora da máquina' : false;
const CORES = ['#1E2A3A', '#FFFFFF', '#A4E830'];

const ORIGINAL: Camadas = {
  versao: 1, base: 'post', largura: 1080, altura: 1350, psd: 'editavel/post.psd', png: 'saida/post.png',
  camadas: [
    { id: 8, nome: 'logo', tipo: 'imagem', x: 844, y: 1193, largura: 140, altura: 63, visivel: true, opacidade: 1, arquivo: 'camadas/post/8.png' },
    { id: 6, nome: '@ana', tipo: 'texto', x: 98, y: 1232, largura: 236, altura: 30, visivel: true, opacidade: 1, arquivo: 'camadas/post/6.png',
      texto: { conteudo: '@ana', fonte: 'Manrope', peso: 500, tamanho: 30, cor: '#FFFFFF', alinhamento: 'left', caixa: null } },
    { id: 3, nome: 'faixa', tipo: 'forma', x: 96, y: 1134, largura: 140, altura: 14, visivel: true, opacidade: 1, arquivo: 'camadas/post/3.png', cor: '#A4E830' },
    { id: 2, nome: 'Background', tipo: 'fundo', x: 0, y: 0, largura: 1080, altura: 1350, visivel: true, opacidade: 1, arquivo: 'camadas/post/2.png', cor: '#1E2A3A' },
  ],
};

test('PNG com transparência: escreve, lê igual, e a área vem do alfa', () => {
  const rgba = new Uint8Array(6 * 4 * 4);
  for (const [x, y] of [[2, 1], [4, 2]]) rgba.set([10, 20, 30, 128], (y * 6 + x) * 4);
  const lido = lerPngRgba(escreverPng({ largura: 6, altura: 4, rgba }));
  assert.deepEqual([lido.largura, lido.altura], [6, 4]);
  assert.deepEqual([...lido.rgba], [...rgba]);
  assert.deepEqual(areaDoAlfa(lido), [2, 1, 3, 2]);
  assert.equal(areaDoAlfa({ largura: 2, altura: 2, rgba: new Uint8Array(16) }), null);
});

test('a edição vira comandos: texto e cor antes, depois posição, depois ordem', () => {
  const cmds = comandosDaEdicao(ORIGINAL, {
    base: 'post',
    camadas: [
      { id: 8, nome: 'logo', dx: -744, dy: -1093, escala: 2 },
      { id: 6, nome: '@ana', visivel: false, texto: '@ana' },
      { id: 3, nome: 'faixa', cor: '#ffffff' },
    ],
    ordem: [3, 8, 6],
  }, CORES);
  assert.deepEqual(cmds.map((c) => c.cmd), ['layer.setProps', 'layer.fill.solidColor.set', 'edit.transform', 'layer.moveTo', 'layer.moveTo']);
  assert.deepEqual(cmds[2].params, { layer: 8, rect: [844, 1193, 984, 1256], quad: [[100, 100], [380, 100], [380, 226], [100, 226]] });
  assert.deepEqual(cmds[3].params, { layer: 8, target: 3, position: 'below' });
  // Nada mudou de verdade: nenhum comando.
  assert.deepEqual(comandosDaEdicao(ORIGINAL, { base: 'post', camadas: [{ id: 6, nome: '@ana', texto: ' @ana ', cor: '#FFFFFF', visivel: true }], ordem: [8, 6, 3] }, CORES), []);
});

test('a edição recusa o que o Studio não deveria deixar', () => {
  const recusa = (camadas: Parameters<typeof comandosDaEdicao>[1]['camadas'], erro: RegExp, ordem?: number[]) =>
    assert.throws(() => comandosDaEdicao(ORIGINAL, { base: 'post', camadas, ordem }, CORES), erro);
  recusa([{ id: 3, nome: 'faixa', cor: '#FF0000' }], /não é uma cor da marca/);
  recusa([{ id: 8, nome: 'logo', texto: 'oi' }], /não é texto/);
  recusa([{ id: 6, nome: '@ana', texto: '   ' }], /ficou vazio/);
  recusa([{ id: 2, nome: 'Background', dx: 10 }], /fundo não sai do lugar/);
  recusa([{ id: 8, nome: 'outro nome' }], /não está mais nessa versão/);
  recusa([{ id: 8, nome: 'logo', escala: 40 }], /não cresce nem encolhe tanto/);
  recusa([{ id: 8, nome: 'logo', cor: '#FFFFFF' }], /não se troca pelo Studio/);
  recusa([], /ordem das camadas não bate/, [8, 6, 2]);
});

test('post pelo roteiro → camadas → edição do Studio → versão nova conferida, igual ao que a tela mostrou', { skip: semFontes, timeout: 120_000 }, async () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const raiz = mkdtempSync(path.join(tmpdir(), 'studio-'));
  const comum = {
    cfg: { pastaJobs: raiz, tetoUsd: 1 } as Config, skill: skills.get('post-feed')!, skills, cliente: BEATRIZ, instaladas,
    pedido: { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'Turma nova no laboratório de redes: inscrições abertas até sexta' }, publicar_em: null },
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {},
  };
  const v1 = await produzir({ ...comum, job: { id: 'v1' }, agente: rodarRoteiro });
  const lista = JSON.parse(readFileSync(path.join(v1.pastaJob, 'camadas', 'post', 'camadas.json'), 'utf8')) as Camadas;
  assert.ok(v1.conferidas.some((c) => c.papel === 'camada' && c.caminho === 'camadas/post/camadas.json'));
  const titulo = lista.camadas.find((c) => c.tipo === 'texto' && c.texto!.tamanho >= 60)!;
  const arroba = lista.camadas.find((c) => c.texto?.conteudo === '@ana_aprendeai')!;
  const logo = lista.camadas.find((c) => c.tipo === 'imagem');
  const faixa = lista.camadas.find((c) => c.tipo === 'forma')!;
  assert.ok(titulo && arroba && faixa, JSON.stringify(lista.camadas.map((c) => [c.nome, c.tipo])));
  assert.equal(lista.camadas.at(-1)!.tipo, 'fundo');

  // O que o Studio mandaria: título novo, @ escondido, faixa branca andando 300 px, e o logo (se houver) no alto.
  const edicao: Edicao = { imagens: [{ base: 'post', camadas: [
    { id: titulo.id, nome: titulo.nome, texto: 'Turma nova, vagas abertas' },
    { id: arroba.id, nome: arroba.nome, visivel: false },
    { id: faixa.id, nome: faixa.nome, cor: '#FFFFFF', dx: 300 },
    ...(logo ? [{ id: logo.id, nome: logo.nome, dx: 100 - logo.x, dy: 100 - logo.y }] : []),
  ] }] };
  // A pasta de entrada como o worker monta: a versão inteira em entrada/base/ e a edição.
  const arquivos = v1.conferidas.filter((c) => c.papel !== 'camada' || c.caminho.endsWith('camadas.json'))
    .map((c) => ({ nome: `base/${c.caminho}`, conteudo: readFileSync(path.join(v1.pastaJob, c.caminho)) }));
  arquivos.push({ nome: 'edicao.json', conteudo: Buffer.from(JSON.stringify(edicao)) });
  const v2 = await produzir({ ...comum, job: { id: 'v2' }, agente: agenteDeEdicao, arquivos, semPreparo: true });

  const nova = JSON.parse(readFileSync(path.join(v2.pastaJob, 'camadas', 'post', 'camadas.json'), 'utf8')) as Camadas;
  const achar = (nome: string) => nova.camadas.find((c) => c.nome === nome || c.texto?.conteudo === nome);
  assert.ok(achar('Turma nova, vagas abertas'), nova.camadas.map((c) => c.texto?.conteudo ?? c.nome).join(' | '));
  assert.equal(achar('@ana_aprendeai')!.visivel, false);
  const faixaNova = nova.camadas.find((c) => c.tipo === 'forma')!;
  assert.equal(faixaNova.cor, '#FFFFFF');
  assert.equal(faixaNova.x, faixa.x + 300);
  if (logo) assert.deepEqual([nova.camadas.find((c) => c.tipo === 'imagem')!.x, nova.camadas.find((c) => c.tipo === 'imagem')!.y], [100, 100]);
  // O PNG entregue é o PSD editado: o pixel no meio da faixa nova é branco.
  const png = lerPngRgba(readFileSync(path.join(v2.pastaJob, 'saida', 'post.png')));
  const i = ((faixaNova.y + Math.floor(faixaNova.altura / 2)) * png.largura + faixaNova.x + Math.floor(faixaNova.largura / 2)) * 4;
  assert.deepEqual([...png.rgba.subarray(i, i + 3)], [255, 255, 255]);
  // A legenda veio da versão de antes, igual.
  assert.equal(readFileSync(path.join(v2.pastaJob, 'saida', 'legenda.txt'), 'utf8'), readFileSync(path.join(v1.pastaJob, 'saida', 'legenda.txt'), 'utf8'));
});
