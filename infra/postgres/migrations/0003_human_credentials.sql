create table principal_auth_profiles (
  principal_id uuid primary key references principals(principal_id) on delete cascade,
  webauthn_user_id text not null unique
    check (webauthn_user_id ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now()
);

create table webauthn_credentials (
  credential_id text primary key
    check (credential_id ~ '^[A-Za-z0-9_-]+$' and char_length(credential_id) <= 1024),
  principal_id uuid not null references principals(principal_id) on delete cascade,
  public_key bytea not null check (octet_length(public_key) > 0),
  counter bigint not null default 0 check (counter >= 0),
  device_type text not null check (device_type in ('singleDevice', 'multiDevice')),
  backed_up boolean not null,
  transports text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= created_at)
);

create index webauthn_credentials_active_by_principal
  on webauthn_credentials(principal_id)
  where revoked_at is null;

create table auth_challenges (
  challenge_id uuid primary key,
  purpose text not null check (purpose in ('registration', 'authentication')),
  challenge_hash bytea not null check (octet_length(challenge_hash) = 32),
  principal_id uuid references principals(principal_id) on delete cascade,
  pending_display_name text,
  pending_handle text,
  webauthn_user_id text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((pending_display_name is null) = (pending_handle is null)),
  check (purpose <> 'authentication' or (
    pending_display_name is null and pending_handle is null and webauthn_user_id is null
  )),
  check (purpose <> 'registration' or webauthn_user_id is not null),
  check (consumed_at is null or consumed_at >= created_at)
);

create index auth_challenges_expiry
  on auth_challenges(expires_at)
  where consumed_at is null;

create table auth_sessions (
  session_hash bytea primary key check (octet_length(session_hash) = 32),
  principal_id uuid not null references principals(principal_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (verified_at >= created_at - interval '1 second'),
  check (revoked_at is null or revoked_at >= created_at)
);

create index auth_sessions_active_by_principal
  on auth_sessions(principal_id, expires_at)
  where revoked_at is null;

create table auth_rate_limits (
  scope text not null,
  key_hash bytea not null check (octet_length(key_hash) = 32),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (scope, key_hash)
);

create table security_audit_events (
  event_id uuid primary key,
  event_type text not null,
  actor_principal_id uuid references principals(principal_id) on delete set null,
  target_type text not null,
  target_id text,
  result text not null check (result in ('succeeded', 'failed', 'denied')),
  request_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index security_audit_events_by_actor
  on security_audit_events(actor_principal_id, created_at desc);
