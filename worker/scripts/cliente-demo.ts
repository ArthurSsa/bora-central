// Um cliente de demonstração, pra testar a Central, o app e a fábrica de
// ponta a ponta sem mexer em cliente de verdade: a Padaria Fermento Vivo,
// numa conta só dela, com a marca inteira (paleta, conjuntos, logo em vetor,
// trilha com licença), o formulário respondido, o plano do mês com pauta e um
// acesso ao app.
//
//   npm run demo:criar      cria, ou refaz do zero se já existir
//   npm run demo:remover    apaga o cliente, a conta, os pedidos, os arquivos e o acesso
//
// Tudo dele leva "(demonstração)" no nome. O acesso ao app é por link no
// e-mail DEMO_EMAIL do .env (um "+demo" do e-mail da Bora cai na mesma caixa);
// sem ele, o acesso fica num endereço de teste que não recebe e-mail.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { trilhaDeTeste, temSoundCraft } from '../teste/trilha.ts';

const CONTA = 'b0a00000-0000-4000-8000-00000000de30';
const CLIENTE = 'b0a00000-0000-4000-8000-00000000de31';
const EMAIL = process.env.DEMO_EMAIL || 'demo@fabrica-bora.test';
const sb = createClient(process.env.SUPABASE_URL ?? 'https://yxewmauwnxnrrhevlbtc.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const ok = <T>(r: { data: T; error: { message: string } | null } | { data: unknown; error: { message: string } }, onde: string): T => {
  if (r.error) throw new Error(`${onde}: ${r.error.message}`);
  return r.data as T;
};

/** O logo: um pão de forma com três cortes, em duas cores da marca. Desenhado aqui, de ninguém. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <path d="M20 70c0-30 25-50 60-50s60 20 60 50v30H20z" fill="#7A3E1D"/>
  <path d="M50 52l14-14M74 56l14-14M98 60l14-14" stroke="#E8B04B" stroke-width="7" stroke-linecap="round"/>
  <circle cx="190" cy="64" r="34" fill="#E8B04B"/>
  <path d="M190 40v48M176 52l14 10 14-10M176 70l14 10 14-10" stroke="#7A3E1D" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const MARCA = {
  paleta: [
    { nome: 'Casca', cor: '#7A3E1D', uso: 'Principal: a cor do pão' },
    { nome: 'Miolo', cor: '#F6EBDD', uso: 'Fundo claro, dia a dia' },
    { nome: 'Fermento', cor: '#E8B04B', uso: 'Destaque: novidade, fornada' },
    { nome: 'Forno', cor: '#2B1A12', uso: 'Fundo escuro, anúncios' },
    { nome: 'Branco', cor: '#FFFFFF', uso: 'Texto sobre o forno' },
  ],
  conjuntos: [
    { k: 'c-forno', nome: 'Forno', quando: 'anúncio, horário da fornada', fundo: '#2B1A12', tinta: '#FFFFFF', destaque: '#E8B04B', faixa: '#E8B04B' },
    { k: 'c-miolo', nome: 'Miolo', quando: 'dia a dia, receitas', fundo: '#F6EBDD', tinta: '#2B1A12', destaque: '#7A3E1D', faixa: '#7A3E1D' },
    { k: 'c-fermento', nome: 'Fermento', quando: 'novidade, promoção', fundo: '#E8B04B', tinta: '#2B1A12', destaque: '#2B1A12', faixa: '#7A3E1D' },
  ],
  conjuntoPadrao: 'c-forno',
  fonteMarca: 'Manrope', fonteFalback: 'display',
  alinha: 'esq', margem: 'folgada', numerar: true,
  tom: 'Caloroso e direto, como conversa no balcão. Frase curta, sem exagero.',
  evitar: 'Promessa de "melhor pão da cidade", preço que não está no pedido, emoji em excesso.',
  publico: 'Vizinhos do bairro, 25 a 60 anos, que passam a pé de manhã.',
  chamada: 'Passa aqui: a fornada sai às 7h.',
  hashtags: '#padaria #fermentonatural #paodebairro',
  obrigatorios: 'O logo em toda peça; o horário da fornada quando for anúncio.',
};

/** O formulário "Conhecendo você", respondido como a dona da padaria responderia. */
const RESPOSTAS = {
  trilha: 'solo',
  nome_pref: 'Marta, da Fermento Vivo',
  tempo_trabalho: 'Seis anos com a padaria; antes, dez anos de confeitaria em hotel.',
  motivo_comeco: 'Queria fazer pão de verdade, de fermentação longa, pro bairro onde cresci.',
  gosta_mais: 'Abrir a porta às 7h com a fornada saindo e ver a fila de vizinhos.',
  pesa_cansa: 'A madrugada de seis dias por semana e explicar por que o pão custa mais que o de mercado.',
  descricao_outros: 'A padaria do pão de fermentação natural, que vende o pão ainda quente.',
  o_que_faz: 'Pão de fermentação natural, broa, focaccia e café da manhã no balcão.',
  cliente_ideal: 'Quem mora ou trabalha a até 15 minutos a pé e toma café da manhã fora.',
  faz_procurar: 'Pão que dura três dias sem endurecer e o cheiro na esquina.',
  diferencial: 'Fermentação de 36 horas, farinha de moinho pequeno, sem melhorador.',
  como_encontram: 'Passando na frente, indicação de vizinho e o Instagram do bairro.',
  entrega_orgulho: 'O pão de centeio que um cliente leva toda semana pra mãe de 90 anos.',
  elogio_frequente: '"Esse pão não parece de padaria, parece de casa."',
  preco_atual: 'Pão de fermentação natural de 800 g a R$ 28.',
  forma_precificacao: 'Custo da farinha e do tempo de forno, mais margem de 40%.',
  ticket_medio: 'R$ 35 por visita.',
  forma_pagamento: 'Pix, cartão e fiado pros de sempre.',
  percepcao_preco: 'Quem prova acha justo; quem só vê a vitrine acha caro.',
  cliente_mais_lucro: 'O café da manhã de fim de semana pra família.',
};

const PLANO = `Este mês a Fermento Vivo mostra o processo: o que faz o pão durar três dias e por que custa o que custa.
Um anúncio forte do horário da fornada por semana; no resto, bastidor e receita no conjunto Miolo.
Meta: mais gente do bairro passando às 7h.`;

const PAUTA = [
  'A fornada sai às 7h: venha buscar o pão quente',
  'Por que o nosso pão leva 36 horas pra ficar pronto',
  'Carrossel: três jeitos de usar o pão amanhecido',
  'Bastidor da madrugada na padaria',
  'Cartaz: aula aberta de fermentação no sábado',
  'Guia: cinco cuidados pra o pão durar a semana',
];

const hojeLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

/** Tudo de um prefixo num balde, descendo nas pastas. */
async function listarTudo(balde: string, prefixo: string): Promise<string[]> {
  const { data } = await sb.storage.from(balde).list(prefixo, { limit: 1000 });
  const saida: string[] = [];
  for (const o of data ?? []) {
    if (o.id) saida.push(`${prefixo}/${o.name}`);
    else saida.push(...(await listarTudo(balde, `${prefixo}/${o.name}`)));
  }
  return saida;
}

async function remover() {
  for (const [balde, prefixo] of [['pedidos', `${CONTA}/${CLIENTE}`], ['elementos', CLIENTE], ['trilhas', CLIENTE], ['identidades', CLIENTE]] as const) {
    const arquivos = await listarTudo(balde, prefixo);
    for (let i = 0; i < arquivos.length; i += 100) await sb.storage.from(balde).remove(arquivos.slice(i, i + 100));
  }
  // O que a equipe pode ter criado testando a ficha: some junto.
  for (const tabela of ['pedidos', 'tarefas', 'planos', 'onboarding_respostas', 'marca_elementos', 'marca_trilhas', 'marca_arquivos',
    'acessos', 'metas', 'baselines', 'marcos', 'conformidade_itens', 'horas', 'conta_membros']) {
    const { error } = await sb.from(tabela).delete().eq('cliente_id', CLIENTE);
    if (error && !/does not exist|column/i.test(error.message)) throw new Error(`limpar ${tabela}: ${error.message}`);
  }
  ok(await sb.from('conta_membros').delete().eq('conta_id', CONTA), 'membros da conta');
  ok(await sb.from('clientes').delete().eq('id', CLIENTE), 'cliente');
  ok(await sb.from('contas').delete().eq('id', CONTA), 'conta');
  const { data: lista } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const u = lista.users.find((x) => x.email === EMAIL);
  if (u) ok(await sb.auth.admin.deleteUser(u.id), 'acesso ao app');
}

async function criar() {
  await remover();
  ok(await sb.from('contas').insert({ id: CONTA, nome: 'Fermento Vivo (demonstração)' }), 'conta');
  ok(await sb.from('clientes').insert({
    id: CLIENTE, conta_id: CONTA, nome: 'Padaria Fermento Vivo (demonstração)', nome_preferido: 'Fermento Vivo',
    tipo_cliente: 'solo', estagio: 'ativo', vertical: 'alimentação', responsavel: 'Bora',
    contato_nome: 'Marta (fictícia)', instagram: '@fermentovivo.demo', cor: '#7A3E1D',
    inicio_contrato: hojeLocal(), valor_mensal: 0, como_chegou: 'demonstração',
    primeiro_valor_prometido: 'Primeira semana com o horário da fornada fixado no Instagram', primeiro_valor_data: hojeLocal(),
    observacoes: 'Cliente de demonstração: tudo aqui é inventado. Apague com npm run demo:remover.',
    marca: MARCA,
  }), 'cliente');

  // O formulário respondido, já ligado ao cliente (não aparece na caixa de entrada).
  ok(await sb.from('onboarding_respostas').insert({
    cliente_id: CLIENTE, nome_informado: 'Marta (demonstração)', origem: 'demonstracao', respostas: RESPOSTAS,
  }), 'formulário');

  // O plano do mês corrente, com a pauta: é dela que sai o "Produzir o mês".
  ok(await sb.from('planos').insert({ cliente_id: CLIENTE, mes: hojeLocal().slice(0, 8) + '01', plano: PLANO, pauta: PAUTA.join('\n'), diagnostico: {} }), 'plano');

  // O logo em vetor: a fábrica faz o PNG e a versão de uma cor sozinha.
  const caminhoLogo = `${CLIENTE}/demo-logo-fermento-vivo.svg`;
  ok(await sb.storage.from('elementos').upload(caminhoLogo, Buffer.from(LOGO_SVG), { contentType: 'image/svg+xml', upsert: true }), 'logo');
  ok(await sb.from('marca_elementos').insert({ cliente_id: CLIENTE, tipo: 'logo', nome: 'Logo Fermento Vivo (demonstração)', caminho: caminhoLogo,
    bytes: Buffer.byteLength(LOGO_SVG), mime: 'image/svg+xml', largura: null, altura: null }), 'logo na marca');

  // A trilha: a música de demonstração do SoundCraft, que ele mesmo sintetiza.
  if (temSoundCraft) {
    const wav = readFileSync(trilhaDeTeste());
    const caminho = `${CLIENTE}/demo-trilha-soundcraft.wav`;
    ok(await sb.storage.from('trilhas').upload(caminho, wav, { contentType: 'audio/wav', upsert: true }), 'trilha');
    ok(await sb.from('marca_trilhas').insert({ cliente_id: CLIENTE, nome: 'Demo do SoundCraft', caminho, bytes: wav.length, mime: 'audio/wav', segundos: 55.9, padrao: true,
      licenca: 'Música de demonstração sintetizada pelo próprio SoundCraft; só pra teste' }), 'trilha na marca');
  }

  // O acesso ao app: entra pelo link no e-mail, sem senha.
  const { data: lista } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const uid = lista.users.find((x) => x.email === EMAIL)?.id
    ?? (ok(await sb.auth.admin.createUser({ email: EMAIL, email_confirm: true }), 'acesso ao app') as { user: { id: string } }).user.id;
  ok(await sb.from('conta_membros').upsert({ conta_id: CONTA, user_id: uid, papel: 'cliente', cliente_id: CLIENTE }), 'acesso ao app');

  console.log(`pronto: "Padaria Fermento Vivo (demonstração)" (${CLIENTE})`);
  console.log(`  marca: 5 cores, 3 conjuntos (Forno é o padrão), logo em SVG${temSoundCraft ? ', trilha padrão' : ''}`);
  console.log(`  formulário respondido, plano de ${hojeLocal().slice(0, 7)} com ${PAUTA.length} temas`);
  console.log(`  app: entra com o link mandado pra ${EMAIL}`);
}

if (process.argv.includes('--remover')) {
  await remover();
  console.log('o cliente de demonstração, a conta, os pedidos, os arquivos e o acesso foram apagados');
} else {
  await criar();
}
