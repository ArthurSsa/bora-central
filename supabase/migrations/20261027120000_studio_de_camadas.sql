-- Etapa F: o Studio da Central.
--
-- A fábrica entrega cada imagem também em camadas (camadas/<base>/camadas.json
-- e um PNG por camada, com papel 'camada' em jobs.saidas — o cliente não lê,
-- porque o balde só deixa ele ver saida/). A equipe mexe nas camadas na
-- Central — arrasta, aumenta, troca o texto, esconde, troca a cor por outra da
-- marca, muda a ordem — e salvar vira uma rodada 'edicao': a fábrica aplica as
-- mudanças no PSD pelo PhotoCraft, sem o Claude, e a versão nova passa pela
-- mesma conferência de qualquer rodada antes de ir pro cliente aprovar.
--
-- Aditiva: uma rodada nova e uma função. Nada existente muda de comportamento.

-- 1. A rodada.
alter table public.jobs drop constraint if exists jobs_rodada_check;
alter table public.jobs add constraint jobs_rodada_check check (rodada in
  ('producao','ajuste','variacoes','previa','completo','da_bora','edicao'));

-- 2. Salvar no Studio.
--
-- Só a equipe: o cliente pede ajuste com as palavras dele (pedir_ajuste). A
-- edição parte da versão que a tela mostrava (p_base), não necessariamente da
-- última — é a que a equipe estava olhando. Uma tentativa só: aplicar a mesma
-- edição de novo dá o mesmo resultado, e o erro volta pra quem editou.
-- Não conta nos cinco ajustes do cliente.
create or replace function public.editar_no_studio(p_pedido uuid, p_base uuid, p_edicao jsonb)
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
    raise exception 'só a equipe da Bora edita no Studio' using errcode = '42501';
  end if;
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null then
    raise exception 'pedido não encontrado' using errcode = '42501';
  end if;
  if p.estado <> 'para_aprovar' then
    raise exception 'só dá pra editar no Studio uma peça esperando aprovação' using errcode = '22023';
  end if;
  select j.skill into v_skill from public.jobs j
   where j.id = p_base and j.pedido_id = p_pedido and j.estado = 'pronto';
  if not found then
    raise exception 'essa versão não é deste pedido, ou não ficou pronta' using errcode = '22023';
  end if;
  -- Separados: jsonb_array_length num não-array é erro, e o "or" não garante a ordem.
  if jsonb_typeof(p_edicao -> 'imagens') is distinct from 'array' then
    raise exception 'a edição não diz as imagens' using errcode = '22023';
  end if;
  if jsonb_array_length(p_edicao -> 'imagens') = 0 then
    raise exception 'nada pra aplicar: mexa em alguma camada antes de salvar' using errcode = '22023';
  end if;
  if octet_length(p_edicao::text) > 65536 then
    raise exception 'a edição passou do tamanho' using errcode = '22023';
  end if;

  insert into public.jobs (pedido_id, rodada, skill, entrada, max_tentativas)
  values (p_pedido, 'edicao', v_skill,
          jsonb_build_object('base_job', p_base, 'edicao', p_edicao, 'por', auth.uid()), 1)
  returning id into v_job;

  update public.pedidos set estado = 'produzindo' where id = p_pedido;
  return v_job;
end $$;

revoke all on function public.editar_no_studio(uuid, uuid, jsonb) from public, anon;
grant execute on function public.editar_no_studio(uuid, uuid, jsonb) to authenticated;
