-- O título do pedido cortava no meio da palavra ("Organização vem ant"):
-- eram os primeiros 80 caracteres do texto, sem olhar onde a palavra acaba.
-- Agora corta no último espaço antes do limite e põe reticências.

create or replace function public.titulo_do_pedido(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when char_length(btrim(p_texto)) <= 80 then btrim(p_texto)
    else rtrim(regexp_replace(left(btrim(p_texto), 80), '\s+\S*$', ''), ' .,;:') || '…'
  end;
$$;

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
  values (p_cliente, p_tipo, public.titulo_do_pedido(v_texto), v_briefing, 'produzindo', p_publicar_em, auth.uid())
  returning id into v_pedido;

  insert into public.jobs (pedido_id, rodada) values (v_pedido, 'producao');
  return v_pedido;
exception
  when invalid_text_representation then
    raise exception 'a quantidade de slides precisa ser um número' using errcode = '22023';
end $$;

-- Os que já foram cortados no meio.
update public.pedidos
   set titulo = public.titulo_do_pedido(briefing->>'texto')
 where char_length(briefing->>'texto') > 80
   and titulo = left(btrim(briefing->>'texto'), 80);
