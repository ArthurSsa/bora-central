-- Etapa H: a pessoa no post.
--
-- O cliente (pelo app) ou a equipe (pela Central) manda uma foto da pessoa, e a
-- fábrica faz o post com ela: acha o rosto, acerta luz e cor, recorta, e monta
-- com a pessoa recortada sobre o fundo da marca ou com a foto inteira e o texto
-- sobre uma faixa da cor da marca. A conferência acha o rosto de novo na peça
-- entregue: inteiro, dentro da margem e sem texto por cima.
--
-- A foto vem de dois lugares: a que acabou de subir pela pasta de envios
-- (briefing.foto, o caminho no balde) ou uma do banco de fotos da marca
-- (briefing.foto_marca, o id em marca_elementos, tipo 'foto').
--
-- Aditiva: a pasta de envios passa a aceitar foto, e criar_pedido aceita os
-- três campos novos no post. O resto é o de 20261026160000_material_de_paginas.

-- 1. A pasta de envios do cliente aceita foto, além de vídeo.
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
     or lower(storage.extension(p_nome)) not in ('mp4', 'mov', 'm4v', 'webm', 'jpg', 'jpeg', 'png', 'webp', 'heic') then
    return false;
  end if;
  v_cliente := partes[2]::uuid;
  return public.pode_ver_cliente(v_cliente)
     and exists (select 1 from public.clientes c where c.id = v_cliente and c.conta_id::text = partes[1]);
end $$;

-- 2. criar_pedido: a foto da pessoa e o jeito, no post.
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
  v_formato text;
  v_de_pedido uuid;
  v_trilha text;
  v_folha text;
  v_paginas integer;
  v_frases integer;
  v_briefing jsonb;
  v_foto text;
  v_foto_marca uuid;
  v_jeito text;
  v_pedido uuid;
  v_ativos text[] := array['post-feed', 'carrossel', 'capa', 'reel', 'cartaz', 'material'];
  v_teto integer := case when public.is_bora_member() then 40 else 5 end;
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

  -- O cartaz: o tamanho do papel, A4 (o padrão) ou A3.
  if p_tipo = 'cartaz' then
    v_folha := lower(coalesce(nullif(btrim(p_briefing->>'folha'), ''), 'a4'));
    if v_folha not in ('a4', 'a3') then
      raise exception 'o cartaz sai em A4 ou A3' using errcode = '22023';
    end if;
  end if;

  -- O material de páginas: o guia (de 6 a 12 páginas) ou o folheto dobrável.
  -- A fábrica não escreve conteúdo: o pedido traz o título e uma ideia por
  -- página (guia) ou por painel (folheto). As frases contam como no worker:
  -- pedaços entre . ; : ! ? ou quebra de linha, com duas palavras ou mais.
  if p_tipo = 'material' then
    v_formato := coalesce(nullif(btrim(p_briefing->>'formato'), ''), 'guia');
    if v_formato not in ('guia', 'folheto') then
      raise exception 'o material sai como guia ou folheto' using errcode = '22023';
    end if;
    v_frases := (select count(*) from regexp_split_to_table(v_texto, E'[.;:!?\n]+') f
                  where coalesce(array_length(regexp_split_to_array(btrim(f), E'\\s+'), 1), 0) >= 2 and btrim(f) <> '');
    if v_formato = 'guia' then
      v_paginas := coalesce(nullif(p_briefing->>'paginas', '')::integer, 8);
      if v_paginas not between 6 and 12 then
        raise exception 'o guia tem de 6 a 12 páginas' using errcode = '22023';
      end if;
      if v_frases < v_paginas - 1 then
        raise exception 'o guia de % páginas precisa de % frases: o título e uma ideia por página (vieram %)', v_paginas, v_paginas - 1, v_frases using errcode = '22023';
      end if;
    elsif v_frases < 4 then
      raise exception 'o folheto precisa de 4 frases: o título e uma ideia por painel (vieram %)', v_frases using errcode = '22023';
    end if;
  end if;

  select conta_id into v_conta from public.clientes where id = p_cliente;

  if p_tipo = 'reel' then
    v_formato := coalesce(nullif(btrim(p_briefing->>'formato'), ''), 'bruto');
    if v_formato not in ('bruto', 'abertura', 'carrossel') then
      raise exception 'esse formato de reel não existe' using errcode = '22023';
    end if;

    -- O vídeo gravado: na pasta de envios DESTE cliente, e já no balde.
    if v_formato = 'bruto' then
      v_anexo := nullif(btrim(p_briefing->>'anexo'), '');
      if v_anexo is null then
        raise exception 'falta o vídeo' using errcode = '22023';
      end if;
      if v_anexo not like v_conta::text || '/' || p_cliente::text || '/uploads/%'
         or not exists (select 1 from storage.objects o where o.bucket_id = 'pedidos' and o.name = v_anexo) then
        raise exception 'o vídeo não chegou; envie de novo' using errcode = '22023';
      end if;
    end if;

    -- O carrossel que vira vídeo: deste cliente, e já aprovado — o vídeo usa
    -- as imagens que o cliente viu e disse sim.
    if v_formato = 'carrossel' then
      if coalesce(p_briefing->>'de_pedido', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'falta o carrossel que vai virar vídeo' using errcode = '22023';
      end if;
      v_de_pedido := (p_briefing->>'de_pedido')::uuid;
      if not exists (
        select 1 from public.pedidos o
         where o.id = v_de_pedido and o.cliente_id = p_cliente and o.tipo = 'carrossel'
           and o.estado in ('aprovado', 'agendado', 'publicado') and o.job_aprovado is not null
      ) then
        raise exception 'esse carrossel ainda não foi aprovado' using errcode = '22023';
      end if;
    end if;

    -- A trilha: "nenhuma", ou uma trilha DESTE cliente. Sem escolha, a fábrica usa a padrão.
    v_trilha := nullif(btrim(p_briefing->>'trilha'), '');
    -- Dois ifs: o "or" do SQL não garante a ordem, e o texto só vira uuid depois de conferido.
    if v_trilha is not null and v_trilha <> 'nenhuma' then
      if v_trilha !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'essa trilha não é deste cliente' using errcode = '22023';
      end if;
      if not exists (select 1 from public.marca_trilhas t where t.id = v_trilha::uuid and t.cliente_id = p_cliente) then
        raise exception 'essa trilha não é deste cliente' using errcode = '22023';
      end if;
    end if;
  end if;

  -- A pessoa no post: a foto que acabou de subir (na pasta de envios DESTE
  -- cliente, e já no balde) ou uma foto do banco da marca dele. E o jeito de
  -- montar: auto (a fábrica escolhe), recorte ou foto inteira.
  if p_tipo = 'post-feed' then
    v_foto := nullif(btrim(p_briefing->>'foto'), '');
    if v_foto is not null then
      if v_foto not like v_conta::text || '/' || p_cliente::text || '/uploads/%'
         or lower(v_foto) !~ '\.(jpe?g|png|webp|heic)$'
         or not exists (select 1 from storage.objects o where o.bucket_id = 'pedidos' and o.name = v_foto) then
        raise exception 'a foto não chegou; envie de novo' using errcode = '22023';
      end if;
    end if;
    -- Dois ifs: o texto só vira uuid depois de conferido.
    if nullif(btrim(p_briefing->>'foto_marca'), '') is not null then
      if p_briefing->>'foto_marca' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'essa foto não é deste cliente' using errcode = '22023';
      end if;
      v_foto_marca := (p_briefing->>'foto_marca')::uuid;
      if not exists (select 1 from public.marca_elementos e where e.id = v_foto_marca and e.cliente_id = p_cliente and e.tipo = 'foto') then
        raise exception 'essa foto não é deste cliente' using errcode = '22023';
      end if;
    end if;
    if v_foto is not null and v_foto_marca is not null then
      raise exception 'escolha uma foto só' using errcode = '22023';
    end if;
    if v_foto is not null or v_foto_marca is not null then
      v_jeito := coalesce(nullif(btrim(p_briefing->>'jeito'), ''), 'auto');
      if v_jeito not in ('auto', 'recorte', 'foto') then
        raise exception 'o post com a pessoa sai recortado, com a foto inteira, ou a fábrica escolhe' using errcode = '22023';
      end if;
    end if;
  end if;

  -- O teto protege a fila do cliente que pede pelo app. A equipe produz o mês
  -- de uma vez (a pauta inteira em lote), então o teto dela é outro.
  if (select count(*) from public.jobs
       where conta_id = v_conta and estado in ('na_fila', 'rodando'))
     >= v_teto then
    raise exception 'já tem peças demais sendo feitas agora; espere algumas terminarem' using errcode = '53400';
  end if;

  v_briefing := jsonb_strip_nulls(jsonb_build_object(
    'texto', v_texto,
    'objetivo', left(nullif(btrim(p_briefing->>'objetivo'), ''), 120),
    'tom', left(nullif(btrim(p_briefing->>'tom'), ''), 120),
    'slides', v_slides,
    'formato', v_formato,
    'anexo', v_anexo,
    'de_pedido', v_de_pedido,
    'trilha', v_trilha,
    'folha', v_folha,
    'paginas', v_paginas,
    'foto', v_foto,
    'foto_marca', v_foto_marca,
    'jeito', v_jeito
  ));

  insert into public.pedidos (cliente_id, tipo, titulo, briefing, estado, publicar_em, criado_por, origem_plano, origem_tema)
  values (p_cliente, p_tipo, public.titulo_do_pedido(v_texto), v_briefing, 'produzindo', p_publicar_em, auth.uid(),
          p_origem_plano, case when p_origem_plano is not null then btrim(p_origem_tema) end)
  returning id into v_pedido;

  insert into public.jobs (pedido_id, rodada) values (v_pedido, 'producao');
  return v_pedido;
exception
  when invalid_text_representation then
    raise exception 'a quantidade de slides ou de páginas precisa ser um número' using errcode = '22023';
end $$;
