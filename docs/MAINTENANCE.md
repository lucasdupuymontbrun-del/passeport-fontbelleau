# Passeport numérique A2 PM 106 — guide de mise à jour et de maintenance

Ce guide explique comment faire vivre le passeport sans reconstruire l'interface.

## 1. Comment le passeport est construit

| Partie | Où elle se trouve | Qui la modifie |
|---|---|---|
| Interface (pages, styles, scripts) | `A2-PM106/index.html`, `assets/` | Rarement, par la personne qui maintient le site |
| Données de référence (identité, documents, planning, scénario) | `data/A2-PM106.json` | Le référent BIM, par un commit sur GitHub |
| Suivi de chantier (statut, remarques, réserves, photos, dates saisies, historique) | Base Supabase | Les éditeurs, depuis le passeport, sur téléphone ou ordinateur |
| Plans du DCE | Stockage privé Supabase, dossier `documents` | Les éditeurs, depuis le passeport (bouton « Ajouter un document ») |
| Vue 3D | `model/a2.json` et `model/a2.bin(.gz)`, extraits de la maquette Revit | Le référent BIM, après une évolution de la maquette |
| Plan de repérage | `plans/A2-PM106-R1.svg`, généré depuis la vue 3D | Le référent BIM |
| QR code et étiquette | `qr/` | Généré une fois ; à refaire seulement si l'adresse du site change |

Le site est statique (GitHub Pages). Les données vivantes sont dans Supabase. Si Supabase ne répond pas, le passeport reste lisible : il affiche le scénario enregistré dans `data/A2-PM106.json` et l'indique dans la rubrique « Suivi de chantier ».

## 2. Mettre à jour le suivi depuis le chantier (éditeurs)

1. Scannez le QR code ou ouvrez l'adresse du passeport.
2. Touchez l'icône de compte, saisissez votre e-mail et ouvrez le lien reçu **sur le même appareil**.
3. Une fois connecté comme éditeur, vous pouvez :
   - **changer le statut** (bouton « Changer le statut ») : l'historique est complété automatiquement. Si le nouveau statut correspond à un jalon sans date réelle, la date du jour est enregistrée comme date réelle ;
   - **ajouter une remarque, une observation ou une réserve**, puis lever une réserve ;
   - **ajouter une photo** (l'appareil photo du téléphone s'ouvre ; l'image est réduite avant l'envoi) ;
   - **mettre à jour une valeur** (icône crayon sur une ligne) en indiquant **toujours la source** (bon de livraison, constat, PV…). La ligne passe alors en fiabilité « Saisi » ;
   - **cocher les points de contrôle avant pose** ;
   - **ajouter un document PDF** dans une catégorie (par exemple le plan de ferraillage quand il sera disponible).

Toutes ces actions sont horodatées et signées par l'e-mail de l'éditeur dans « Historique des modifications ». Les écrans ouverts se mettent à jour en direct.

## 3. Gérer les personnes autorisées

Dans Supabase : **Table Editor > membres**, ou **SQL Editor** :

```sql
insert into public.membres (email, role, nom) values
  ('prenom.nom@exemple.fr', 'editeur', 'Prénom Nom'),
  ('jury@exemple.fr', 'lecteur', 'Jury ESCT')
on conflict (email) do update set role = excluded.role, nom = excluded.nom;
```

- `editeur` : modifie le suivi et ouvre les plans.
- `lecteur` : ouvre les plans, ne modifie rien.
- Toute autre personne, connectée ou non, consulte le passeport en lecture seule et ne peut pas ouvrir les plans du DCE.

Pour retirer un accès : `delete from public.membres where email = '...';`

Les e-mails doivent être saisis en minuscules.

## 3 bis. Si le tableau de contrôle affiche « Règles de stockage : À FAIRE »

Certains projets Supabase refusent de créer les règles de stockage depuis le SQL Editor. Créez-les à la main : **Storage > Policies**, puis « New policy » > « For full customization » sur le compartiment indiqué :

| Compartiment | Nom | Opération | Rôle | Définition |
|---|---|---|---|---|
| documents | documents: membre lit | SELECT | authenticated | `bucket_id = 'documents' and public.est_membre()` |
| documents | documents: editeur televerse | INSERT | authenticated | `bucket_id = 'documents' and public.est_editeur()` |
| photos | photos: editeur televerse | INSERT | authenticated | `bucket_id = 'photos' and public.est_editeur()` |

Relancez ensuite `supabase/schema.sql` : la ligne doit passer à « OK ».

## 4. Modifier les données de référence (`data/A2-PM106.json`)

Sur GitHub, ouvrez le fichier, cliquez sur le crayon, modifiez, puis « Commit changes ». Le site est republié en une à deux minutes.

Chaque information suit le même modèle :

```json
{ "cle": "poids", "label": "Poids", "valeur": "≈ 1,37 t au levage",
  "detail": "Hypothèses : …", "fiab": "estime", "sources": ["Calcul à partir des dimensions de la maquette"] }
```

Codes de fiabilité (`fiab`) :

| Code | Affiché | Quand l'utiliser |
|---|---|---|
| `verifie` | Vérifié | Confirmé par deux sources concordantes ou une pièce du marché |
| `modele` | Maquette | Lu dans la maquette Revit, à confirmer en exécution |
| `estime` | Estimation | Calculé ; les hypothèses sont dans `detail` |
| `conflit` | Sources en conflit | Deux documents se contredisent ; expliquer le choix dans `detail` |
| `fictif` | Fictif | Donnée inventée pour la démonstration (hachurée partout) |
| `nd` | Non disponible | Introuvable : laisser `valeur` à `null` |
| `saisi` | Saisi | Réservé aux valeurs saisies depuis le passeport |

Règle : **ne jamais inscrire une valeur sans source**. Si une information manque, mettre `"valeur": null` et `"fiab": "nd"`.

**Passer d'une donnée fictive à une donnée réelle** : remplacez la valeur, mettez `fiab` à `verifie` (ou `modele`) et indiquez la pièce dans `sources`. Pour le statut et l'historique fictifs déjà en base, supprimez-les dans Supabase (`delete from evenements where fictif;` et `delete from notes where fictif;`) puis fixez le statut réel avec le bouton « Changer le statut ».

Les jalons du planning (`planning.jalons`) portent trois dates : `contractuelle`, `previsionnelle`, `reelle` (format `AAAA-MM-JJ`, `null` si inconnue). La « prochaine échéance » de l'accueil est le premier jalon sans date réelle.

## 5. Ajouter ou remplacer un plan du DCE

Deux possibilités :

- depuis le passeport, connecté comme éditeur : « Ajouter un document » ;
- depuis Supabase : **Storage > documents > A2-PM106/**, glisser le PDF, puis renseigner son chemin dans `documents[].fichier` du fichier JSON (sans le préfixe `documents/`).

Les plans du DCE ne doivent pas être déposés dans le dépôt GitHub : il est public.

## 6. Mettre à jour la vue 3D après une modification de la maquette

1. Ouvrir `MQT-FONTBELLEAU-G4` dans Revit et exécuter `tools/revit_export_geometry.py` (pont Python, pyRevit ou RevitPythonShell). Le script est en lecture seule et écrit dans `Documents\Passeport_A2_PM106\export3d\`.
2. Copier le dossier `export3d` à la racine du site, puis :

```bash
python tools/build_model.py
gzip -9 -k -f model/a2.bin
python tools/build_plan.py
```

3. Publier (commit) `model/` et `plans/`. Ne pas publier `export3d/`.

## 7. QR code

Le QR code contient l'adresse **permanente** `https://<compte>.github.io/<dépôt>/A2-PM106/`. Il ne change pas quand les données changent. Il faut le régénérer seulement si l'adresse du site change :

```bash
pip install segno reportlab opencv-python-headless
python tools/qr.py https://<compte>.github.io/<dépôt>/A2-PM106/ A2-PM106 "A2 PM 106" "Tour A2, étage R+1, noyau central"
```

Le script relit le QR produit et refuse de terminer si l'adresse lue ne correspond pas. L'étiquette `qr/Etiquette_A2-PM106.pdf` mesure 150 × 100 mm ; imprimez-la à 100 %, plastifiez-la et fixez-la à hauteur d'yeux près de l'ouvrage.

## 8. Créer le passeport d'un autre ouvrage

1. Copier `A2-PM106/` en `A2-PM107/` et remplacer `data-ref="A2-PM106"` dans `index.html`.
2. Copier `data/A2-PM106.json` en `data/A2-PM107.json` et le remplir.
3. Dans Supabase : `insert into ouvrages (ref, statut) values ('A2-PM107', 'a_commander');`
4. Pour la 3D, adapter `TARGET` (ElementId) dans `tools/revit_export_geometry.py`.
5. Générer le QR code avec la nouvelle adresse.

## 9. Disponibilité et sécurité

- **Supabase gratuit** : un projet sans activité pendant une semaine est mis en pause. La tâche GitHub `.github/workflows/keepalive.yml` l'interroge deux fois par semaine. Si le suivi affiche « Hors ligne », ouvrez le tableau de bord Supabase et relancez le projet (« Restore »).
- **Envoi des e-mails de connexion** : le service d'e-mail intégré de Supabase est limité à quelques messages par heure. Pour un usage réel, configurez un SMTP (Authentication > Emails > SMTP).
- La clé publique Supabase (`anon` / `publishable`) dans `config.js` est faite pour être publique : les droits sont contrôlés par les règles RLS de `supabase/schema.sql`. Ne mettez **jamais** la clé `service_role` / `secret` dans le site.
- Dans Supabase, **Authentication > URL Configuration** : l'adresse du site doit figurer dans « Site URL » et « Redirect URLs », sinon les liens de connexion ne ramènent pas au passeport.

## 10. En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Hors ligne » dans le suivi | Projet Supabase en pause, ou `config.js` vide | Relancer le projet ; vérifier `config.js` |
| Le lien de connexion ouvre une page vide ou localhost | URL de redirection absente | Ajouter l'adresse du site dans Authentication > URL Configuration |
| « Action refusée » | L'e-mail n'est pas éditeur | L'ajouter dans `membres` avec le rôle `editeur` |
| « Accès réservé » sur un plan | L'e-mail n'est pas dans `membres` | L'ajouter comme `lecteur` ou `editeur` |
| La 3D ne s'affiche pas | Navigateur sans WebGL | Le plan de repérage reste disponible dans « Localisation » |
