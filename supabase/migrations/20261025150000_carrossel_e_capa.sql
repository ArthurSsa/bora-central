-- Carrossel e capa entram no app do cliente.
--
-- O carrossel pede uma escolha a mais (quantos slides); a capa entrega três
-- opções, e aprovar uma capa sem dizer QUAL não serve pra nada — a escolha
-- fica guardada no pedido, junto da rodada aprovada.

alter table public.pedidos
  add column if not exists escolha integer check (escolha between 1 and 10);

comment on column public.pedidos.escolha is
  'Qual das opções o cliente aprovou, quando a peça vem com mais de uma (capa: 1, 2 ou 3).';

create or replace function public.criar_pedido(
  p_cliente uuid,
  p_tipo text,
  p_briefing jsonb,
  p_publicar_em timestamptz default null
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

  -- Quantos slides: só no carrossel, e dentro do que a skill faz (3 a 10).
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

  insert into public.pedidos (cliente_id, tipo, titulo, briefing, estado, publicar_em, criado_por)
  values (p_cliente, p_tipo, left(v_texto, 80), v_briefing, 'produzindo', p_publicar_em, auth.uid())
  returning id into v_pedido;

  insert into public.jobs (pedido_id, rodada) values (v_pedido, 'producao');
  return v_pedido;
exception
  when invalid_text_representation then
    raise exception 'a quantidade de slides precisa ser um número' using errcode = '22023';
end $$;

-- Aprovar agora diz qual opção, quando há mais de uma. A versão de um
-- argumento sai: com o default, a chamada antiga continua funcionando.
drop function if exists public.aprovar_pedido(uuid);

create or replace function public.aprovar_pedido(p_pedido uuid, p_escolha integer default null)
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
  if p.estado <> 'para_aprovar' then
    raise exception 'este pedido não está esperando aprovação' using errcode = '22023';
  end if;
  if p.tipo = 'capa' and (p_escolha is null or p_escolha not between 1 and 3) then
    raise exception 'escolha uma das três capas' using errcode = '22023';
  end if;
  update public.pedidos
     set estado = 'aprovado',
         aprovado_em = now(),
         aprovado_por = auth.uid(),
         job_aprovado = public.ultima_rodada_pronta(p_pedido),
         escolha = case when p.tipo = 'capa' then p_escolha end
   where id = p_pedido;
end $$;

revoke all on function public.aprovar_pedido(uuid, integer) from public, anon;
grant execute on function public.aprovar_pedido(uuid, integer) to authenticated;
