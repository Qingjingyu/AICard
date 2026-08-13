insert into platform_client_scopes (client_id, scope)
values ('test_client', 'card.id')
on conflict (client_id, scope) do nothing;
