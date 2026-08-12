alter table platform_client_scopes
  drop constraint platform_client_scopes_scope_check,
  add constraint platform_client_scopes_scope_check
    check (scope in ('card.basic', 'card.handle', 'card.id', 'offline_access', 'agent.runtime'));

alter table platform_grants
  drop constraint platform_grants_scopes_check,
  add constraint platform_grants_scopes_check
    check (
      cardinality(scopes) between 1 and 5
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access', 'agent.runtime'
      ]::text[]
    );

alter table authorization_codes
  drop constraint authorization_codes_scopes_check,
  add constraint authorization_codes_scopes_check
    check (
      cardinality(scopes) between 1 and 5
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access', 'agent.runtime'
      ]::text[]
    );

alter table platform_access_tokens
  drop constraint platform_access_tokens_scopes_check,
  add constraint platform_access_tokens_scopes_check
    check (
      cardinality(scopes) between 1 and 5
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access', 'agent.runtime'
      ]::text[]
    );

alter table platform_refresh_token_families
  drop constraint platform_refresh_token_families_scopes_check,
  add constraint platform_refresh_token_families_scopes_check
    check (
      cardinality(scopes) between 1 and 5
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access', 'agent.runtime'
      ]::text[]
      and 'offline_access' = any(scopes)
    );

insert into platform_client_scopes (client_id, scope)
values ('yoyoo_dev', 'agent.runtime');

create table agent_runtime_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  grant_id uuid not null references platform_grants(grant_id) on delete cascade,
  node_id uuid not null references agent_nodes(node_id) on delete cascade,
  client_id text not null references platform_clients(client_id) on delete restrict,
  subject text not null,
  audience text not null check (audience ~ '^[a-z][a-z0-9:_-]{2,127}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  foreign key (subject)
    references platform_subjects(subject) on delete cascade
);

create index agent_runtime_tokens_active
  on agent_runtime_tokens(client_id, node_id, expires_at)
  where expires_at > created_at;
