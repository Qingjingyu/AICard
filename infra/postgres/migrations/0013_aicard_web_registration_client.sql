insert into platform_clients (client_id, display_name, audience)
values ('aicard_web', 'AI Card', 'aicard-web')
on conflict (client_id) do nothing;
