-- O reel entra no app: o cliente manda o vídeo que gravou e a fábrica faz o resto.
--
-- O vídeo sobe direto do celular pro balde, antes do pedido existir — é um
-- arquivo grande, e prender o pedido a um envio de minutos deixaria rascunho
-- pela metade. Vai pra <conta>/<cliente>/uploads/<id>/<nome>, e o pedido só
-- aceita um anexo que está ali, daquele cliente, e que existe de verdade.

-- 1. O cliente pode subir vídeo, e só na pasta de envios dele.
create or replace function public.pode_enviar_arquivo_pedido(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  partes text[] := storage.foldername(p_nome);
  v_cliente uuid;
begin
  if coalesce(array_length(partes, 1), 0) <> 4 or partes[3] <> 'uploads'
     or partes[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or lower(storage.extension(p_nome)) not in ('mp4', 'mov', 'm4v', 'webm') then
    return false;
  end if;
  v_cliente := partes[2]::uuid;
  return public.pode_ver_cliente(v_cliente)
     and exists (select 1 from public.clientes c where c.id = v_cliente and c.conta_id::text = partes[1]);
end $$;

revoke all on function public.pode_enviar_arquivo_pedido(text) from public, anon;
grant execute on function public.pode_enviar_arquivo_pedido(text) to authenticated;

drop policy if exists pedidos_enviar on storage.objects;
create policy pedidos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'pedidos' and public.pode_enviar_arquivo_pedido(name));

-- O app não sabe de que conta o cliente é, e nem precisa: o banco diz a pasta.
create or replace function public.pasta_de_envio(p_cliente uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conta uuid;
begin
  if not public.pode_ver_cliente(p_cliente) then
    raise exception 'sem acesso a este cliente' using errcode = '42501';
  end if;
  select conta_id into v_conta from public.clientes where id = p_cliente;
  return v_conta::text || '/' || p_cliente::text || '/uploads/' || gen_random_uuid()::text;
end $$;

revoke all on function public.pasta_de_envio(uuid) from public, anon;
grant execute on function public.pasta_de_envio(uuid) to authenticated;

-- 2. Pedir, agora com reel.
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
  v_anexo text;
  v_briefing jsonb;
  v_pedido uuid;
  v_ativos text[] := array['post-feed', 'carrossel', 'capa', 'reel'];
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

  -- O vídeo do reel: na pasta de envios DESTE cliente, e já no balde.
  if p_tipo = 'reel' then
    v_anexo := nullif(btrim(p_briefing->>'anexo'), '');
    if v_anexo is null then
      raise exception 'falta o vídeo' using errcode = '22023';
    end if;
    if v_anexo not like v_conta::text || '/' || p_cliente::text || '/uploads/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'pedidos' and o.name = v_anexo) then
      raise exception 'o vídeo não chegou; envie de novo' using errcode = '22023';
    end if;
  end if;

  if (select count(*) from public.jobs
       where conta_id = v_conta and estado in ('na_fila', 'rodando')) >= 5 then
    raise exception 'já tem cinco peças sendo feitas agora; espere uma terminar' using errcode = '53400';
  end if;

  v_briefing := jsonb_strip_nulls(jsonb_build_object(
    'texto', v_texto,
    'objetivo', left(nullif(btrim(p_briefing->>'objetivo'), ''), 120),
    'tom', left(nullif(btrim(p_briefing->>'tom'), ''), 120),
    'slides', v_slides,
    'anexo', v_anexo
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
