alter table platform_subjects
  add constraint platform_subjects_client_principal_subject_unique
  unique (client_id, principal_id, subject);

alter table platform_access_tokens
  drop constraint platform_access_tokens_client_id_principal_id_fkey,
  drop constraint platform_access_tokens_subject_fkey,
  add constraint platform_access_tokens_subject_binding_fkey
    foreign key (client_id, principal_id, subject)
    references platform_subjects(client_id, principal_id, subject)
    on delete cascade;
