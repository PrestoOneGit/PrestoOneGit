# L'Arène — neuro-évolution : des IA apprennent à combattre

Une arène de combat dans le navigateur où une équipe de quatre héros — Guerrier,
Archère, Mage, Soigneuse — affronte des vagues de monstres de plus en plus
féroces. **Aucun comportement n'est écrit à la main** : chaque héros est piloté
par un petit réseau de neurones, et c'est l'évolution qui façonne les poids.
Si le guerrier apprend à foncer dans le tas pour attirer les monstres pendant
que le mage place son AoE, c'est parce que la sélection l'a découvert.

## Lancer le projet

```bash
cd arene
npm install
npm run dev
```

De préférence dans Chrome/Chromium (meilleur support Web Workers + WebGPU à terme).

## Comment ça apprend (sans heuristique)

- **Le cerveau** : un MLP 23 → 16 → 4 par héros (~450 poids). Entrées : ses PV,
  son cooldown, sa position, les 3 monstres les plus proches (position relative,
  PV, gabarit), l'allié le plus blessé, le centre de l'équipe, la vague en cours.
  Sorties : direction et intensité du déplacement, décision d'agir, préférence
  de ciblage (proche ↔ faible). Le moteur n'impose que les règles du jeu
  (portées, dégâts, murs) — jamais de « va vers ta cible » codé en dur.
- **L'évolution** : 48 équipes par génération, évaluées en parallèle dans des
  Web Workers (un par cœur CPU), chacune sur 3 combats déterministes.
  Élitisme, tournois, croisement par cerveaux entiers (chaque héros hérite du
  réseau complet d'un parent) et **mutation auto-adaptative** : chaque enfant
  tire sa propre intensité de mutation, du réglage fin à la grande exploration,
  et un quart des enfants ne retravaille qu'un seul héros à fond.
- **La pression** : monstres qui se renforcent à chaque vague, « chasseurs »
  qui traquent le héros le plus blessé, enrage anti-kiting. Toute équipe finit
  par céder : c'est la vague atteinte qui départage les stratégies.
- **Mesuré** : +74 % de fitness et vague 3 → 5 en 150 générations (test
  reproductible en Node, graines fixes). La progression se fait par paliers et
  percées — la signature de la neuro-évolution — que le journal raconte en direct.

## Ce qu'on voit à l'écran

- **La scène 3D** : des capsules colorées sur un plateau — la lisibilité vient
  des couleurs, des barres de vie et des effets (flèches, anneaux d'AoE, soins),
  pas des modèles. La scène rejoue en continu le meilleur match connu pendant
  que l'évolution continue en arrière-plan.
- **Le panneau équipe** : vie, dégâts infligés et soins de chaque héros en direct.
- **Le mur de simulations** : une mini-arène par worker, en temps réel.
- **La courbe de fitness** et le **journal d'apprentissage** (records, % de gain).

## Et le GPU (RX 6900 XT) ?

Le GPU sert déjà au rendu 3D. Pour le calcul d'apprentissage, le goulot n'est
pas les réseaux (450 poids, négligeable) mais la simulation de combat, pleine
de branchements — un travail parfait pour les 12 threads d'un Ryzen 3600, mal
adapté au GPU à cette échelle. Le jour où on passe à de gros cerveaux
(récurrents, milliers de poids) ou à des milliers d'arènes simultanées, l'étape
naturelle est un évaluateur **WebGPU** (compute shaders WGSL dans Chrome) qui
fait tourner les passes avant de toute la population en parallèle sur la carte.
L'architecture s'y prête : le moteur (`sim/engine.js`) est déjà pur et isolé.

## Structure

```
arene/
├── index.html            # Coquille HTML + HUD
├── src/
│   ├── main.js           # Scène, rejeu du meilleur match, boucle de rendu
│   ├── style.css         # Interface (palette crème / terracotta)
│   ├── sim/brain.js      # MLP par héros, croisement, mutation adaptative
│   ├── sim/engine.js     # Règles du jeu (portées, vagues, monstres) — pur JS
│   ├── ga/worker.js      # Évaluation accélérée dans un Web Worker
│   ├── ga/evolution.js   # Neuro-évolution + pool de workers
│   ├── view/arena3d.js   # Plateau, capsules, effets
│   └── ui/hud.js         # Mini-arènes, courbe, stats d'équipe, journal
```

## Pistes d'évolution

- Évaluateur WebGPU (population entière en compute shaders)
- Réseaux récurrents (mémoire courte : fuir *puis* revenir)
- Monstres co-évolutifs (deux populations qui s'affrontent)
- Sauvegarde/partage des cerveaux champions (export JSON)
- Visualisation des activations du réseau du héros sélectionné
