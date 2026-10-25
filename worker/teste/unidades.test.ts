// O que dá pra testar sem app, sem banco e sem modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { carregarSkills, escolherSkill, interpretarSkill, lerCabecalho, lerSaida } from '../src/skills.ts';
import { contraste, conjuntoPadrao, marcaParaAgente, resolverFonte, tintaPara } from '../src/marca.ts';
import { dimensoesPng, dimensoesPsd, conferirSaida } from '../src/verificar.ts';
import { caminhoNoBalde, type Job } from '../src/fila.ts';
import { servidorMcp } from '../src/apps.ts';
import { montarPedido, montarSistema } from '../src/instrucoes.ts';
import { RAIZ_REPO } from '../src/config.ts';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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

test('as skills do repositório carregam, e a de teste só roda forçada', () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const t = skills.get('post-feed-teste');
  assert.ok(t);
  assert.deepEqual(t.apps, ['photocraft']);
  assert.deepEqual(t.tipos, []);
  assert.equal(escolherSkill(skills, 'post-feed', 'post-feed-teste').nome, 'post-feed-teste');
  assert.throws(() => escolherSkill(skills, 'post-feed', null), /nenhuma skill/);
  assert.throws(() => escolherSkill(skills, 'post-feed', 'nao-existe'), /não existe/);
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
  const pedido = montarPedido(skill, { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'oi', anexos: [] }, publicar_em: null }, texto);
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
