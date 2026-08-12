create table platform_clients (
  client_id text primary key check (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  display_name text not null check (char_length(display_name) between 1 and 64),
  audience text not null unique check (audience ~ '^[a-z][a-z0-9:_-]{2,127}$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create table platform_client_redirect_uris (
  client_id text not null references platform_clients(client_id) on delete cascade,
  redirect_uri text not null check (char_length(redirect_uri) between 8 and 2048),
  primary key (client_id, redirect_uri)
);

create table platform_client_scopes (
  client_id text not null references platform_clients(client_id) on delete cascade,
  scope text not null check (scope in ('card.basic', 'card.handle', 'card.id')),
  primary key (client_id, scope)
);

create table platform_grants (
  grant_id uuid primary key,
  client_id text not null references platform_clients(client_id) on delete restrict,
  principal_id uuid not null references principals(principal_id) on delete cascade,
  scopes text[] not null check (cardinality(scopes) between 1 and 3),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (client_id, principal_id),
  check ((status = 'revoked') = (revoked_at is not null))
);

create table authorization_codes (
  code_hash bytea primary key check (octet_length(code_hash) = 32),
  grant_id uuid not null references platform_grants(grant_id) on delete cascade,
  client_id text not null references platform_clients(client_id) on delete restrict,
  principal_id uuid not null references principals(principal_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 3),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at),
  foreign key (client_id, redirect_uri)
    references platform_client_redirect_uris(client_id, redirect_uri) on delete restrict
);

create index authorization_codes_active
  on authorization_codes(client_id, expires_at)
  where consumed_at is null;

create table platform_access_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  grant_id uuid not null references platform_grants(grant_id) on delete cascade,
  client_id text not null references platform_clients(client_id) on delete restrict,
  principal_id uuid not null references principals(principal_id) on delete cascade,
  subject text not null,
  audience text not null,
  scopes text[] not null check (cardinality(scopes) between 1 and 3),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at),
  foreign key (client_id, principal_id)
    references platform_subjects(client_id, principal_id) on delete cascade,
  foreign key (subject) references platform_subjects(subject) on delete cascade
);

create index platform_access_tokens_active
  on platform_access_tokens(client_id, expires_at)
  where revoked_at is null;

insert into platform_clients (client_id, display_name, audience) values
  ('yoyoo_dev', 'Yoyoo', 'yoyoo'),
  ('test_client', 'AI Card Test Platform', 'test-platform');

insert into platform_client_redirect_uris (client_id, redirect_uri) values
  ('yoyoo_dev', 'http://localhost:4173/auth/aicard/callback'),
  ('test_client', 'http://localhost:4174/callback');

insert into platform_client_scopes (client_id, scope) values
  ('yoyoo_dev', 'card.basic'),
  ('yoyoo_dev', 'card.handle'),
  ('yoyoo_dev', 'card.id'),
  ('test_client', 'card.basic'),
  ('test_client', 'card.handle');
