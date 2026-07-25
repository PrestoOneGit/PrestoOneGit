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
npm run audit    # la suite de vérification (12 tests)
```

Ou depuis ce dossier : `npm run dev`, `npm run build:single`.

## Coût de calcul

Un run complet coûte **~21 ms** en JavaScript, dont **95 % en passes avant
des réseaux** (mesuré par `audit/` — voir la note de profilage plus bas).
La logique de jeu ne pèse que 5 % : micro-optimiser le moteur ne mènerait
nulle part, et c'est précisément pourquoi le portage GPU est le bon levier.

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

- MLP **108 → 24 → 16** par agent (3 016 poids ; 15 085 pour l'équipe des 5,
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

```bash
node audit/audit.mjs                      # suite complète
node audit/cross-check.mjs session.json   # les chiffres du HUD, recalculés hors de l'appli
```

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
surdimensionné pour la population** — 15 085 paramètres pour 32 individus.
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
