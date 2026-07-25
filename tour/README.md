# La Tour — des aventuriers IA apprennent à grimper

Une équipe de 5 aventuriers affronte une tour de 100 étages (1000 à terme) :
plateau carré avec murs, portails et pièges, paliers de nouveaux monstres,
boss tous les 10 étages, élites, états et interactions élémentaires, draft
roguelike à chaque niveau, ressources persistantes et repos limités — façon
donjon D&D. **Aucun comportement n'est écrit à la main** : chaque aventurier
est piloté par son réseau de neurones, et même la **composition de l'équipe**
(les 5 classes parmi 9) et **les cartes qu'il drafte** font partie de ce que
l'évolution découvre. Si la méta converge vers 3 mages, c'est qu'elle l'a
trouvé toute seule.

## Lancer

Depuis la racine du dépôt (voir [`DEMARRAGE.md`](../DEMARRAGE.md) pour
l'installation complète) :

```bash
npm run tour     # Chrome recommandé → http://localhost:5173
npm run build    # fichier autonome dans tour/dist-single/index.html
npm run audit            # la suite de vérification (12 tests)
npm run verifier-moteurs # Node et le navigateur calculent-ils pareil ?
```

Ou depuis ce dossier : `npm run dev`, `npm run build:single`.

## Coût de calcul

Un run complet coûte **~91 ms** en JavaScript (mesuré par `audit/`).

Le coût est passé de ~21 ms à ~91 ms avec la refonte du plateau, pour deux
raisons qui n'en sont pas une régression : les réseaux ont grossi
(156 → 24 → 16 contre 66 → 28 → 18), et surtout les équipes survivent
maintenant jusqu'à l'étage 20 au lieu de mourir au 8ᵉ — elles simulent
donc bien plus longtemps.

**Le profil s'est inversé.** Sur la version précédente, 95 % du temps
partait dans les passes avant des réseaux et 5 % seulement dans la logique
de jeu. Mesuré sur 5 runs et 41 876 décisions de réseau, avec les mêmes
graines pour les deux mesures :

| | part du temps |
|---|---|
| Passes avant des réseaux | **36 %** |
| Logique de jeu — terrain, ligne de vue, états, invocations | **64 %** |

La conclusion qui figurait ici — « micro-optimiser le moteur ne mènerait
nulle part » — n'est donc plus valable. La logique de jeu est devenue le
poste dominant et n'a jamais été optimisée.

L'argument pour le GPU tient toujours, mais il ne repose pas sur la vitesse
par run : l'audit montre **20 845 paramètres pour une population de 32**. Ce
qui bride le projet est la taille de la population, pas le nombre de runs
par seconde. Tripler la vitesse donnerait le même plafond, plus vite.
C'est aussi la raison de ne pas passer par WebAssembly : le gain porterait
sur la mauvaise contrainte, et les fonctions transcendantes n'y sont pas
garanties identiques au bit près — ce dont dépend tout l'audit.

## Le plateau (`src/sim/terrain.js`)

**Carré de 32×32**, redessiné à chaque étage selon quatre archétypes tirés à
la graine : salle ouverte, colonnade, couloirs, chambres. Les murs bloquent
**le déplacement et la ligne de vue** — sans cette seconde règle un couloir
ne vaudrait rien et Shadow Step non plus.

- **Portails** : 2 à 4 par étage, sur les bords. Les monstres en sortent par
  vagues, avec une cadence propre à chaque portail. On peut tenir le goulot
  devant, ou le sceller (Occultiste).
- **Pièges** : déclenchés **par les deux camps**, donc on peut y attirer les
  monstres. Fosse à pointes et goudron sont visibles ; rune arcanique et
  braséro brisé ne le sont pas — ni à l'écran, ni dans les observations des
  réseaux. Sur 25 étages mesurés : 65 visibles, 52 cachés.

## Le jeu (data-driven : `src/sim/data.js`)

- **9 classes** × 4 capacités : Chevalier (frappe de bouclier, provocation,
  mur de garde, charge), Berserk (coup de taille brise-gel, fauchage, rage
  noire, charge brutale), Archère (tir précis, flèche perforante, piège à
  mâchoires, roulade), Mage (light arrow, freeze, explosion, shadow step),
  Clerc (châtiment, soin, sanctuaire, intervention), Occultiste (éclat
  d'ombre, nuée toxique, malédiction, sceau de scellement), Invocateur
  (éclat, slime, golem, permutation), Nécromancien (éclat d'os, lever les
  morts, explosion de cadavre, linceul d'os), Lutin (dard, poussière
  d'entrain, chant de bravoure, bond farceur).
- **15 états unifiés** portés par toutes les entités. Négatifs : en feu,
  empoisonné (cumulable ×5), électrifié (se propage), gelé, ralenti,
  étourdi, vulnérable, saignement, terreur. Positifs : béni, hâte, bouclier,
  régénération, posture, intangible.
- **Quatre interactions élémentaires**, peu nombreuses mais lisibles :
  gelé + coup lourd brise le gel et double les dégâts ; feu et gel
  s'annulent ; l'électricité se propage à deux cibles au lieu d'une sur un
  gelé ; poison + feu double les dégâts du poison.
- **14 monstres** à comportement propre : gobelin (fuit quand les siens
  tombent), slime (se scinde), squelette (se relève une fois), loup (meute,
  cible les blessés), serpent (frappe et recule, empoisonne), orc,
  hobgobelin (bénit les gobelins), chauve-souris (vole, ignore les pièges au
  sol), araignée (pose des toiles), goule (ressuscite), golem (brise les
  murs temporaires), spectre (traverse les murs), troll (régénère sauf sous
  le feu), liche (invoque, gèle, électrifie). Boss tous les 10 étages,
  élites à partir du 4ᵉ.
- **Ressources persistantes** : PV/mana conservés entre étages, régén
  partielle, 3 repos complets par run — le moment de se reposer est VOTÉ
  par les réseaux (une sortie dédiée), pas décidé par une règle. Un agent
  tombé est relevé **une fois** par run ; la seconde mort est définitive.

## Mobilité et draft roguelike

- **Trois déplacements à cooldown**, communs à toutes les classes :
  **dash** (repositionnement instantané, 5 s), **course** (+60 % de vitesse
  pendant 3 s, 12 s), **bond** (saut de 6,5 unités qui **esquive la mêlée**
  pendant le vol, 10 s). Le réseau décide quand les déclencher.
- **Plus de croissance de stats.** Un agent démarre avec son attaque de base
  et **une seule** capacité de classe. À chaque niveau, **3 cartes tirées au
  sort** et le réseau en choisit une : une des 3 capacités de classe qui lui
  manquent, un des 10 passifs communs (Célérité, Vivacité, Endurance,
  Concentration, Vampirisme, Esquive, Allonge, Résilience, Curée, Pas
  assuré), ou un des 5 renforts d'une capacité déjà possédée. C'est la
  « build » de l'agent, et elle est apprise — les cartes proposées font
  partie des observations du réseau.
- Effet de bord heureux : comme un agent ne porte jamais plus de 4
  capacités, l'espace d'action reste borné malgré 36 capacités au catalogue.
  Le draft résout le problème qu'il crée.

## L'apprentissage (zéro heuristique)

- MLP **156 → 24 → 16** par agent (4 168 poids ; 20 845 pour l'équipe des 5,
  classes comprises). Observations brutes : soi et ses états, cooldowns de
  mobilité, capacités et passifs possédés, **6 capteurs de distance aux murs**,
  4 monstres proches, 4 alliés, ses invocations, les cadavres proches, les
  portails, les pièges **visibles**, l'étage, les repos restants, et **les 3
  cartes proposées** quand un draft est en cours.
- Sorties : déplacement, mobilité (dash/course/bond), choix d'action parmi
  les 4 capacités portées, ciblage, envie de repos, **et le choix de carte**.
- Neuro-évolution : 32 équipes/génération dans des Web Workers, **4 graines
  par évaluation** (mesuré : à 2 graines le biais de sélection atteint 20 %,
  à 4 il tombe à 3-4 %), croisement par agents entiers (classe + cerveau),
  mutation auto-adaptative, mutation de classe rare (3 %) qui explore la méta.
- Fitness = étages franchis (×1000) **plus des termes continus** (monstres
  tués, dégâts, PV restants, temps) : sans eux le paysage est un escalier où
  99,4 % de la variance vient d'un entier, et où 0 enfant sur 280 dépasse son
  parent.

## Persistance

L'entraînement **survit à un rechargement**. La population, l'historique et
les runs records sont écrits dans IndexedDB toutes les 10 générations, à la
mise en pause et à la fermeture de l'onglet ; au démarrage, la session est
reprise là où elle s'était arrêtée. Le menu **Session** permet aussi de
sauvegarder à la demande, d'**exporter la session en `.json`** (pour la
transporter entre machines, ou récupérer un entraînement lancé sur GPU
loué), d'en **importer** une, ou d'effacer la sauvegarde.

Les sauvegardes portent un numéro de format : si les règles ou la taille des
réseaux changent, une vieille session est ignorée avec un message clair
plutôt que reprise avec des agents incohérents.

## Rapports de run (lisibles par un LLM)

Le bouton **Rapport** rejoue le run affiché en mode journalisé et produit :

- **par agent** : classe, niveau, dégâts, soins, dégâts subis, étage de mort,
  améliorations choisies, usage de chaque capacité, compte de dash/course/bond ;
- **par étage** : durée, composition exacte des monstres, dégâts échangés,
  morts, repos pris, améliorations distribuées ;
- une **chronologie** horodatée (début d'étage, mort d'agent, repos, choix
  d'amélioration, fin de run).

« Copier pour un LLM » met un résumé markdown compact dans le presse-papier,
« Exporter JSON » télécharge le rapport complet. Depuis la console :

```js
tour.report(130)                  // rapport structuré d'une génération
tour.markdown(130)                // le même, en markdown à coller
tour.comparer([20, 130, 300])     // ce qui a changé entre plusieurs générations
tour.playGeneration(130)          // rejouer ce champion dans la vue 3D
```

## Ce qu'on observe (mesuré)

### La méta : huit classes sur neuf sont jouées

Mesuré sur **4 essais d'évolution indépendants**, 25 générations chacun —
un motif présent dans un seul essai ne serait que du bruit. Part de chaque
classe dans la population entière (répartition uniforme = 11 %) :

| classe | gén. 0 | gén. 24 |
|---|---|---|
| Berserk | 12 % | 20 % |
| Invocateur | 8 % | 15 % |
| Archère | 10 % | 13 % |
| Nécromancien | 12 % | 12 % |
| Mage | 12 % | 11 % |
| Clerc | 13 % | 11 % |
| Lutin | 12 % | 10 % |
| Occultiste | 12 % | 7 % |
| **Chevalier** | 9 % | **1 %** |

Les compositions championnes le disent mieux que les pourcentages : **aucune
n'empile quatre fois la même classe**, et deux sont composées de cinq classes
différentes.

```
essai 0 : 2× invocateur / archère / lutin / nécromancien
essai 1 : clerc / occultiste / berserk / archère / nécromancien
essai 2 : 3× berserk / invocateur / clerc
essai 3 : 2× mage / archère / invocateur / lutin
```

Il a fallu deux passes de rééquilibrage pour y arriver. La première a révélé
que le **DPS de la capacité de départ** était le facteur dominant — un agent
commence avec une seule capacité — et il allait de 5,5 (Chevalier) à 15,0
(Berserk), soit un écart de 2,73×. Compressé à 1,27×, le Berserk est tombé de
52 % à 13 %… et l'Invocateur est monté à 37 %. La seconde passe l'a ramené à
15 % et a réparé les deux kits dont la valeur n'atteignait jamais la fitness :
« Lever les morts » ne faisait *rien* sans cadavre à portée, et les bonus du
Lutin ne valaient pas un corps de plus.

**Le Chevalier reste marginal, et c'est un choix.** Voir la note sur la
limite de `fitness()` dans `engine.js` : le terme de survie est une
*fraction* de PV, donc encaisser deux fois et demie plus de coups
n'apporte rien de mesurable. Le corriger reviendrait à récompenser le
barème au lieu du jeu.

### Progression

Mesures sur le plateau carré, population 32, 4 graines par évaluation :

- **Base de comparaison** : des équipes tirées au hasard atteignent en
  moyenne l'**étage 4,7**.
- **Évolution** : record à l'étage **17** en génération 0, **20** en
  génération 9, **23** en génération 18 ; la fitness moyenne de la
  population monte de **+61 %** sur ces 18 générations.
- **Les réseaux apprennent à naviguer.** Les runs qui se terminent par
  *enlisement* (l'équipe n'arrive plus à atteindre les monstres à travers
  les murs) passent de **24 sur 128 à 11 sur 128**. Personne n'a écrit de
  code de pathfinding : le moteur ne fournit qu'un contournement mécanique
  du dernier mètre, la décision d'itinéraire est apprise.
- **La compo évolue seule** : Chevalier / 3× Berserk / Lutin en génération 0,
  Mage / 3× Berserk / Invocateur en 9, Clerc / 3× Berserk / Archère en 18.
  Le journal d'ascension raconte ces bascules en direct.
- Boss des étages 10/20/… : murs visibles dans la courbe.

## Visionneuse

Rejeu 3D du meilleur run sur le plateau carré : murs instanciés (bordure
haute et sombre, obstacles intérieurs plus bas pour qu'on voie par-dessus),
**portails** en anneaux pulsants qui s'éteignent quand ils sont scellés ou
épuisés, **pièges visibles seulement** — les cachés ne sont pas dessinés,
exactement comme les agents les perçoivent —, invocations, cadavres, zones
persistantes, murs temporaires du Chevalier, et teinte d'état sur les
monstres (bleu gelé, orange en feu, jaune électrifié). Plus : barres
PV/mana, anneaux d'AoE, mur des ascensions parallèles (une par worker),
courbe de l'étage record, rejeux cliquables des 40 derniers records,
contrôles pause/x1/x2/x4.

La caméra recadre le plateau sur la zone d'écran laissée libre par les
panneaux : replier le panneau latéral recentre la vue au lieu de la décaler.

**Rejouer n'importe quelle génération** : le champion de *chaque* génération
est archivé (400 dernières, plus tous les records, jamais évincés). Le champ
« gén. » du panneau Rejeux rejoue celle qu'on veut — pas seulement celles qui
ont battu un record. Depuis la console : `tour.playGeneration(130)`.

### Niveaux de détail (bouton Capsules / Pions / Deluxe)

Comme un réglage graphique de jeu : on remplace les modèles et les effets
du rejeu, sans toucher au reste.

| Niveau | Modèles | Ombres | Effets |
|---|---|---|---|
| **Capsules** | capsules colorées | non | projectiles et zones |
| **Pions** (défaut) | pièces tournées façon jeu d'échecs, emblème par classe (une forme par kit sur les neuf) | oui | + **sceaux magiques** (cercles runiques au sol pour les zones, buffs et montées en niveau), traînées de dash, arcs de bond |
| **Deluxe** | pions + matériaux plus riches | oui | + fentes à l'attaque, flashs d'impact, pop des cibles touchées |

**Vrais modèles 3D** : le rendu est le seul endroit qui touche à la
géométrie (`view/tower3d.js`, méthodes `makeHeroMesh` / `makeMonsterMesh`),
donc brancher des `.glb` chargés par `GLTFLoader` ne demande de toucher à
rien d'autre. Seule contrainte : le build « un seul fichier » ne peut pas
embarquer des binaires lourds — avec de vrais modèles il faut servir le
dossier `dist/` normalement (`npm run build` + un serveur statique) plutôt
que `build:single`.

**Le rendu ne ralentit pas l'apprentissage.** L'évolution tourne dans les Web
Workers (autres cœurs CPU), le rendu sur le fil principal + GPU, et sur les
milliers de runs simulés **un seul est rendu** : celui du rejeu. Mesuré en
navigateur (3 cœurs, rendu logiciel — le pire des cas) : 0,87 gén/s en
Capsules, 0,92 en Pions, 0,95 en Deluxe — l'écart est du bruit. Le sélecteur
sert donc au confort (vieille machine, session en arrière-plan), pas à
protéger le calcul.

## Audit : les résultats sont-ils réels ?

`audit/` contient une suite de tests écrits pour **pouvoir échouer**, et
c'est ce qu'ils ont fait — trois défauts réels ont été trouvés et corrigés
(paysage de fitness en escalier, trop peu de graines par évaluation, export
de session destructeur). Voir [`audit/README.md`](audit/README.md) pour le
détail de chaque test et de chaque correction.

**Dernier passage sur le plateau carré : 12 tests sur 12, en 3 000 s.**
Sortie complète archivée dans
[`audit/resultats-reference.txt`](audit/resultats-reference.txt).

| Test | Résultat |
|---|---|
| Répétabilité | 8 exécutions identiques au bit près (11263.684677) |
| Poids à zéro | champion 21 834 contre **101** — p = 1,34e-9 |
| Poids mélangés | champion 21 834 contre **5 221** — p = 1,54e-7 |
| Généralisation (25 graines inédites) | 21 834 contre 9 870 — p = 1,72e-6, taille d'effet **88 %** |
| Sur-apprentissage | inédites = **72 %** de l'entraînement |
| Évolution > loterie (budget égal) | 15 561 contre 12 660 — **5/5 victoires**, p = 9,02e-3 |
| Contrôle négatif | avec sélection **+10 410**, sans sélection **+1 583** |
| Tendance | **+332,5** points de fitness par génération sur 30 |

Les deux derniers sont les seuls qui pouvaient réellement invalider le
projet. « Évolution > loterie » donne 1 920 évaluations à chaque méthode,
cinq fois de suite : si le champion n'était qu'un bon billet de loterie
parmi beaucoup de tirages, la recherche aléatoire ferait jeu égal. Le
contrôle négatif rejoue exactement le même algorithme en choisissant les
parents **au hasard** au lieu des meilleurs : si le progrès venait d'un
artefact du code plutôt que de la sélection, il apparaîtrait là aussi.

```bash
node audit/audit.mjs                      # suite complète
node audit/verif-moteurs.mjs              # reproductibilité Node ↔ navigateur
node audit/selectivite-draft.mjs          # le réseau choisit-il sa carte ?
node audit/cross-check.mjs session.json   # les chiffres du HUD, recalculés hors de l'appli
```

### Reproductibilité entre moteurs

`verif-moteurs.mjs` exécute les mêmes runs dans Node **et dans un vrai
navigateur**, puis compare au bit près. Ce test échouait 6 fois sur 6 : le
même génome sur la même graine donnait 24 étages sous Node et 19 sous
Chromium. Deux causes, toutes deux réelles.

ECMAScript n'impose pas le dernier bit des fonctions transcendantes.
`Math.cos(0.1)` vaut `0.9950041652780257` sous Node et `…258` sous Chrome.
Le moteur en appelait sur le chemin chaud — `hypot` 28 fois, `sin` 5, `cos`
4, `tanh` 2, `exp` 1, `pow` 1, `atan2` 1. Un bit sur les PV d'un monstre le
fait mourir un tick plus tard et, vingt étages plus loin, les trajectoires
n'ont plus rien de commun. `src/sim/exact.js` les remplace toutes par des
constantes littérales et des opérations normées.

Et `[0,1,2,3].sort(() => rng() - 0.5)` pour placer les portails : ce
comparateur n'est pas un ordre total, la norme laisse donc le résultat à
l'implémentation — et il consomme un nombre d'appels au générateur qui
dépend de l'algorithme de tri, décalant tout le flux aléatoire en aval.
Remplacé par un mélange de Fisher-Yates.

**6/6 identiques aujourd'hui.** C'est le prérequis de la phase GPU : sans
lui, impossible de vérifier dans le navigateur ce qu'une machine louée a
calculé.

### Le draft choisit-il vraiment ?

La fréquence brute des cartes prises ne prouve rien : une carte rarement
proposée ne peut pas être souvent prise. `selectivite-draft.mjs` compare
donc le choix à un tirage au hasard **parmi les mêmes offres**.

L'encodage précédent résumait chaque carte à deux scores flous, si bien que
les dix passifs se réduisaient à **trois signatures** — « Célérité » et
« Concentration » étaient littéralement le même vecteur. C'est corrigé :
10 signatures pour 10 passifs. Mais la mesure reste franche — **1,22× le
hasard à 14 générations, et la première carte de la liste prise 48 % du
temps**. L'encodage a levé l'impossibilité, il n'a pas encore produit
l'apprentissage : le draft ne pèse qu'une vingtaine de décisions sur 2 600
ticks. Le test est en place pour suivre ce chiffre.

Ce qui est vérifié : déterminisme au bit près, réalité du travail effectué,
effondrement des performances si l'on vide ou mélange les poids des réseaux,
généralisation à des graines jamais vues, supériorité sur une recherche
aléatoire à budget égal, contrôle négatif sans sélection, et reproduction
exacte dans un processus Node indépendant des fitness annoncées par
l'interface.

## Le plafond, et ce qui l'a levé

`node audit/diagnose-plateau.mjs` mesure les causes possibles d'un
plafonnement. Sur la version précédente du jeu, le verdict était sans appel :

> **Le plafond était arithmétique, pas cognitif.** Les monstres gagnaient
> 5,5 % de puissance par étage contre 3,5 % pour les agents, et leur nombre
> croissait en plus linéairement. Le total de PV d'un étage passait de 0,2×
> celui de l'équipe au 1ᵉʳ étage à 1,3× au 15ᵉ et 3,6× au 30ᵉ. Aucune
> stratégie, même parfaite, ne franchissait ce mur : sur 12 graines
> inédites, un champion mourait aux étages 8 à 10, toujours par **mort** et
> jamais par enlisement. Les leviers tactiques étaient déjà saturés (49 %
> des actions étaient des capacités, aucune laissée de côté).

C'est exactement ce que la refonte supprime : **le draft ne donne plus de
stats**, ni aux agents ni aux monstres. La difficulté vient désormais du
nombre, de la variété et de la cadence des portails, et de la géométrie du
plateau. Le plafond observé passe de l'étage 8-10 à l'étage 23 en 18
générations, et il n'est plus atteint par écrasement arithmétique.

Un frein secondaire subsiste et s'est même accentué : **le génome est
surdimensionné pour la population** — 20 845 paramètres pour 32 individus.
Un algorithme génétique explore correctement quelques centaines de
paramètres à cette taille de population. C'est l'argument principal pour la
phase GPU : ce n'est pas la vitesse par run qui manque, c'est la taille de
population.

## Prochaine étape : la phase GPU

Le moteur est volontairement pur et data-driven pour le portage Python
vectorisé (JAX/PyTorch) : des milliers de tours en parallèle sur GPU loués,
populations de milliers d'équipes, cap à 1000 étages, et le navigateur qui
devient la visionneuse des cerveaux exportés (JSON). Ensuite : PPO multi-agent
pour affiner les timings fins.
