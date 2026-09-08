-- O jeito daquele cliente: cor de apoio, formato e visual padrão, alinhamento,
-- tom de voz, o que evitar, chamada e hashtags que se repetem. Sem isto, toda
-- peça nova começa do zero e sai um pouco diferente da anterior — e é a
-- repetição visual que faz um perfil parecer profissional.
-- jsonb porque só é lido junto com o cliente e vai mudar mais que a tabela.
alter table public.clientes
  add column if not exists marca jsonb not null default '{}'::jsonb;

alter table public.clientes drop constraint if exists clientes_marca_ck;
alter table public.clientes add constraint clientes_marca_ck
  check (jsonb_typeof(marca) = 'object');
