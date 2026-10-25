// Põe um pedido de teste na fila e acompanha pelo Realtime até o fim — o mesmo
// caminho que a tela de acompanhamento vai usar no passo 2.
//
//   npm run enfileirar-teste                       Moacyr, texto padrão
//   npm run enfileirar-teste -- --cliente "Moacyr" --texto "Turma nova do laboratório"
//
// Sai com código 0 só se o job terminou pronto E os arquivos estão no balde
// com o tamanho que o banco diz. É o critério de pronto do passo 1.
import { parseArgs } from 'node:util';
import { conectar, BALDE } from '../src/fila.ts';
import { lerConfig } from '../src/config.ts';

const { values } = parseArgs({
  options: {
    cliente: { type: 'string', default: 'Moacyr' },
    texto: { type: 'string', default: 'Teste da fábrica: o laboratório tem turma nova, e o primeiro post dela saiu sem ninguém abrir um editor.' },
    skill: { type: 'string', default: 'post-feed-teste' },
    'limite-min': { type: 'string', default: '15' },
  },
});

const cfg = lerConfig();
const sb = conectar(cfg);

const { data: clientes, error: e1 } = await sb.from('clientes').select('id, nome').ilike('nome', `%${values.cliente}%`);
if (e1) throw e1;
if (clientes.length !== 1) throw new Error(`"${values.cliente}" bate com ${clientes.length} clientes: ${clientes.map((c) => c.nome).join(', ')}`);
const cliente = clientes[0];

const { data: pedido, error: e2 } = await sb.from('pedidos')
  .insert({ cliente_id: cliente.id, tipo: 'post-feed', titulo: 'Teste da fábrica', briefing: { texto: values.texto } })
  .select('id').single();
if (e2) throw e2;
const { data: job, error: e3 } = await sb.from('jobs')
  .insert({ pedido_id: pedido.id, skill: values.skill })
  .select('id').single();
if (e3) throw e3;
console.log(`pedido ${pedido.id}\njob    ${job.id}  (${cliente.nome}, skill ${values.skill})\n`);

type Linha = { atualizado_em: string; estado: string; etapa: string | null; progresso: number; erro: string | null; saidas: Array<{ caminho: string; bytes: number; papel: string }>; custo_usd: number; render_segundos: number; tokens_entrada: number; tokens_saida: number };

const final = await new Promise<Linha>((resolver, rejeitar) => {
  const limite = setTimeout(() => rejeitar(new Error(`passou de ${values['limite-min']} min sem terminar`)), Number(values['limite-min']) * 60_000);
  let ultima = '';
  let vista = 0;
  const mostrar = (l: Linha) => {
    // A leitura inicial e o Realtime correm em paralelo, e o que chega por
    // último nem sempre é o mais novo. Sem isto o progresso volta de 3% pra 0%
    // — e a tela do cliente, no passo 2, escuta do mesmo jeito. Compara como
    // data: o REST e o Realtime não formatam o timestamptz igual.
    const quando = Date.parse(l.atualizado_em);
    if (quando < vista) return;
    vista = quando;
    const t = `${l.estado.padEnd(8)} ${String(l.progresso).padStart(5)}%  ${l.etapa ?? ''}${l.erro ? `  [${l.erro}]` : ''}`;
    if (t !== ultima) console.log(`${new Date().toLocaleTimeString('pt-BR')}  ${t}`);
    ultima = t;
    if (l.estado === 'pronto' || l.estado === 'falhou') {
      clearTimeout(limite);
      void sb.removeAllChannels();
      resolver(l);
    }
  };
  sb.channel(`job-${job.id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${job.id}` }, (m) => mostrar(m.new as Linha))
    .subscribe(async (status) => {
      // Lê uma vez depois de inscrito: se o job andou antes da inscrição, não perde.
      if (status === 'SUBSCRIBED') {
        const { data } = await sb.from('jobs').select('*').eq('id', job.id).single();
        if (data) mostrar(data as Linha);
      }
    });
});

if (final.estado !== 'pronto') {
  console.error(`\nFALHOU: ${final.erro}`);
  process.exit(1);
}

console.log(`\ncusto US$ ${Number(final.custo_usd).toFixed(4)} · ${final.tokens_entrada} tokens de entrada, ${final.tokens_saida} de saída · ${final.render_segundos}s nos apps`);
let tudoCerto = true;
for (const s of final.saidas) {
  const pasta = s.caminho.split('/').slice(0, -1).join('/');
  const nome = s.caminho.split('/').at(-1);
  const { data } = await sb.storage.from(BALDE).list(pasta, { search: nome });
  const noBalde = data?.find((o) => o.name === nome);
  const bate = noBalde && Number(noBalde.metadata?.size) === s.bytes;
  if (!bate) tudoCerto = false;
  console.log(`${bate ? 'ok   ' : 'FALTA'}  ${s.papel.padEnd(8)} ${s.caminho}  ${s.bytes} bytes`);
}
process.exit(tudoCerto ? 0 : 1);
