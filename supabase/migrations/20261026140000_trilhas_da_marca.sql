-- Trilhas da marca: a música que entra nos vídeos (abertura, carrossel em
-- vídeo e reel), subida pela equipe na Marca da Central. Só música que o
-- cliente tem direito de usar — por isso cada uma diz de onde vem a licença.
-- O pedido de vídeo pode escolher uma, ou "nenhuma"; sem escolha, vai a padrão.

create table if not exists public.marca_trilhas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  licenca text not null check (char_length(btrim(licenca)) between 3 and 300),
  caminho text not null unique,
  bytes bigint,
  mime text,
  segundos numeric,
  padrao boolean not null default false,
  criado_em timestamptz not null default now()
);

comment on table public.marca_trilhas is
  'Músicas da marca para os vídeos. licenca: de onde vem o direito de uso (loja, contrato, autor). padrao: a que entra quando o pedido não escolhe.';

-- Uma padrão por cliente.
create unique index if not exists marca_trilhas_uma_padrao on public.marca_trilhas (cliente_id) where padrao;
create index if not exists marca_trilhas_cliente on public.marca_trilhas (cliente_id);

alter table public.marca_trilhas enable row level security;
drop policy if exists marca_trilhas_membro on public.marca_trilhas;
create policy marca_trilhas_membro on public.marca_trilhas
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

-- O balde: fechado, só áudio, até 30 MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trilhas', 'trilhas', false, 31457280,
        array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac',
              'audio/aiff', 'audio/x-aiff', 'audio/ogg'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists trilhas_ler on storage.objects;
drop policy if exists trilhas_subir on storage.objects;
drop policy if exists trilhas_apagar on storage.objects;
create policy trilhas_ler on storage.objects for select to authenticated
  using (bucket_id = 'trilhas' and public.is_bora_member());
create policy trilhas_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'trilhas' and public.is_bora_member());
create policy trilhas_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'trilhas' and public.is_bora_member());

-- criar_pedido: o pedido de vídeo leva a trilha escolhida (uma trilha deste
-- cliente, ou "nenhuma"). O resto é o de 20261026130000_lote_da_equipe.
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
  v_briefing jsonb;
  v_pedido uuid;
  v_ativos text[] := array['post-feed', 'carrossel', 'capa', 'reel'];
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
    'trilha', v_trilha
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

-- pedir_ajuste: dois atalhos novos, só pra vídeo — "música mais baixa" e
-- "sem música". O resto é o de 20261025140000_pedido_do_cliente.
create or replace function public.pedir_ajuste(p_pedido uuid, p_texto text, p_atalhos text[] default '{}'::text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_atalhos text[] := coalesce(p_atalhos, '{}');
  v_permitidos text[] := array['troca a foto', 'mais curto', 'outra cor da marca', 'mais sério', 'música mais baixa', 'sem música'];
  v_de_musica text[] := array['música mais baixa', 'sem música'];
  v_job uuid;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not public.pode_ver_cliente(p.cliente_id) then
    raise exception 'pedido não encontrado' using errcode = '42501';
  end if;
  if p.estado <> 'para_aprovar' then
    raise exception 'este pedido não está esperando aprovação' using errcode = '22023';
  end if;
  if not v_atalhos <@ v_permitidos then
    raise exception 'atalho de ajuste desconhecido' using errcode = '22023';
  end if;
  if v_atalhos && v_de_musica and p.tipo <> 'reel' then
    raise exception 'só vídeo tem música' using errcode = '22023';
  end if;
  if char_length(v_texto) < 3 and cardinality(v_atalhos) = 0 then
    raise exception 'diga o que mudar, ou escolha um dos atalhos' using errcode = '22023';
  end if;
  if char_length(v_texto) > 600 then
    raise exception 'o pedido de ajuste passou de 600 caracteres' using errcode = '22023';
  end if;
  if p.ajustes >= 5 then
    raise exception 'este pedido já teve cinco ajustes; a equipe da Bora vai falar com você' using errcode = '53400';
  end if;

  insert into public.jobs (pedido_id, rodada, entrada)
  values (p_pedido, 'ajuste', jsonb_build_object(
    'texto', nullif(v_texto, ''),
    'atalhos', to_jsonb(v_atalhos),
    'base_job', public.ultima_rodada_pronta(p_pedido)
  ))
  returning id into v_job;

  update public.pedidos set estado = 'produzindo', ajustes = ajustes + 1 where id = p_pedido;
  return v_job;
end $$;
