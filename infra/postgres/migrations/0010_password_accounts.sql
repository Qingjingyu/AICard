create table human_password_credentials (
  principal_id uuid primary key references principals(principal_id) on delete cascade,
  password_hash bytea not null check (octet_length(password_hash) = 64),
  password_salt bytea not null check (octet_length(password_salt) = 16),
  password_algorithm text not null check (password_algorithm = 'scrypt-v1'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table account_registration_requests (
  client_id text not null references platform_clients(client_id) on delete restrict,
  idempotency_key_hash bytea not null check (octet_length(idempotency_key_hash) = 32),
  request_fingerprint bytea not null check (octet_length(request_fingerprint) = 32),
  principal_id uuid not null references principals(principal_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, idempotency_key_hash)
);

create index account_registration_requests_by_principal
  on account_registration_requests(principal_id, created_at desc);
