-- Visão Bora: a equipe vê a fila inteira, quanto custa, e assume o pedido
-- quando a fábrica não dá conta.
--
-- Assumir tira o pedido da fábrica (cancela a rodada que estiver na fila ou
-- rodando — o worker perde o lease e para) e avisa o cliente. A equipe corrige
-- no editor dela, sobe os arquivos numa pasta da Bora dentro do pedido e
-- entrega: a entrega vira uma rodada "da_bora" na fila, que o worker NÃO
-- produz — só confere, com a mesma conferência de marca de qualquer rodada, e
-- só então mostra pro cliente. A Bora também não passa sem conferir.

-- 1. Quem assumiu, e quando.
alter table public.pedidos add column if not exists assumido_por uuid references auth.users(id) on delete set null;
alter table public.pedidos add column if not exists assumido_em timestamptz;

-- 2. A rodada da Bora.
alter table public.jobs drop constraint if exists jobs_rodada_check;
alter table public.jobs add constraint jobs_rodada_check check (rodada in
  ('producao','ajuste','variacoes','previa','completo','da_bora'));

-- 3. Assumir.
create or replace function public.assumir_pedido(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  v_ultimo uuid;
begin
  if not public.is_bora_member() then
    raise exception 'só a equipe da Bora assume pedido' using errcode = '42501';
  end if;
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null then
    raise exception 'pedido não encontrado' using errcode = 'P0002';
  end if;
  if p.estado not in ('produzindo', 'para_aprovar') then
    raise exception 'esse pedido já foi aprovado ou cancelado' using errcode = '22023';
  end if;

  -- O que estiver na fila ou rodando para aqui. O worker descobre na próxima
  -- renovação do lease e larga o job sem gravar nada.
  update public.jobs
     set estado = 'cancelado', etapa = 'assumido pela Bora', erro = coalesce(erro, 'assumido pela Bora'),
         lease_ate = null, terminado_em = now()
   where pedido_id = p_pedido and estado in ('na_fila', 'rodando');

  update public.pedidos
     set assumido_por = auth.uid(), assumido_em = now(), estado = 'produzindo'
   where id = p_pedido;

  select id into v_ultimo from public.jobs where pedido_id = p_pedido order by criado_em desc limit 1;
  if v_ultimo is not null then
    insert into public.job_eventos (job_id, mensagem, visivel_cliente)
    values (v_ultimo, 'A equipe da Bora está finalizando este pedido.', true);
  end if;
end $$;

-- 4. A pasta da Bora dentro do pedido: <conta>/<cliente>/<pedido>/bora/<id>/.
--    Só a equipe escreve ali; ler, a equipe já lê o balde inteiro.
create or replace function public.pode_enviar_arquivo_da_bora(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  partes text[] := storage.foldername(p_nome);
begin
  if not public.is_bora_member() then
    return false;
  end if;
  return coalesce(array_length(partes, 1), 0) = 5 and partes[4] = 'bora'
     and partes[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.pedidos p
                  where p.id = partes[3]::uuid and p.conta_id::text = partes[1] and p.cliente_id::text = partes[2]);
end $$;

revoke all on function public.pode_enviar_arquivo_da_bora(text) from public, anon;
grant execute on function public.pode_enviar_arquivo_da_bora(text) to authenticated;

drop policy if exists pedidos_bora_enviar on storage.objects;
create policy pedidos_bora_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'pedidos' and public.pode_enviar_arquivo_da_bora(name));

-- 5. Entregar: a pasta subida vira uma rodada que o worker confere.
create or replace function public.entregar_pela_bora(p_pedido uuid, p_pasta text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  v_skill text;
  v_job uuid;
begin
  if not public.is_bora_member() then
    raise exception 'só a equipe da Bora entrega por aqui' using errcode = '42501';
  end if;
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or p.assumido_por is null then
    raise exception 'assuma o pedido antes de entregar' using errcode = '22023';
  end if;
  if p.estado <> 'produzindo' then
    raise exception 'esse pedido não está esperando a Bora' using errcode = '22023';
  end if;
  if exists (select 1 from public.jobs where pedido_id = p_pedido and estado in ('na_fila', 'rodando')) then
    raise exception 'a entrega anterior ainda está sendo conferida' using errcode = '22023';
  end if;
  if p_pasta !~ ('^' || p.conta_id || '/' || p.cliente_id || '/' || p.id || '/bora/[0-9a-f-]{36}$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'pedidos' and o.name like p_pasta || '/%') then
    raise exception 'os arquivos não chegaram; suba de novo' using errcode = '22023';
  end if;

  -- A mesma skill da última rodada: é ela que diz que arquivos o pedido entrega.
  select skill into v_skill from public.jobs
   where pedido_id = p_pedido and skill is not null order by criado_em desc limit 1;

  insert into public.jobs (pedido_id, rodada, skill, entrada, max_tentativas)
  values (p_pedido, 'da_bora', v_skill, jsonb_build_object('pasta_da_bora', p_pasta, 'por', auth.uid()), 1)
  returning id into v_job;
  return v_job;
end $$;

-- 6. A fila, do jeito que a equipe olha: uma linha por pedido que ainda não
--    terminou, com a última rodada, quantas tentativas ela gastou e por quê.
create or replace function public.fila_da_fabrica()
returns table (
  pedido_id uuid, cliente_id uuid, cliente text, tipo text, titulo text, pedido_estado text,
  assumido_por uuid, assumido_em timestamptz, criado_em timestamptz,
  job_id uuid, rodada text, skill text, job_estado text, etapa text, progresso numeric,
  tentativas integer, max_tentativas integer, erro text, job_atualizado_em timestamptz,
  motivos text[], custo_usd numeric, render_segundos numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_bora_member() then
    raise exception 'só a equipe da Bora vê a fila' using errcode = '42501';
  end if;
  return query
  select p.id, p.cliente_id, coalesce(nullif(c.nome_preferido, ''), c.nome), p.tipo, p.titulo, p.estado,
         p.assumido_por, p.assumido_em, p.criado_em,
         j.id, j.rodada, j.skill, j.estado, j.etapa, j.progresso, j.tentativas, j.max_tentativas, j.erro, j.atualizado_em,
         -- Cada reprovação vira um evento de erro; é a lista do "por quê", na ordem.
         array(select e.mensagem from public.job_eventos e
                where e.job_id = j.id and e.nivel = 'erro' order by e.id),
         (select coalesce(sum(x.custo_usd), 0) from public.jobs x where x.pedido_id = p.id),
         (select coalesce(sum(x.render_segundos), 0) from public.jobs x where x.pedido_id = p.id)
    from public.pedidos p
    join public.clientes c on c.id = p.cliente_id
    left join lateral (
      select * from public.jobs x where x.pedido_id = p.id order by x.criado_em desc limit 1
    ) j on true
   where p.estado in ('produzindo', 'para_aprovar')
      or (j.estado = 'falhou' and p.estado not in ('aprovado', 'agendado', 'publicado', 'cancelado'))
   order by (j.estado = 'falhou') desc, (p.assumido_por is not null) desc, p.criado_em;
end $$;

-- 7. Quanto custou, por cliente, num intervalo: o Claude em dólar e o tempo
--    dentro dos apps. Conta toda rodada, inclusive as que falharam — elas
--    também gastaram.
create or replace function public.custos_da_fabrica(p_de date, p_ate date)
returns table (
  cliente_id uuid, cliente text, pedidos bigint, rodadas bigint, tentativas bigint, falharam bigint,
  da_bora bigint, custo_usd numeric, render_segundos numeric, tokens_entrada bigint, tokens_saida bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_bora_member() then
    raise exception 'só a equipe da Bora vê os custos' using errcode = '42501';
  end if;
  return query
  select c.id, coalesce(nullif(c.nome_preferido, ''), c.nome),
         count(distinct j.pedido_id), count(j.id), coalesce(sum(j.tentativas), 0)::bigint,
         count(j.id) filter (where j.estado = 'falhou'),
         count(j.id) filter (where j.rodada = 'da_bora'),
         coalesce(sum(j.custo_usd), 0), coalesce(sum(j.render_segundos), 0),
         coalesce(sum(j.tokens_entrada), 0)::bigint, coalesce(sum(j.tokens_saida), 0)::bigint
    from public.jobs j
    join public.clientes c on c.id = j.cliente_id
   where public.dia_local(j.criado_em) between p_de and p_ate
   group by c.id
   order by sum(j.custo_usd) desc, count(j.id) desc;
end $$;

revoke all on function public.assumir_pedido(uuid) from public, anon;
revoke all on function public.entregar_pela_bora(uuid, text) from public, anon;
revoke all on function public.fila_da_fabrica() from public, anon;
revoke all on function public.custos_da_fabrica(date, date) from public, anon;
grant execute on function public.assumir_pedido(uuid) to authenticated;
grant execute on function public.entregar_pela_bora(uuid, text) to authenticated;
grant execute on function public.fila_da_fabrica() to authenticated;
grant execute on function public.custos_da_fabrica(date, date) to authenticated;
