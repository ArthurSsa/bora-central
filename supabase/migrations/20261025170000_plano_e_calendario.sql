-- Do plano do mês ao calendário, e do calendário à agenda da Bora.
--
-- O plano do mês já existia no Estúdio (planos.pauta, um tema por linha). O
-- cliente passa a ver esses temas como sugestão e a pedir a partir deles; a
-- peça aprovada com data vira "agendada" e aparece na agenda da Central como
-- tarefa de publicação. As duas pontas se seguem: mudar a data no app move a
-- tarefa, mover a tarefa na Central muda a data no app, e marcar a tarefa como
-- feita põe o pedido em "publicado".

-- 1. De onde o pedido veio, e qual tarefa da agenda é dele.
alter table public.pedidos
  add column if not exists origem_plano uuid references public.planos(id) on delete set null,
  add column if not exists origem_tema text,
  add column if not exists tarefa_id uuid references public.tarefas(id) on delete set null;

create unique index if not exists pedidos_tarefa_unica on public.pedidos (tarefa_id) where tarefa_id is not null;

comment on column public.pedidos.origem_tema is
  'O tema da pauta do plano do mês de onde o pedido saiu. É o que tira o tema da lista de sugestões.';
comment on column public.pedidos.tarefa_id is
  'A tarefa de publicação na agenda da Bora. Criada quando o pedido é agendado; as duas datas andam juntas.';

-- 2. O dia, no fuso de quem usa. Quem pede no celular em Fortaleza escolhe
-- "sexta"; o banco guarda meio-dia de sexta no horário de Brasília, e a agenda
-- (que é por dia) recebe sexta — nunca quinta às 21h em UTC.
create or replace function public.dia_local(p timestamptz)
returns date language sql immutable set search_path = '' as $$
  select (p at time zone 'America/Sao_Paulo')::date;
$$;

create or replace function public.meio_dia_local(p date)
returns timestamptz language sql immutable set search_path = '' as $$
  select (p + time '12:00') at time zone 'America/Sao_Paulo';
$$;

-- 3. As sugestões do mês: a pauta do plano do mês corrente, tema por tema, com
-- o pedido que cada um já virou (se virou). Quem decide o que mostrar é a tela.
create or replace function public.sugestoes_do_mes(p_cliente uuid)
returns table (plano_id uuid, mes date, ordem integer, tema text, pedido_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode_ver_cliente(p_cliente) then
    raise exception 'sem acesso a este cliente' using errcode = '42501';
  end if;
  return query
  select pl.id, pl.mes, t.ordem::integer, t.tema,
         (select d.id from public.pedidos d
           where d.origem_plano = pl.id and d.origem_tema = t.tema and d.estado <> 'cancelado'
           order by d.criado_em limit 1)
    from public.planos pl
    cross join lateral (
      select btrim(linha) as tema, n as ordem
        from unnest(string_to_array(coalesce(pl.pauta, ''), E'\n')) with ordinality as x(linha, n)
       where btrim(linha) <> ''
    ) t
   where pl.cliente_id = p_cliente
     and pl.mes = date_trunc('month', public.dia_local(now()))::date
   order by t.ordem;
end $$;

-- 4. Pedir, agora dizendo de que tema veio. A versão de quatro argumentos sai:
-- com os dois novos opcionais, a chamada antiga continua igual.
drop function if exists public.criar_pedido(uuid, text, jsonb, timestamptz);

create or replace function public.criar_pedido(
  p_cliente uuid,
  p_tipo text,
  p_briefing jsonb,
  p_publicar_em timestamptz default null,
  p_origem_plano uuid default null,
  p_origem_tema text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta uuid;
  v_texto text := btrim(coalesce(p_briefing->>'texto', ''));
  v_slides integer;
  v_briefing jsonb;
  v_pedido uuid;
  v_ativos text[] := array['post-feed', 'carrossel', 'capa'];
begin
  if not public.pode_ver_cliente(p_cliente) then
    raise exception 'sem acesso a este cliente' using errcode = '42501';
  end if;
  if not p_tipo = any (v_ativos) then
    raise exception 'esse tipo de peça ainda não está disponível' using errcode = '22023';
  end if;
  if jsonb_typeof(p_briefing) is distinct from 'object' then
    raise exception 'pedido sem conteúdo' using errcode = '22023';
  end if;
  if char_length(v_texto) < 3 then
    raise exception 'conte em uma ou duas frases o que você quer' using errcode = '22023';
  end if;
  if char_length(v_texto) > 800 then
    raise exception 'o texto passou de 800 caracteres; resuma um pouco' using errcode = '22023';
  end if;
  if p_publicar_em is not null and public.dia_local(p_publicar_em) < public.dia_local(now()) then
    raise exception 'escolha um dia de hoje em diante' using errcode = '22023';
  end if;

  -- O tema tem que estar mesmo na pauta daquele plano, daquele cliente: a
  -- origem é o que tira a sugestão da lista, e não pode ser inventada.
  if p_origem_plano is not null and not exists (
    select 1 from public.planos pl
     where pl.id = p_origem_plano and pl.cliente_id = p_cliente
       and btrim(p_origem_tema) = any (select btrim(x) from unnest(string_to_array(coalesce(pl.pauta, ''), E'\n')) x)
  ) then
    raise exception 'esse tema não está no plano do mês' using errcode = '22023';
  end if;

  if p_tipo = 'carrossel' then
    v_slides := coalesce(nullif(p_briefing->>'slides', '')::integer, 5);
    if v_slides not between 3 and 10 then
      raise exception 'o carrossel tem de 3 a 10 imagens' using errcode = '22023';
    end if;
  end if;

  select conta_id into v_conta from public.clientes where id = p_cliente;
  if (select count(*) from public.jobs
       where conta_id = v_conta and estado in ('na_fila', 'rodando')) >= 5 then
    raise exception 'já tem cinco peças sendo feitas agora; espere uma terminar' using errcode = '53400';
  end if;

  v_briefing := jsonb_strip_nulls(jsonb_build_object(
    'texto', v_texto,
    'objetivo', left(nullif(btrim(p_briefing->>'objetivo'), ''), 120),
    'tom', left(nullif(btrim(p_briefing->>'tom'), ''), 120),
    'slides', v_slides
  ));

  insert into public.pedidos (cliente_id, tipo, titulo, briefing, estado, publicar_em, criado_por, origem_plano, origem_tema)
  values (p_cliente, p_tipo, public.titulo_do_pedido(v_texto), v_briefing, 'produzindo', p_publicar_em, auth.uid(),
          p_origem_plano, case when p_origem_plano is not null then btrim(p_origem_tema) end)
  returning id into v_pedido;

  insert into public.jobs (pedido_id, rodada) values (v_pedido, 'producao');
  return v_pedido;
exception
  when invalid_text_representation then
    raise exception 'a quantidade de slides precisa ser um número' using errcode = '22023';
end $$;

-- 5. Aprovar: com data que ainda não passou, já sai agendado. Data que passou
-- enquanto a peça era feita não vale mais — sai sem data, pra escolher outra.
create or replace function public.aprovar_pedido(p_pedido uuid, p_escolha integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  v_data_vale boolean;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not public.pode_ver_cliente(p.cliente_id) then
    raise exception 'pedido não encontrado' using errcode = '42501';
  end if;
  if p.estado <> 'para_aprovar' then
    raise exception 'este pedido não está esperando aprovação' using errcode = '22023';
  end if;
  if p.tipo = 'capa' and (p_escolha is null or p_escolha not between 1 and 3) then
    raise exception 'escolha uma das três capas' using errcode = '22023';
  end if;
  v_data_vale := p.publicar_em is not null and public.dia_local(p.publicar_em) >= public.dia_local(now());
  update public.pedidos
     set estado = case when v_data_vale then 'agendado' else 'aprovado' end,
         publicar_em = case when v_data_vale then p.publicar_em end,
         aprovado_em = now(),
         aprovado_por = auth.uid(),
         job_aprovado = public.ultima_rodada_pronta(p_pedido),
         escolha = case when p.tipo = 'capa' then p_escolha end
   where id = p_pedido;
end $$;

-- 6. Agendar e reagendar. Sem dia, volta pra "aprovado" e sai da agenda.
create or replace function public.agendar_pedido(p_pedido uuid, p_dia date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not public.pode_ver_cliente(p.cliente_id) then
    raise exception 'pedido não encontrado' using errcode = '42501';
  end if;
  if p.estado not in ('aprovado', 'agendado') then
    raise exception 'só dá pra agendar peça aprovada' using errcode = '22023';
  end if;
  if p_dia is not null and p_dia < public.dia_local(now()) then
    raise exception 'escolha um dia de hoje em diante' using errcode = '22023';
  end if;
  update public.pedidos
     set publicar_em = case when p_dia is not null then public.meio_dia_local(p_dia) end,
         estado = case when p_dia is not null then 'agendado' else 'aprovado' end
   where id = p_pedido;
end $$;

-- 7. Pedido → agenda. Agendado cria (ou move) a tarefa de publicação; deixar
-- de estar agendado tira a tarefa da agenda. A trava de profundidade é o que
-- impede a volta: quando é a agenda que mexe no pedido, este gatilho não
-- devolve a mexida pra agenda.
create or replace function public.pedido_para_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tarefa uuid;
  v_titulo text := 'Publicar: ' || coalesce(new.titulo, 'peça do app');
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if new.estado = 'agendado' and new.publicar_em is not null then
    if new.tarefa_id is null then
      insert into public.tarefas (titulo, detalhe, cliente_id, data, tipo, estado, prioridade, campos)
      values (v_titulo,
              'Peça aprovada pelo cliente no app. A data anda junto com a do pedido: mover aqui muda lá.',
              new.cliente_id, public.dia_local(new.publicar_em), 'publicacao', 'pendente', 'normal',
              jsonb_build_object(
                'canal', case new.tipo when 'capa' then 'YouTube' else 'Instagram feed' end,
                'aprovado_por', 'o cliente, pelo app',
                'pedido_id', new.id))
      returning id into v_tarefa;
      update public.pedidos set tarefa_id = v_tarefa where id = new.id;
    else
      update public.tarefas
         set data = public.dia_local(new.publicar_em), titulo = v_titulo
       where id = new.tarefa_id
         and (data is distinct from public.dia_local(new.publicar_em) or titulo is distinct from v_titulo);
    end if;
  elsif new.estado <> 'publicado' and new.tarefa_id is not null then
    delete from public.tarefas where id = new.tarefa_id;
    update public.pedidos set tarefa_id = null where id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists pedido_para_agenda on public.pedidos;
create trigger pedido_para_agenda
  after insert or update of estado, publicar_em, titulo on public.pedidos
  for each row execute function public.pedido_para_agenda();

-- 8. Agenda → pedido. Mover a tarefa muda a data do pedido; marcar como feita
-- publica; cancelar, tirar a data ou apagar devolve o pedido pra "aprovado",
-- sem data, pro cliente escolher outra.
create or replace function public.agenda_para_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    update public.pedidos
       set tarefa_id = null, publicar_em = null,
           estado = case when estado = 'agendado' then 'aprovado' else estado end
     where tarefa_id = old.id;
    return old;
  end if;
  if new.estado = 'concluido' and old.estado is distinct from 'concluido' then
    update public.pedidos set estado = 'publicado' where tarefa_id = new.id and estado = 'agendado';
  elsif new.estado = 'cancelado' or new.data is null then
    update public.pedidos set tarefa_id = null, publicar_em = null, estado = 'aprovado'
     where tarefa_id = new.id and estado = 'agendado';
  elsif new.data is distinct from old.data then
    update public.pedidos set publicar_em = public.meio_dia_local(new.data)
     where tarefa_id = new.id and estado = 'agendado';
  end if;
  return new;
end $$;

drop trigger if exists agenda_para_pedido on public.tarefas;
create trigger agenda_para_pedido
  after update of data, estado on public.tarefas
  for each row execute function public.agenda_para_pedido();

-- Antes do apagar, e não depois: depois, o "on delete set null" já soltou o
-- pedido e não dá mais pra achar de quem a tarefa era.
drop trigger if exists agenda_apagada on public.tarefas;
create trigger agenda_apagada
  before delete on public.tarefas
  for each row execute function public.agenda_para_pedido();

revoke all on function public.sugestoes_do_mes(uuid) from public, anon;
revoke all on function public.criar_pedido(uuid, text, jsonb, timestamptz, uuid, text) from public, anon;
revoke all on function public.agendar_pedido(uuid, date) from public, anon;
revoke all on function public.pedido_para_agenda() from public, anon, authenticated;
revoke all on function public.agenda_para_pedido() from public, anon, authenticated;
grant execute on function public.sugestoes_do_mes(uuid) to authenticated;
grant execute on function public.criar_pedido(uuid, text, jsonb, timestamptz, uuid, text) to authenticated;
grant execute on function public.agendar_pedido(uuid, date) to authenticated;
