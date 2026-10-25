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
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RAIZ_REPO, RAIZ_WORKER } from '../src/config.ts';

const URL_SB = 'https://yxewmauwnxnrrhevlbtc.supabase.co';
const CHAVE_PUBLICA = 'sb_publishable_G_FuzadzmX2BwkRO81H3mw_xoYnthod';
const CONTA = 'b0a00000-0000-4000-8000-00000000e2e0';
const CLIENTE = 'b0a00000-0000-4000-8000-00000000e2e1';
const EMAIL = 'cliente-teste@fabrica-bora.test';

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
  await prepararCliente();

  const html = readFileSync(path.join(RAIZ_REPO, 'sites', 'app', 'index.html'));
  servidor = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
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

/** Hoje + n dias, no fuso desta máquina (o mesmo do app). */
function hojeIso(mais = 0) {
  const d = new Date();
  d.setDate(d.getDate() + mais);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

after(async () => {
  await limparAgenda().catch((e) => console.error(e.message));
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
// WCAG — a mesma varredura que a Central e o Estúdio passaram a usar.
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

test('Hoje: a pergunta, seis cartões, três ativos, e nenhum cliente da Bora à vista', async () => {
  const page = await abrir();
  await page.getByRole('heading', { name: 'O que você quer criar hoje?' }).waitFor();
  await semErroNaTela(page);
  assert.equal(await page.locator('.tipo').count(), 6);
  assert.equal(await page.locator('.tipo[aria-disabled="true"]').count(), 3, 'post, carrossel e capa ativos; o resto em breve');
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
