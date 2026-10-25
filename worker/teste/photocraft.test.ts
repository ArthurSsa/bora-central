// Contra o PhotoCraft de verdade, sem modelo:
//   - as raízes de pasta seguram;
//   - cada skill, pelo roteiro (os mesmos comandos do SKILL.md), sai aprovada
//     na conferência de marca com as marcas da Beatriz e do Moacyr;
//   - a conferência reprova o que um designer reprovaria.
//
// Pula sozinho se o photocraft-cli não estiver na máquina. PASTA_PREVIAS=<pasta>
// guarda as peças pra olhar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fontesInstaladas, servidorMcp } from '../src/apps.ts';
import { RAIZ_REPO, acharCli, type Config } from '../src/config.ts';
import { produzir } from '../src/worker.ts';
import { FalhaDoAgente, type Agente } from '../src/agente.ts';
import { conferirMarca } from '../src/conferencia.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { coresDaMarca, type ClienteParaMarca } from '../src/marca.ts';
import { abrirMcp } from '../src/mcp-cru.ts';
import { BEATRIZ, MOACYR } from './marcas.ts';

let instaladas: string[] = [];
try {
  instaladas = fontesInstaladas();
} catch {
  /* sem PhotoCraft: os testes abaixo pulam */
}
const semApp = instaladas.length === 0 ? 'photocraft-cli não encontrado' : false;
const semFontes = semApp || (!instaladas.includes('Manrope') || !instaladas.includes('Anton') ? 'Manrope/Anton não instaladas (npm run fontes)' : false);
const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
const previas = process.env.PASTA_PREVIAS;
const cfgTeste = (pastaJobs: string) => ({ pastaJobs, tetoUsd: 1 }) as Config;
const pedidoDe = (tipo: string, briefing: Record<string, unknown>) => ({ id: 'p', tipo, titulo: null, briefing, publicar_em: null });
const nada = { abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {} };

test('a raiz de pasta segura: dentro grava, fora é recusado', { skip: semApp }, async () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'job-'));
  mkdirSync(path.join(pasta, 'saida'));
  const fora = mkdtempSync(path.join(tmpdir(), 'fora-'));
  const mcp = await abrirMcp(servidorMcp('photocraft', pasta));
  try {
    assert.ok(!(await mcp.chamar('doc_new', { width: 64, height: 64 })).erro);
    assert.ok(!(await mcp.chamar('doc_save', { path: 'saida/dentro.png' })).erro);
    assert.ok(existsSync(path.join(pasta, 'saida', 'dentro.png')));
    assert.ok((await mcp.chamar('doc_save', { path: path.join(fora, 'vazou.png') })).erro, 'gravou fora da pasta do job');
    assert.ok(!existsSync(path.join(fora, 'vazou.png')));
    assert.ok((await mcp.chamar('doc_save', { path: '../escapou.png' })).erro, 'aceitou ../');
  } finally {
    mcp.fechar();
  }
});

const PEDIDOS: Array<[string, string, Record<string, unknown>]> = [
  ['post-feed', 'post-feed', { texto: 'Turma nova no laboratório de redes: inscrições abertas até sexta' }],
  ['carrossel', 'carrossel', { texto: 'Não existe atalho pra liderar um time. Liderança se aprende fazendo. Organização vem antes de talento. Feedback toda semana', slides: 4 }],
  ['capa-thumbnail', 'capa', { texto: 'Como montei um time de produto sem saber programar' }],
];

for (const [quem, cliente] of [['beatriz', BEATRIZ], ['moacyr', MOACYR]] as Array<[string, ClienteParaMarca]>) {
  for (const [nomeSkill, tipo, briefing] of PEDIDOS) {
    test(`${quem}: ${nomeSkill} pelo roteiro passa na conferência de marca`, { skip: semFontes }, async () => {
      const raiz = previas ?? mkdtempSync(path.join(tmpdir(), 'jobs-'));
      const etapas: number[] = [];
      const r = await produzir({
        cfg: cfgTeste(raiz), job: { id: `${quem}-${nomeSkill}` }, skill: skills.get(nomeSkill)!, skills,
        pedido: pedidoDe(tipo, briefing), cliente, instaladas, agente: rodarRoteiro,
        ...nada, aoMudarEtapa: async (e) => { etapas.push(e.progresso); },
      });
      assert.equal(r.fonte.substituida, false, `fonte substituída: ${r.fonte.usada}`);
      const esperadas = { 'post-feed': 3, carrossel: 4 * 2 + 1, 'capa-thumbnail': 8 }[nomeSkill];
      assert.equal(r.conferidas.length, esperadas);
      for (let i = 1; i < etapas.length; i++) assert.ok(etapas[i] >= etapas[i - 1], `progresso voltou: ${etapas.join(' → ')}`);
    });
  }
}

test('ajuste no roteiro: "outra cor" troca o conjunto e "mais curto" corta o título', { skip: semFontes }, async () => {
  const raiz = previas ?? mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const r = await produzir({
    cfg: cfgTeste(raiz), job: { id: 'beatriz-ajuste' }, skill: skills.get('post-feed')!, skills,
    pedido: pedidoDe('post-feed', { texto: 'Não existe atalho pra liderar um time de produto' }),
    cliente: BEATRIZ, instaladas, agente: rodarRoteiro, ...nada,
    ajustes: [{ texto: null, atalhos: ['outra cor da marca', 'mais curto'] }],
  });
  assert.match(r.resultado.resumo, /Verde-limão/);
  const info = JSON.parse(execFileSync(acharCli('photocraft'), ['info', path.join(r.pastaJob, 'editavel', 'post.psd'), '--compact'], { encoding: 'utf8' }));
  const textos = info.layers.filter((l: { kind: string }) => l.kind === 'Type').map((l: { text: { text: string } }) => l.text.text);
  assert.ok(textos.includes('Não existe atalho pra'), textos.join(' | '));
});

test('produzir reprova tamanho errado e guarda o custo da tentativa', { skip: semApp }, async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const custos = { tokens_entrada: 10, tokens_saida: 5, tokens_cache_leitura: 0, tokens_cache_escrita: 0, custo_usd: 0.01, render_segundos: 0.2 };
  const agente: Agente = async (p) => {
    const mcp = await abrirMcp(servidorMcp('photocraft', p.pastaJob));
    await mcp.chamar('doc_new', { width: 1000, height: 1350, background: p.dados.conjunto.fundo });
    await mcp.chamar('doc_save', { path: 'editavel/post.psd' });
    await mcp.chamar('doc_save', { path: 'saida/post.png' });
    mcp.fechar();
    return { custos, resumo: 'fiz', turnos: 3 };
  };
  await assert.rejects(
    produzir({ cfg: cfgTeste(raiz), job: { id: 'torto' }, skill: skills.get('post-feed-teste')!, pedido: pedidoDe('post-feed', { texto: 'x' }), cliente: BEATRIZ, instaladas, agente, ...nada }),
    (e: unknown) => e instanceof FalhaDoAgente && /1000×1350/.test(e.message) && e.custos.custo_usd === 0.01,
  );
});

// ---------- a conferência reprova o que um designer reprovaria ----------

/** Monta uma peça direto no CLI, sem MCP: fundo, um texto, PSD e PNG. */
function peca(pasta: string, nome: string, fundo: string, texto: Record<string, unknown>) {
  mkdirSync(path.join(pasta, 'editavel'), { recursive: true });
  mkdirSync(path.join(pasta, 'saida'), { recursive: true });
  const cli = acharCli('photocraft');
  execFileSync(cli, ['run', '--new', JSON.stringify({ width: 1080, height: 1350, background: fundo }),
    '--cmd', 'type.create', '--params', JSON.stringify({ text: 'Não existe atalho', box: [96, 400, 888, 400], size: 88, ...texto }),
    '--out', path.join(pasta, 'editavel', `${nome}.psd`)]);
  execFileSync(cli, ['convert', path.join(pasta, 'editavel', `${nome}.psd`), path.join(pasta, 'saida', `${nome}.png`)]);
  return { caminho: `saida/${nome}.png`, papel: 'saida' as const, mime: 'image/png', bytes: 1 };
}

const regraBeatriz = () => ({ cores: coresDaMarca(BEATRIZ), fontes: ['Manrope'] });

test('conferência: a peça certa passa', { skip: semFontes }, () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'conf-'));
  const s = peca(pasta, 'certa', '#1E2A3A', { font: 'Manrope', weight: 700, color: '#FFFFFF' });
  assert.deepEqual(conferirMarca(pasta, [s], regraBeatriz()).erros, []);
});

for (const [caso, fundo, texto, esperado] of [
  ['fonte que não é da marca', '#1E2A3A', { font: 'Arial', weight: 700, color: '#FFFFFF' }, /"Arial"; a fonte da marca é "Manrope"/],
  ['fundo fora da paleta', '#D62828', { font: 'Manrope', weight: 700, color: '#FFFFFF' }, /#D62828 ocupa .* não é da paleta/],
  ['texto fora da paleta', '#1E2A3A', { font: 'Manrope', weight: 700, color: '#FF00FF' }, /texto na cor #FF00FF/],
  ['peso fino demais', '#1E2A3A', { font: 'Manrope', weight: 200, color: '#FFFFFF' }, /peso 200/],
  ['verde-limão sobre branco', '#FFFFFF', { font: 'Manrope', weight: 700, color: '#A4E830' }, /1\.5:1; precisa de 3:1/],
  ['texto na borda', '#1E2A3A', { font: 'Manrope', weight: 700, color: '#FFFFFF', box: [10, 400, 1060, 400] }, /encostado na borda/],
] as Array<[string, string, Record<string, unknown>, RegExp]>) {
  test(`conferência reprova: ${caso}`, { skip: semFontes }, () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'conf-'));
    const s = peca(pasta, 'p', fundo, texto);
    const { erros } = conferirMarca(pasta, [s], regraBeatriz());
    assert.ok(erros.some((e) => esperado.test(e)), `esperava ${esperado}, veio: ${erros.join(' | ') || '(nada)'}`);
  });
}

test('conferência aceita o degradê entre duas cores da marca, e só ele', { skip: semFontes }, () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'conf-'));
  mkdirSync(path.join(pasta, 'editavel')); mkdirSync(path.join(pasta, 'saida'));
  const cli = acharCli('photocraft');
  const fazer = (nome: string, to: string) => {
    execFileSync(cli, ['run', '--new', JSON.stringify({ width: 1280, height: 720, background: '#1E2A3A' }),
      '--cmd', 'select.rect', '--params', JSON.stringify({ x: 640, y: 0, width: 640, height: 720 }),
      '--cmd', 'layer.newFillLayer.gradient', '--params', JSON.stringify({ from: '#1E2A3A', to, angle: 0 }),
      '--cmd', 'select.deselect', '--out', path.join(pasta, 'editavel', `${nome}.psd`)]);
    execFileSync(cli, ['convert', path.join(pasta, 'editavel', `${nome}.psd`), path.join(pasta, 'saida', `${nome}.png`)]);
    return { caminho: `saida/${nome}.png`, papel: 'saida' as const, mime: 'image/png', bytes: 1 };
  };
  assert.deepEqual(conferirMarca(pasta, [fazer('da-marca', '#A4E830')], regraBeatriz()).erros, []);
  assert.ok(conferirMarca(pasta, [fazer('fora', '#D62828')], regraBeatriz()).erros.length > 0, 'degradê pra cor de fora passou');
});

if (previas) {
  test('prévias guardadas', () => {
    console.log(`prévias em ${previas}: ${readdirSync(previas).join(', ')}`);
  });
}
