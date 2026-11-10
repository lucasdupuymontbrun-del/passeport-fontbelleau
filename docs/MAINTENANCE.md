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
python tools/build_ferraillage_4d.py <chemin>/ouvrages.json
```

   La seconde commande ajoute aux fiches les plans de ferraillage d'exemple et à `data/index.json` les dates du scénario 4D (voir § 6 ter). Elle doit toujours suivre la première, qui réécrit ces fichiers sans ces données.

3. Lire `docs/AUDIT_OUVRAGES.md` (identifiants en double, éléments sans identifiant, incohérences), puis publier `data/`, `model/`, `plans/` et `docs/`.
4. Mettre à jour le jumeau énergétique et le comparatif (voir la dernière section).

Équipements de génie climatique : seuls les extracteurs de la ventilation hybride de la tour A2 (famille « VAR A2 - Extracteur hybride stato-mécanique », identifiants `VHY-EXT-A` à `VHY-EXT-I`) ont une fiche ; le passeport leur ajoute le préfixe `A2`. Les colonnes de ventilation (gaines du sous-projet « A2 - Lot 502 CVC ») sont visibles en 3D (groupe `a2_vmc`) sans fiche, une colonne étant faite de plusieurs tronçons.

Transfert sans accès au dossier : les deux scripts écrivent aussi une version compressée (`*.b64`) qu'on peut relire par morceaux avec le pont Python quand le dossier `Documents\Passeport_Fontbelleau\` n'est pas accessible directement.

La référence d'une fiche dérive de l'identifiant de la maquette (`A2 PM 001` → `A2-PM001`). Les éléments de la tour A1 reçoivent le préfixe `A1`, déduit de leur sous-projet. Un identifiant partagé par plusieurs éléments donne des fiches numérotées (`A2-P201-1`, `A2-P201-2`…) et un avertissement.

## 6 ter. Plans de ferraillage fictifs, avancement 4D et mode présentation

**Plans de ferraillage.** `tools/build_ferraillage_4d.py` ajoute un bloc `ferraillage` aux fiches des ouvrages en béton (prémurs, voiles, poteaux, poutres, longrines, pieux, massifs, dalles) : repères, diamètres, espacements, longueurs, poids et ratio, calculés à partir des dimensions de la maquette et de règles forfaitaires (treillis HA8 e = 15 cm pour les prémurs, HA10/HA8 pour les voiles, etc.). Ce sont des **exemples fictifs** : aucun calcul de structure n'a été fait et le DCE ne contient aucun plan d'exécution. Le dessin (élévation ou plan, coupe, nomenclature, cartouche) est produit dans le navigateur par `assets/js/ferraillage.js`, avec le filigrane « EXEMPLE FICTIF » et la mention « Ne pas utiliser pour l'exécution » ; il se télécharge en SVG ou s'imprime en PDF. Les ouvrages trop petits, les dalles sans épaisseur ou les cas dont le ratio sortirait de 20 à 300 kg/m³ n'ont pas d'exemple.

**Avancement 4D.** Sur la page d'accueil, le bouton « Avancement 4D » colore la maquette par statut et affiche un curseur temporel ; « Lecture » fait défiler le chantier. Les dates viennent du scénario fictif par étage (colonne `dates` de `data/index.json`, ajoutée par le même script). Pour une date égale ou postérieure à aujourd'hui, le statut saisi en ligne (Supabase) remplace celui du scénario. Le tableau sous la maquette donne le pourcentage posé, l'avancement par zone et les livraisons de la semaine. Aucun planning TCE n'existe dans le DCE : si un planning réel est fourni, c'est la fonction de dates du script qu'il faudra remplacer.

**Terrain naturel.** Depuis le 09/11/2026, le terrain naturel (groupe `topo` de `model/site.json`) n'est plus affiché dans la 3D du site, pour laisser voir les fondations et le parking. Les fondations font partie de la vue « Tout », et la caméra peut descendre jusqu'à environ 20° sous l'horizon pour voir pieux et massifs. Le terrain reste exporté et la maquette Revit n'est pas modifiée ; pour le réafficher, retirer la ligne `if (g.name === 'topo') continue;` dans `assets/js/viewer.js`.

**Mode présentation.** Le bouton « Présentation » (ou l'adresse `…/?presentation`) lance une visite guidée en 7 étapes : maquette, recherche d'A2 PM 106, fiche, plan de ferraillage, avancement du jour, lecture 4D, suivi depuis le chantier. Flèches du clavier ou Page préc./suiv. pour avancer, Échap pour quitter. Sur téléphone, la visite passe en plein écran (3D au-dessus de la carte, frise 4D superposée, textes courts du champ `m`), et l'on change d'étape en balayant la carte. Le texte des étapes est dans `tourSteps()` de `assets/js/explore.js`.

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

**Version aux couleurs de Veck Construction** (noir et doré du logo, logo VECK au centre du QR, équerres dorées) : `python tools/qr_veck.py` produit `qr/Veck_<ref>.png` et `qr/Etiquette_Veck_<ref>.pdf` pour les deux QR (adresses en tête du script). Le QR est en correction d'erreur maximale (H) pour tolérer le logo ; le script le relit en taille normale et réduite et échoue si une relecture rate. Polices Archivo Black / ExtraBold (licence OFL) dans `tools/fonts/`.

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


## Jumeau énergétique et comparatif A1 / A2 : site séparé

Le jumeau énergétique et le comparatif des tours A1 et A2 ont leur propre site : dépôt `jumeau-fontbelleau`, en ligne sur https://lucasdupuymontbrun-del.github.io/jumeau-fontbelleau/. Son guide de maintenance est dans ce dépôt (`docs/MAINTENANCE.md`).

Ce qui reste ici :

- les pages `energie/` et `comparatif/` ne font plus que rediriger vers le nouveau site (adresse et paramètres conservés : `energie/?l=A2.36` ouvre le logement A2.36) ;
- le volet « Énergie » des fiches : `assets/js/energie-fiche.js` lit `data/energie/ouvrages.json` et `data/energie/logements.json`. Ces deux fichiers sont écrits par le générateur du jumeau (`tools/build_energie.py` du dépôt `jumeau-fontbelleau`), qui lit lui-même `model/` et `data/index.json` d'ici.

Ordre de mise à jour après une modification de la maquette : 1) régénérer ce site (§ 6, y compris `build_ferraillage_4d.py`) ; 2) dans le dépôt du jumeau, `python tools/build_energie.py` puis `python tools/build_comparatif.py` ; 3) publier les deux dépôts.

## Présentation commune aux deux sites (10/11/2026)

- **Barre des sites** : en haut de chaque page, `nav.sitenav` avec trois liens (Maquette et ouvrages · Jumeau énergétique · Comparatif A1/A2). Le lien de la page courante porte `aria-current`. Le balisage est écrit à la main dans chaque page (accueil, `o/`, `A2-PM106/` du passeport ; `index.html` et `comparatif/` du jumeau) ; le style est dans `assets/css/app.css` (bloc identique dans les deux dépôts) et, pour le jumeau, dans `assets/css/energie.css`. Sur une fiche d'ouvrage, le lien « Maquette » ramène la maquette centrée sur l'ouvrage (`data-bind="back-maquette"`).
- **Rubriques repliées sur téléphone** : `assets/js/fold.js` (même fichier dans les deux dépôts) replie, sous 760 px de large, les rubriques marquées `data-fold="…"` (le texte de l'attribut est celui du bouton). Fiches : identité, documents, approvisionnement. Comparatif : lots, quantités, coûts par poste, sources. Le menu des rubriques et les liens `#rubrique` déplient. Rien ne change sur ordinateur ni à l'impression.
- **Couleurs** : noir et or Veck (`--or`, `--or-fonce`, `--noir-veck`) pour les boutons « Présentation », les soulignés et la visite guidée ; le rose « traceur » reste réservé à l'élément sélectionné (3D, plans) et aux repères. Code des tours partout : A1 bleu (`--a1`), A2 orange (`--a2`). Dans le jumeau, les barres gardent la couleur de l'usage ; seuls les repères A1 / A2 prennent la couleur de la tour.
- **Maquette** : ciel de jour en fond (dégradé CSS de `.viewer`). La visite guidée de l'accueil a une 8e étape qui mène à la présentation du jumeau (`?presentation`).

## Vue « Performance thermique » de la maquette (10/11/2026)

- Bouton « Performance thermique » à côté de « Maquette » et « Avancement 4D » : chaque paroi prend la couleur de son coefficient U (W/m².K). Tour A1 : doublage intérieur, U 0,27 (étude thermique RT 2012) ; tour A2 : ITE, U ≈ 0,21 ; planchers et toitures : U calculé depuis la résistance R du CCTP (+ Rsi + Rse + dalle) ; balcons sans rupteur de la tour A1 : pont thermique ; dalle haute du parking et balcons de la tour A2 laissés en gris (choix du groupe) ; fenêtres : Uw absent du DCE ; extracteurs et capteurs de la variante repérés.
- Données : `data/energie/ouvrages.json` (profil thermique de chaque ouvrage, écrit par le générateur du jumeau). Classes et valeurs : `TH` et `TH_PROFIL` dans `assets/js/explore.js`.
- Un clic sur une paroi ajoute au résumé son rôle thermique, U, sa composition et la propriété IFC correspondante (Pset_WallCommon.ThermalTransmittance).
- La visite guidée a une étape « La performance thermique dans la maquette », avant celle du jumeau.
