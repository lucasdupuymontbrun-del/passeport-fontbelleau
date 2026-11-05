# Passeport numérique d'ouvrage — Domaine de Fontbelleau

Fiche d'identité numérique de l'ouvrage **A2 PM 106** (prémur du noyau central, tour A2, étage R+1), accessible par QR code depuis le chantier.

Démonstrateur réalisé pour le projet ESCT MP2-BC1-P3 Transition numérique. Les données fictives sont signalées par des hachures dans tout le passeport.

- Passeport : `A2-PM106/`
- Données de référence : `data/A2-PM106.json`
- Vue 3D extraite de la maquette Revit `MQT-FONTBELLEAU-G4` : `model/`
- Suivi de chantier (statuts, réserves, photos, historique) : Supabase, schéma dans `supabase/schema.sql`
- QR code et étiquette à imprimer : `qr/`
- Mise à jour et maintenance : [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md)

## Mise en ligne

1. Exécuter `supabase/schema.sql` dans le SQL Editor du projet Supabase, puis ajouter les membres (voir le guide).
2. Renseigner `config.js` : adresse du site, URL Supabase, clé publique `anon` / `publishable`.
3. GitHub : Settings > Pages > Deploy from a branch > `main` / racine.
4. Supabase : Authentication > URL Configuration > ajouter l'adresse du site.
5. Générer le QR code avec `tools/qr.py`.

## Licences des composants

three.js (MIT), supabase-js (MIT), polices Archivo et Big Shoulders Stencil (SIL Open Font License) : voir `assets/vendor/` et `assets/fonts/`.
