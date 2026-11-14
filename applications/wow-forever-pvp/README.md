# WoW Forever PvP — prototype 0.5

Application de suivi du PvP sauvage, accompagnée d'un addon WoW expérimental.
Elle s'installe comme application ChaOS (contrat `chaosAddonApi: 3`) ou tourne
seule en local. **Pas encore testée dans le client Forever.** Aucune API web
Blizzard ni dépendance npm n'est nécessaire.

## Dans ChaOS

Ajouter le dépôt qui contient ce paquet dans le panneau admin (onglet
Add-ons), installer « WoW Forever PvP » puis redémarrer le site. L'application
s'ouvre dans sa propre fenêtre du bureau (`client/index.html`).

Les mouvements et appuis de souris sont relayés vers le bureau ChaOS pour
que les curseurs partagés suivent aussi l'intérieur de l'application et du
portrait 3D. Le relais utilise uniquement les iframes de même origine et
convertit les coordonnées selon leur position et leur échelle.

- Tout le monde consulte le carnet ; seul un compte ChaOS connecté peut
  importer un relevé, et uniquement depuis le site (`server/index.js`).
- Les relevés sont stockés dans `addons/applications/wow-forever-pvp/data/tracker.json` sur le
  serveur. Ce dossier est conservé lors des mises à jour et désinstallations, et
  monté comme volume par la composition Docker générée.
- L'API est servie sous `/api/wow-forever-pvp/` (`state` en lecture, `import`
  en écriture, 2 Mio maximum).

### Portrait 3D

Le petit avatar de la liste et de la fiche est conservé comme image PNG dans
le navigateur (jusqu’à 80 apparences). Les deux vues partagent la même image,
y compris après rechargement si le stockage local est disponible. Seuls les
portraits visibles déclenchent une génération ; les rendus sont exécutés un
par un et survivent à la navigation. Le portrait charge seulement le casque
et l’apparence du personnage, sans les autres pièces ni les effets des armes.
La caméra vise le point d’attache du casque pour cadrer la tête, puis le rendu
est capturé en PNG 96 × 96 et le moteur 3D est libéré. Le modèle de base reste
un fichier corps entier ; ses parties ne sont pas téléchargeables séparément.
Un changement de casque ou d’apparence produit une nouvelle image ; changer
d’arme ou de bottes ne l’invalide pas. Effacer le stockage du site efface ce cache.
L’API de portrait du jeu dessine une texture interne : l’addon ne peut pas en
extraire une image à joindre à son export JSON.

La fiche joueur place le modèle 3D entre les emplacements d’équipement.
Elle reprend la disposition du panneau en jeu : cadre bronze, icônes seules
autour du modèle, armes en bas et caractéristiques dans un panneau défilant
à droite. Les noms et effets restent accessibles en infobulle et au clavier.
Sur petit écran, les caractéristiques passent sous le vestiaire.
Le décor de la fiche suit la zone de départ de la race. Les décors sont inclus
dans l’application pour rester disponibles lorsque le site source change de version.
Les enchantements qui possèdent un effet visuel affichent leur halo sur le modèle 3D.
Les modèles d’effets absents du paquet Forever sont chargés depuis le paquet commun
WoWBocho, avec leurs textures et particules. Le moteur WoWBocho
affiche la race, la silhouette, les choix du barbier et l’équipement du
dernier relevé. Le modèle SD est sélectionné par défaut lorsqu’il est disponible.
Le sélecteur HD/SD se trouve en haut de l’aperçu et conserve
les choix qui ont un équivalent dans l’autre modèle. Une indication signale
les choix ou les objets indisponibles. Les Skyborne sont disponibles en HD.
Dans la fiche, le sélecteur occupe une barre séparée au-dessus de l’équipement.
Le modèle visible peut aussi fournir la capture de l’avatar à la liste et à
l’en-tête, sans second chargement 3D ; la caméra retrouve ensuite sa position.
Les anciens relevés peuvent utiliser les sélecteurs manuels. La visionneuse
demande WebGL 2 et un accès aux ressources externes de WoWBocho et Wowhead.
Le serveur relaie les fichiers des modèles et les correspondances HD/SD,
avec un cache mémoire limité à 64 Mio pour les fichiers des modèles.

Le collecteur conserve l’identifiant d’enchantement séparément et protège les
liens d’objets dans le JSON contre leur interprétation par la zone de copie WoW.
Pour les anciens exports dont les liens ont déjà été remplacés par le nom de
l’objet, la ligne explicite `Enchanted: Weapon Damage +5` permet de retrouver
le halo Impact sans modifier les relevés enregistrés.

Avec le collecteur 0.5.5, ouvre le salon du barbier en jeu pour relever
les choix actuels du personnage, comme la coiffure, les couleurs, le
visage et les détails propres à sa race. Tu peux fermer le salon sans rien
acheter, puis lancer `/cvp export` et importer le relevé dans ChaOS.
`/cvp appearance` permet de vérifier ou de rafraîchir la capture au salon.
Sans relevé d’apparence, la fiche utilise le modèle générique de la race.

L’addon WoW relève la race, la silhouette, les identifiants des icônes et la
qualité des pièces lors de l’export. Pour un ancien relevé, la fiche propose
les sélecteurs de modèle et déduit la qualité du lien d’objet quand il la
contient. Les images des icônes sont servies par [Zephras](https://zephras.com/data/).
Survoler une pièce ou la sélectionner au clavier affiche ses caractéristiques.
Le collecteur 0.5.1 joint les lignes lisibles de l’infobulle en jeu à
l’équipement du relevé courant. Pour les autres relevés, la fiche affiche les
caractéristiques de base fournies par Zephras et indique leur provenance.

## Démarrer seule en local

Avec Node.js 24 ou plus récent, depuis ce dossier :

```powershell
npm start
```

Ouvrir <http://127.0.0.1:4783>. Le serveur écoute uniquement sur cet ordinateur.
Arrêter avec Ctrl+C. Le port est fixe dans ce prototype.

Les imports sont stockés dans `data/tracker.json`, hors Git. Copier ce fichier
serveur arrêté pour une sauvegarde. Le navigateur n'est pas le stockage : ouvrir
un autre navigateur sur la même application retrouve les données. Ce mode local
n'a pas d'authentification et ne doit pas être exposé sur Internet : pour un
usage partagé, passer par ChaOS et ses comptes.

## Installer l'addon WoW

1. Copier le dossier `wow-addon/ChaOSWorldPvP` dans le dossier `Interface/AddOns`
   du **client Forever effectivement installé**. Le `.toc` doit se trouver dans
   `Interface/AddOns/ChaOSWorldPvP/ChaOSWorldPvP.toc`, sans dossier intermédiaire.
2. Redémarrer le jeu et vérifier que l'addon est activé.
3. Taper `/cvp status` pour voir les compteurs collectés et la disponibilité des
   lectures de VH, de carte et de l’API de récapitulatif de mort.
4. Jouer, puis taper `/cvp export`. Copier le contenu de la fenêtre (Ctrl+A,
   Ctrl+C) et le coller dans « Importer un relevé » dans l'application.
5. Importer à nouveau après une session : les mêmes événements ne sont pas
   comptés deux fois. Chaque ami peut transmettre son export à la personne qui
   héberge ce prototype local ; il n'y a pas encore de synchronisation réseau.

### Points d’honneur (collecteur 0.5.5)

`/cvp honor` affiche le solde d’honneur disponible ainsi que les gains et les
baisses observés dans l’historique local conservé. `/cvp status` affiche aussi
le solde. La collecte lit `C_CurrencyInfo.GetCurrencyInfo` pour la monnaie
`Constants.CurrencyConsts.HONOR_CURRENCY_ID` (1792), documentée dans les
[constantes du client Forever](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/CurrencyConstantsDocumentation.lua).
Elle se rafraîchit aux mises à jour de monnaie et toutes les deux secondes.

Après `/cvp export`, importer le relevé sur le site : l’onglet « Joueur contre
joueur » affiche le solde daté, les points gagnés, les baisses du solde et les
20 dernières variations. Les totaux portent sur tous les contextes ; un compteur
isole les gains observés en monde ouvert. Une baisse peut être un achat ou une
remise à zéro, sans déduire sa cause. Les VH restent un compteur distinct.

Une lecture absente ou protégée reste inconnue ; zéro est un solde valide.
Les variations hors ligne et celles traversant une période illisible ne sont
pas reconstituées. Plusieurs opérations entre deux lectures peuvent n’être
visibles que par leur différence nette. Les anciens exports restent importables
mais n’inventent pas d’historique d’honneur. Mettre à jour le site et le collecteur
ensemble pour que l’import reconnaisse les nouveaux événements.

### Joueurs tués (collecteur 0.5.6)

Le journal et la carte affichent les coups fatals personnels avec la victime :
« Joueur tué · Nom-Royaume · coup fatal personnel », ou « du familier » pour
ton propre familier. Le collecteur utilise l’événement `PARTY_KILL` et
`UnitNameFromGUID`, documentés dans les
[API du client Forever](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua),
sans se réabonner au journal de combat bloqué.

Un coup fatal donné par un autre membre du groupe n’est pas attribué au
personnage suivi. Les PNJ et familiers ennemis sont exclus. Une identité
protégée est ignorée ; si seul le nom manque, le journal affiche « nom
indisponible ». La cible actuellement sélectionnée ne sert jamais à deviner
la victime.

Les VH continuent à provenir du compteur du jeu et peuvent inclure des
participations. Les coups fatals sont des événements séparés, sans ajouter
une seconde VH. Le losange de la carte et le compteur par zone distinguent
les joueurs tués des VH. Les anciens exports ne contiennent pas les noms
des victimes : mettre à jour le site et l’addon, puis exporter après de
nouveaux combats. La réception de l’événement et la lisibilité des noms
restent à confirmer dans le client utilisé.

Le `.toc` cible l'interface `16001`, identifiée pendant la recherche. Vérifier
la version du client avant de considérer l'addon compatible. Les API absentes
ou les valeurs protégées sont ignorées ; une valeur manquante reste inconnue.

Pour préparer un ZIP à partager sous Windows, lancer `npm run package:addon`.
Le fichier est produit à la racine du dépôt dans
`artifacts/wow-forever-pvp/ChaOSWorldPvP-0.5.12.zip` (hors Git et hors du paquet
installable). Décompresser
ce ZIP dans `Interface/AddOns` donne directement le dossier de l'addon.

## Profils, guildes et temps de jeu

Les onglets **Joueurs** et **Guildes** ouvrent des pages distinctes, avec des
liens directs partageables. Le nom de guilde sur un profil ouvre sa fiche ;
chaque contribution renvoie au personnage correspondant.

La page de guilde réunit les personnages importés de la même région et du même
ruleset (PvP, PvE…). Les libellés CAMWOW EU4/EU5 Realm 4/6 décrivent des layers
et ne séparent ni les guildes ni les profils d’un même personnage. Le ruleset
est déduit du suffixe PvP/PvE quand un ancien export le laisse inconnu. Les
imports non classifiables restent séparés jusqu’à identification du ruleset.
Les profils déjà importés sont regroupés en mémoire au chargement : les
observations communes sont dédoublonnées par source et identifiant, les
historiques conservés, puis persistés au prochain import réussi. La lecture
seule ne réécrit pas la sauvegarde d’origine. Les anciens liens restent valides.
La fiche affiche les compteurs de VH cumulées
des membres actuels suivis, les gains observés pendant l’appartenance à la
guilde (tous contextes), leur part en monde ouvert et les contributions par
personnage. Les anciens membres restent dans l’historique des contributions.
Les crédits de VH sont additionnés par participant, sans les présenter comme
des victimes uniques. Les membres sans export ne sont pas inventés.

Le profil affiche le `/played` total dans un encart « Temps de jeu » en jours,
heures et minutes ; la date de mesure se trouve en infobulle. Le collecteur
le demande à la connexion et avant l’export via
`RequestTimePlayed`, puis lit `TIME_PLAYED_MSG`. L’export attend la réponse
jusqu’à deux secondes ; en cas d’indisponibilité, il conserve la dernière
mesure datée. Les anciens exports affichent « Non relevé ».

L’étude du compagnon d’envoi automatique est dans
[docs/wow-forever-sync.md](../../docs/wow-forever-sync.md). Aucun envoi automatique
n’est activé par cette version.

### Journées et groupes probables

Le profil s’ouvre sur **Joueur contre joueur**, placé avant **Personnage**.
Le viewer 3D se charge seulement à l’ouverture de l’onglet Personnage.

Le sélecteur **Journée** filtre les gains observés, les courbes, le journal,
les rapprochements et la carte, sur les pages des joueurs et des guildes.
Les dates utilisent le fuseau local du navigateur, avec des journées calendaires
(les changements d’heure peuvent donc produire des jours de 23 ou 25 heures).
Les derniers compteurs cumulés, le solde disponible et le `/played` restent
des mesures datées ; ils ne sont pas présentés comme des gains journaliers.
**Jour après jour** permet de sélectionner un jour et de trier par date ou
nombre de VH. Le journal et la répartition quotidienne respectent aussi la carte
choisie. Le journal affiche jusqu’à 200 événements selon l’ordre sélectionné.

Les **groupes probables** rapprochent au moins deux personnages distincts,
de la même guilde au moment des événements, du même ruleset et de la même région.
Ils doivent avoir des VH ou des coups fatals en monde ouvert, sur la même carte,
dans une fenêtre de 120 secondes. La diagonale de la boîte des positions doit
être inférieure à 0,03 en coordonnées normalisées de carte. Les positions
manquantes, les morts et les BG ne servent pas d’indices de proximité.

Depuis **0.5.10**, les rapprochements sont réunis en **sessions probables**
quand au moins deux participants restent communs au rapprochement précédent
et que le délai depuis son dernier indice ne dépasse pas 30 minutes. Une
session peut durer plusieurs heures et traverser plusieurs zones ou minuit.
Sa durée va du premier au dernier indice observé, sans prouver une présence
continue pendant les intervalles. Un seul membre commun ne suffit pas à
relier deux groupes distincts. Une interruption de plus de 30 minutes crée
une nouvelle session ; il n’y a pas de durée maximale totale.

Les fiches affichent la plage horaire, les participants observés, les zones
et les crédits de VH. Le bouton affiche les positions des rapprochements,
sans inventer de trajet entre elles. Les filtres de jour et de carte ne
conservent que les indices correspondants, y compris pour les VH et les
participants d’une session sur plusieurs jours ou zones.
Il s’agit d’une inférence, pas d’une preuve d’appartenance au groupe ou de
victimes uniques. Les douze sessions les plus récentes sont détaillées.

Les anciens collecteurs pouvaient exporter une guilde vide à la connexion
avant le chargement de ses informations. Depuis **0.5.11**, les rapprochements
probables peuvent utiliser un relevé ancien ultérieur de la même session pour
compléter cette lecture manquante. La fiche indique les membres dont la guilde
est déduite. Une coupure de session, un changement de source, une absence de
guilde confirmée ou un relevé ultérieur explicitement confirmé empêchent cette
déduction. Les événements avant le premier relevé ne sont pas complétés.
Les historiques et les compteurs de guilde confirmés ne sont pas réécrits.
Les nouveaux relevés exportent `guildKnown` quand la présence ou l’absence
de guilde est connue, afin de distinguer une lecture manquante d’un joueur
réellement sans guilde.

### Pourquoi les exports contiennent un historique

L’addon conserve jusqu’à 300 relevés et 5 000 événements par personnage local.
Les connexions, déconnexions, `/reload` et exports peuvent ajouter des relevés
datés, avec l’équipement observé à cet instant. Cet historique permet de
récupérer les périodes qui n’avaient pas encore été importées. Le réimport
des mêmes identifiants n’ajoute pas de VH. Il ne reconstitue aucun combat
antérieur à la collecte et n’attribue pas les gains hors ligne à une zone.

À partir de **0.5.9**, l’export conserve les relevés mais n’envoie qu’une seule
fois chaque équipement distinct dans `equipmentSets`. Chaque relevé utilise
un `equipmentRef` indexé à partir de zéro. Le serveur reconstruit les mêmes
objets avant validation et sauvegarde ; l’historique local n’est pas modifié.
Les infobulles complètes restent limitées à l’équipement actuel.
Depuis **0.5.12**, le réimport tolère jusqu’à `1e-10` d’écart sur les coordonnées
normalisées X/Y d’une observation déjà enregistrée, pour absorber les écarts
de dernière décimale entre sérialiseurs Lua/JSON. Les coordonnées originales
restent conservées. Les identifiants, dates, carte, zone, VH et autres champs
restent comparés strictement ; un vrai conflit annule l’import entier et
indique désormais l’identifiant de l’événement ou du relevé concerné.
**Mettre le site à jour avant l’addon 0.5.9** : les anciens sites ne lisent pas
les références d’équipement. Les anciens exports complets restent acceptés
par le nouveau site.

## Diagnostiquer une action bloquée en jeu

Avant de reproduire le problème, cette commande affiche dans le chat le nom
de l'événement, l'addon signalé et la fonction protégée :

```text
/run local f=CreateFrame("Frame");f:RegisterEvent("ADDON_ACTION_BLOCKED");f:RegisterEvent("ADDON_ACTION_FORBIDDEN");f:SetScript("OnEvent",function(_,e,a,b) print(e,a,b) end)
```

Un `/reload` retire cet écouteur temporaire. Pour obtenir le chemin de
contamination de l'interface, activer `/console taintLog 1`, redémarrer le jeu,
reproduire le blocage puis quitter le jeu. Chercher `blocked` dans
`Logs/taint.log` du client Forever. Désactiver ensuite avec
`/console taintLog 0`. L'addon nommé dans l'alerte ne suffit pas à identifier
l'origine de la contamination.

## Publier le paquet

L'installateur ChaOS refuse tout dossier `data` provenant du paquet téléchargé
(« Add-on must not ship its data folders: data ») : ce dossier contient les
relevés du site et n'est jamais remplacé par une mise à jour. Les sauvegardes
locales restent dans `data/`, mais ne doivent jamais être publiées avec le code,
pas plus que le ZIP de l'addon WoW.

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
  sessions et détection d'une baisse du compteur. Victimes des coups fatals
  personnels ou du familier relevées séparément quand leur identité est lisible.
- Morts personnelles avec position si disponible. Le récapitulatif de WoW
  Forever peut fournir le coup fatal et sa source. Le journal distingue les
  morts PvP, PvE, environnementales et auto-infligées.
- Position précédente de moins de dix secondes utilisée à défaut, avec son heure.
- Classement du groupe par VH observées dans le monde ouvert, recherche par nom
  ou guilde, fiches, journal et répartition par carte/zone.
- Fond de carte de WoW Forever servi par [Warcraft Forever](https://warcraftforever.games/maps),
  avec vue d’Azeroth et marqueurs superposés par carte observée. Les marqueurs
  indiquent la position du collecteur lors de la détection.
- Import borné à 2 Mio, format validé, doublons ignorés, conflits rejetés,
  sauvegarde par remplacement de fichier et tests de persistance et de transport.

## Limites à connaître

- L'addon doit d'abord être validé **en jeu**. Les tests Lua simulés ne prouvent
  pas le comportement de Forever, de ses restrictions ou de son interface.
- Depuis le collecteur 0.5.4, l'abonnement au journal de combat est retiré :
  le client Forever a bloqué son enregistrement comme action protégée.
  La collecte des causes utilise le récapitulatif de mort (API actuelle ou
  historique). Sans récapitulatif lisible, la cause reste inconnue. Les anciennes morts sans
  source et celles dont le coup fatal est illisible restent de cause inconnue.
  La catégorie décrit la source du coup fatal. Le filtre des morts agit sur
  la carte, le journal et la répartition par zone ; les VH restent affichées
  au-dessus des croix, quelle que soit la cause sélectionnée.
- Les fonds proviennent du build 1.60.1.69893. Une grille prend le relais si
  le fond de la carte sélectionnée ne se charge pas.
- Les VH incluent les participations en groupe : aucun compteur de coups fatals.
- Le compteur global et son écart incluent tous les contextes. Seuls les gains
  détectés en contexte explicitement `world` alimentent le suivi sauvage.
- Un premier relevé n'invente aucun historique ; les gains hors ligne ou pendant
  une lecture indisponible ne sont pas localisés. Une interruption de plus de
  cinq secondes ou un changement de contexte rend le gain de contexte inconnu.
- Les positions correspondent à la détection, avec un intervalle de collecte de
  deux secondes. Les coordonnées ne sont pas une preuve du point exact du combat.
- Région issue du client, ruleset déduit du suffixe PvP/PvE du libellé de layer
  s’il n’est pas déjà renseigné. Sans indice, il reste `unknown`.
- La guilde et le niveau sont relevés aux exports/sessions. Un nouvel export
  de l'historique ne doit pas réattribuer les anciennes observations.
- Limite locale de 5 000 événements et 300 relevés par personnage dans l'addon ;
  les plus anciens sont retirés, avec avertissement lors de l'export. Exporter
  régulièrement : le site conserve les observations précédemment importées.
- Limite serveur de 100 000 événements/relevés. La sauvegarde du prototype est
  prévue pour un seul processus ; ne pas lancer plusieurs instances sur le même
  fichier. Pas de fusion automatique de plusieurs installations d'un personnage.
- Le portrait reprend les choix capturés au barbier et reconnus par le modèle.
  Les nouveaux exports relèvent aussi les transmogrifications appliquées et les
  pièces masquées, sans modifier les objets des infobulles. Après mise à jour
  de l’addon en jeu, refaire `/cvp export` puis importer le résultat sur le site.
  Les anciens exports utilisent les objets équipés. La collecte utilise
  [l’API transmog du client Forever](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/TransmogDocumentation.lua)
  et reste à valider en jeu.
  Les choix sans équivalent HD/SD et les objets sans modèle sont signalés.
  Un relevé sans capture du barbier utilise l’apparence par défaut.
- Rang, points de rang, talents et victimes des simples participations restent à
  implémenter après vérification des API et sources de ressources.

## Vérifier

```powershell
npm test
```

Les tests Node vérifient le format d'import, les compteurs, le dédoublonnage,
les conflits, la persistance et le transport local. Une fois le paquet installé
dans ChaOS, `npm run test:addons` (depuis le site) exécute aussi
`tests/chaos/feature.test.js` : comptes, origine, type et taille des imports. Aucun test ne remplit la base
de l'application avec des personnages de démonstration.

Le scénario Lua `tests/collector.test.lua` s'exécute avec Lua 5.4 depuis ce dossier :

```powershell
lua tests/collector.test.lua
```

Il utilise des API simulées, sans client WoW. Il vérifie l'export, les sessions,
la distinction des contextes et les morts. Les essais réels à effectuer sont
listés dans le [cadrage](../../docs/wow-forever-pvp.md).

## Étape suivante

Mettre à jour l’application ChaOS, puis installer le collecteur 0.5 sur le
client Forever. Vérifier `/cvp status`, importer un relevé avec une nouvelle
mort et comparer le journal au récapitulatif affiché en jeu.
