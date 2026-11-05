# Passeports numériques des ouvrages — guide de mise à jour et de maintenance

Ce guide explique comment faire vivre le passeport sans reconstruire l'interface.

## 1. Comment les passeports sont construits

Le site contient **un passeport par ouvrage de la maquette** (3 899 fiches) et **deux QR codes** :

- le QR d'**A2 PM 106**, qui ouvre directement sa fiche détaillée (`A2-PM106/`) ;
- le QR du **projet**, qui ouvre la maquette 3D (page d'accueil du site). On y touche un ouvrage (ou on le cherche par sa référence) pour afficher son résumé, puis on ouvre sa fiche complète (`o/?r=<référence>`).

| Partie | Où elle se trouve | Qui la modifie |
|---|---|---|
| Interface | `index.html` (maquette du projet), `o/index.html` (fiche d'un ouvrage), `A2-PM106/index.html`, `assets/` | Rarement, par la personne qui maintient le site |
| Fiches des ouvrages | `data/o/<référence>.json`, `data/commun.json`, `data/index.json` | Générées par `tools/build_passeports.py` depuis la maquette |
| Fiche détaillée d'A2 PM 106 | `tools/sources/A2-PM106.json` (rédigée et vérifiée à la main) | Le référent BIM |
| Suivi de chantier (statut, remarques, réserves, photos, dates saisies, historique) | Base Supabase | Les éditeurs, depuis les fiches |
| Plans du DCE | Stockage privé Supabase, compartiment `documents` | Les éditeurs, ou le tableau de bord Supabase |
| Vue 3D | `model/site.json`, `model/site.bin(.gz)` | Générée depuis la maquette Revit |
| Plans de repérage | `plans/<zone>-<étage>.svg` | Générés depuis la vue 3D |
| QR codes et étiquettes | `qr/A2-PM106.*`, `qr/Projet-Fontbelleau.*` | Générés une fois ; à refaire seulement si l'adresse du site change |
| Audit de la maquette | `docs/AUDIT_OUVRAGES.md` | Régénéré avec les fiches |

Le site est statique (GitHub Pages). Les données vivantes sont dans Supabase. Tant qu'un éditeur n'a rien modifié sur un ouvrage, sa fiche affiche le scénario de démonstration (marqué « Fictif ») ; la ligne de suivi en ligne est créée automatiquement au premier geste d'un éditeur (fonction `initialiser_ouvrage`, voir `supabase/migration_tous_ouvrages.sql`).

### Ce qui vient de la maquette et ce qui est fictif

- **Maquette** (tag « Maquette ») : référence, désignation, catégorie, bâtiment, étage, dimensions, surfaces et volumes, matériaux, lot quand il est écrit dans la maquette, position NGF, ouvrages au contact, quantités.
- **Vérifié** : bâtiment (sous-projet + DCE), lot 301 pour le gros œuvre (CCTP 301), pièces du DCE correspondant à la zone et à l'étage d'après leur intitulé.
- **Estimation** : poids des éléments en béton (volume × 2,5 t/m³).
- **Fictif** (hachuré) : fournisseurs, références de commande, montants, délais, dates des jalons, statuts, équipes, matériel, contrôles. Le scénario suit un cycle de 2 semaines par étage, la tour A1 ayant 4 semaines d'avance sur la tour A2, et reste cohérent avec A2 PM 106 (livré le 04/11/2026, pose prévue le 18/11/2026).
- **Non disponible** : tout le reste (ferraillage, notes de calcul, fiches techniques, CCTP absents du DCE…).

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

## 4. Modifier la fiche détaillée d'A2 PM 106 (`tools/sources/A2-PM106.json`, puis relancer `tools/build_passeports.py`)

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

## 6. Régénérer les fiches, la 3D et les plans après une modification de la maquette

1. Ouvrir `MQT-FONTBELLEAU-G4` dans Revit et exécuter, avec le pont Python, pyRevit ou RevitPythonShell :
   - `tools/revit_export_ouvrages.py` (données de tous les ouvrages) ;
   - `tools/revit_export_geometry_all.py` (géométrie 3D).
   Les deux scripts sont en lecture seule et écrivent dans `Documents\Passeport_Fontbelleau\`.
2. Copier `export\ouvrages.json` et le dossier `export3d` sur le poste qui génère le site, puis :

```bash
pip install numpy
python tools/build_passeports.py <chemin>/ouvrages.json <chemin>/export3d
```

3. Lire `docs/AUDIT_OUVRAGES.md` (identifiants en double, éléments sans identifiant, incohérences), puis publier `data/`, `model/`, `plans/` et `docs/`.

La référence d'une fiche dérive de l'identifiant de la maquette (`A2 PM 001` → `A2-PM001`). Les éléments de la tour A1 reçoivent le préfixe `A1`, déduit de leur sous-projet. Un identifiant partagé par plusieurs éléments donne des fiches numérotées (`A2-P201-1`, `A2-P201-2`…) et un avertissement.

## 6 bis. Lien avec la maquette Revit

Deux paramètres partagés d'occurrence sont liés à la catégorie **Murs** (groupe « Données d'identification ») :

| Paramètre | Type | GUID | Valeur sur A2 PM 106 (élément 439362) |
|---|---|---|---|
| Passeport - URL | URL | `e6cc7f1e-27bd-4971-b505-58a6f7b52222` | adresse du passeport (cliquable dans les propriétés Revit) |
| Passeport - Statut | Texte | `12091e0f-3f00-46be-aa97-e24d3c9e04b3` | copie du statut de suivi |

Leur définition est dans un fichier séparé, `Documents\FONTBELLEAU_terrain\scripts\PASSEPORT_params_partages.txt` ; le fichier de paramètres partagés habituel du projet n'a pas été modifié. Le voile jumeau de la tour A1 (élément 318104) a été renommé « A1 PM 106 » pour lever l'homonymie.

Ces deux paramètres ne sont remplis que pour A2 PM 106 ; les autres ouvrages sont accessibles par la maquette du projet. Le passeport en ligne reste la source de vérité du statut : « Passeport - Statut » est une copie, à mettre à jour à la main dans Revit lors des jalons importants (livraison, pose, réception). Après toute modification, **Synchroniser avec le fichier central**.

## 7. QR codes

Deux QR codes seulement :

| QR | Adresse | Fichiers |
|---|---|---|
| A2 PM 106 | `https://lucasdupuymontbrun-del.github.io/passeport-fontbelleau/A2-PM106/` | `qr/A2-PM106.png`, `.svg`, `qr/Etiquette_A2-PM106.pdf` |
| Projet (maquette 3D) | `https://lucasdupuymontbrun-del.github.io/passeport-fontbelleau/` | `qr/Projet-Fontbelleau.png`, `.svg`, `qr/Etiquette_Projet-Fontbelleau.pdf` |

À regénérer seulement si l'adresse du site change :

```bash
pip install segno reportlab opencv-python-headless
python tools/qr.py <adresse>/A2-PM106/ A2-PM106 "A2 PM 106" "Tour A2, étage R+1, noyau central"
python tools/qr.py <adresse>/ Projet-Fontbelleau "Fontbelleau" "Tours A1 et A2, parking, fondations et abords"
```

Le script relit chaque QR produit et refuse de terminer si l'adresse lue ne correspond pas. Les étiquettes mesurent 150 × 100 mm ; imprimez-les à 100 %. Le lien `…/?o=<référence>` ouvre la maquette directement sur un ouvrage.

## 8. Plans du DCE consultables depuis les fiches

Les fiches renvoient vers les pièces du DCE correspondant à leur zone et à leur étage. Elles s'ouvrent après connexion (membres) depuis le compartiment privé `documents` de Supabase. Quatre pièces y sont déjà, dans `A2-PM106/` (GO.03.02.05, GO.03.02.07, coupe A2, CCTP 301). Les autres sont attendues dans `documents/dce/` sous les noms indiqués dans `data/commun.json` (champ `fichier`) ; tant qu'un fichier manque, la fiche l'indique au clic.

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
