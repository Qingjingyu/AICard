create table service_metadata (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into service_metadata (key, value)
values ('foundation_version', '1');
