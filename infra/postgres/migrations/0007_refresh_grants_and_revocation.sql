alter table platform_client_scopes
  drop constraint platform_client_scopes_scope_check,
  add constraint platform_client_scopes_scope_check
    check (scope in ('card.basic', 'card.handle', 'card.id', 'offline_access'));

alter table platform_grants
  drop constraint platform_grants_scopes_check,
  add constraint platform_grants_scopes_check
    check (
      cardinality(scopes) between 1 and 4
      and scopes <@ array['card.basic', 'card.handle', 'card.id', 'offline_access']::text[]
    );

alter table authorization_codes
  drop constraint authorization_codes_scopes_check,
  add constraint authorization_codes_scopes_check
    check (
      cardinality(scopes) between 1 and 4
      and scopes <@ array['card.basic', 'card.handle', 'card.id', 'offline_access']::text[]
    ),
  add column exchange_idempotency_hash bytea
    check (exchange_idempotency_hash is null or octet_length(exchange_idempotency_hash) = 32),
  add column exchange_response_ciphertext bytea,
  add column exchange_response_iv bytea
    check (exchange_response_iv is null or octet_length(exchange_response_iv) = 12),
  add column exchange_response_tag bytea
    check (exchange_response_tag is null or octet_length(exchange_response_tag) = 16),
  add constraint authorization_codes_exchange_recovery_complete check (
    (exchange_idempotency_hash is null
      and exchange_response_ciphertext is null
      and exchange_response_iv is null
      and exchange_response_tag is null)
    or
    (exchange_idempotency_hash is not null
      and exchange_response_ciphertext is not null
      and exchange_response_iv is not null
      and exchange_response_tag is not null)
  );

alter table platform_access_tokens
  drop constraint platform_access_tokens_scopes_check,
  add constraint platform_access_tokens_scopes_check
    check (
      cardinality(scopes) between 1 and 4
      and scopes <@ array['card.basic', 'card.handle', 'card.id', 'offline_access']::text[]
    );

create table platform_refresh_token_families (
  family_id uuid primary key,
  grant_id uuid not null references platform_grants(grant_id) on delete cascade,
  client_id text not null references platform_clients(client_id) on delete restrict,
  principal_id uuid not null references principals(principal_id) on delete cascade,
  subject text not null,
  audience text not null,
  scopes text[] not null check (
    cardinality(scopes) between 1 and 4
    and scopes <@ array['card.basic', 'card.handle', 'card.id', 'offline_access']::text[]
    and 'offline_access' = any(scopes)
  ),
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'revoked') = (revoked_at is not null)),
  foreign key (client_id, principal_id, subject)
    references platform_subjects(client_id, principal_id, subject) on delete cascade
);

create index platform_refresh_token_families_active
  on platform_refresh_token_families(grant_id, expires_at)
  where status = 'active';

create table platform_refresh_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  family_id uuid not null references platform_refresh_token_families(family_id) on delete cascade,
  generation integer not null check (generation >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  replaced_by_hash bytea check (replaced_by_hash is null or octet_length(replaced_by_hash) = 32),
  rotation_idempotency_hash bytea
    check (rotation_idempotency_hash is null or octet_length(rotation_idempotency_hash) = 32),
  rotation_response_ciphertext bytea,
  rotation_response_iv bytea
    check (rotation_response_iv is null or octet_length(rotation_response_iv) = 12),
  rotation_response_tag bytea
    check (rotation_response_tag is null or octet_length(rotation_response_tag) = 16),
  created_at timestamptz not null default now(),
  unique (family_id, generation),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at),
  check (revoked_at is null or revoked_at >= created_at),
  check (
    (rotation_idempotency_hash is null
      and rotation_response_ciphertext is null
      and rotation_response_iv is null
      and rotation_response_tag is null)
    or
    (rotation_idempotency_hash is not null
      and rotation_response_ciphertext is not null
      and rotation_response_iv is not null
      and rotation_response_tag is not null)
  )
);

create index platform_refresh_tokens_family
  on platform_refresh_tokens(family_id, generation desc);

alter table platform_access_tokens
  add column family_id uuid references platform_refresh_token_families(family_id) on delete cascade;

create index platform_access_tokens_family
  on platform_access_tokens(family_id)
  where family_id is not null;

insert into platform_client_scopes (client_id, scope)
values ('yoyoo_dev', 'offline_access');
