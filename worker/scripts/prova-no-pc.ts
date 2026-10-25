// Prova a fábrica no PC com um pedido de verdade, no cliente de teste:
// pede uma abertura animada, derruba o worker no meio (se pedido) e espera o
// vigia religar, a rodada voltar pra fila e o pedido chegar em "para aprovar".
//
//   node --env-file=.env scripts/prova-no-pc.ts [--derrubar]
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const CLIENTE = 'b0a00000-0000-4000-8000-00000000e2e1';
const sb = createClient(process.env.SUPABASE_URL ?? 'https://yxewmauwnxnrrhevlbtc.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const derrubar = process.argv.includes('--derrubar');
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { data: ped, error } = await sb.from('pedidos').insert({
  cliente_id: CLIENTE, tipo: 'reel', titulo: 'Prova da fábrica no PC', estado: 'produzindo',
  briefing: { texto: 'Prova da fábrica no PC', formato: 'abertura' },
}).select('id').single();
if (error) throw error;
await sb.from('jobs').insert({ pedido_id: ped.id, rodada: 'producao' });
console.log(`pedido ${ped.id} na fila`);

let derrubado = false;
const inicio = Date.now();
for (;;) {
  const { data: j } = await sb.from('jobs').select('estado, etapa, progresso, tentativas, worker_id, erro').eq('pedido_id', ped.id).single();
  const { data: p } = await sb.from('pedidos').select('estado').eq('id', ped.id).single();
  console.log(`${Math.round((Date.now() - inicio) / 1000)} s · job ${j!.estado} (${j!.etapa ?? '-'}, ${j!.progresso}%, tentativa ${j!.tentativas}) · pedido ${p!.estado}`);
  if (derrubar && !derrubado && j!.estado === 'rodando' && Number(j!.progresso) >= 10) {
    // O worker da fábrica, não o vigia: o vigia é quem tem que religar.
    const pid = execFileSync('powershell', ['-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*src/worker.ts*' -and $_.CommandLine -notlike '*e2e*' }).ProcessId"], { encoding: 'utf8' }).trim();
    console.log(`>>> derrubando o worker ${pid} no meio da rodada`);
    execFileSync('taskkill', ['/PID', pid, '/F']);
    derrubado = true;
  }
  if (p!.estado === 'para_aprovar') { console.log(`chegou no cliente em ${Math.round((Date.now() - inicio) / 1000)} s, tentativas: ${j!.tentativas}`); break; }
  if (j!.estado === 'falhou') { console.log(`FALHOU: ${j!.erro}`); process.exit(1); }
  if (Date.now() - inicio > 240_000) { console.log('passou de 4 minutos'); process.exit(1); }
  await pausa(1500);
}
