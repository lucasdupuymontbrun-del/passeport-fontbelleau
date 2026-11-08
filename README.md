# Passeports numériques d'ouvrage — Domaine de Fontbelleau

Maquette 3D du projet et fiche d'identité numérique de chaque ouvrage (3 905 fiches), accessibles par deux QR codes : celui du prémur **A2 PM 106** et celui du **projet**.

Démonstrateur réalisé pour le projet ESCT MP2-BC1-P3 Transition numérique. Les données fictives sont signalées par des hachures.

- Maquette du projet (QR projet) : `index.html`
- Fiche d'un ouvrage : `o/?r=<référence>` ; fiche détaillée d'A2 PM 106 : `A2-PM106/`
- Données générées depuis la maquette Revit `MQT-FONTBELLEAU-G4` : `data/`, `model/`, `plans/` (générateur : `tools/build_passeports.py`)
- Plans de ferraillage d'exemple (fictifs, aucun calcul de structure) et scénario d'avancement 4D : `tools/build_ferraillage_4d.py`, à lancer après le générateur
- Mode présentation (visite guidée en 7 étapes) : bouton « Présentation » ou `?presentation`
- Suivi de chantier (statuts, réserves, photos, historique) : Supabase, schéma dans `supabase/schema.sql`
- QR codes et étiquettes : `qr/`
- Jumeau énergétique et comparatif A1 / A2 : **site séparé**, dépôt [`jumeau-fontbelleau`](https://github.com/lucasdupuymontbrun-del/jumeau-fontbelleau), en ligne sur https://lucasdupuymontbrun-del.github.io/jumeau-fontbelleau/. Les anciennes adresses `energie/` et `comparatif/` redirigent vers lui (l'étiquette QR déjà imprimée reste valable). Ce dépôt garde seulement le volet « Énergie » des fiches (`data/energie/ouvrages.json` et `logements.json`, écrits par le générateur du jumeau)
- Audit de la maquette : [`docs/AUDIT_OUVRAGES.md`](docs/AUDIT_OUVRAGES.md)
- Mise à jour et maintenance : [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md)

## Mise en ligne

1. Exécuter `supabase/schema.sql` dans le SQL Editor du projet Supabase (ou, sur une base déjà installée, `supabase/migration_tous_ouvrages.sql`), puis ajouter les membres.
2. Renseigner `config.js` : adresse du site, URL Supabase, clé publique `anon` / `publishable`.
3. GitHub : Settings > Pages > Deploy from a branch > `main` / racine.
4. Supabase : Authentication > URL Configuration > ajouter l'adresse du site.
5. Générer les QR codes avec `tools/qr.py`.

## Licences des composants

three.js (MIT), supabase-js (MIT), polices Archivo et Big Shoulders Stencil (SIL Open Font License) : voir `assets/vendor/` et `assets/fonts/`.
