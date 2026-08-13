create sequence ai_card_public_id_sequence
  as bigint
  start with 100001
  increment by 1
  no cycle;

alter table card_handles
  drop constraint card_handles_card_id_fkey;

alter table agent_invitations
  drop constraint agent_invitations_card_id_fkey;

alter table ai_cards
  drop constraint ai_cards_card_id_check;

create temporary table ai_card_id_migration (
  old_card_id text primary key,
  new_card_id text not null unique
) on commit drop;

insert into ai_card_id_migration (old_card_id, new_card_id)
select
  card_id,
  'AI_' || (100000 + row_number() over (order by created_at, principal_id))::text
from ai_cards;

update card_handles as handles
set card_id = migration.new_card_id
from ai_card_id_migration as migration
where handles.card_id = migration.old_card_id;

update agent_invitations as invitations
set card_id = migration.new_card_id
from ai_card_id_migration as migration
where invitations.card_id = migration.old_card_id;

update ai_cards as cards
set card_id = migration.new_card_id
from ai_card_id_migration as migration
where cards.card_id = migration.old_card_id;

create table ai_card_id_aliases (
  old_card_id text primary key
    check (old_card_id ~ '^aic_[0-9A-HJKMNP-TV-Z]{26}$'),
  card_id text not null unique references ai_cards(card_id) on delete cascade,
  migrated_at timestamptz not null default now()
);

insert into ai_card_id_aliases (old_card_id, card_id)
select old_card_id, new_card_id from ai_card_id_migration;

select setval(
  'ai_card_public_id_sequence',
  greatest(100001, 100000 + (select count(*) from ai_cards)),
  (select count(*) > 0 from ai_cards)
);

alter table ai_cards
  add constraint ai_cards_card_id_check
    check (card_id ~ '^AI_[1-9][0-9]{5,}$');

alter table card_handles
  add constraint card_handles_card_id_fkey
    foreign key (card_id) references ai_cards(card_id)
    on update cascade on delete cascade;

alter table agent_invitations
  add constraint agent_invitations_card_id_fkey
    foreign key (card_id) references ai_cards(card_id)
    on update cascade on delete cascade;

create function assign_ai_card_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.card_id is not null then
    raise exception 'AI Card ID is assigned by the identity service';
  end if;
  new.card_id := 'AI_' || nextval('ai_card_public_id_sequence')::text;
  return new;
end;
$$;

create trigger ai_cards_assign_public_id
before insert on ai_cards
for each row execute function assign_ai_card_public_id();

create function prevent_ai_card_public_id_change()
returns trigger
language plpgsql
as $$
begin
  if new.card_id is distinct from old.card_id then
    raise exception 'AI Card ID is immutable';
  end if;
  return new;
end;
$$;

create trigger ai_cards_prevent_public_id_change
before update of card_id on ai_cards
for each row execute function prevent_ai_card_public_id_change();
