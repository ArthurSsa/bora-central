-- O cliente pede, aprova e pede ajuste — sempre por função, nunca escrevendo
-- direto nas tabelas.
--
-- A razão é que quase tudo num pedido é decisão que não é dele: que skill
-- roda, em que estado o job nasce, quanto custa, se dá pra pedir mais um
-- ajuste. Uma política de INSERT em pedidos deixaria o celular de qualquer
-- cliente escolher isso. A função recebe só o que é do cliente dizer (o que
-- ele quer, em texto) e decide o resto aqui dentro.

-- 1. O que o pedido guarda sobre a aprovação.
alter table public.pedidos
  add column if not exists aprovado_em timestamptz,
  add column if not exists aprovado_por uuid references auth.users(id) on delete set null,
  add column if not exists job_aprovado uuid references public.jobs(id) on delete set null,
  add column if not exists ajustes integer not null default 0;

comment on column public.pedidos.job_aprovado is
  'Qual rodada foi aprovada. Um pedido com três ajustes tem quatro versões; esta é a que vai ao ar.';

-- 2. Quem eu atendo.
--
-- Pra Bora, todos os clientes; pro dono de conta, os da conta; pro cliente,
-- ele mesmo. Devolve só o que a tela precisa — a ficha inteira tem valor do
-- contrato e observação interna, e isso não sai daqui.
create or replace function public.meus_clientes()
returns table (id uuid, nome text, cor text, instagram text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, coalesce(nullif(c.nome_preferido, ''), c.nome), c.cor, c.instagram
    from public.clientes c
   where public.pode_ver_cliente(c.id)
   order by coalesce(nullif(c.nome_preferido, ''), c.nome);
$$;

-- 3. A marca, do jeito que o cliente pode ver.
create or replace function public.marca_do_cliente(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.clientes;
begin
  if not public.pode_ver_cliente(p_cliente) then
    raise exception 'sem acesso a este cliente' using errcode = '42501';
  end if;
  select * into c from public.clientes where id = p_cliente;
  return jsonb_build_object(
    'nome', coalesce(nullif(c.nome_preferido, ''), c.nome),
    'instagram', c.instagram,
    'cor', c.cor,
    'paleta', coalesce(c.marca->'paleta', '[]'::jsonb),
    'conjuntos', coalesce(c.marca->'conjuntos', '[]'::jsonb),
    'conjuntoPadrao', c.marca->>'conjuntoPadrao',
    'fonte', nullif(c.marca->>'fonteMarca', ''),
    'tom', nullif(c.marca->>'tom', ''),
    'publico', nullif(c.marca->>'publico', ''),
    'evitar', nullif(c.marca->>'evitar', ''),
    'obrigatorios', nullif(c.marca->>'obrigatorios', ''),
    'chamada', nullif(c.marca->>'chamada', '')
  );
end $$;

-- 4. Pedir.
--
-- Só os tipos que já têm skill que entrega. Os outros cartões aparecem na
-- tela como "em breve"; se alguém chamar a função direto com eles, é não.
--
-- Teto de cinco rodadas em andamento por conta: cada rodada custa token e
-- CPU, e um botão apertado vinte vezes não pode virar vinte jobs.
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
  v_briefing jsonb;
  v_pedido uuid;
  v_ativos text[] := array['post-feed'];
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

  select conta_id into v_conta from public.clientes where id = p_cliente;
  if (select count(*) from public.jobs
       where conta_id = v_conta and estado in ('na_fila', 'rodando')) >= 5 then
    raise exception 'já tem cinco peças sendo feitas agora; espere uma terminar' using errcode = '53400';
  end if;

  -- Só as chaves que a tela manda, e só texto curto. O resto do briefing é
  -- decisão da skill, não do celular.
  v_briefing := jsonb_strip_nulls(jsonb_build_object(
    'texto', v_texto,
    'objetivo', left(nullif(btrim(p_briefing->>'objetivo'), ''), 120),
    'tom', left(nullif(btrim(p_briefing->>'tom'), ''), 120)
  ));

  insert into public.pedidos (cliente_id, tipo, titulo, briefing, estado, publicar_em, criado_por)
  values (p_cliente, p_tipo, left(v_texto, 80), v_briefing, 'produzindo', p_publicar_em, auth.uid())
  returning id into v_pedido;

  insert into public.jobs (pedido_id, rodada) values (v_pedido, 'producao');
  return v_pedido;
end $$;

-- A rodada que está valendo: a última que ficou pronta.
create or replace function public.ultima_rodada_pronta(p_pedido uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.jobs
   where pedido_id = p_pedido and estado = 'pronto'
   order by criado_em desc
   limit 1;
$$;

-- 5. Aprovar. Guarda QUAL versão foi aprovada.
create or replace function public.aprovar_pedido(p_pedido uuid)
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
  update public.pedidos
     set estado = 'aprovado',
         aprovado_em = now(),
         aprovado_por = auth.uid(),
         job_aprovado = public.ultima_rodada_pronta(p_pedido)
   where id = p_pedido;
end $$;

-- 6. Pedir ajuste.
--
-- O ajuste é uma rodada nova em cima da última versão pronta, não um pedido
-- do zero: a entrada guarda de qual rodada ele parte, e o worker abre o
-- editável dela. Depois de cinco ajustes a fábrica para e a Bora entra — a
-- essa altura o problema quase nunca é a peça, é o pedido.
create or replace function public.pedir_ajuste(p_pedido uuid, p_texto text, p_atalhos text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_atalhos text[] := coalesce(p_atalhos, '{}');
  v_permitidos text[] := array['troca a foto', 'mais curto', 'outra cor da marca', 'mais sério'];
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

revoke all on function public.meus_clientes() from public, anon;
revoke all on function public.marca_do_cliente(uuid) from public, anon;
revoke all on function public.criar_pedido(uuid, text, jsonb, timestamptz) from public, anon;
revoke all on function public.ultima_rodada_pronta(uuid) from public, anon, authenticated;
revoke all on function public.aprovar_pedido(uuid) from public, anon;
revoke all on function public.pedir_ajuste(uuid, text, text[]) from public, anon;
grant execute on function public.meus_clientes() to authenticated;
grant execute on function public.marca_do_cliente(uuid) to authenticated;
grant execute on function public.criar_pedido(uuid, text, jsonb, timestamptz) to authenticated;
grant execute on function public.ultima_rodada_pronta(uuid) to service_role;
grant execute on function public.aprovar_pedido(uuid) to authenticated;
grant execute on function public.pedir_ajuste(uuid, text, text[]) to authenticated;
