-- Passeports de tous les ouvrages : mise à jour de la base de suivi.
-- À exécuter une fois dans Supabase → SQL Editor → New query (coller tout le fichier, puis Run).
-- Le script ne supprime rien. Il ajoute une fonction qui crée la ligne de suivi d'un ouvrage
-- au premier geste d'un éditeur (changement de statut, note, photo, document, date), avec
-- l'historique fictif du scénario de démonstration de cet ouvrage, toujours marqué « fictif ».

create or replace function public.initialiser_ouvrage(p_ref text, p_statut text, p_maj_le timestamptz default null,
                                                      p_evenements jsonb default '[]'::jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare ev jsonb;
begin
  if not public.est_editeur() then raise exception 'not allowed: votre compte n''est pas éditeur'; end if;
  if p_ref is null or p_ref !~ '^[A-Za-z0-9._-]{1,80}$' then raise exception 'Référence d''ouvrage invalide'; end if;
  insert into ouvrages(ref, statut, maj_le, maj_par)
  values (p_ref, coalesce(p_statut, 'a_commander'), coalesce(p_maj_le, now()), 'Scénario de démonstration')
  on conflict (ref) do nothing;
  if not found then return false; end if;
  for ev in select * from jsonb_array_elements(coalesce(p_evenements, '[]'::jsonb)) loop
    insert into evenements(ref, type, ancien, nouveau, commentaire, auteur, fictif, cree_le)
    values (p_ref, 'statut', ev->>'ancien', ev->>'nouveau', ev->>'commentaire', 'Scénario de démonstration', true,
            coalesce((ev->>'cree_le')::timestamptz, now()));
  end loop;
  return true;
end $$;
revoke all on function public.initialiser_ouvrage(text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.initialiser_ouvrage(text, text, timestamptz, jsonb) to authenticated;

-- Contrôle
select 'Fonction initialiser_ouvrage' as controle,
       case when exists (select 1 from pg_proc where proname = 'initialiser_ouvrage') then 'OK' else 'À FAIRE' end as etat
union all
select 'Ouvrages déjà suivis en ligne', (select count(*)::text from public.ouvrages);
