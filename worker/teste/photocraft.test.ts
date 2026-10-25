// Contra o PhotoCraft de verdade, sem modelo: as raízes de pasta seguram, os
// comandos que a skill manda o agente usar existem e funcionam, e produzir()
// aprova o que está certo e reprova o que não está.
//
// Pula sozinho se o photocraft-cli não estiver na máquina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fontesInstaladas, servidorMcp } from '../src/apps.ts';
import { RAIZ_REPO, type Config } from '../src/config.ts';
import { produzir } from '../src/worker.ts';
import { FalhaDoAgente, type Agente } from '../src/agente.ts';
import { carregarSkills } from '../src/skills.ts';
import { conferirSaida } from '../src/verificar.ts';
import { abrirMcp } from '../src/mcp-cru.ts';

let instaladas: string[] = [];
try {
  instaladas = fontesInstaladas();
} catch {
  /* sem PhotoCraft: os testes abaixo pulam */
}
const semApp = instaladas.length === 0 ? 'photocraft-cli não encontrado' : false;
const skill = carregarSkills(path.join(RAIZ_REPO, 'skills')).get('post-feed-teste')!;

/** Faz, pelo MCP, exatamente o que a SKILL.md manda o agente fazer. */
async function seguirASkill(pasta: string, o: { fundo: string; faixa: string; tinta: string; fonte: string; titulo: string; largura?: number }) {
  const mcp = await abrirMcp(servidorMcp('photocraft', pasta));
  const passo = async (nome: string, args: Record<string, unknown>) => {
    const r = await mcp.chamar(nome, args);
    assert.ok(!r.erro, `${nome} falhou: ${r.texto}`);
    return r.texto;
  };
  try {
    const m = 96;
    await passo('doc_new', { width: o.largura ?? 1080, height: 1350, background: o.fundo, name: 'post' });
    await passo('command_run', { id: 'select.rect', params: { x: m, y: 1180, width: 180, height: 16 } });
    await passo('command_run', { id: 'layer.newFillLayer.solidColor', params: { color: o.faixa } });
    await passo('command_run', { id: 'select.deselect', params: {} });
    await passo('command_run', {
      id: 'type.create',
      params: { text: o.titulo, box: [m, 420, 1080 - 2 * m, 600], font: o.fonte, size: 88, weight: 700, color: o.tinta, align: 'left' },
    });
    const doc = JSON.parse(await passo('doc_inspect', {}));
    await passo('doc_save', { path: 'editavel/post.psd' });
    await passo('doc_save', { path: 'saida/post.png' });
    return doc;
  } finally {
    mcp.fechar();
  }
}

function pastaDeJob() {
  const p = mkdtempSync(path.join(tmpdir(), 'job-'));
  for (const s of ['saida', 'editavel', 'entrada']) mkdirSync(path.join(p, s));
  return p;
}

test('a raiz de pasta segura: dentro grava, fora é recusado', { skip: semApp }, async () => {
  const pasta = pastaDeJob();
  const fora = mkdtempSync(path.join(tmpdir(), 'fora-'));
  const mcp = await abrirMcp(servidorMcp('photocraft', pasta));
  try {
    assert.ok(!(await mcp.chamar('doc_new', { width: 64, height: 64 })).erro);
    assert.ok(!(await mcp.chamar('doc_save', { path: 'saida/dentro.png' })).erro);
    assert.ok(existsSync(path.join(pasta, 'saida', 'dentro.png')));
    const r = await mcp.chamar('doc_save', { path: path.join(fora, 'vazou.png') });
    assert.ok(r.erro, 'gravou fora da pasta do job');
    assert.ok(!existsSync(path.join(fora, 'vazou.png')));
    assert.ok((await mcp.chamar('doc_save', { path: '../escapou.png' })).erro, 'aceitou ../');
  } finally {
    mcp.fechar();
  }
});

test('os comandos da skill de teste funcionam e o PSD sai em camadas', { skip: semApp }, async () => {
  const pasta = pastaDeJob();
  const doc = await seguirASkill(pasta, { fundo: '#6128C2', faixa: '#E53B93', tinta: '#FFFFFF', fonte: instaladas[0], titulo: 'Um título de teste que quebra em mais de uma linha' });
  const tipos = doc.layers.map((l: { kind: string }) => l.kind).sort();
  assert.ok(tipos.includes('Type'), `sem camada de texto: ${tipos}`);
  assert.equal(doc.layers.length, 3, 'fundo, faixa e texto');
  const texto = doc.layers.find((l: { kind: string }) => l.kind === 'Type');
  assert.equal(texto.text.font, instaladas[0]);
  const [x, y, w, h] = texto.bounds;
  assert.ok(x >= 96 && y >= 96 && x + w <= 1080 - 96 && y + h <= 1350 - 96, `título fora da margem: ${texto.bounds}`);
  for (const s of skill.saidas) conferirSaida(pasta, s);
});

const cfgTeste = (pastaJobs: string) => ({ pastaJobs, tetoUsd: 1 }) as Config;
const cliente = { nome: 'Glau Aguiar', nome_preferido: null, cor: '#6128C2', registro_profissional: null, marca: { fonteMarca: 'Fonte Que Não Existe', fonteFalback: 'display' } };
const pedido = { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'teste' }, publicar_em: null };
const custos = { tokens_entrada: 10, tokens_saida: 5, tokens_cache_leitura: 0, tokens_cache_escrita: 0, custo_usd: 0.01, render_segundos: 0.2 };

test('produzir aprova o que a skill prometeu e entrega a fonte já resolvida ao agente', { skip: semApp }, async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'jobs-'));
  let recebido = '';
  const agente: Agente = async (p) => {
    recebido = p.pedido;
    await seguirASkill(p.pastaJob, { fundo: '#6128C2', faixa: '#E53B93', tinta: '#FFFFFF', fonte: instaladas[0], titulo: 'ok' });
    return { custos, resumo: 'fiz', turnos: 3 };
  };
  const r = await produzir({
    cfg: cfgTeste(raiz), job: { id: 'job-ok' }, skill, pedido, cliente, instaladas, agente,
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {},
  });
  assert.equal(r.conferidas.length, 2);
  assert.ok(r.fonte.substituida);
  assert.ok(recebido.includes(`"${r.fonte.usada}"`), 'o agente não recebeu a fonte resolvida');
});

test('produzir reprova tamanho errado e guarda o custo da tentativa', { skip: semApp }, async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const agente: Agente = async (p) => {
    await seguirASkill(p.pastaJob, { fundo: '#6128C2', faixa: '#E53B93', tinta: '#FFFFFF', fonte: instaladas[0], titulo: 'x', largura: 1000 });
    return { custos, resumo: 'fiz', turnos: 3 };
  };
  await assert.rejects(
    produzir({
      cfg: cfgTeste(raiz), job: { id: 'job-torto' }, skill, pedido, cliente, instaladas, agente,
      abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {},
    }),
    (e: unknown) => e instanceof FalhaDoAgente && /1000×1350/.test(e.message) && e.custos.custo_usd === 0.01,
  );
});

test('o roteiro (sem Claude) faz o post da skill de teste com a marca de cada cliente', { skip: semApp }, async () => {
  const { rodarRoteiro, tituloDoTexto } = await import('../src/roteiro.ts');
  assert.equal(tituloDoTexto('Teste da fábrica: o laboratório tem turma nova'), 'Teste da fábrica');
  assert.equal(tituloDoTexto('um dois três quatro cinco seis sete oito nove dez.'), 'um dois três quatro cinco seis sete oito');

  const raiz = process.env.PASTA_PREVIAS ?? mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const clientes = {
    moacyr: { nome: 'Moacyr', nome_preferido: null, cor: '#E8A33D', registro_profissional: null, marca: {
      margem: 'folgada', alinha: 'esq', fonteMarca: '', fonteFalback: 'impacto', conjuntoPadrao: 'j-autoridade',
      conjuntos: [{ k: 'j-autoridade', nome: 'Autoridade', fundo: '#15181C', tinta: '#FFFFFF', destaque: '#E8A33D', faixa: '#E8A33D' }] } },
    beatriz: { nome: 'Ana Beatriz Leite', nome_preferido: null, cor: '#1E2A3A', registro_profissional: null, marca: {
      margem: 'folgada', alinha: 'esq', fonteMarca: 'Manrope', fonteFalback: 'display', conjuntoPadrao: 'j-noite',
      conjuntos: [{ k: 'j-noite', nome: 'Azul-noite', fundo: '#1E2A3A', tinta: '#FFFFFF', destaque: '#A4E830', faixa: '#A4E830' }] } },
  };
  for (const [id, cli] of Object.entries(clientes)) {
    const etapas: string[] = [];
    const r = await produzir({
      cfg: cfgTeste(raiz), job: { id: `roteiro-${id}` }, skill,
      pedido: { ...pedido, briefing: { texto: 'Turma nova no laboratório de redes: inscrições abertas até sexta' } },
      cliente: cli, instaladas, agente: rodarRoteiro,
      abortar: new AbortController(), aoMudarEtapa: async (e) => { etapas.push(e.etapa); }, aoUsarFerramenta: () => {},
    });
    assert.equal(r.conferidas.length, 2, id);
    assert.deepEqual(etapas, ['desenhando o post', 'escrevendo o título', 'conferindo o post'], id);
    assert.equal(r.resultado.custos.custo_usd, 0);
    assert.ok(r.resultado.custos.render_segundos > 0, 'tempo nos apps não foi medido');
  }
});

test('ajuste no roteiro: "outra cor" troca o conjunto e "mais curto" corta o título', { skip: semApp }, async () => {
  const { rodarRoteiro } = await import('../src/roteiro.ts');
  const raiz = process.env.PASTA_PREVIAS ?? mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const beatriz = { nome: 'Ana Beatriz Leite', nome_preferido: null, cor: '#1E2A3A', registro_profissional: null, marca: {
    margem: 'folgada', alinha: 'esq', fonteMarca: 'Manrope', fonteFalback: 'display', conjuntoPadrao: 'j-noite',
    conjuntos: [
      { k: 'j-noite', nome: 'Azul-noite', fundo: '#1E2A3A', tinta: '#FFFFFF', destaque: '#A4E830', faixa: '#A4E830' },
      { k: 'j-limao', nome: 'Verde-limão', fundo: '#A4E830', tinta: '#1E2A3A', destaque: '#1E2A3A', faixa: '#1E2A3A' },
    ] } };
  const r = await produzir({
    cfg: cfgTeste(raiz), job: { id: 'roteiro-ajuste' }, skill,
    pedido: { ...pedido, briefing: { texto: 'Não existe atalho pra liderar um time de produto' } },
    cliente: beatriz, instaladas, agente: rodarRoteiro,
    ajustes: [{ texto: null, atalhos: ['outra cor da marca', 'mais curto'] }],
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {},
  });
  assert.match(r.resultado.resumo, /Verde-limão/);
  assert.match(r.resultado.resumo, /título "Não existe atalho pra"/);
  const { execFileSync } = await import('node:child_process');
  const { acharCli } = await import('../src/config.ts');
  const info = JSON.parse(execFileSync(acharCli('photocraft'), ['info', path.join(r.pastaJob, 'editavel', 'post.psd'), '--compact'], { encoding: 'utf8' }));
  assert.equal(info.layers.find((l: { kind: string }) => l.kind === 'Type').text.text, 'Não existe atalho pra');
});
