-- Identidade visual do cliente: o arquivo do manual, guardado, e a tabela que
-- diz o que é cada arquivo.
--
-- Por que balde fechado e não público. É manual de marca de cliente, e parte
-- dele é material de campanha com regra própria. Público significa URL que
-- qualquer um adivinha; fechado significa link assinado de dois minutos, que é
-- o que o Estúdio usa.
--
-- Por que a lista de tipos permitidos. Sem ela, o balde aceita qualquer coisa
-- que o navegador mande, executável inclusive. A lista é a trava; o Estúdio
-- também barra antes de subir, mas a trava de verdade é esta.
--
-- ESTA MIGRAÇÃO JÁ FOI APLICADA E CONFERIDA no projeto. O arquivo aqui é só
-- pro histórico do repositório.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'identidades', 'identidades', false, 104857600,
  array['application/pdf','image/png','image/jpeg','image/svg+xml','image/webp',
        'font/ttf','font/otf','font/woff','font/woff2','application/zip']
)
on conflict (id) do nothing;

drop policy if exists identidades_ler    on storage.objects;
drop policy if exists identidades_subir  on storage.objects;
drop policy if exists identidades_trocar on storage.objects;
drop policy if exists identidades_apagar on storage.objects;

create policy identidades_ler on storage.objects
  for select using (bucket_id = 'identidades' and is_bora_member());
create policy identidades_subir on storage.objects
  for insert with check (bucket_id = 'identidades' and is_bora_member());
create policy identidades_trocar on storage.objects
  for update using (bucket_id = 'identidades' and is_bora_member())
          with check (bucket_id = 'identidades' and is_bora_member());
create policy identidades_apagar on storage.objects
  for delete using (bucket_id = 'identidades' and is_bora_member());

-- O que é cada arquivo. Colunas de verdade, não jsonb: tipo e cliente_id são
-- filtrados e listados, e a regra da casa é que o que se filtra tem coluna.
create table if not exists public.marca_arquivos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  tipo        text not null check (tipo in ('manual','logo','fonte','foto','outro')),
  caminho     text not null unique,
  nome        text not null,
  bytes       bigint,
  mime        text,
  nota        text,
  enviado_em  timestamptz not null default now()
);

create index if not exists marca_arquivos_cliente_idx
  on public.marca_arquivos (cliente_id, enviado_em desc);

alter table public.marca_arquivos enable row level security;

drop policy if exists marca_arquivos_membro on public.marca_arquivos;
create policy marca_arquivos_membro on public.marca_arquivos
  for all using (is_bora_member()) with check (is_bora_member());
