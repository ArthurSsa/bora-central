-- Hora de job é a hora do banco, não a do worker.
--
-- O primeiro teste de ponta a ponta saiu com duração NEGATIVA: iniciado_em vem
-- do now() do banco (em pegar_job) e terminado_em vinha do relógio do worker,
-- que estava 6 s atrasado. Com dois relógios na mesma conta, a duração mede a
-- diferença entre eles, não o trabalho — e ela entra na precificação.
--
-- Agora o banco carimba as duas pontas, e o lease é renovado por função, pelo
-- mesmo motivo: um worker com relógio uns minutos atrasado renovaria um lease
-- que já nasce vencido, e outro worker pegaria o mesmo job no meio.

create or replace function public.jobs_tocar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  if new.estado is distinct from old.estado then
    if new.estado in ('pronto','falhou','cancelado') then
      new.terminado_em := now();
    elsif new.estado = 'na_fila' then
      new.terminado_em := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_tocar on public.jobs;
create trigger jobs_tocar before update on public.jobs
  for each row execute function public.jobs_tocar();

-- Devolve false se o job não é mais deste worker: cancelado, ou retomado por
-- outro depois de um lease vencido.
create or replace function public.renovar_lease(p_job uuid, p_worker text, p_segundos integer default 600)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with r as (
    update public.jobs
       set lease_ate = now() + make_interval(secs => p_segundos)
     where id = p_job and worker_id = p_worker and estado = 'rodando'
    returning 1
  )
  select exists (select 1 from r);
$$;

revoke all on function public.renovar_lease(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.renovar_lease(uuid, text, integer) to service_role;

-- Os dois jobs do primeiro teste ficaram com terminado_em do relógio do
-- worker. A duração deles não é recuperável; zera em vez de deixar negativa.
update public.jobs set terminado_em = iniciado_em where terminado_em < iniciado_em;
