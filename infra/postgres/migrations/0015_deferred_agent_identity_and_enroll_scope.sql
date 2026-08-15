alter table platform_client_scopes
  drop constraint platform_client_scopes_scope_check,
  add constraint platform_client_scopes_scope_check
    check (scope in (
      'card.basic', 'card.handle', 'card.id', 'offline_access',
      'agent.runtime', 'agent.enroll'
    ));

alter table platform_grants
  drop constraint platform_grants_scopes_check,
  add constraint platform_grants_scopes_check
    check (
      cardinality(scopes) between 1 and 6
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access',
        'agent.runtime', 'agent.enroll'
      ]::text[]
    );

alter table authorization_codes
  drop constraint authorization_codes_scopes_check,
  add constraint authorization_codes_scopes_check
    check (
      cardinality(scopes) between 1 and 6
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access',
        'agent.runtime', 'agent.enroll'
      ]::text[]
    );

alter table platform_access_tokens
  drop constraint platform_access_tokens_scopes_check,
  add constraint platform_access_tokens_scopes_check
    check (
      cardinality(scopes) between 1 and 6
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access',
        'agent.runtime', 'agent.enroll'
      ]::text[]
    );

alter table platform_refresh_token_families
  drop constraint platform_refresh_token_families_scopes_check,
  add constraint platform_refresh_token_families_scopes_check
    check (
      cardinality(scopes) between 1 and 6
      and scopes <@ array[
        'card.basic', 'card.handle', 'card.id', 'offline_access',
        'agent.runtime', 'agent.enroll'
      ]::text[]
      and 'offline_access' = any(scopes)
    );

insert into platform_client_scopes (client_id, scope)
select client_id, 'agent.enroll'
from platform_clients
where audience = 'yoyoo'
on conflict (client_id, scope) do nothing;

alter table agent_invitations
  add column display_name text,
  add column client_id text references platform_clients(client_id) on delete restrict;

update agent_invitations invitations
set display_name = cards.display_name,
    client_id = 'yoyoo_dev'
from ai_cards cards
where cards.card_id = invitations.card_id;

alter table agent_invitations
  alter column card_id drop not null,
  alter column display_name set not null,
  alter column client_id set not null,
  add constraint agent_invitations_display_name_check
    check (char_length(display_name) between 1 and 64);
