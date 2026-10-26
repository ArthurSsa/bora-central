// O critério de pronto do passo 2, rodado de verdade: um cliente, num celular
// de 390 px, pede um post, acompanha, pede ajuste, vê a versão nova e aprova —
// contra o banco de produção, a fábrica no modo roteiro e o PhotoCraft.
//
//   npm run e2e
//
// O cliente é de mentira e mora numa conta só dele ("Teste da fábrica"), então
// o teste também prova o isolamento: ele não enxerga nenhum cliente da Bora.
// Usa o Edge ou o Chrome que já estão na máquina; não baixa navegador.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RAIZ_REPO, RAIZ_WORKER } from '../src/config.ts';
import { montarBrutoDeTeste, temTudoProReel } from '../teste/bruto.ts';
import { acharCli, type Config } from '../src/config.ts';
import { fontesInstaladas } from '../src/apps.ts';
import type { ClienteParaMarca } from '../src/marca.ts';
import { lerPng } from '../src/png.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { produzir } from '../src/worker.ts';

const temEffectCraft = existsSync(acharCli('effectcraft'));

const URL_SB = 'https://yxewmauwnxnrrhevlbtc.supabase.co';
const CHAVE_PUBLICA = 'sb_publishable_G_FuzadzmX2BwkRO81H3mw_xoYnthod';
const CONTA = 'b0a00000-0000-4000-8000-00000000e2e0';
const CLIENTE = 'b0a00000-0000-4000-8000-00000000e2e1';
const EMAIL = 'cliente-teste@fabrica-bora.test';
const EMAIL_EQUIPE = 'equipe-teste@fabrica-bora.test';

const admin: SupabaseClient = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } });
let navegador: Browser;
let servidor: Server;
let worker: ChildProcess;
let origem = '';
let sessao: object;
let comoCliente: SupabaseClient;

const NAVEGADORES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
];

async function prepararCliente() {
  const ok = <T>(r: { data: T; error: { message: string } | null } | { data: unknown; error: { message: string } }, onde: string): T => {
    if (r.error) throw new Error(`${onde}: ${r.error.message}`);
    return r.data as T;
  };
  ok(await admin.from('contas').upsert({ id: CONTA, nome: 'Teste da fábrica (e2e)' }), 'conta');
  ok(await admin.from('clientes').upsert({
    id: CLIENTE, conta_id: CONTA, nome: 'Cliente de Teste', nome_preferido: 'Cliente de Teste', estagio: 'encerrado', tipo_cliente: 'solo',
    cor: '#1E2A3A', valor_mensal: 123, observacoes: 'NÃO PODE APARECER PRO CLIENTE',
    marca: {
      margem: 'folgada', alinha: 'esq', fonteMarca: 'Manrope', fonteFalback: 'display', conjuntoPadrao: 'j-noite',
      conjuntos: [
        { k: 'j-noite', nome: 'Azul-noite', fundo: '#1E2A3A', tinta: '#FFFFFF', destaque: '#A4E830', faixa: '#A4E830' },
        { k: 'j-limao', nome: 'Verde-limão', fundo: '#A4E830', tinta: '#1E2A3A', destaque: '#1E2A3A', faixa: '#1E2A3A' },
      ],
      paleta: [{ nome: 'Azul-noite', cor: '#1E2A3A', uso: 'Principal' }, { nome: 'Verde-limão', cor: '#A4E830', uso: 'Destaque' }],
      tom: 'Direto e prático.', evitar: 'Emoji.',
    },
  }), 'cliente');

  // Limpa as rodadas anteriores do teste: pedidos (com jobs e eventos, em cascata) e arquivos.
  const { data: arquivos } = await admin.storage.from('pedidos').list(`${CONTA}/${CLIENTE}`, { limit: 1000 });
  for (const pasta of arquivos ?? []) {
    const fundo = await listarTudo(`${CONTA}/${CLIENTE}/${pasta.name}`);
    if (fundo.length) await admin.storage.from('pedidos').remove(fundo);
  }
  ok(await admin.from('pedidos').delete().eq('cliente_id', CLIENTE), 'limpar pedidos');
  await limparAgenda();
  await limparElementos();

  // Um plano do mês de mentira, no mês corrente: é dele que saem as sugestões.
  ok(await admin.from('planos').upsert(
    { cliente_id: CLIENTE, mes: hojeIso().slice(0, 8) + '01', pauta: 'Bastidor do laboratório numa sexta\nO erro mais comum de quem começa\nTurma nova: inscrições abertas', diagnostico: {} },
    { onConflict: 'cliente_id,mes' },
  ), 'plano do mês');

  // Senha nova a cada rodada, que só existe na memória deste processo.
  const senha = randomBytes(24).toString('base64url');
  const lista = ok(await admin.auth.admin.listUsers({ perPage: 1000 }), 'listar usuários') as { users: Array<{ id: string; email?: string }> };
  let uid = lista.users.find((u) => u.email === EMAIL)?.id;
  if (uid) ok(await admin.auth.admin.updateUserById(uid, { password: senha }), 'trocar senha');
  else uid = (ok(await admin.auth.admin.createUser({ email: EMAIL, password: senha, email_confirm: true }), 'criar usuário') as { user: { id: string } }).user.id;
  ok(await admin.from('conta_membros').upsert({ conta_id: CONTA, user_id: uid, papel: 'cliente', cliente_id: CLIENTE }), 'membro');

  comoCliente = createClient(URL_SB, CHAVE_PUBLICA, { auth: { persistSession: false } });
  const { data, error } = await comoCliente.auth.signInWithPassword({ email: EMAIL, password: senha });
  if (error) throw error;
  sessao = data.session!;
}

/**
 * Alguém da equipe, de mentira: entra na Central e vê a Fábrica. Senha nova a
 * cada rodada, só na memória; o acesso de equipe sai no fim do teste.
 */
let sessaoEquipe: object;
let uidEquipe: string | null = null;
async function prepararEquipe() {
  const senha = randomBytes(24).toString('base64url');
  const lista = await admin.auth.admin.listUsers({ perPage: 1000 });
  let uid = lista.data.users.find((u) => u.email === EMAIL_EQUIPE)?.id;
  if (uid) await admin.auth.admin.updateUserById(uid, { password: senha });
  else uid = (await admin.auth.admin.createUser({ email: EMAIL_EQUIPE, password: senha, email_confirm: true })).data.user!.id;
  uidEquipe = uid;
  const { error } = await admin.from('profiles').upsert({ id: uid, is_agency: true });
  if (error) throw new Error(`perfil da equipe: ${error.message}`);
  const c = createClient(URL_SB, CHAVE_PUBLICA, { auth: { persistSession: false } });
  const { data, error: e } = await c.auth.signInWithPassword({ email: EMAIL_EQUIPE, password: senha });
  if (e) throw e;
  sessaoEquipe = data.session!;
}

async function listarTudo(prefixo: string): Promise<string[]> {
  const { data } = await admin.storage.from('pedidos').list(prefixo, { limit: 1000 });
  const saida: string[] = [];
  for (const o of data ?? []) {
    if (o.id) saida.push(`${prefixo}/${o.name}`);
    else saida.push(...(await listarTudo(`${prefixo}/${o.name}`)));
  }
  return saida;
}

before(async () => {
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, 'falta SUPABASE_SERVICE_ROLE_KEY no worker/.env');
  // A fábrica do PC disputaria os pedidos com o worker deste teste.
  const pidVigia = path.join(process.env.LOCALAPPDATA ?? '', 'BoraFabrica', 'vigia.pid');
  if (existsSync(pidVigia)) {
    const pid = Number(readFileSync(pidVigia, 'utf8'));
    let viva = false;
    try { process.kill(pid, 0); viva = true; } catch { /* não está rodando */ }
    assert.ok(!viva, 'a fábrica deste PC está ligada; desligue antes (npm run fabrica:desligar) e ligue depois (npm run fabrica:ligar)');
  }
  await prepararCliente();

  await prepararEquipe();
  // O app do cliente na raiz e a Central da equipe em /central/, no mesmo servidor.
  const html = readFileSync(path.join(RAIZ_REPO, 'sites', 'app', 'index.html'));
  const central = readFileSync(path.join(RAIZ_REPO, 'sites', 'central', 'index.html'));
  servidor = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end((req.url ?? '').startsWith('/central') ? central : html);
  });
  // Porta fixa 3000: é um endereço que o Supabase aceita como destino do link
  // de acesso, e o teste do link do e-mail precisa voltar pra cá. Ocupada,
  // usa qualquer uma e esse teste pula.
  await new Promise<void>((ok) => {
    servidor.once('error', () => servidor.listen(0, '127.0.0.1', ok));
    servidor.listen(3000, '127.0.0.1', ok);
  });
  origem = `http://localhost:${(servidor.address() as { port: number }).port}`;

  worker = spawn(process.execPath, ['--env-file=.env', 'src/worker.ts', '--roteiro'], {
    cwd: RAIZ_WORKER, env: { ...process.env, WORKER_ID: 'e2e-app-cliente', ESPERA_FILA_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout!.on('data', (d) => process.env.E2E_VERBOSO && process.stdout.write(`[worker] ${d}`));
  worker.stderr!.on('data', (d) => process.stderr.write(`[worker] ${d}`));

  const exe = NAVEGADORES.find(existsSync);
  assert.ok(exe, 'nenhum Edge/Chrome/Chromium encontrado');
  navegador = await chromium.launch({ executablePath: exe, headless: true });
});

/**
 * As tarefas de publicação do cliente de teste vivem na agenda de verdade da
 * Central. Saem no começo e no fim de cada rodada — a Bora não pode abrir a
 * agenda de segunda e achar "Publicar: Bastidor do laboratório".
 */
async function limparAgenda() {
  const { error } = await admin.from('tarefas').delete().eq('cliente_id', CLIENTE);
  if (error) throw new Error(`limpar agenda: ${error.message}`);
}

/** O logo de mentira da etapa B: sai no começo e no fim, pra não entrar nas peças dos outros testes. */
async function limparElementos() {
  const { data } = await admin.storage.from('elementos').list(CLIENTE, { limit: 1000 });
  if (data?.length) await admin.storage.from('elementos').remove(data.map((o) => `${CLIENTE}/${o.name}`));
  const { error } = await admin.from('marca_elementos').delete().eq('cliente_id', CLIENTE);
  if (error) throw new Error(`limpar elementos: ${error.message}`);
}

/** Hoje + n dias, no fuso desta máquina (o mesmo do app). */
function hojeIso(mais = 0) {
  const d = new Date();
  d.setDate(d.getDate() + mais);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

after(async () => {
  await limparAgenda().catch((e) => console.error(e.message));
  await limparElementos().catch((e) => console.error(e.message));
  // A conta de equipe de teste só é da equipe enquanto o teste roda.
  if (uidEquipe) await admin.from('profiles').update({ is_agency: false }).eq('id', uidEquipe);
  await navegador?.close();
  worker?.kill();
  servidor?.close();
});

async function abrir(tema: 'light' | 'dark' = 'light'): Promise<Page> {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: tema });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origem });
  // A sessão entra no localStorage antes do app carregar — o mesmo lugar onde
  // o link do e-mail a deixaria.
  await ctx.addInitScript(([chave, valor]) => localStorage.setItem(chave, valor), ['sb-yxewmauwnxnrrhevlbtc-auth-token', JSON.stringify(sessao)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  if (process.env.E2E_DEPURAR) {
    page.on('response', async (r) => { if (r.url().includes('/rpc/')) console.log('[rede]', r.status(), r.url().split('/rpc/')[1], (await r.text().catch(() => '')).slice(0, 160)); });
    page.on('console', (m) => console.log('[console]', m.text()));
  }
  await page.goto(origem + '/#/hoje');
  return page;
}

// Erro na tela é falha do teste, mesmo que o resto pareça funcionar: foi
// assim que uma consulta quebrada passou pela primeira rodada deste arquivo.
async function semErroNaTela(page: Page) {
  const erros = await page.locator('.aviso.erro').allTextContents();
  assert.deepEqual(erros, [], 'a tela mostrou erro');
}

const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Todo texto visível, com a opacidade herdada e a regra de texto grande da
// WCAG — a mesma varredura que a Central passou a usar.
const varrerContraste = (page: Page) => page.evaluate(() => {
  const rgb = (s: string) => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]: number[]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const fundoDe = (el: Element | null): number[] => {
    for (; el; el = el.parentElement) {
      const c = rgb(getComputedStyle(el).backgroundColor);
      if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3);
    }
    return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  };
  const falhas: string[] = [];
  const andar = document.createTreeWalker(document.getElementById('app')!, NodeFilter.SHOW_TEXT);
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const el = n.parentElement!;
    if (!n.textContent!.trim() || !el.getClientRects().length) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || el.closest('[aria-hidden="true"]') || el.closest('.sr') || el.closest(':disabled')) continue;
    let alfa = 1;
    for (let p: Element | null = el; p; p = p.parentElement) alfa *= Number(getComputedStyle(p).opacity);
    const fg = rgb(st.color), bg = fundoDe(el);
    const cor = fg.slice(0, 3).map((c, i) => c * alfa * (fg[3] ?? 1) + bg[i] * (1 - alfa * (fg[3] ?? 1)));
    const [a, b] = [lum(cor), lum(bg)].sort((x, y) => y - x);
    const razao = (a + 0.05) / (b + 0.05);
    const px = parseFloat(st.fontSize), negrito = Number(st.fontWeight) >= 700;
    const minimo = px >= 24 || (negrito && px >= 18.66) ? 3 : 4.5;
    if (razao < minimo) falhas.push(`${razao.toFixed(2)}:1 "${n.textContent!.trim().slice(0, 30)}"`);
  }
  return falhas;
});

test('Hoje: a pergunta, seis cartões, quatro ativos, e nenhum cliente da Bora à vista', async () => {
  const page = await abrir();
  await page.getByRole('heading', { name: 'O que você quer criar hoje?' }).waitFor();
  await semErroNaTela(page);
  assert.equal(await page.locator('.tipo').count(), 6);
  assert.equal(await page.locator('.tipo[aria-disabled="true"]').count(), 2, 'post, carrossel, reel e capa ativos; o resto em breve');
  assert.equal(await page.locator('.quem .nome').textContent(), 'Cliente de Teste');
  assert.equal(await page.locator('select').count(), 0, 'cliente de uma conta só não devia ver seletor');
  assert.ok(await semRolagemLateral(page));
  for (const tema of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: tema });
    assert.deepEqual(await varrerContraste(page), [], `contraste no tema ${tema}`);
  }
  await foto(page, 'hoje');
  await page.context().close();
});

async function foto(page: Page, nome: string) {
  if (!process.env.E2E_FOTOS) return;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(process.env.E2E_FOTOS, `${nome}.png`) });
}

test('isolamento: o cliente não enxerga nem pede pelo Moacyr, e a ficha interna não vaza', async () => {
  const { data: clientes } = await comoCliente.rpc('meus_clientes');
  assert.deepEqual((clientes as Array<{ id: string }>).map((c) => c.id), [CLIENTE]);
  const { data: moacyr } = await admin.from('clientes').select('id').ilike('nome', 'moacyr%').single();
  const r = await comoCliente.rpc('criar_pedido', { p_cliente: moacyr!.id, p_tipo: 'post-feed', p_briefing: { texto: 'invasão' } });
  assert.ok(r.error, 'pediu em nome do Moacyr');
  const { data: pedidosDoMoacyr } = await comoCliente.from('pedidos').select('id').eq('cliente_id', moacyr!.id);
  assert.equal(pedidosDoMoacyr!.length, 0);
  const { data: marca, error: erroMarca } = await comoCliente.rpc('marca_do_cliente', { p_cliente: CLIENTE });
  assert.ifError(erroMarca);
  assert.equal((marca as { conjuntos: unknown[] }).conjuntos.length, 2, JSON.stringify(marca));
  assert.ok(!JSON.stringify(marca).includes('NÃO PODE APARECER'), 'observação interna vazou');
  assert.ok(!('valor_mensal' in (marca as object)));
});

test('pede um post pelo celular, acompanha, pede ajuste, vê a versão nova e aprova', { timeout: 240_000 }, async () => {
  const page = await abrir();
  await page.getByRole('heading', { name: 'O que você quer criar hoje?' }).waitFor();
  await semErroNaTela(page);
  await page.getByRole('link', { name: /Post para feed/ }).click();

  // Passo 1
  await page.getByRole('heading', { name: 'O que o post precisa dizer?' }).waitFor();
  const continuar = page.getByRole('button', { name: 'Continuar' });
  assert.ok(await continuar.isDisabled(), 'continuar sem texto');
  await page.locator('#texto').fill('Abrimos turma nova no laboratório: inscrições até sexta');
  assert.ok(await semRolagemLateral(page));
  await continuar.click();

  // Passo 2
  await page.getByRole('heading', { name: 'Algumas escolhas' }).waitFor();
  await page.getByRole('button', { name: 'Contar uma novidade' }).click();
  assert.equal(await page.getByRole('button', { name: 'Contar uma novidade' }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Passo 3: o resumo em palavras de quem pede — nada de pixel nem nome de fonte.
  await page.getByRole('heading', { name: 'Confere antes de pedir' }).waitFor();
  const resumo = await page.locator('.resumo').textContent();
  assert.match(resumo!, /1 post para o feed do Instagram/);
  assert.match(resumo!, /Abrimos turma nova/);
  assert.match(resumo!, /Contar uma novidade/);
  assert.doesNotMatch(resumo!, /1080|px|Manrope|PSD|camada/i);
  assert.equal(await page.locator('.resumo .amostras i').count(), 3, 'as cores da marca não apareceram no resumo');
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'passo-3');
  await page.getByRole('button', { name: 'Pedir post' }).click();

  // Acompanhamento: a barra só anda pra frente.
  await page.waitForURL(/#\/pedido\//);
  const pedidoId = page.url().split('/').pop()!;
  await page.evaluate(() => {
    (window as unknown as { _vistos: number[] })._vistos = [];
    new MutationObserver(() => {
      const b = document.querySelector('[role=progressbar]');
      if (b) (window as unknown as { _vistos: number[] })._vistos.push(Number(b.getAttribute('aria-valuenow')));
    }).observe(document.getElementById('app')!, { subtree: true, childList: true, attributes: true });
  });
  await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 90_000 });
  const vistos = await page.evaluate(() => (window as unknown as { _vistos: number[] })._vistos);
  for (let i = 1; i < vistos.length; i++) assert.ok(vistos[i] >= vistos[i - 1], `barra voltou: ${vistos.join(' → ')}`);

  const previa = page.locator('img.previa');
  await previa.waitFor();
  await page.waitForFunction(() => (document.querySelector('img.previa') as HTMLImageElement)?.naturalWidth > 0);
  assert.equal(await previa.evaluate((i: HTMLImageElement) => `${i.naturalWidth}×${i.naturalHeight}`), '1080×1350');
  const primeiraVersao = await previa.getAttribute('src');
  // A legenda vem junto, e o botão copia de verdade.
  await page.getByRole('heading', { name: 'Legenda' }).waitFor();
  assert.match((await page.locator('.texto-entrega').textContent())!, /Abrimos turma nova no laboratório/);
  await page.getByRole('button', { name: 'Copiar a legenda' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Legenda copiada' }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Abrimos turma nova/);
  const historico = await page.locator('.linha-tempo').textContent();
  assert.match(historico!, /Desenhando o post/);
  assert.match(historico!, /Pronto para você aprovar/);
  assert.ok(await semRolagemLateral(page));
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'para-aprovar');

  // Ajuste
  await page.getByRole('button', { name: 'Pedir ajuste' }).click();
  const enviar = page.getByRole('button', { name: 'Enviar ajuste' });
  assert.ok(await enviar.isDisabled(), 'enviar ajuste vazio');
  await page.getByRole('button', { name: 'Outra cor da marca' }).click();
  await page.getByRole('button', { name: 'Mais curto' }).click();
  await enviar.click();
  await page.getByText('Fazendo o ajuste').waitFor();
  await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 90_000 });
  await page.locator('.versoes button').nth(1).waitFor();
  assert.equal(await page.locator('.versoes button').count(), 2);
  await page.waitForFunction((antiga) => {
    const i = document.querySelector('img.previa') as HTMLImageElement;
    return i && i.src !== antiga && i.naturalWidth > 0;
  }, primeiraVersao);

  // O ajuste mudou o que foi pedido: fundo verde-limão, título de quatro palavras.
  const { data: jobs } = await admin.from('jobs').select('id, rodada, estado, entrada').eq('pedido_id', pedidoId).order('criado_em');
  assert.deepEqual(jobs!.map((j) => `${j.rodada}:${j.estado}`), ['producao:pronto', 'ajuste:pronto']);
  const { data: eventos } = await admin.from('job_eventos').select('mensagem').eq('job_id', jobs![1].id).order('id');
  const resumoRoteiro = eventos!.map((e) => e.mensagem).find((m) => m.startsWith('Roteiro'))!;
  assert.match(resumoRoteiro, /conjunto "Verde-limão"/);
  assert.match(resumoRoteiro, /título "Abrimos turma nova no"/);

  // Aprovar
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Aprovado' }).first().waitFor();
  assert.doesNotMatch((await page.locator('.aviso.ok').allTextContents()).join(' '), /\.\./, 'ponto duplo depois da data');
  const historico2 = await page.locator('section[aria-labelledby=historico]').textContent();
  assert.match(historico2!, /Ajuste 1.*Recebemos o seu pedido de ajuste.*Primeira versão.*Começamos a produzir o seu pedido/s);
  assert.equal((historico2!.match(/Começamos a produzir/g) || []).length, 1, 'a rodada de ajuste também disse "começamos a produzir"');
  const { data: pedido } = await admin.from('pedidos').select('estado, job_aprovado, ajustes').eq('id', pedidoId).single();
  assert.equal(pedido!.estado, 'aprovado');
  assert.equal(pedido!.job_aprovado, jobs![1].id, 'aprovou a versão errada');
  assert.equal(pedido!.ajustes, 1);
  assert.equal(await page.getByRole('link', { name: 'Baixar a imagem' }).count(), 1);

  // Pedidos e Minha marca
  const abas = page.getByRole('navigation', { name: 'Seções' });
  await abas.getByRole('link', { name: 'Pedidos' }).click();
  await page.getByRole('heading', { name: 'Seus pedidos' }).waitFor();
  assert.match((await page.locator('.linha-ped').first().textContent())!, /Aprovado/);
  await semErroNaTela(page);
  await abas.getByRole('link', { name: 'Minha marca' }).click();
  await page.getByRole('heading', { name: 'Sua marca' }).waitFor();
  assert.equal(await page.locator('.cor').count(), 2);
  assert.equal(await page.locator('.combo').count(), 2);
  assert.ok(await semRolagemLateral(page));
  for (const tema of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: tema });
    assert.deepEqual(await varrerContraste(page), [], `contraste da marca no tema ${tema}`);
  }

  if (process.env.E2E_FOTOS) {
    await page.goto(origem + '/#/pedido/' + pedidoId);
    await page.locator('img.previa').waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(process.env.E2E_FOTOS, 'acompanhamento.png'), fullPage: true });
  }
  await page.context().close();
});

/** Abre o pedido em 3 passos pra um tipo, escreve o texto e chega no resumo. */
async function pedirAte3(page: Page, cartao: RegExp, texto: string, passo2?: (page: Page) => Promise<void>) {
  await page.getByRole('heading', { name: 'O que você quer criar hoje?' }).waitFor();
  await page.getByRole('link', { name: cartao }).click();
  await page.locator('#texto').fill(texto);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Algumas escolhas' }).waitFor();
  if (passo2) await passo2(page);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Confere antes de pedir' }).waitFor();
}

test('carrossel: escolhe 3 imagens, desliza pelas três, copia a legenda e aprova', { timeout: 240_000 }, async () => {
  const page = await abrir();
  await pedirAte3(page, /Carrossel/, 'Não existe atalho pra liderar. Liderança se aprende fazendo. Organização vem antes de talento', async (p) => {
    assert.equal(await p.getByRole('button', { name: '5', exact: true }).getAttribute('aria-pressed'), 'true', 'padrão não é 5');
    await p.getByRole('button', { name: '3', exact: true }).click();
  });
  assert.match((await page.locator('.resumo').textContent())!, /1 carrossel de 3 imagens/);
  assert.deepEqual(await varrerContraste(page), []);
  await page.getByRole('button', { name: 'Pedir carrossel' }).click();
  await page.waitForURL(/#\/pedido\//);
  const pedidoId = page.url().split('/').pop()!;
  await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 90_000 });
  assert.match((await page.locator('h1').textContent())!, /vem…$/, 'o título do pedido cortou no meio da palavra');

  const imagens = page.locator('.galeria img');
  await page.waitForFunction(() => [...document.querySelectorAll('.galeria img')].filter((i) => (i as HTMLImageElement).naturalWidth > 0).length === 3);
  // A próxima imagem aparece na borda: a primeira não ocupa a largura toda.
  const larguras = await page.evaluate(() => ({
    g: document.querySelector('.galeria')!.getBoundingClientRect().width,
    i: document.querySelector('.galeria img')!.getBoundingClientRect().width,
  }));
  assert.ok(larguras.i < larguras.g * 0.9, `a imagem ocupa ${larguras.i} de ${larguras.g}`);
  assert.equal(await imagens.count(), 3);
  assert.equal(await imagens.nth(2).getAttribute('alt'), 'Imagem 3 de 3');
  await page.getByRole('heading', { name: 'Legenda' }).waitFor();
  assert.ok(await semRolagemLateral(page), 'a galeria vazou pro lado da página');
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'carrossel');

  await page.getByRole('button', { name: 'Aprovar' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Aprovado' }).first().waitFor();
  assert.equal(await page.locator('.baixar a').count(), 3, 'devia oferecer as três imagens pra baixar');
  const { data: pedido } = await admin.from('pedidos').select('estado, briefing').eq('id', pedidoId).single();
  assert.equal(pedido!.estado, 'aprovado');
  assert.equal((pedido!.briefing as { slides: number }).slides, 3);
  await semErroNaTela(page);

  // O carrossel aprovado vira vídeo, com as mesmas três imagens.
  if (temEffectCraft) {
    await page.getByRole('button', { name: 'Transformar em vídeo' }).click();
    await page.waitForURL((u) => !u.href.endsWith(pedidoId));
    const videoId = page.url().split('/').pop()!;
    const { data: novo } = await admin.from('pedidos').select('tipo, briefing').eq('id', videoId).single();
    assert.equal(novo!.tipo, 'reel');
    assert.deepEqual([(novo!.briefing as { formato: string }).formato, (novo!.briefing as { de_pedido: string }).de_pedido], ['carrossel', pedidoId]);
    await page.getByText('Fazendo o vídeo do carrossel').waitFor();
    await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('video.previa') as HTMLVideoElement;
      return v && /reel\.mp4/.test(v.src) && v.readyState >= 1;
    });
    const v = await page.locator('video.previa').evaluate((x: HTMLVideoElement) => ({ w: x.videoWidth, h: x.videoHeight, s: x.duration }));
    assert.deepEqual([v.w, v.h], [1080, 1920]);
    assert.ok(Math.abs(v.s - 8) < 0.3, `vídeo de ${v.s}s; 3 imagens × 2,5 s + 0,5 s`);
    await foto(page, 'carrossel-em-video');
    await semErroNaTela(page);
  }
  await page.context().close();
});

test('abertura animada: sem gravar nada, com prévia antes, a barra andando e o vídeo de 10 s', {
  skip: !temEffectCraft && 'falta o EffectCraft', timeout: 240_000,
}, async () => {
  const page = await abrir();
  await page.getByRole('heading', { name: 'O que você quer criar hoje?' }).waitFor();
  await page.locator('a.tipo', { hasText: 'Reel ou vídeo curto' }).click();
  await page.getByRole('button', { name: 'Quero uma abertura animada' }).click();
  await page.getByRole('heading', { name: 'O que a abertura vai dizer?' }).waitFor();
  assert.equal(await page.locator('#video').count(), 0, 'pediu vídeo pra abertura');
  await page.locator('#texto').fill('Turma nova do laboratório, inscrições abertas');
  assert.ok(await semRolagemLateral(page));
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'abertura-passo-1');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Algumas escolhas' }).waitFor();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const resumo = (await page.locator('.resumo').textContent())!;
  assert.match(resumo, /1 abertura animada de 10 segundos/);
  assert.doesNotMatch(resumo, /Com o seu vídeo|arquivo das legendas/);

  await page.getByRole('button', { name: 'Pedir abertura' }).click();
  await page.waitForURL(/#\/pedido\//);
  const pedidoId = page.url().split('/').pop()!;
  // Tudo o que a barra mostrou, e a frase de quanto falta.
  await page.evaluate(() => {
    const w = window as unknown as { _vistos: number[]; _falta: string[] };
    w._vistos = []; w._falta = [];
    new MutationObserver(() => {
      const b = document.querySelector('[role=progressbar][aria-label=Andamento]');
      if (b) w._vistos.push(Number(b.getAttribute('aria-valuenow')));
      const f = document.querySelector('.falta');
      if (f) w._falta.push(f.textContent || '');
    }).observe(document.getElementById('app')!, { subtree: true, childList: true, attributes: true });
  });
  await page.getByText('Prévia: os primeiros 3 segundos').waitFor({ timeout: 120_000 });
  await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 120_000 });
  const { vistos, falta } = await page.evaluate(() => {
    const w = window as unknown as { _vistos: number[]; _falta: string[] };
    return { vistos: w._vistos, falta: w._falta };
  });
  for (let i = 1; i < vistos.length; i++) assert.ok(vistos[i] >= vistos[i - 1], `barra voltou: ${vistos.join(' → ')}`);
  assert.ok(new Set(vistos).size >= 3, `a barra quase não andou: ${[...new Set(vistos)].join(', ')}`);
  console.log(`  barra: ${[...new Set(vistos)].join(' → ')}; texto: ${[...new Set(falta)].join(' | ')}`);

  await page.waitForFunction(() => {
    const v = document.querySelector('video.previa') as HTMLVideoElement;
    return v && /reel\.mp4/.test(v.src) && v.readyState >= 1;
  });
  const v = await page.locator('video.previa').evaluate((x: HTMLVideoElement) => ({ w: x.videoWidth, h: x.videoHeight, s: x.duration }));
  assert.deepEqual([v.w, v.h], [1080, 1920]);
  assert.ok(Math.abs(v.s - 10) < 0.3, `abertura de ${v.s}s`);
  await page.getByRole('heading', { name: 'Legenda' }).waitFor();
  const historico = (await page.locator('.linha-tempo').textContent())!;
  assert.match(historico, /Montando a cena.*/s);
  assert.equal((historico.match(/Animando/g) || []).length, 1, 'o "animando" repetiu no histórico');
  assert.ok(await semRolagemLateral(page));
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'abertura-para-aprovar');

  await page.getByRole('button', { name: 'Aprovar' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Aprovado' }).first().waitFor();
  assert.equal(await page.getByRole('link', { name: 'Baixar o reel' }).count(), 1);
  assert.equal(await page.getByRole('link', { name: /legendas \(\.srt\)/ }).count(), 0, 'abertura não tem legenda de fala');
  const { data: pedido } = await admin.from('pedidos').select('estado, briefing').eq('id', pedidoId).single();
  assert.equal(pedido!.estado, 'aprovado');
  assert.equal((pedido!.briefing as { formato: string }).formato, 'abertura');
  const { data: jobs } = await admin.from('jobs').select('skill').eq('pedido_id', pedidoId);
  assert.deepEqual(jobs!.map((j) => j.skill), ['abertura-com-motion']);
  await semErroNaTela(page);
  await page.context().close();
});

test('capa: três opções, aprovar só depois de escolher, e a escolhida é a que fica', { timeout: 240_000 }, async () => {
  const page = await abrir();
  await pedirAte3(page, /Capa ou thumbnail/, 'Como montei um time de produto sem saber programar');
  assert.match((await page.locator('.resumo').textContent())!, /3 opções de capa para vídeo do YouTube/);
  await page.getByRole('button', { name: 'Pedir capas' }).click();
  await page.waitForURL(/#\/pedido\//);
  const pedidoId = page.url().split('/').pop()!;
  await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 90_000 });

  await page.waitForFunction(() => [...document.querySelectorAll('.opcao img')].filter((i) => (i as HTMLImageElement).naturalWidth === 1280).length === 3);
  const aprovar = page.getByRole('button', { name: 'Escolha uma opção' });
  assert.ok(await aprovar.isDisabled(), 'aprovou sem escolher');
  await page.getByRole('button', { name: /Opção 2/ }).click();
  assert.equal(await page.getByRole('button', { name: /Opção 2/ }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('heading', { name: 'Títulos pro vídeo' }).waitFor();
  assert.equal(await page.locator('.titulos li').count(), 2);
  await page.getByRole('heading', { name: 'Descrição do vídeo' }).waitFor();
  assert.ok(await semRolagemLateral(page));
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'capa');

  await page.getByRole('button', { name: 'Aprovar opção 2' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Aprovado' }).first().waitFor();
  assert.match((await page.locator('.opcao.escolhida').textContent())!, /Opção 2 · a escolhida/);
  assert.equal(await page.getByRole('link', { name: 'Baixar a imagem' }).count(), 1, 'só a capa escolhida pra baixar');
  assert.match((await page.getByRole('link', { name: 'Baixar a imagem' }).getAttribute('download'))!, /capa-2\.png/);
  const { data: pedido } = await admin.from('pedidos').select('estado, escolha').eq('id', pedidoId).single();
  assert.deepEqual(pedido, { estado: 'aprovado', escolha: 2 });
  await semErroNaTela(page);
  await page.context().close();
});

test('envio de vídeo: só na pasta do próprio cliente, e o pedido só aceita vídeo que chegou', async () => {
  const { data: pasta, error } = await comoCliente.rpc('pasta_de_envio', { p_cliente: CLIENTE });
  assert.ifError(error);
  assert.match(pasta as string, new RegExp(`^${CONTA}/${CLIENTE}/uploads/[0-9a-f-]{36}$`));
  const video = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });

  // Na pasta de outra pessoa, ou fora de "uploads", ou sem ser vídeo: recusado.
  const { data: moacyr } = await admin.from('clientes').select('id, conta_id').ilike('nome', 'moacyr%').single();
  for (const caminho of [
    `${moacyr!.conta_id}/${moacyr!.id}/uploads/${crypto.randomUUID()}/bruto.mp4`,
    `${CONTA}/${CLIENTE}/${crypto.randomUUID()}/saida/bruto.mp4`,
    `${pasta}/script.html`,
  ]) {
    const r = await comoCliente.storage.from('pedidos').upload(caminho, video);
    assert.ok(r.error, `subiu em ${caminho}`);
  }
  assert.ok((await comoCliente.rpc('pasta_de_envio', { p_cliente: moacyr!.id })).error, 'deu a pasta do Moacyr');

  // O pedido de reel: sem vídeo, com vídeo que não subiu, ou com o vídeo de outro cliente — recusado.
  const contarReels = async () => (await admin.from('pedidos').select('id', { count: 'exact', head: true }).eq('cliente_id', CLIENTE).eq('tipo', 'reel')).count;
  const antes = await contarReels();
  const pedir =(anexo?: string) => comoCliente.rpc('criar_pedido', { p_cliente: CLIENTE, p_tipo: 'reel', p_briefing: { texto: 'Um reel', anexo } });
  assert.match((await pedir()).error?.message ?? '', /falta o vídeo/);
  assert.match((await pedir(`${pasta}/bruto.mp4`)).error?.message ?? '', /não chegou/);
  assert.match((await pedir(`${moacyr!.conta_id}/${moacyr!.id}/uploads/x/bruto.mp4`)).error?.message ?? '', /não chegou/);
  // Os formatos sem vídeo: formato inventado, ou carrossel que não é do cliente / não foi aprovado.
  const comFormato = (b: Record<string, unknown>) => comoCliente.rpc('criar_pedido', { p_cliente: CLIENTE, p_tipo: 'reel', p_briefing: { texto: 'Um reel', ...b } });
  assert.match((await comFormato({ formato: 'holograma' })).error?.message ?? '', /formato de reel não existe/);
  assert.match((await comFormato({ formato: 'carrossel' })).error?.message ?? '', /falta o carrossel/);
  assert.match((await comFormato({ formato: 'carrossel', de_pedido: 'x; drop table pedidos' })).error?.message ?? '', /falta o carrossel/);
  const { data: alheio } = await admin.from('pedidos').select('id').neq('cliente_id', CLIENTE).eq('tipo', 'carrossel').limit(1).maybeSingle();
  if (alheio) assert.match((await comFormato({ formato: 'carrossel', de_pedido: alheio.id })).error?.message ?? '', /não foi aprovado/);
  assert.match((await comFormato({ formato: 'carrossel', de_pedido: crypto.randomUUID() })).error?.message ?? '', /não foi aprovado/);
  assert.equal(await contarReels(), antes, 'algum pedido recusado entrou');
});

test('reel: sobe o vídeo pelo celular, vê a prévia antes, depois o reel inteiro, e aprova', {
  skip: !temTudoProReel && 'falta FilmCraft, PhotoCraft, whisper.cpp ou a voz do Windows', timeout: 600_000,
}, async () => {
  const bruto = montarBrutoDeTeste();
  const page = await abrir();
  await page.getByRole('heading', { name: 'O que você quer criar hoje?' }).waitFor();
  await page.locator('a.tipo', { hasText: 'Reel ou vídeo curto' }).click();

  // Passo 1: o vídeo sobe enquanto a pessoa escreve.
  await page.getByRole('heading', { name: 'Mande o vídeo que você gravou' }).waitFor();
  const continuar = page.getByRole('button', { name: 'Continuar' });
  await page.locator('#texto').fill('Turma nova do laboratório de redes, inscrições até sexta');
  assert.ok(await continuar.isDisabled(), 'continuar sem vídeo');
  await page.locator('#video').setInputFiles(bruto);
  await page.getByText('Vídeo recebido.').waitFor({ timeout: 60_000 });
  assert.ok(await semRolagemLateral(page));
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'reel-passo-1');
  await continuar.click();
  await page.getByRole('heading', { name: 'Algumas escolhas' }).waitFor();
  assert.ok(await page.getByText('Pra que serve esse vídeo?').count());
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Confere antes de pedir' }).waitFor();
  const resumo = (await page.locator('.resumo').textContent())!;
  assert.match(resumo, /1 reel em pé/);
  assert.match(resumo, /bruto\.mp4/);
  assert.match(resumo, /15 segundos/);
  await page.getByRole('button', { name: 'Pedir reel' }).click();
  await page.waitForURL(/#\/pedido\//);
  const pedidoId = page.url().split('/').pop()!;
  const { data: criado } = await admin.from('pedidos').select('briefing').eq('id', pedidoId).single();
  assert.match((criado!.briefing as { anexo: string }).anexo, new RegExp(`^${CONTA}/${CLIENTE}/uploads/.+/bruto\\.mp4$`));

  // A prévia aparece enquanto o reel ainda está sendo feito, e toca.
  await page.getByText('Prévia: os primeiros 15 segundos').waitFor({ timeout: 300_000 });
  assert.ok(await page.locator('.selo.produzindo').count(), 'a prévia só apareceu depois de pronto');
  await page.waitForFunction(() => (document.querySelector('video.previa') as HTMLVideoElement)?.readyState >= 1);
  const previa = await page.locator('video.previa').evaluate((v: HTMLVideoElement) => v.duration);
  assert.ok(previa > 13 && previa < 15.6, `prévia de ${previa}s`);
  await foto(page, 'reel-previa');

  // O reel inteiro: em pé, mais curto que o bruto, com a legenda pra copiar.
  await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 300_000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('video.previa') as HTMLVideoElement;
    return v && /reel\.mp4/.test(v.src) && v.readyState >= 1;
  });
  const reel = await page.locator('video.previa').evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight, s: v.duration }));
  assert.deepEqual([reel.w, reel.h], [1080, 1920]);
  assert.ok(reel.s > 20 && reel.s < 65, `reel de ${reel.s}s`);
  await page.getByRole('heading', { name: 'Legenda' }).waitFor();
  assert.match((await page.locator('.texto-entrega').textContent())!, /laboratório/);
  assert.ok(await semRolagemLateral(page));
  assert.deepEqual(await varrerContraste(page), []);
  await foto(page, 'reel-para-aprovar');

  // No reel, o ajuste só oferece o que a fábrica sabe mudar no vídeo.
  await page.getByRole('button', { name: 'Pedir ajuste' }).click();
  assert.deepEqual(await page.locator('[aria-label="Atalhos de ajuste"] button').allTextContents(), ['Outra cor da marca']);
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: 'Aprovar' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Aprovado' }).first().waitFor();
  assert.equal(await page.getByRole('link', { name: 'Baixar o reel' }).count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Baixar as legendas (.srt)' }).count(), 1);
  const { data: pedido } = await admin.from('pedidos').select('estado').eq('id', pedidoId).single();
  assert.equal(pedido!.estado, 'aprovado');

  // Na lista, a miniatura do reel é o primeiro quadro do vídeo.
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Pedidos' }).click();
  await page.locator('.linha-ped video.miniatura').first().waitFor();
  await semErroNaTela(page);
  await page.context().close();
});

/** No calendário, vai até o mês do dia (no máximo dois meses pra frente). */
async function calendarioNoDia(page: Page, dia: string) {
  for (let i = 0; i < 3 && !(await page.locator(`[data-dia="${dia}"]`).count()); i++) {
    await page.getByRole('button', { name: 'Próximo mês' }).click();
  }
  return page.locator(`[data-dia="${dia}"]`);
}

test('plano do mês: "Criar isso" vira pedido escrito, e o calendário e a agenda da Bora andam juntos', { timeout: 240_000 }, async () => {
  const page = await abrir();
  const tema = 'O erro mais comum de quem começa';

  // As sugestões do plano, e o "Criar isso" pedindo só o formato.
  await page.getByRole('heading', { name: /Sugestões do seu plano de/ }).waitFor();
  assert.equal(await page.locator('.sugestao').count(), 3);
  await page.getByRole('button', { name: `Criar isso: ${tema}` }).click();
  await page.locator('.sugestao').filter({ hasText: tema }).getByRole('button', { name: 'Post para feed' }).click();

  // O pedido já vem escrito.
  await page.getByRole('heading', { name: 'O que o post precisa dizer?' }).waitFor();
  assert.equal(await page.locator('#texto').inputValue(), tema);
  assert.match((await page.locator('main').textContent())!, /veio do seu plano do mês/);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Algumas escolhas' }).waitFor();
  const dia1 = hojeIso(2);
  await page.locator('#data').fill(dia1);
  await page.getByRole('button', { name: 'Continuar' }).click();
  assert.match((await page.locator('.resumo').textContent())!, /Vai ao ar/);
  await page.getByRole('button', { name: 'Pedir post' }).click();
  await page.waitForURL(/#\/pedido\//);
  const pedidoId = page.url().split('/').pop()!;

  // Aprovado com data → agendado, e a tarefa aparece na agenda da Central.
  await page.locator('.selo.para_aprovar').first().waitFor({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Aprovado e agendado' }).waitFor();
  await page.locator('.selo.agendado').first().waitFor();
  const lerPedido = async () => (await admin.from('pedidos').select('estado, publicar_em, tarefa_id, origem_tema').eq('id', pedidoId).single()).data!;
  const lerTarefa = async (id: string) => (await admin.from('tarefas').select('tipo, data, estado, titulo, campos').eq('id', id).single()).data!;
  let ped = await lerPedido();
  assert.equal(ped.estado, 'agendado');
  assert.equal(ped.origem_tema, tema);
  let tarefa = await lerTarefa(ped.tarefa_id);
  assert.equal(tarefa.tipo, 'publicacao');
  assert.equal(tarefa.data, dia1);
  assert.equal((tarefa.campos as { pedido_id: string }).pedido_id, pedidoId);

  // O tema saiu das sugestões.
  const abas = page.getByRole('navigation', { name: 'Seções' });
  await abas.getByRole('link', { name: 'Hoje' }).click();
  await page.getByText('1 de 3 temas já viraram pedido.').waitFor();
  assert.equal(await page.locator('.sugestao').count(), 2);
  assert.equal(await page.locator('.sugestao').filter({ hasText: tema }).count(), 0);

  // Calendário: a peça no dia, e "Mudar data" move a tarefa da Central.
  await abas.getByRole('link', { name: 'Calendário' }).click();
  await page.getByRole('heading', { name: 'Calendário' }).waitFor();
  const celula1 = await calendarioNoDia(page, dia1);
  assert.equal(await celula1.locator('.peca').count(), 1);
  assert.ok(await semRolagemLateral(page), 'o calendário vazou pro lado');
  for (const tema2 of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: tema2 });
    assert.deepEqual(await varrerContraste(page), [], `contraste do calendário no tema ${tema2}`);
  }
  await foto(page, 'calendario');
  await celula1.click();
  const dia2 = hojeIso(4);
  await page.getByRole('button', { name: /Mudar a data:/ }).click();
  await page.getByLabel('Em que dia vai ao ar?').fill(dia2);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.locator('.aviso.ok').filter({ hasText: 'Agendado pra' }).waitFor();
  tarefa = await lerTarefa(ped.tarefa_id);
  assert.equal(tarefa.data, dia2, 'mudar a data no app não moveu a tarefa da Central');

  // A Bora move a tarefa na Central → o calendário do cliente acompanha, ao vivo.
  const dia3 = hojeIso(5);
  await admin.from('tarefas').update({ data: dia3 }).eq('id', ped.tarefa_id);
  const celula3 = await calendarioNoDia(page, dia3);
  await celula3.locator('.peca').waitFor({ timeout: 15_000 });
  ped = await lerPedido();
  assert.equal(ped.publicar_em.slice(0, 10), dia3);

  // A Bora marca a publicação como feita → o pedido vira "publicado".
  await admin.from('tarefas').update({ estado: 'concluido' }).eq('id', ped.tarefa_id);
  await page.goto(origem + '/#/pedido/' + pedidoId);
  await page.locator('.selo.publicado').first().waitFor({ timeout: 15_000 });
  assert.match((await page.locator('.data-ar').textContent())!, /Foi ao ar/);
  assert.equal(await page.getByRole('button', { name: /Mudar a data/ }).count(), 0, 'peça publicada não muda de data');
  await semErroNaTela(page);
  await page.context().close();
});

// ---------- passo 7: Visão Bora ----------

/** Espera o banco chegar num estado, olhando de segundo em segundo. */
async function esperar<T>(ler: () => Promise<T>, pronto: (v: T) => boolean, ms: number, oque: string): Promise<T> {
  const ate = Date.now() + ms;
  for (;;) {
    const v = await ler();
    if (pronto(v)) return v;
    if (Date.now() > ate) throw new Error(`não chegou a tempo: ${oque} (${JSON.stringify(v)})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test('Visão Bora: a fábrica refaz duas vezes, a equipe assume, entrega, a conferência barra o que falta, e o cliente aprova', { timeout: 300_000 }, async () => {
  // Só a equipe vê a fila e assume.
  assert.ok((await comoCliente.rpc('fila_da_fabrica')).error, 'cliente viu a fila da fábrica');
  assert.ok((await comoCliente.rpc('custos_da_fabrica', { p_de: '2026-01-01', p_ate: '2026-12-31' })).error, 'cliente viu os custos');

  // Um pedido que a fábrica não consegue fazer: a skill forçada não tem roteiro.
  const { data: ped, error } = await admin.from('pedidos').insert({
    cliente_id: CLIENTE, tipo: 'post-feed', titulo: 'Pedido que a fábrica não dá conta', briefing: { texto: 'Pedido que a fábrica não dá conta' }, estado: 'produzindo',
  }).select('id').single();
  assert.ifError(error);
  const pedidoId = ped!.id as string;
  assert.ok((await comoCliente.rpc('assumir_pedido', { p_pedido: pedidoId })).error, 'cliente assumiu pedido');
  await admin.from('jobs').insert({ pedido_id: pedidoId, rodada: 'producao', skill: 'copy-e-hashtags' });

  // Refaz sozinha duas vezes; na terceira, falha de vez.
  const job = await esperar(
    async () => (await admin.from('jobs').select('id, estado, tentativas').eq('pedido_id', pedidoId).single()).data!,
    (j) => j.estado === 'falhou', 90_000, 'o job falhar de vez',
  );
  assert.equal(job.tentativas, 3);
  const { data: erros } = await admin.from('job_eventos').select('mensagem').eq('job_id', job.id).eq('nivel', 'erro');
  assert.equal(erros!.length, 3, 'cada tentativa deixa o motivo');

  // A Fábrica, na Central: o número aceso, o pedido em "Precisa da equipe" com os três motivos.
  const est = await abrirCentral('#/fabrica');
  await est.getByRole('heading', { name: 'Fábrica', exact: true, level: 1 }).waitFor();
  // O worker deste teste dá sinal de vida: a Fábrica aparece ligada.
  await est.locator('.fab-sinal.ligada', { hasText: /Fábrica ligada em .*sem o Claude/ }).waitFor({ timeout: 15_000 });
  const cartao = est.locator(`.card.fab[data-pedido="${pedidoId}"]`);
  await cartao.waitFor();
  assert.match((await cartao.locator('.chip').textContent())!, /Precisa da equipe/);
  assert.equal(await cartao.locator('.fab-motivos li').count(), 3);
  assert.match((await cartao.locator('.fab-motivos').textContent())!, /o roteiro não sabe fazer a skill copy-e-hashtags/);
  assert.match((await cartao.locator('.fab-linha').textContent())!, /tentativa 3 de 3/);
  assert.ok(Number(await est.locator('.navtopo button', { hasText: 'Fábrica' }).locator('.conta').textContent()) >= 1, 'o número da aba Fábrica não acendeu');
  if (process.env.E2E_FOTOS) await est.screenshot({ path: path.join(process.env.E2E_FOTOS, 'fabrica.png'), fullPage: true });

  // Assumir é "Editar à mão", na tela do pedido: o cliente passa a ver que a equipe está finalizando.
  await cartao.getByRole('button', { name: 'Abrir o pedido' }).click();
  await est.waitForURL(/#\/p\//);
  await est.getByRole('button', { name: 'Editar à mão' }).click();
  const entrega = est.locator(`#cr-entrega-${pedidoId}`);
  await entrega.waitFor();
  await est.locator('.chip', { hasText: 'Com a equipe' }).first().waitFor();
  const cli = await abrir();
  await cli.goto(origem + '/#/pedido/' + pedidoId);
  await cli.getByText('A equipe da Bora está finalizando este pedido.').first().waitFor();

  // A versão corrigida, feita aqui como a designer faria no editor dela.
  const { data: linha } = await admin.from('clientes').select('nome, nome_preferido, cor, marca, registro_profissional, instagram').eq('id', CLIENTE).single();
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const feito = await produzir({
    cfg: { pastaJobs: mkdtempSync(path.join(tmpdir(), 'equipe-')), tetoUsd: 1 } as Config, job: { id: 'correcao' },
    skill: skills.get('post-feed')!, skills, pedido: { id: pedidoId, tipo: 'post-feed', titulo: null, briefing: { texto: 'Pedido que a equipe terminou' }, publicar_em: null },
    cliente: linha as ClienteParaMarca, instaladas: fontesInstaladas(), agente: rodarRoteiro,
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {},
  });
  const arq = (c: string) => path.join(feito.pastaJob, c);

  // Primeira entrega sem o editável e sem a legenda: a conferência barra, e diz o que faltou.
  await entrega.setInputFiles([arq('saida/post.png')]);
  await est.getByRole('button', { name: 'Entregar a versão corrigida' }).click();
  const barrada = await esperar(
    async () => (await admin.from('jobs').select('estado, erro, skill').eq('pedido_id', pedidoId).eq('rodada', 'da_bora').order('criado_em')).data?.[0] ?? null,
    (j) => j?.estado === 'falhou', 60_000, 'a entrega incompleta ser barrada',
  );
  assert.equal(barrada!.skill, 'post-feed', 'a entrega da equipe usou a skill da rodada que travou');
  assert.match(barrada!.erro!, /faltou na entrega da equipe: post\.psd, legenda\.txt/);
  await est.locator('.cr-edicao .erro', { hasText: 'faltou na entrega da equipe' }).waitFor({ timeout: 30_000 });

  // A entrega completa passa, e chega no cliente.
  await entrega.setInputFiles([arq('saida/post.png'), arq('editavel/post.psd'), arq('saida/legenda.txt')]);
  await est.getByRole('button', { name: 'Entregar a versão corrigida' }).click();
  await esperar(
    async () => (await admin.from('pedidos').select('estado').eq('id', pedidoId).single()).data!.estado,
    (e) => e === 'para_aprovar', 60_000, 'a entrega da equipe chegar no cliente',
  );
  await cli.locator('.selo.para_aprovar').first().waitFor({ timeout: 30_000 });
  await cli.waitForFunction(() => (document.querySelector('img.previa') as HTMLImageElement)?.naturalWidth > 0);
  assert.match((await cli.locator('section[aria-labelledby=historico]').textContent())!, /Versão da equipe da Bora/);
  await cli.getByRole('button', { name: 'Aprovar' }).click();
  await cli.locator('.aviso.ok').filter({ hasText: 'Aprovado' }).first().waitFor();
  await semErroNaTela(cli);

  // Nos custos do mês, o cliente de teste com a rodada da equipe contada.
  await est.goto(origem + '/central/#/fabrica');
  await est.getByRole('heading', { name: 'Custos da fábrica no mês' }).waitFor();
  const linhaCusto = est.locator('.fab-custos tr', { hasText: 'Cliente de Teste' });
  await linhaCusto.waitFor();
  const celulas = await linhaCusto.locator('td').allTextContents();
  assert.ok(Number(celulas[5]) >= 2, `rodadas da equipe: ${celulas.join(' | ')}`);
  await est.context().close();
  await cli.context().close();
});

// ---------- entrar pelo link do e-mail ----------
//
// Os outros testes põem a sessão direto no navegador; este faz o caminho de
// quem recebe o e-mail: um navegador sem nada guardado abre o link de acesso
// (gerado pelo Supabase como o do e-mail, sem mandar e-mail) e precisa cair
// dentro. Foi assim que se descobriu que a página limpava o endereço antes
// do supabase-js ler a sessão — o login dava certo e a tela voltava pro "Entrar".
for (const [onde, email, caminho, dentro] of [
  ['app do cliente', EMAIL, '/', 'O que você quer criar hoje?'],
  ['Central', EMAIL_EQUIPE, '/central/', null],
] as const) {
  test(`entrar pelo link do e-mail: ${onde}`, async (t) => {
    if (!origem.endsWith(':3000')) { t.skip('a porta 3000 estava ocupada; o Supabase só aceita voltar pra ela'); return; }
    const destino = origem.replace('127.0.0.1', 'localhost') + caminho;
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: destino } });
    assert.ifError(error);
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { throw e; });
    await page.goto(data.properties.action_link);
    // Na Central, dentro é ver o menu das áreas, que só aparece pra quem entrou.
    await (dentro ? page.getByRole('heading', { name: dentro }) : page.locator('.navtopo')).first().waitFor({ timeout: 20_000 });
    assert.doesNotMatch(page.url(), /access_token/, 'a sessão ficou exposta na barra de endereço');
    // E continua dentro ao recarregar: a sessão foi guardada, não só lida.
    await page.reload();
    // Na Central, dentro é ver o menu das áreas, que só aparece pra quem entrou.
    await (dentro ? page.getByRole('heading', { name: dentro }) : page.locator('.navtopo')).first().waitFor({ timeout: 20_000 });
    await ctx.close();
  });
}

// ---------- a Central cria pela fábrica ----------
//
// A etapa A: a equipe pede pela Central, acompanha, pede ajuste, edita à mão
// no PhotoCraft (baixa o PSD, troca o título, exporta, sobe) e aprova — sem o
// editor antigo. E vídeo também: abertura animada e reel do vídeo gravado.

async function abrirCentral(rota: string): Promise<Page> {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origem });
  await ctx.addInitScript(([chave, valor]) => localStorage.setItem(chave, valor), ['sb-yxewmauwnxnrrhevlbtc-auth-token', JSON.stringify(sessaoEquipe)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  page.on('dialog', (d) => d.accept());
  if (process.env.E2E_DEPURAR) {
    page.on('response', async (r) => { if (/\/(rpc|rest\/v1)\//.test(r.url()) && r.status() >= 400) console.log('[rede]', r.status(), r.url().split('/v1/')[1], (await r.text().catch(() => '')).slice(0, 200)); });
    page.on('console', (m) => console.log('[console]', m.text()));
    await page.exposeFunction('__toast', (t: string) => console.log('[toast]', t));
    await ctx.addInitScript(() => new MutationObserver(() => { const t = document.getElementById('toast'); if (t?.textContent) (window as unknown as { __toast: (s: string) => void }).__toast(t.textContent); })
      .observe(document, { subtree: true, childList: true, characterData: true }));
  }
  await page.goto(origem + '/central/' + rota);
  return page;
}

/** Pede pela tela Nova peça e devolve o id do pedido. */
async function pedirPelaCentral(page: Page, tipo: RegExp, texto: string, antes?: (p: Page) => Promise<void>) {
  await page.getByRole('heading', { name: 'Criar', exact: true, level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Nova peça', exact: true }).click();
  await page.locator('#cr-cliente').selectOption(CLIENTE);
  await page.locator('.cr-tipo', { hasText: tipo }).click();
  if (antes) await antes(page);
  await page.locator('#cr-texto').fill(texto);
  await page.getByRole('button', { name: 'Pedir à fábrica' }).click();
  await page.waitForURL(/#\/p\//);
  return page.url().split('/').pop()!;
}

test('Central: a equipe pede um post, ajusta, edita à mão no PhotoCraft e aprova — sem o editor antigo', { timeout: 300_000 }, async () => {
  const page = await abrirCentral('#/criar');
  // O antigo Estúdio virou Criar: o endereço velho cai no lugar novo, e o editor de navegador sumiu.
  await page.goto(origem + '/central/#/estudio');
  await page.getByRole('heading', { name: 'Criar', exact: true, level: 1 }).waitFor();
  assert.equal(await page.getByText('Monta e exporta a peça').count(), 0, 'o editor antigo ainda está na tela');
  await page.locator('.fab-sinal.ligada', { hasText: /Fábrica ligada/ }).waitFor({ timeout: 15_000 });

  const pedidoId = await pedirPelaCentral(page, /^Post/, 'Turma nova do laboratório: inscrições até sexta');
  const { data: criado } = await admin.from('pedidos').select('pela_equipe').eq('id', pedidoId).single();
  assert.equal(criado!.pela_equipe, true, 'o banco não marcou que foi a equipe');
  await page.locator('.chip', { hasText: 'Para aprovar' }).first().waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.cr-imagens img')].some((i) => (i as HTMLImageElement).naturalWidth === 1080));
  await page.getByText('Legenda', { exact: true }).waitFor();
  if (process.env.E2E_FOTOS) await page.screenshot({ path: path.join(process.env.E2E_FOTOS, 'central-pedido.png'), fullPage: true });

  // Ajuste por atalho: a fábrica refaz e aparece a segunda versão.
  await page.getByRole('button', { name: 'Pedir ajuste' }).click();
  await page.getByRole('button', { name: 'Outra cor da marca' }).click();
  await page.getByRole('button', { name: 'Enviar ajuste' }).click();
  await page.getByRole('button', { name: 'Versão 2' }).waitFor({ timeout: 90_000 });
  await page.locator('.chip', { hasText: 'Para aprovar' }).first().waitFor({ timeout: 90_000 });

  // Editar à mão: a fábrica para, o PSD é baixado, o título muda no PhotoCraft, e a versão sobe.
  await page.getByRole('button', { name: 'Editar à mão' }).click();
  const linkPsd = page.locator('.cr-edicao a', { hasText: 'post.psd · abre no PhotoCraft' });
  await linkPsd.waitFor();
  const pasta = mkdtempSync(path.join(tmpdir(), 'mao-'));
  const baixar = async (nome: string) => {
    const href = await page.locator('.cr-edicao a', { hasText: nome }).first().getAttribute('href');
    const r = await fetch(href!);
    assert.ok(r.ok, `baixar ${nome}`);
    writeFileSync(path.join(pasta, nome), Buffer.from(await r.arrayBuffer()));
  };
  await baixar('post.psd');
  await baixar('legenda.txt');
  const cli = acharCli('photocraft');
  const info = JSON.parse(execFileSync(cli, ['info', path.join(pasta, 'post.psd'), '--compact'], { encoding: 'utf8' }));
  type Camada = { id: number; kind: string; bounds: number[] };
  const titulo = (info.layers as Camada[]).filter((l) => l.kind === 'Type').sort((a, b) => b.bounds[2] * b.bounds[3] - a.bounds[2] * a.bounds[3])[0];
  mkdirSync(path.join(pasta, 'corrigido'));
  execFileSync(cli, ['run', path.join(pasta, 'post.psd'), '--cmd', 'type.edit', '--params', JSON.stringify({ layer: titulo.id, text: 'Turma nova, corrigida à mão' }),
    '--out', path.join(pasta, 'corrigido', 'post.psd')]);
  execFileSync(cli, ['convert', path.join(pasta, 'corrigido', 'post.psd'), path.join(pasta, 'corrigido', 'post.png')]);
  writeFileSync(path.join(pasta, 'corrigido', 'legenda.txt'), readFileSync(path.join(pasta, 'legenda.txt')));
  await page.locator(`#cr-entrega-${pedidoId}`).setInputFiles(['post.psd', 'post.png', 'legenda.txt'].map((n) => path.join(pasta, 'corrigido', n)));
  await page.getByRole('button', { name: 'Entregar a versão corrigida' }).click();
  await page.getByRole('button', { name: /^Equipe \d/ }).waitFor({ timeout: 90_000 });
  await page.locator('.chip', { hasText: 'Para aprovar' }).first().waitFor({ timeout: 30_000 });
  const { data: rodadas } = await admin.from('jobs').select('rodada, estado').eq('pedido_id', pedidoId).order('criado_em');
  assert.deepEqual(rodadas!.map((j) => `${j.rodada}:${j.estado}`), ['producao:pronto', 'ajuste:pronto', 'da_bora:pronto']);

  // O texto novo está mesmo na peça entregue.
  const { data: ult } = await admin.from('jobs').select('saidas').eq('pedido_id', pedidoId).eq('rodada', 'da_bora').single();
  const psdEntregue = (ult!.saidas as Array<{ caminho: string }>).find((s) => s.caminho.endsWith('post.psd'))!;
  const { data: blob } = await admin.storage.from('pedidos').download(psdEntregue.caminho);
  writeFileSync(path.join(pasta, 'entregue.psd'), Buffer.from(await blob!.arrayBuffer()));
  const textos = (JSON.parse(execFileSync(cli, ['info', path.join(pasta, 'entregue.psd'), '--compact'], { encoding: 'utf8' })).layers as Array<{ kind: string; text?: { text: string } }>)
    .filter((l) => l.kind === 'Type').map((l) => l.text?.text ?? '');
  assert.ok(textos.includes('Turma nova, corrigida à mão'), textos.join(' | '));

  await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await page.locator('.chip', { hasText: 'Aprovado' }).first().waitFor();
  await page.locator('.cr-aprovado a', { hasText: 'Baixar post.png' }).waitFor();
  await semErroNaTela(page);
  await page.context().close();
});

test('Central: vídeo — abertura animada e reel do vídeo gravado, pedidos pela equipe', {
  skip: !temEffectCraft && 'falta o EffectCraft', timeout: 400_000,
}, async () => {
  const page = await abrirCentral('#/criar');
  const abertura = await pedirPelaCentral(page, /^Abertura animada/, 'Turma nova do laboratório, inscrições abertas');
  await page.locator('.chip', { hasText: 'Para aprovar' }).first().waitFor({ timeout: 120_000 });
  const reelPronto = () => page.waitForFunction(() => {
    const v = document.querySelector('video.cr-video') as HTMLVideoElement;
    return v && /reel\.mp4/.test(v.src) && v.readyState >= 1;
  });
  await reelPronto();
  const v = await page.locator('video.cr-video').evaluate((x: HTMLVideoElement) => [x.videoWidth, x.videoHeight, Math.round(x.duration)]);
  assert.deepEqual(v, [1080, 1920, 10]);
  if (process.env.E2E_FOTOS) await page.screenshot({ path: path.join(process.env.E2E_FOTOS, 'central-abertura.png'), fullPage: true });
  const { data: j } = await admin.from('jobs').select('skill').eq('pedido_id', abertura).single();
  assert.equal(j!.skill, 'abertura-com-motion');

  if (temTudoProReel) {
    const bruto = montarBrutoDeTeste();
    await page.getByRole('button', { name: '← Peças' }).click();
    await pedirPelaCentral(page, /^Reel do vídeo gravado/, 'Turma nova do laboratório de redes', async (p) => {
      await p.locator('#cr-video').setInputFiles(bruto);
      await p.locator('#cr-envio', { hasText: 'recebido' }).waitFor({ timeout: 60_000 });
    });
    await page.locator('.chip', { hasText: 'Para aprovar' }).first().waitFor({ timeout: 300_000 });
    await reelPronto();
  }

  // A Fábrica, na Central: o aviso de ligada e os custos do mês com o cliente de teste.
  await page.goto(origem + '/central/#/fabrica');
  await page.getByRole('heading', { name: 'Fábrica', exact: true, level: 1 }).waitFor();
  await page.locator('.fab-sinal.ligada').waitFor({ timeout: 15_000 });
  await page.locator('.fab-custos tr', { hasText: 'Cliente de Teste' }).waitFor();
  if (process.env.E2E_FOTOS) await page.screenshot({ path: path.join(process.env.E2E_FOTOS, 'central-fabrica.png'), fullPage: true });
  await semErroNaTela(page);
  await page.context().close();
});

test('Central: todas as áreas e todas as abas da ficha abrem sem erro, depois de tirar o editor antigo', { timeout: 180_000 }, async () => {
  const page = await abrirCentral('#/agora');
  const erros: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  for (const [rota, titulo] of [
    ['#/agora', 'Agora'], ['#/agenda', 'Agenda'], ['#/funil', 'Funil'], ['#/lista', 'Planilha'], ['#/clientes', 'Clientes'],
    ['#/economia', 'Economia'], ['#/listas', 'Listas'], ['#/fabrica', 'Fábrica'], ['#/criar', 'Criar'],
  ] as const) {
    await page.goto(origem + '/central/' + rota);
    await page.getByRole('heading', { name: titulo, exact: true, level: 1 }).waitFor({ timeout: 15_000 });
  }
  // A Economia mostra o que a fábrica gastou no mês.
  await page.goto(origem + '/central/#/economia');
  await page.getByRole('heading', { name: 'Custos da fábrica no mês' }).waitFor({ timeout: 15_000 });
  // A Marca ficou, com a prévia desenhada no navegador.
  await page.goto(origem + '/central/#/criar');
  await page.getByRole('button', { name: 'Marca', exact: true }).click();
  await page.locator('.bloco .visao button', { hasText: 'Cliente de Teste' }).click();
  await page.locator('canvas.previa-cv').waitFor();
  await page.waitForFunction(() => (document.querySelector('canvas.previa-cv') as HTMLCanvasElement).width > 0);
  // Cada aba da ficha do cliente de teste.
  for (const aba of ['respostas', 'plano', 'acessos', 'metas', 'baseline', 'marcos', 'conformidade', 'horas', 'agenda', 'pagina']) {
    await page.goto(origem + `/central/#/c/${CLIENTE}/${aba}`);
    await page.locator('.side .navitem.active').waitFor({ timeout: 15_000 });
  }
  assert.deepEqual(erros, [], 'erro no console');
  await semErroNaTela(page);
  await page.context().close();
});

// ---------- etapa B: a Marca, o Plano do mês e o mês inteiro pela Central ----------
//
// O critério de pronto da etapa B: a equipe cria um conjunto de cores, sobe o
// logo, escreve a pauta no Plano do mês e manda o mês inteiro pra fábrica de
// uma vez — e as peças saem com aquele conjunto e aquele logo.

/** Um PNG de verdade: retângulo de uma cor sobre fundo transparente — o logo de mentira. */
function pngDeTeste(largura: number, altura: number, cor: string): Buffer {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
  const passo = 1 + largura * 4;
  const bruto = Buffer.alloc(passo * altura);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const dentro = x >= largura * 0.1 && x < largura * 0.9 && y >= altura * 0.2 && y < altura * 0.8;
      if (dentro) bruto.set([r, g, b, 255], y * passo + 1 + x * 4);
    }
  }
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const bloco = (tipo: string, dados: Buffer) => {
    const cab = Buffer.alloc(4); cab.writeUInt32BE(dados.length);
    const fim = Buffer.alloc(4); fim.writeUInt32BE(crc(Buffer.concat([Buffer.from(tipo), dados])));
    return Buffer.concat([cab, Buffer.from(tipo), dados, fim]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr), bloco('IDAT', deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]);
}

const hex = (rgb: Uint8Array, i: number) => '#' + [0, 1, 2].map((k) => rgb[i * 3 + k].toString(16).padStart(2, '0')).join('').toUpperCase();

/** A imagem que a fábrica entregou num pedido, já lida. */
async function imagemEntregue(pedidoId: string, final: RegExp) {
  const { data: job } = await admin.from('jobs').select('saidas').eq('pedido_id', pedidoId).eq('estado', 'pronto').single();
  const s = (job!.saidas as Array<{ caminho: string }>).find((x) => final.test(x.caminho));
  assert.ok(s, `a entrega não tem ${final}`);
  const { data: blob } = await admin.storage.from('pedidos').download(s.caminho);
  return lerPng(Buffer.from(await blob!.arrayBuffer()));
}

test('Central, etapa B: conjunto e logo na Marca, pauta no Plano do mês, o mês inteiro pra fábrica — e as peças saem com os dois', { timeout: 400_000 }, async () => {
  const page = await abrirCentral('#/criar');
  await page.getByRole('heading', { name: 'Criar', exact: true, level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Marca', exact: true }).click();
  await page.locator('.bloco .visao button', { hasText: 'Cliente de Teste' }).click();

  // O logo: verde-limão, a única cor da marca que o conjunto novo não usa —
  // se ela aparece na peça, foi o logo que entrou.
  await page.getByText('O que entra nas peças', { exact: true }).waitFor();
  await page.locator('.el-entrada').setInputFiles({ name: 'logo-teste.png', mimeType: 'image/png', buffer: pngDeTeste(280, 140, '#A4E830') });
  await page.locator('.el-item', { hasText: 'logo-teste.png' }).filter({ hasText: '280×140' }).waitFor({ timeout: 30_000 });
  const { data: els } = await admin.from('marca_elementos').select('tipo, largura, altura').eq('cliente_id', CLIENTE);
  assert.deepEqual(els, [{ tipo: 'logo', largura: 280, altura: 140 }]);

  // Um conjunto novo, claro, que vira o padrão do cliente.
  const antes = await page.locator('.conj-cartao').count();
  await page.getByRole('button', { name: '+ outro conjunto' }).click();
  const novo = page.locator('.conj-cartao').nth(antes);
  await novo.waitFor();
  await novo.getByPlaceholder('Nome (ex.: Tema leve)').fill('Areia do lote');
  await novo.getByPlaceholder('Nome (ex.: Tema leve)').press('Tab');
  const lerMarca = async () => (await admin.from('clientes').select('marca').eq('id', CLIENTE).single()).data!.marca;
  await esperar(lerMarca, (m) => m.conjuntos.some((j: { nome: string }) => j.nome === 'Areia do lote'), 15_000, 'o nome do conjunto novo ser guardado');
  await page.locator('.conj-cartao').nth(antes).getByRole('button', { name: 'Usar como padrão' }).click();
  const marca = await esperar(lerMarca,
    (m) => m.conjuntos.find((j: { k: string }) => j.k === m.conjuntoPadrao)?.nome === 'Areia do lote', 15_000, 'o conjunto novo virar o padrão');
  const areia = marca.conjuntos.find((j: { k: string }) => j.k === marca.conjuntoPadrao) as { fundo: string };
  assert.equal(areia.fundo.toUpperCase(), '#F5F2EC');
  await page.locator('.conj-cartao').nth(antes).getByRole('button', { name: 'É o padrão dele' }).waitFor();
  if (process.env.E2E_FOTOS) await page.screenshot({ path: path.join(process.env.E2E_FOTOS, 'central-marca.png'), fullPage: true });

  // A pauta, escrita à mão no Plano do mês — o cliente de teste nem tem formulário.
  await page.goto(origem + `/central/#/c/${CLIENTE}/plano`);
  await page.getByText('Sem formulário, não há o que ler').waitFor({ timeout: 15_000 });
  const temas = ['Carrossel: os três erros de quem começa', 'A turma nova do laboratório', 'Capa do vídeo da aula aberta'];
  await page.getByLabel('Pauta do mês').fill(temas.join('\n'));
  await page.getByRole('button', { name: 'Produzir o mês' }).click();

  // Produzir o mês: o cliente já escolhido, um tema por linha, o formato sugerido pelo texto.
  await page.locator('#lote-cliente').waitFor();
  assert.equal(await page.locator('#lote-cliente').inputValue(), CLIENTE);
  const linhas = page.locator('.lote-linha');
  await linhas.first().waitFor({ timeout: 15_000 });
  assert.deepEqual(await linhas.locator('.lote-tema').allTextContents(), temas);
  assert.deepEqual(await linhas.locator('select').evaluateAll((s) => s.map((x) => (x as HTMLSelectElement).value)), ['carrossel', 'post', 'capa']);
  assert.deepEqual(await linhas.locator('input[type=checkbox]').evaluateAll((s) => s.map((x) => (x as HTMLInputElement).checked)), [true, true, true]);
  if (process.env.E2E_FOTOS) await page.screenshot({ path: path.join(process.env.E2E_FOTOS, 'central-lote.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pedir 3 peças à fábrica' }).click();

  // Volta pra Peças, só deste cliente.
  await page.locator('.cr-lista').waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('select[aria-label=Cliente]').inputValue(), CLIENTE);
  const { data: plano } = await admin.from('planos').select('id').eq('cliente_id', CLIENTE).eq('mes', hojeIso().slice(0, 8) + '01').single();
  const pedidos = await esperar(
    async () => (await admin.from('pedidos').select('id, tipo, estado, origem_tema, pela_equipe').eq('origem_plano', plano!.id).in('origem_tema', temas).order('criado_em')).data ?? [],
    (ps) => ps.length === 3 && ps.every((p) => p.estado === 'para_aprovar'), 300_000, 'as três peças do mês ficarem prontas',
  );
  assert.deepEqual(pedidos.map((p) => [p.origem_tema, p.tipo]), [[temas[0], 'carrossel'], [temas[1], 'post-feed'], [temas[2], 'capa']]);
  assert.ok(pedidos.every((p) => p.pela_equipe), 'o banco não marcou que foi a equipe');

  // O post: no fundo do conjunto novo, e com o logo.
  const img = await imagemEntregue(pedidos.find((p) => p.tipo === 'post-feed')!.id, /saida\/post\.png$/);
  assert.equal(hex(img.rgb, 150 * img.largura + 540), '#F5F2EC', 'o post não saiu no conjunto padrão novo');
  let limao = 0;
  for (let i = 0; i < img.largura * img.altura; i++) if (hex(img.rgb, i) === '#A4E830') limao++;
  assert.ok(limao > 2000, `o logo não entrou no post (${limao} px verde-limão)`);

  // O carrossel também nasce no conjunto novo.
  const s1 = await imagemEntregue(pedidos.find((p) => p.tipo === 'carrossel')!.id, /saida\/slide-01\.png$/);
  assert.equal(hex(s1.rgb, 150 * s1.largura + 540), '#F5F2EC', 'o carrossel não saiu no conjunto padrão novo');

  // De novo em Produzir o mês: os três temas já viraram pedido, e nada sai duas vezes.
  await page.getByRole('button', { name: 'Produzir o mês', exact: true }).click();
  await page.locator('#lote-cliente').selectOption(CLIENTE);
  await page.locator('.lote-linha.feito').nth(2).waitFor({ timeout: 15_000 });
  assert.equal(await page.getByRole('button', { name: 'Já virou pedido →' }).count(), 3);
  assert.ok(await page.getByRole('button', { name: 'Pedir 0 peças à fábrica' }).isDisabled());
  await semErroNaTela(page);
  await page.context().close();
});
