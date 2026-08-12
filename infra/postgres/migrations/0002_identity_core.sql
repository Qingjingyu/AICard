create table principals (
  principal_id uuid primary key,
  principal_type text not null check (principal_type in ('human', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (substring(principal_id::text from 15 for 1) = '7')
);

create table ai_cards (
  card_id text primary key check (card_id ~ '^aic_[0-9A-HJKMNP-TV-Z]{26}$'),
  principal_id uuid not null unique references principals(principal_id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_url text,
  bio text check (bio is null or char_length(bio) <= 280),
  status text not null default 'active' check (status in ('active', 'suspended', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);

create table card_handles (
  handle text primary key check (handle ~ '^[a-z][a-z0-9_]{2,31}$'),
  card_id text not null references ai_cards(card_id) on delete cascade,
  is_current boolean not null default true,
  claimed_at timestamptz not null default now(),
  retired_at timestamptz,
  check (is_current = (retired_at is null))
);

create unique index card_handles_one_current_per_card
  on card_handles(card_id)
  where is_current;

create table principal_controllers (
  controlled_principal_id uuid not null references principals(principal_id) on delete cascade,
  controller_principal_id uuid not null references principals(principal_id) on delete cascade,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (controlled_principal_id, controller_principal_id),
  check (controlled_principal_id <> controller_principal_id),
  check (revoked_at is null or revoked_at >= verified_at)
);

create table platform_subjects (
  client_id text not null check (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  principal_id uuid not null references principals(principal_id) on delete cascade,
  subject text not null unique check (subject ~ '^sub_[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  primary key (client_id, principal_id)
);

create index principal_controllers_by_controller
  on principal_controllers(controller_principal_id)
  where revoked_at is null;
