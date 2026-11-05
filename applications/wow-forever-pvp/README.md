# WoW Forever PvP — prototype 0.1

Application locale de suivi du PvP sauvage, accompagnée d'un addon WoW
expérimental. **Pas encore installée dans ChaOS et pas encore testée dans le
client Forever.** Aucune API web Blizzard ni dépendance npm n'est nécessaire.

## Démarrer l'application

Avec Node.js 24 ou plus récent, depuis ce dossier :

```powershell
npm start
```

Ouvrir <http://127.0.0.1:4783>. Le serveur écoute uniquement sur cet ordinateur.
Arrêter avec Ctrl+C. Le port est fixe dans ce prototype.

Les imports sont stockés dans `data/tracker.json`, hors Git. Copier ce fichier
serveur arrêté pour une sauvegarde. Le navigateur n'est pas le stockage : ouvrir
un autre navigateur sur la même application retrouve les données. Le prototype
n'a pas d'authentification et ne doit pas être exposé sur Internet ; l'intégration
aux comptes et droits ChaOS reste à faire.

## Installer l'addon WoW

1. Copier le dossier `wow-addon/ChaOSWorldPvP` dans le dossier `Interface/AddOns`
   du **client Forever effectivement installé**. Le `.toc` doit se trouver dans
   `Interface/AddOns/ChaOSWorldPvP/ChaOSWorldPvP.toc`, sans dossier intermédiaire.
2. Redémarrer le jeu et vérifier que l'addon est activé.
3. Taper `/cvp status` pour voir les compteurs collectés et la disponibilité des
   lectures de VH et de carte.
4. Jouer, puis taper `/cvp export`. Copier le contenu de la fenêtre (Ctrl+A,
   Ctrl+C) et le coller dans « Importer un relevé » dans l'application.
5. Importer à nouveau après une session : les mêmes événements ne sont pas
   comptés deux fois. Chaque ami peut transmettre son export à la personne qui
   héberge ce prototype local ; il n'y a pas encore de synchronisation réseau.

Le `.toc` cible l'interface `16001`, identifiée pendant la recherche. Vérifier
la version du client avant de considérer l'addon compatible. Les API absentes
ou les valeurs protégées sont ignorées ; une valeur manquante reste inconnue.

Pour préparer un ZIP à partager sous Windows, lancer `npm run package:addon`.
Le fichier est produit à la racine du dépôt dans
`artifacts/wow-forever-pvp/ChaOSWorldPvP-0.1.0.zip` (hors Git et hors du paquet
installable). Décompresser
ce ZIP dans `Interface/AddOns` donne directement le dossier de l'addon.

## Corriger « Add-on must not ship its data folders: data »

L'installateur ChaOS refuse tout dossier `data` provenant du paquet téléchargé,
même si `addon.json` ne déclare pas de données. Les sauvegardes locales restent
dans `data/`, mais ne doivent jamais être publiées avec le code.

Depuis le dépôt source qui est effectivement téléchargé par ChaOS, vérifier :

```powershell
git ls-files -- applications/wow-forever-pvp/data
```

Si des fichiers apparaissent, les retirer du suivi Git **sans effacer leurs
copies locales** :

```powershell
git rm -r --cached -- applications/wow-forever-pvp/data
```

Inclure ce retrait et le changement du script de création du ZIP dans la prochaine
révision publiée du dépôt source. Ajouter `data/` à `.gitignore` ne retire pas
les fichiers déjà suivis. Relancer ensuite l'installation dans ChaOS sur la
nouvelle révision ; reprendre celle du journal reproduirait le même refus.

Le contrôle `node scripts/check-addons.mjs`, lancé à la racine du dépôt, détecte
désormais ces fichiers suivis, y compris sans déclaration `data` dans le manifeste.

## Ce qui existe

- Export JSON versionné d'un personnage : identité, guilde au relevé, équipement
  par emplacement et VH cumulées si lisibles.
- Échantillonnage du compteur toutes les deux secondes : gains de VH par contexte,
  sessions et détection d'une baisse du compteur. Pas d'identification de victime.
- Morts personnelles, toutes causes confondues, avec position si disponible.
- Position précédente de moins de dix secondes utilisée à défaut, avec son heure.
- Classement du groupe par VH observées dans le monde ouvert, recherche par nom
  ou guilde, fiches, journal et répartition par carte/zone.
- Plan de coordonnées normalisées d'une carte sélectionnée ; aucun fond de carte
  du jeu pour le moment. Un point VH est la position du collecteur lors de la
  détection, pas celle de sa victime.
- Import borné à 2 Mio, format validé, doublons ignorés, conflits rejetés,
  sauvegarde par remplacement de fichier et tests de persistance et de transport.

## Limites à connaître

- L'addon doit d'abord être validé **en jeu**. Les tests Lua simulés ne prouvent
  pas le comportement de Forever, de ses restrictions ou de son interface.
- Pas de distinction fiable PvP/PvE pour les morts. Aucun ratio PvP calculé.
- Les VH incluent les participations en groupe : aucun compteur de coups fatals.
- Le compteur global et son écart incluent tous les contextes. Seuls les gains
  détectés en contexte explicitement `world` alimentent le suivi sauvage.
- Un premier relevé n'invente aucun historique ; les gains hors ligne ou pendant
  une lecture indisponible ne sont pas localisés. Une interruption de plus de
  cinq secondes ou un changement de contexte rend le gain de contexte inconnu.
- Les positions correspondent à la détection, avec un intervalle de collecte de
  deux secondes. Les coordonnées ne sont pas une preuve du point exact du combat.
- Région issue du client, règles de jeu indiquées `unknown` : classification
  manuelle des règles et gestion des changements d'identité restent à développer.
- La guilde et le niveau sont relevés aux exports/sessions. Un nouvel export
  de l'historique ne doit pas réattribuer les anciennes observations.
- Limite locale de 5 000 événements et 300 relevés par personnage dans l'addon ;
  les plus anciens sont retirés, avec avertissement lors de l'export. Exporter
  régulièrement : le site conserve les observations précédemment importées.
- Limite serveur de 100 000 événements/relevés. La sauvegarde du prototype est
  prévue pour un seul processus ; ne pas lancer plusieurs instances sur le même
  fichier. Pas de fusion automatique de plusieurs installations d'un personnage.
- Stuff présenté par nom/identifiant, sans icônes, infobulles complètes ni 3D.
- Honneur, rang, points de rang, talents, adversaires et carte du jeu restent à
  implémenter après vérification des API et sources de ressources.

## Vérifier

```powershell
npm test
```

Les tests Node vérifient le format d'import, les compteurs, le dédoublonnage,
les conflits, la persistance et le transport local. Aucun test ne remplit la base
de l'application avec des personnages de démonstration.

Le scénario Lua `tests/collector.test.lua` s'exécute avec Lua 5.4 depuis ce dossier :

```powershell
lua tests/collector.test.lua
```

Il utilise des API simulées, sans client WoW. Il vérifie l'export, les sessions,
la distinction des contextes et les morts. Les essais réels à effectuer sont
listés dans le [cadrage](../../docs/wow-forever-pvp.md).

## Étape suivante

Installer l'addon sur le client Forever et recueillir un export réel ainsi que
le résultat de `/cvp status`. Corriger les incompatibilités observées avant
d'ajouter l'attribution PvP, les fonds de carte ou le raccordement à ChaOS.
