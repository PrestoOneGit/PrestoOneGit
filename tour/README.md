# La Tour — des aventuriers IA apprennent à grimper

Une équipe de 5 aventuriers affronte une tour de 100 étages (1000 à terme) :
paliers de nouveaux monstres, boss tous les 10 étages, élites, afflictions,
sorts, ressources persistantes et repos limités — façon donjon D&D. **Aucun
comportement n'est écrit à la main** : chaque aventurier est piloté par son
réseau de neurones, et même la **composition de l'équipe** (les 5 classes)
fait partie du génome. Si la méta converge vers 3 mages, c'est que
l'évolution l'a découvert.

## Lancer

```bash
cd tour
npm install
npm run dev            # Chrome/Chromium recommandé
npm run build:single   # produit dist-single/index.html, autonome
```

## Le jeu (data-driven : `src/sim/data.js`)

- **6 classes** × 3 capacités : Chevalier (coup de bouclier étourdissant,
  provocation, posture), Berserker (frappe lourde, tourbillon, cri de guerre,
  passif rage), Archère (tir précis, tir handicapant, pluie de flèches),
  Mage (boule de feu, éclair de givre, nova), Clerc (soin, cercle de soin,
  bénédiction), Occultiste (malédiction, nuée toxique, drain).
- **Afflictions** : brûlure, poison (cumulable), ralentissement, étourdissement,
  vulnérabilité. **Buffs** : bénédiction (+dégâts), posture (-dégâts subis).
- **La tour** : budget de monstres croissant par étage, paliers (rats/gobelins →
  orcs/chamans → araignées/golems → spectres/pyromants → trolls/liches),
  boss tous les 10 étages, élites à partir du 15. Monstres soigneurs,
  blindés, perce-armure, à zone… Les monstres grimpent en puissance un peu
  plus vite que les héros : le mur arrive toujours, le repousser demande de
  mieux jouer.
- **Ressources persistantes** : PV/mana conservés entre étages, régén
  partielle, 3 repos complets par run — le moment de se reposer est VOTÉ
  par les réseaux (une sortie dédiée), pas décidé par une règle.

## Mobilité et progression

- **Trois déplacements à cooldown**, communs à toutes les classes :
  **dash** (repositionnement instantané, 5 s), **course** (+70 % de vitesse
  pendant 3 s, 12 s), **bond** (saut de 7 unités qui **esquive la mêlée**
  pendant le vol, 10 s). Le réseau décide quand les déclencher.
- **Un niveau par étage franchi**, et tous les 5 étages **un choix
  d'amélioration** parmi 6 (Vigueur, Puissance, Célérité, Arcanes,
  Amplification, Résilience) — le réseau désigne laquelle. Les rangs se
  cumulent : c'est la « build » de l'agent, et elle est apprise.

## L'apprentissage (zéro heuristique)

- MLP 66 → 28 → 18 par agent : observations brutes (soi, cooldowns de
  mobilité, améliorations possédées, 4 monstres proches, 4 alliés, étage,
  repos restants) → déplacement, mobilité, choix d'action parmi les 4
  disponibles, ciblage, envie de repos, préférence d'amélioration.
- Neuro-évolution : 32 équipes/génération dans des Web Workers, croisement
  par agents entiers (classe + cerveau), mutation auto-adaptative,
  mutation de classe rare (3 %) qui explore la méta.
- Fitness = étages franchis (x1000) + progression de l'étage courant.

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
`tour.report(130)` et `tour.markdown(130)`.

## Ce qu'on observe (mesuré)

- Les équipes aléatoires meurent aux étages 6-8 ; en 60 générations
  (~70 s de calcul mono-thread), record à l'étage 11-12 et **la compo
  évolue seule** : le Clerc initial a été remplacé par un 2ᵉ Mage, puis la
  méta a oscillé entre « 4× Mage / Archère » et « 3× Mage / Archère /
  Berserker ». Le journal d'ascension raconte ces bascules en direct.
- Boss des étages 10/20/… : murs visibles dans la courbe.

## Visionneuse

Rejeu 3D du meilleur run (barres PV/mana, anneaux d'AoE, provocation, frappes
de boss), ambiance du plateau qui change avec les paliers, mur des ascensions
parallèles (une par worker), courbe de l'étage record, rejeux cliquables des
40 derniers records, contrôles pause/x1/x2/x4.

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
| **Pions** (défaut) | pièces tournées façon jeu d'échecs, emblème par classe (couronne, cornes, arc, chapeau, auréole, orbe) | oui | + **sceaux magiques** (cercles runiques au sol pour les zones, buffs et montées en niveau), traînées de dash, arcs de bond |
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

## Prochaine étape : la phase GPU

Le moteur est volontairement pur et data-driven pour le portage Python
vectorisé (JAX/PyTorch) : des milliers de tours en parallèle sur GPU loués,
populations de milliers d'équipes, cap à 1000 étages, et le navigateur qui
devient la visionneuse des cerveaux exportés (JSON). Ensuite : PPO multi-agent
pour affiner les timings fins.
