// O que dá pra testar sem app, sem banco e sem modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { carregarSkills, escolherSkill, expandirSaidas, interpretarSkill, lerCabecalho, lerQuantidade, lerSaida } from '../src/skills.ts';
import { contraste, conjuntoPadrao, marcaParaAgente, resolverFonte, tintaPara } from '../src/marca.ts';
import { dimensoesPng, dimensoesPsd, conferirSaida } from '../src/verificar.ts';
import { caminhoNoBalde, type Job } from '../src/fila.ts';
import { servidorMcp } from '../src/apps.ts';
import { montarPedido, montarSistema } from '../src/instrucoes.ts';
import { RAIZ_REPO } from '../src/config.ts';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('cabeçalho: escalar, lista entre colchetes, lista com hífen, comentário', () => {
  const { campos, corpo } = lerCabecalho('---\nname: x\n# nota\ntipos: [a, b]\nvazia: []\nsaidas:\n  - saida/a.png 10x20\n  - editavel/a.psd\n---\ncorpo aqui\n');
  assert.equal(campos.name, 'x');
  assert.deepEqual(campos.tipos, ['a', 'b']);
  assert.deepEqual(campos.vazia, []);
  assert.deepEqual(campos.saidas, ['saida/a.png 10x20', 'editavel/a.psd']);
  assert.equal(corpo, 'corpo aqui');
});

test('saída fora de saida/ ou editavel/ é recusada', () => {
  assert.throws(() => lerSaida('../fora.png'));
  assert.throws(() => lerSaida('saida/sub/a.png'));
  assert.throws(() => lerSaida('saida/a.png 10por20'));
  assert.deepEqual(lerSaida('saida/a.png 1080x1350'), { caminho: 'saida/a.png', largura: 1080, altura: 1350 });
});

test('skill com nome diferente da pasta, ou app desconhecido, não carrega', () => {
  assert.throws(() => interpretarSkill('a', '---\nname: b\nsaidas:\n  - saida/x.png\n---\n'), /se chama/);
  assert.throws(() => interpretarSkill('a', '---\nname: a\napps: [photoshop]\nsaidas:\n  - saida/x.png\n---\n'), /app desconhecido/);
});

test('as skills do repositório carregam e cada tipo do app cai na skill certa', () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  assert.deepEqual([...skills.keys()].sort(), ['capa-thumbnail', 'carrossel', 'copy-e-hashtags', 'post-feed', 'post-feed-teste']);
  assert.equal(escolherSkill(skills, 'post-feed', null).nome, 'post-feed');
  assert.equal(escolherSkill(skills, 'carrossel', null).nome, 'carrossel');
  assert.equal(escolherSkill(skills, 'capa', null).nome, 'capa-thumbnail');
  assert.equal(escolherSkill(skills, 'post-feed', 'post-feed-teste').nome, 'post-feed-teste', 'a de teste ainda roda pelo nome');
  assert.throws(() => escolherSkill(skills, 'reel', null), /nenhuma skill/);
  assert.throws(() => escolherSkill(skills, 'post-feed', 'nao-existe'), /não existe/);
  for (const s of ['post-feed', 'carrossel', 'capa-thumbnail']) {
    assert.deepEqual(skills.get(s)!.usa, ['copy-e-hashtags'], `${s} entrega legenda`);
    assert.ok(skills.get(s)!.saidas.some((x) => x.caminho === 'saida/legenda.txt'));
  }
});

test('saídas variáveis: o carrossel tem quantos slides o cliente pediu, dentro do que a skill aceita', () => {
  const carrossel = carregarSkills(path.join(RAIZ_REPO, 'skills')).get('carrossel')!;
  assert.deepEqual(carrossel.quantidade, { campo: 'slides', min: 3, max: 10, padrao: 5 });
  const slides = (b: Record<string, unknown>) => expandirSaidas(carrossel, b).filter((s) => s.caminho.endsWith('.png')).map((s) => s.caminho);
  assert.deepEqual(slides({ slides: 3 }), ['saida/slide-01.png', 'saida/slide-02.png', 'saida/slide-03.png']);
  assert.equal(slides({}).length, 5, 'sem escolha, o padrão');
  assert.equal(slides({ slides: 50 }).length, 10, 'acima do máximo, o máximo');
  assert.equal(slides({ slides: 'muitos' }).length, 5);
  assert.ok(expandirSaidas(carrossel, { slides: 3 }).some((s) => s.caminho === 'editavel/slide-03.psd'));
  assert.throws(() => lerQuantidade('slides 3-10'), /formato/);
  assert.throws(() => interpretarSkill('x', '---\nname: x\nsaidas:\n  - saida/a-{n}.png\n---\n'), /juntas/);
});

test('salvar texto: só .txt da entrega, nada fora de saida/', async () => {
  const { salvarTexto } = await import('../src/agente.ts');
  const pasta = mkdtempSync(path.join(tmpdir(), 'txt-'));
  const saidas = [{ caminho: 'saida/legenda.txt' }, { caminho: 'saida/post.png' }];
  salvarTexto(pasta, saidas, 'saida/legenda.txt', 'oi\r\n#tag  ');
  assert.equal(readFileSync(path.join(pasta, 'saida', 'legenda.txt'), 'utf8'), 'oi\n#tag\n');
  assert.throws(() => salvarTexto(pasta, saidas, 'saida/post.png', 'x'), /só dá pra salvar/);
  assert.throws(() => salvarTexto(pasta, saidas, '../fora.txt', 'x'), /só dá pra salvar/);
  assert.throws(() => salvarTexto(pasta, saidas, 'editavel/legenda.txt', 'x'), /só dá pra salvar/);
});

test('conferência dos textos: limite do Instagram, hashtags, emoji e os dois títulos', async () => {
  const { conferirTextos } = await import('../src/conferencia.ts');
  const pasta = mkdtempSync(path.join(tmpdir(), 'txt-'));
  mkdirSync(path.join(pasta, 'saida'));
  const conferir = (nome: string, texto: string, semEmoji = true) => {
    writeFileSync(path.join(pasta, 'saida', nome), texto);
    return conferirTextos(pasta, [{ caminho: `saida/${nome}`, papel: 'saida', mime: 'text/plain', bytes: texto.length }], { semEmoji });
  };
  assert.deepEqual(conferir('legenda.txt', 'Gancho curto.\n\nCorpo.\n\n#um #dois #tres').erros, []);
  assert.match(conferir('legenda.txt', 'Gancho 🚀\n\n#a #b #c').erros[0], /emoji/);
  assert.deepEqual(conferir('legenda.txt', 'Gancho 🚀\n\n#a #b #c', false).erros, [], 'marca que usa emoji');
  assert.match(conferir('legenda.txt', 'x'.repeat(2300)).erros[0], /2\.200/);
  assert.match(conferir('legenda.txt', 'oi ' + Array.from({ length: 31 }, (_, i) => `#h${i}`).join(' ')).erros[0], /30/);
  assert.match(conferir('legenda.txt', 'sem hashtag nenhuma').avisos[0], /hashtag/);
  assert.deepEqual(conferir('titulos.txt', 'Um título\nOutro título').erros, []);
  assert.match(conferir('titulos.txt', 'Só um').erros[0], /dois/);
});

test('atalhos de ajuste no roteiro: somam, giram as cores e listam o que só o Claude faz', async () => {
  const { aplicarAtalhos } = await import('../src/roteiro.ts');
  assert.deepEqual(aplicarAtalhos([], 3), { conjunto: 0, maxPalavras: 8, ignorados: [] });
  const r = aplicarAtalhos([
    { texto: null, atalhos: ['outra cor da marca'] },
    { texto: 'tira a palavra turma', atalhos: ['mais curto', 'outra cor da marca', 'mais sério'] },
  ], 3);
  assert.equal(r.conjunto, 2);
  assert.equal(r.maxPalavras, 4);
  assert.deepEqual(r.ignorados, ['mais sério', '"tira a palavra turma"']);
  assert.equal(aplicarAtalhos([{ texto: null, atalhos: ['outra cor da marca', 'outra cor da marca'] }], 2).conjunto, 0, 'volta pro começo');
});

test('o pedido de ajuste diz o que mudar, o que já foi mudado e de onde partir', () => {
  const skill = carregarSkills(path.join(RAIZ_REPO, 'skills')).get('post-feed')!;
  const pedido = { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'oi' }, publicar_em: null };
  const saidas = expandirSaidas(skill, pedido.briefing);
  const t = montarPedido(skill, pedido, 'marca', {
    saidas,
    ajustes: [{ texto: null, atalhos: ['outra cor da marca'] }, { texto: 'tira a exclamação', atalhos: ['mais curto'] }],
    temAnterior: true,
  });
  assert.ok(t.includes('pediu: "mais curto" e "tira a exclamação"'));
  assert.ok(t.includes('- "outra cor da marca"'));
  assert.ok(t.includes('entrada/anterior/'));
  assert.ok(!montarPedido(skill, pedido, 'marca', { saidas }).includes('Ajuste'), 'produção não fala de ajuste');
});

test('o pedido leva os elementos da marca e o motivo da reprovação anterior', () => {
  const skill = carregarSkills(path.join(RAIZ_REPO, 'skills')).get('post-feed')!;
  const pedido = { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'oi' }, publicar_em: null };
  const saidas = expandirSaidas(skill, pedido.briefing);
  const com = montarPedido(skill, pedido, 'marca', {
    saidas,
    elementos: [{ tipo: 'logo', nome: 'Logo', arquivo: 'entrada/elementos/logo-1.png', largura: 800, altura: 400 }],
    erroAnterior: 'texto em "Arial"; a fonte da marca é "Manrope"',
  });
  assert.ok(com.includes('entrada/elementos/logo-1.png — logo "Logo", 800×400 px'));
  assert.ok(com.includes('A tentativa anterior foi reprovada') && com.includes('"Manrope"'));
  assert.ok(montarPedido(skill, pedido, 'marca', { saidas }).includes('nenhum cadastrado. Não ponha logo nem foto'));
});

test('o sistema da skill leva junto as skills que ela usa', () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const s = montarSistema(skills.get('carrossel')!, skills);
  assert.ok(s.includes('# Parte "copy-e-hashtags"'));
  assert.ok(s.includes('salvar_texto'));
});

test('fonte: a da marca se instalada, senão a cadeia do Estúdio, e avisa a troca', () => {
  assert.deepEqual(resolverFonte('Garet', 'display', ['Arial', 'Garet']), { pedida: 'Garet', usada: 'Garet', substituida: false });
  assert.deepEqual(resolverFonte('Garet', 'display', ['Arial', 'Segoe UI']), { pedida: 'Garet', usada: 'Segoe UI', substituida: true });
  assert.equal(resolverFonte('', 'impacto', ['Impact', 'Arial']).usada, 'Impact');
  assert.equal(resolverFonte(undefined, undefined, ['space grotesk']).usada, 'space grotesk');
  assert.equal(resolverFonte('X', 'mono', ['Wingdings']).usada, 'Wingdings');
});

test('contraste bate com a WCAG e a tinta automática escolhe o lado certo', () => {
  assert.equal(contraste('#FFFFFF', '#000000').toFixed(0), '21');
  assert.equal(contraste('#15181C', '#E8A33D').toFixed(1), '8.3'); // o número que está na paleta do Moacyr
  assert.equal(tintaPara('#6128C2'), '#FFFFFF');
  assert.equal(tintaPara('#FAC712'), '#0A0A0A');
});

test('conjunto: o padrão da marca; sem tinta, calcula; sem conjuntos, deriva da cor', () => {
  const marca = {
    conjuntoPadrao: 'j-rua',
    conjuntos: [
      { k: 'j-roxo', nome: 'Roxo', fundo: '#6128C2', tinta: '#FFFFFF', destaque: '#E53B93', faixa: '#E53B93' },
      { k: 'j-rua', nome: 'Rosa de rua', fundo: '#E53B93', tinta: '', destaque: '#FAC712', faixa: '#6128C2' },
    ],
  };
  const c = conjuntoPadrao(marca, null);
  assert.equal(c.nome, 'Rosa de rua');
  assert.equal(c.tinta, tintaPara('#E53B93'));
  const d = conjuntoPadrao({}, '#E8A33D');
  assert.equal(d.fundo, '#E8A33D');
  assert.equal(d.tinta, '#0A0A0A');
});

test('o texto da marca leva o que o agente não pode errar, e o sistema não muda entre clientes', () => {
  const fonte = { pedida: 'Garet', usada: 'Segoe UI', substituida: true };
  const { texto } = marcaParaAgente(
    { nome: 'Glau Aguiar', nome_preferido: null, cor: '#6128C2', registro_profissional: null, marca: { evitar: 'política', obrigatorios: 'estrela amarela', alinha: 'esq' } },
    fonte,
  );
  for (const trecho of ['Glau Aguiar', '"Segoe UI"', '"Garet"', 'NUNCA: política', 'estrela amarela', 'à esquerda']) assert.ok(texto.includes(trecho), trecho);

  const skill = carregarSkills(path.join(RAIZ_REPO, 'skills')).get('post-feed-teste')!;
  assert.equal(montarSistema(skill), montarSistema(skill));
  assert.ok(!montarSistema(skill).includes('Glau'), 'marca do cliente vazou pro sistema e quebraria o cache');
  const pedido = montarPedido(skill, { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'oi', anexos: [] }, publicar_em: null }, texto, { saidas: skill.saidas });
  assert.ok(pedido.includes('O que o cliente escreveu: oi'));
  assert.ok(pedido.includes('saida/post.png (1080×1350 px)'));
  assert.ok(!pedido.includes('anexos'), 'objeto do briefing não vira texto solto');
});

test('dimensões de PNG e PSD pelo cabeçalho; lixo não passa', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1080, 16);
  png.writeUInt32BE(1350, 20);
  assert.deepEqual(dimensoesPng(png), { largura: 1080, altura: 1350 });
  assert.equal(dimensoesPng(Buffer.from('não é png nenhum, só texto...')), null);

  const psd = Buffer.alloc(26);
  psd.write('8BPS', 0, 'ascii');
  psd.writeUInt16BE(1, 4);
  psd.writeUInt32BE(1350, 14);
  psd.writeUInt32BE(1080, 18);
  assert.deepEqual(dimensoesPsd(psd), { largura: 1080, altura: 1350 });

  const pasta = mkdtempSync(path.join(tmpdir(), 'conf-'));
  mkdirSync(path.join(pasta, 'saida'));
  writeFileSync(path.join(pasta, 'saida', 'a.png'), png);
  assert.equal(conferirSaida(pasta, { caminho: 'saida/a.png', largura: 1080, altura: 1350 }).papel, 'saida');
  assert.throws(() => conferirSaida(pasta, { caminho: 'saida/a.png', largura: 1080, altura: 1080 }), /1080×1350/);
  assert.throws(() => conferirSaida(pasta, { caminho: 'saida/b.png' }), /não existe/);
});

test('caminho no balde segue a ordem que o RLS lê: conta/cliente/pedido/job/papel', () => {
  const job = { id: 'J', conta_id: 'C', cliente_id: 'K', pedido_id: 'P' } as Job;
  assert.equal(caminhoNoBalde(job, 'saida/post.png'), 'C/K/P/J/saida/post.png');
});

test('cada app sobe com as flags que ele aceita', () => {
  const pasta = path.join(tmpdir(), 'job-x');
  assert.deepEqual(servidorMcp('photocraft', pasta).args, ['mcp', '--automation-read-root', pasta, '--automation-write-root', pasta]);
  assert.ok(servidorMcp('effectcraft', pasta).args!.includes('--autosave'));
  // O FilmCraft sai com erro 2 se receber raiz de automação.
  assert.ok(!servidorMcp('filmcraft', pasta).args!.some((a) => a.startsWith('--automation')));
  assert.ok(!servidorMcp('lightcraft', pasta).args!.some((a) => a.startsWith('--automation')));
});
