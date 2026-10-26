-- O cartaz para imprimir e o logo vetorial (etapa D, VectorCraft).
--
-- O cartaz é um tipo novo de pedido: A4 ou A3 (briefing.folha), feito no
-- VectorCraft, entregue em PDF pra gráfica, PNG e editável. E o logo da marca
-- pode subir em vetor (SVG, PDF, AI, EPS): a fábrica converte no tamanho da
-- peça e faz a versão de uma cor pra cada conjunto.

alter table public.pedidos drop constraint if exists pedidos_tipo_check;
alter table public.pedidos add constraint pedidos_tipo_check
  check (tipo in ('post-feed','carrossel','story','reel','capa','apresentacao','cartaz'));

-- O balde dos elementos aceita o logo em vetor.
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp',
                                  'application/pdf', 'application/postscript', 'application/illustrator',
                                  'application/eps', 'application/x-eps', 'image/x-eps']
 where id = 'elementos';

-- criar_pedido: aceita o cartaz e o tamanho do papel. O resto é o de
-- 20261026140000_trilhas_da_marca.
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
  v_briefing jsonb;
  v_pedido uuid;
  v_ativos text[] := array['post-feed', 'carrossel', 'capa', 'reel', 'cartaz'];
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
    'folha', v_folha
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
