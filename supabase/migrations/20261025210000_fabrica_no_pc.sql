-- A fábrica no PC: ela agora depende de um computador estar ligado, então
-- a equipe precisa ver se está, e o que ficou pela metade quando ele caiu
-- tem que voltar pra fila sem esperar o lease vencer.

-- 1. O sinal de vida: cada worker diz que está vivo a cada 30 s. O relógio
--    é o do banco — o do PC pode estar adiantado ou atrasado.
create table if not exists public.fabrica_sinais (
  worker_id text primary key,
  maquina text,
  agente text,
  ocupado_com uuid,
  ligado_em timestamptz not null default now(),
  visto_em timestamptz not null default now()
);

alter table public.fabrica_sinais enable row level security;
drop policy if exists fabrica_sinais_ler on public.fabrica_sinais;
create policy fabrica_sinais_ler on public.fabrica_sinais for select using (public.is_bora_member());

create or replace function public.sinal_da_fabrica(p_worker text, p_maquina text, p_agente text, p_ocupado uuid, p_ligou boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fabrica_sinais (worker_id, maquina, agente, ocupado_com, ligado_em, visto_em)
  values (p_worker, p_maquina, p_agente, p_ocupado, now(), now())
  on conflict (worker_id) do update
     set maquina = excluded.maquina, agente = excluded.agente, ocupado_com = excluded.ocupado_com,
         visto_em = now(),
         ligado_em = case when p_ligou then now() else public.fabrica_sinais.ligado_em end;
$$;

-- 2. Voltou depois de cair: o que este worker deixou rodando volta pra fila
--    na hora. A tentativa gasta continua contada — um job que derruba a
--    fábrica toda vez não pode ficar tentando pra sempre.
create or replace function public.soltar_jobs_do_worker(p_worker text)
returns integer
language sql
security definer
set search_path = ''
as $$
  with soltos as (
    update public.jobs
       set estado = case when tentativas >= max_tentativas then 'falhou' else 'na_fila' end,
           erro = coalesce(erro, 'a fábrica caiu no meio desta rodada'),
           etapa = case when tentativas >= max_tentativas then 'precisa da equipe' else 'tentando de novo' end,
           worker_id = null, lease_ate = null, restam_segundos = null,
           terminado_em = case when tentativas >= max_tentativas then now() else terminado_em end
     where worker_id = p_worker and estado = 'rodando'
    returning 1
  )
  select count(*)::integer from soltos;
$$;

revoke all on function public.sinal_da_fabrica(text, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.soltar_jobs_do_worker(text) from public, anon, authenticated;
grant execute on function public.sinal_da_fabrica(text, text, text, uuid, boolean) to service_role;
grant execute on function public.soltar_jobs_do_worker(text) to service_role;

-- 3. O que a Fábrica do Estúdio lê: há quantos segundos cada worker deu
--    sinal, contado no relógio do banco — não no de quem olha a tela.
create or replace function public.sinais_da_fabrica()
returns table (worker_id text, maquina text, agente text, ocupado_com uuid, ligado_em timestamptz, visto_em timestamptz, segundos_sem_sinal integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_bora_member() then
    raise exception 'só a equipe da Bora vê a fábrica' using errcode = '42501';
  end if;
  return query
  select s.worker_id, s.maquina, s.agente, s.ocupado_com, s.ligado_em, s.visto_em,
         extract(epoch from now() - s.visto_em)::integer
    from public.fabrica_sinais s
   order by s.visto_em desc;
end $$;

revoke all on function public.sinais_da_fabrica() from public, anon;
grant execute on function public.sinais_da_fabrica() to authenticated;
