create schema reference_product;

create table reference_product.login_flows (
  flow_hash bytea primary key check (octet_length(flow_hash) = 32),
  client_id text not null check (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  redirect_uri text not null,
  state_hash bytea not null check (octet_length(state_hash) = 32),
  verifier_ciphertext bytea not null,
  verifier_iv bytea not null check (octet_length(verifier_iv) = 12),
  verifier_tag bytea not null check (octet_length(verifier_tag) = 16),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  response_ciphertext bytea,
  response_iv bytea check (response_iv is null or octet_length(response_iv) = 12),
  response_tag bytea check (response_tag is null or octet_length(response_tag) = 16),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((consumed_at is null) = (response_ciphertext is null)),
  check ((response_ciphertext is null) = (response_iv is null)),
  check ((response_ciphertext is null) = (response_tag is null))
);

create index reference_product_login_flows_active
  on reference_product.login_flows(expires_at)
  where consumed_at is null;

create table reference_product.members (
  member_id uuid primary key,
  client_id text not null check (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  subject text not null check (subject ~ '^sub_[A-Za-z0-9_-]{43}$'),
  card_id text not null check (card_id ~ '^AI_[1-9][0-9]{5,}$'),
  principal_type text not null check (principal_type in ('human', 'ai')),
  display_name text not null check (char_length(display_name) between 1 and 64),
  handle text not null check (handle ~ '^[a-z][a-z0-9_]{2,31}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, subject),
  unique (client_id, card_id)
);

create table reference_product.sessions (
  session_hash bytea primary key check (octet_length(session_hash) = 32),
  member_id uuid not null references reference_product.members(member_id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

create index reference_product_sessions_active
  on reference_product.sessions(member_id, expires_at)
  where revoked_at is null;
