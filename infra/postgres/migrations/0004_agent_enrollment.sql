create table agent_invitations (
  invitation_id uuid primary key,
  card_id text not null references ai_cards(card_id) on delete cascade,
  controller_principal_id uuid not null references principals(principal_id) on delete cascade,
  ticket_hash bytea not null unique check (octet_length(ticket_hash) = 32),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'revoked')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'claimed') = (claimed_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index agent_invitations_by_controller
  on agent_invitations(controller_principal_id, created_at desc);

create table agent_nodes (
  node_id uuid primary key,
  principal_id uuid not null references principals(principal_id) on delete cascade,
  machine_name text not null check (machine_name ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  public_key_spki bytea not null check (octet_length(public_key_spki) between 32 and 256),
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_authenticated_at timestamptz,
  online_until timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((status = 'revoked') = (revoked_at is not null)),
  unique (principal_id, machine_name)
);

create index agent_nodes_by_principal on agent_nodes(principal_id, created_at desc);

create table agent_claims (
  claim_id uuid primary key,
  invitation_id uuid not null unique references agent_invitations(invitation_id) on delete cascade,
  node_id uuid not null unique references agent_nodes(node_id) on delete cascade,
  claim_secret_hash bytea not null check (octet_length(claim_secret_hash) = 32),
  created_at timestamptz not null default now()
);

create table agent_node_challenges (
  challenge_id uuid primary key,
  node_id uuid not null references agent_nodes(node_id) on delete cascade,
  challenge_hash bytea not null check (octet_length(challenge_hash) = 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index agent_node_challenges_active
  on agent_node_challenges(node_id, expires_at)
  where consumed_at is null;
