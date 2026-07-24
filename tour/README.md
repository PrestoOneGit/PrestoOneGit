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

## L'apprentissage (zéro heuristique)

- MLP 55 → 24 → 9 par aventurier : observations brutes (soi, 4 monstres
  proches, 4 alliés, étage, repos restants) → déplacement, choix d'action
  parmi les 4 disponibles, ciblage, envie de repos.
- Neuro-évolution : 32 équipes/génération dans des Web Workers, croisement
  par aventuriers entiers (classe + cerveau), mutation auto-adaptative,
  mutation de classe rare (3 %) qui explore la méta.
- Fitness = étages franchis (x1000) + progression de l'étage courant.

## Ce qu'on observe (mesuré)

- Les équipes aléatoires meurent aux étages 6-8 ; en 60 générations
  (~70 s de calcul mono-thread), record à l'étage 11-12 et **la compo
  évolue seule** : le Clerc initial a été remplacé par un 2ᵉ Mage, puis la
  méta a oscillé entre « 4× Mage / Archère » et « 3× Mage / Archère /
  Berserker ». Le journal d'ascension raconte ces bascules en direct.
- Boss des étages 10/20/… : murs visibles dans la courbe.

## Visionneuse

Rejeu 3D du meilleur run (capsules, barres PV/mana, anneaux d'AoE, provocation,
frappes de boss), ambiance du plateau qui change avec les paliers, mur des
ascensions parallèles (une par worker), courbe de l'étage record, rejeux
cliquables des 20 derniers records, contrôles pause/x1/x2/x4.

## Prochaine étape : la phase GPU

Le moteur est volontairement pur et data-driven pour le portage Python
vectorisé (JAX/PyTorch) : des milliers de tours en parallèle sur GPU loués,
populations de milliers d'équipes, cap à 1000 étages, et le navigateur qui
devient la visionneuse des cerveaux exportés (JSON). Ensuite : PPO multi-agent
pour affiner les timings fins.
