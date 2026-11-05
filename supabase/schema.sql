-- Passeport numérique d'ouvrage — schéma Supabase
-- À exécuter une seule fois dans Supabase : SQL Editor > New query > coller > Run.
-- Le script peut être relancé : il ne recrée pas ce qui existe déjà.

-- 1. Membres autorisés ------------------------------------------------
-- role = 'editeur' : modifie le suivi et ouvre les plans
-- role = 'lecteur' : ouvre les plans, ne modifie rien
create table if not exists public.membres (
  email text primary key check (email = lower(email)),
  role  text not null check (role in ('editeur', 'lecteur')),
  nom   text
);

create or replace function public.email_courant() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.est_editeur() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membres where email = public.email_courant() and role = 'editeur')
$$;

create or replace function public.est_membre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membres where email = public.email_courant())
$$;

-- 2. Tables du suivi ---------------------------------------------------
create table if not exists public.ouvrages (
  ref      text primary key,
  statut   text not null default 'a_commander' check (statut in
           ('a_commander','commande','fabrication','pret','livre','attente_pose','pose_en_cours','pose','receptionne')),
  maj_le   timestamptz not null default now(),
  maj_par  text
);

create table if not exists public.evenements (
  id          bigint generated always as identity primary key,
  ref         text not null references public.ouvrages(ref) on delete cascade,
  type        text not null,
  ancien      text,
  nouveau     text,
  commentaire text,
  auteur      text,
  fictif      boolean not null default false,
  cree_le     timestamptz not null default now()
);
create index if not exists evenements_ref_idx on public.evenements (ref, cree_le desc);

create table if not exists public.notes (
  id      bigint generated always as identity primary key,
  ref     text not null references public.ouvrages(ref) on delete cascade,
  type    text not null check (type in ('remarque','observation','reserve')),
  texte   text not null check (length(texte) between 1 and 2000),
  levee   boolean not null default false,
  auteur  text,
  fictif  boolean not null default false,
  cree_le timestamptz not null default now()
);

create table if not exists public.photos (
  id      bigint generated always as identity primary key,
  ref     text not null references public.ouvrages(ref) on delete cascade,
  chemin  text not null,
  legende text,
  auteur  text,
  cree_le timestamptz not null default now()
);

create table if not exists public.champs (
  ref     text not null references public.ouvrages(ref) on delete cascade,
  cle     text not null,
  valeur  text,
  source  text,
  auteur  text,
  maj_le  timestamptz not null default now(),
  primary key (ref, cle)
);

create table if not exists public.documents (
  id         bigint generated always as identity primary key,
  ref        text not null references public.ouvrages(ref) on delete cascade,
  categorie  text,
  titre      text not null,
  ref_doc    text,
  chemin     text not null,
  ajoute_par text,
  cree_le    timestamptz not null default now()
);

-- 3. Auteur et historique automatiques ---------------------------------
create or replace function public.t_auteur() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'notes' and tg_op = 'INSERT' then new.auteur := coalesce(nullif(public.email_courant(), ''), new.auteur);
  elsif tg_table_name = 'photos' then new.auteur := coalesce(nullif(public.email_courant(), ''), new.auteur);
  elsif tg_table_name = 'champs' then new.auteur := coalesce(nullif(public.email_courant(), ''), new.auteur); new.maj_le := now();
  elsif tg_table_name = 'documents' then new.ajoute_par := coalesce(nullif(public.email_courant(), ''), new.ajoute_par);
  end if;
  return new;
end $$;

create or replace function public.t_historique() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(nullif(public.email_courant(), ''), 'système');
begin
  -- Chaque table est traitée dans son propre bloc : PL/pgSQL ne lit que les colonnes de la table concernée.
  if tg_table_name = 'notes' then
    if tg_op = 'INSERT' then
      insert into evenements(ref, type, nouveau, auteur, fictif, cree_le)
      values (new.ref, 'note_' || new.type, new.texte, coalesce(nullif(public.email_courant(), ''), new.auteur, 'système'), new.fictif, new.cree_le);
      if new.fictif then return new; end if;
    elsif new.levee is distinct from old.levee then
      insert into evenements(ref, type, nouveau, auteur)
      values (new.ref, case when new.levee then 'reserve_levee' else 'reserve_rouverte' end, new.texte, who);
    else
      return new;
    end if;
  elsif tg_table_name = 'photos' then
    insert into evenements(ref, type, nouveau, auteur) values (new.ref, 'photo', new.legende, who);
  elsif tg_table_name = 'champs' then
    if tg_op = 'UPDATE' then
      insert into evenements(ref, type, ancien, nouveau, commentaire, auteur)
      values (new.ref, 'champ', old.valeur, new.valeur, new.cle || coalesce(' (source : ' || new.source || ')', ''), who);
    else
      insert into evenements(ref, type, nouveau, commentaire, auteur)
      values (new.ref, 'champ', new.valeur, new.cle || coalesce(' (source : ' || new.source || ')', ''), who);
    end if;
  elsif tg_table_name = 'documents' then
    insert into evenements(ref, type, nouveau, auteur) values (new.ref, 'document', new.titre, who);
  end if;
  update ouvrages set maj_le = now(), maj_par = who where ref = new.ref;
  return new;
end $$;

drop trigger if exists notes_auteur on public.notes;
create trigger notes_auteur before insert on public.notes for each row execute function public.t_auteur();
drop trigger if exists photos_auteur on public.photos;
create trigger photos_auteur before insert on public.photos for each row execute function public.t_auteur();
drop trigger if exists champs_auteur on public.champs;
create trigger champs_auteur before insert or update on public.champs for each row execute function public.t_auteur();
drop trigger if exists documents_auteur on public.documents;
create trigger documents_auteur before insert on public.documents for each row execute function public.t_auteur();

drop trigger if exists notes_hist on public.notes;
create trigger notes_hist after insert or update on public.notes for each row execute function public.t_historique();
drop trigger if exists photos_hist on public.photos;
create trigger photos_hist after insert on public.photos for each row execute function public.t_historique();
drop trigger if exists champs_hist on public.champs;
create trigger champs_hist after insert or update on public.champs for each row execute function public.t_historique();
drop trigger if exists documents_hist on public.documents;
create trigger documents_hist after insert on public.documents for each row execute function public.t_historique();

-- Changement de statut : une seule fonction, qui vérifie le droit et écrit l'historique.
create or replace function public.changer_statut(p_ref text, p_statut text, p_commentaire text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ancien text; who text := public.email_courant();
begin
  if not public.est_editeur() then raise exception 'not allowed: votre compte n''est pas éditeur'; end if;
  select statut into v_ancien from ouvrages where ref = p_ref for update;
  if not found then raise exception 'Ouvrage % introuvable', p_ref; end if;
  update ouvrages set statut = p_statut, maj_le = now(), maj_par = who where ref = p_ref;
  insert into evenements(ref, type, ancien, nouveau, commentaire, auteur) values (p_ref, 'statut', v_ancien, p_statut, p_commentaire, who);
end $$;
revoke all on function public.changer_statut(text, text, text) from public, anon;
grant execute on function public.changer_statut(text, text, text) to authenticated;

-- 4. Règles d'accès (RLS) ----------------------------------------------
alter table public.membres    enable row level security;
alter table public.ouvrages   enable row level security;
alter table public.evenements enable row level security;
alter table public.notes      enable row level security;
alter table public.photos     enable row level security;
alter table public.champs     enable row level security;
alter table public.documents  enable row level security;

drop policy if exists "membre lit sa ligne" on public.membres;
create policy "membre lit sa ligne" on public.membres for select to authenticated using (email = public.email_courant());

-- lecture publique du suivi (le passeport est consultable par QR code)
drop policy if exists "lecture publique" on public.ouvrages;
create policy "lecture publique" on public.ouvrages for select using (true);
drop policy if exists "lecture publique" on public.evenements;
create policy "lecture publique" on public.evenements for select using (true);
drop policy if exists "lecture publique" on public.notes;
create policy "lecture publique" on public.notes for select using (true);
drop policy if exists "lecture publique" on public.photos;
create policy "lecture publique" on public.photos for select using (true);
drop policy if exists "lecture publique" on public.champs;
create policy "lecture publique" on public.champs for select using (true);
drop policy if exists "lecture publique" on public.documents;
create policy "lecture publique" on public.documents for select using (true);

-- écriture réservée aux éditeurs (le statut passe par changer_statut)
drop policy if exists "editeur ajoute" on public.notes;
create policy "editeur ajoute" on public.notes for insert to authenticated with check (public.est_editeur());
drop policy if exists "editeur modifie" on public.notes;
create policy "editeur modifie" on public.notes for update to authenticated using (public.est_editeur()) with check (public.est_editeur());
drop policy if exists "editeur ajoute" on public.photos;
create policy "editeur ajoute" on public.photos for insert to authenticated with check (public.est_editeur());
drop policy if exists "editeur ajoute" on public.champs;
create policy "editeur ajoute" on public.champs for insert to authenticated with check (public.est_editeur());
drop policy if exists "editeur modifie" on public.champs;
create policy "editeur modifie" on public.champs for update to authenticated using (public.est_editeur()) with check (public.est_editeur());
drop policy if exists "editeur ajoute" on public.documents;
create policy "editeur ajoute" on public.documents for insert to authenticated with check (public.est_editeur());

-- 5. Stockage des fichiers ----------------------------------------------
-- Chaque opération est protégée : si Supabase refuse une étape, le reste du script continue
-- et le tableau de contrôle final indique ce qui reste à faire.
do $$
begin
  insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
  insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
exception when others then
  raise notice 'Compartiments non créés (%). Créez-les dans Storage : photos (public) et documents (privé).', sqlerrm;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos: editeur televerse') then
    execute $p$create policy "photos: editeur televerse" on storage.objects for insert to authenticated
             with check (bucket_id = 'photos' and public.est_editeur())$p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents: membre lit') then
    execute $p$create policy "documents: membre lit" on storage.objects for select to authenticated
             using (bucket_id = 'documents' and public.est_membre())$p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents: editeur televerse') then
    execute $p$create policy "documents: editeur televerse" on storage.objects for insert to authenticated
             with check (bucket_id = 'documents' and public.est_editeur())$p$;
  end if;
exception when others then
  raise notice 'Règles de stockage non créées (%). Voir docs/MAINTENANCE.md, section Stockage.', sqlerrm;
end $$;

-- 6. Temps réel (mise à jour instantanée des écrans ouverts) -------------
do $$
declare t text;
begin
  foreach t in array array['ouvrages','evenements','notes','photos','champs','documents'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when others then
  raise notice 'Temps réel non activé (%). Le passeport fonctionne, sans mise à jour instantanée.', sqlerrm;
end $$;

-- 7. Données initiales : A2 PM 106 et son scénario de démonstration ------
insert into public.ouvrages (ref, statut, maj_le, maj_par)
values ('A2-PM106', 'livre', '2026-11-04 10:20+01', 'Scénario de démonstration')
on conflict (ref) do nothing;

insert into public.evenements (ref, type, ancien, nouveau, commentaire, auteur, fictif, cree_le)
select * from (values
  ('A2-PM106', 'statut', 'a_commander', 'commande',    'Commande CMD-301-A2-0106 envoyée au préfabricant.', 'Scénario de démonstration', true, timestamptz '2026-10-07 09:00+02'),
  ('A2-PM106', 'statut', 'commande',    'fabrication', 'Coulage des deux peaux en usine.',                   'Scénario de démonstration', true, timestamptz '2026-10-27 07:30+01'),
  ('A2-PM106', 'statut', 'fabrication', 'pret',        'Contrôle usine conforme, mise sur chevalet.',        'Scénario de démonstration', true, timestamptz '2026-10-30 16:00+01'),
  ('A2-PM106', 'statut', 'pret',        'livre',       'Déchargé et stocké verticalement sur chevalet, zone de stockage nord.', 'Scénario de démonstration', true, timestamptz '2026-11-04 10:20+01')
) as v(ref, type, ancien, nouveau, commentaire, auteur, fictif, cree_le)
where not exists (select 1 from public.evenements where ref = 'A2-PM106' and fictif);

insert into public.notes (ref, type, texte, auteur, fictif, cree_le)
select * from (values
  ('A2-PM106', 'observation', 'Stocké verticalement sur chevalet, zone de stockage nord, à portée de grue.', 'Scénario de démonstration', true, timestamptz '2026-11-04 10:25+01'),
  ('A2-PM106', 'reserve', 'Épaufrure d''environ 3 cm à l''angle bas de la peau côté escalier. À reprendre avant la pose.', 'Scénario de démonstration', true, timestamptz '2026-11-04 10:30+01')
) as v(ref, type, texte, auteur, fictif, cree_le)
where not exists (select 1 from public.notes where ref = 'A2-PM106' and fictif);

-- 8. Tableau de contrôle : chaque ligne doit afficher OK -----------------
select 'Tables du suivi' as element,
       case when (select count(*) from information_schema.tables where table_schema = 'public'
                  and table_name in ('membres','ouvrages','evenements','notes','photos','champs','documents')) = 7
            then 'OK' else 'À FAIRE' end as etat
union all
select 'Ouvrage A2-PM106 et scénario', case when exists (select 1 from public.ouvrages where ref = 'A2-PM106') then 'OK' else 'À FAIRE' end
union all
select 'Compartiments photos et documents', case when (select count(*) from storage.buckets where id in ('photos','documents')) = 2 then 'OK' else 'À FAIRE : créer dans Storage' end
union all
select 'Règles de stockage', case when (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                                     and policyname in ('photos: editeur televerse','documents: membre lit','documents: editeur televerse')) = 3
                                  then 'OK' else 'À FAIRE : créer dans Storage > Policies' end
union all
select 'Temps réel', case when (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                                and tablename in ('ouvrages','evenements','notes','photos','champs','documents')) = 6
                          then 'OK' else 'Facultatif : non activé' end
union all
select 'Éditeurs déclarés', case when exists (select 1 from public.membres where role = 'editeur') then 'OK' else 'À FAIRE : ajouter votre e-mail' end;
