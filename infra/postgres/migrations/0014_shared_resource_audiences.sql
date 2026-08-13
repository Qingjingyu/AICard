alter table platform_clients
  drop constraint platform_clients_audience_key;

create index platform_clients_audience
  on platform_clients(audience)
  where status = 'active';
