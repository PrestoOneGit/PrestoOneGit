# L'Arène — des IA apprennent à combattre (3D low poly)

Une arène de combat dans le navigateur où une équipe de quatre héros — Guerrier,
Archère, Mage, Soigneuse — affronte des vagues de monstres de plus en plus
féroces. Personne ne leur a dit comment jouer : **des dizaines de combats
simulés en parallèle** et un algorithme génétique font émerger les bonnes
stratégies, génération après génération.

## Lancer le projet

```bash
cd arene
npm install
npm run dev
```

## Comment ça apprend

- **Le génome** : chaque héros possède 6 « gènes » de comportement — distance
  préférée, prudence (seuil de repli), focus des cibles faibles, esquive/kiting,
  entraide, agressivité. Rien n'est codé en dur : un guerrier peut naître
  froussard et une soigneuse kamikaze.
- **L'évaluation en parallèle** : à chaque génération, 32 équipes candidates
  sont testées dans des Web Workers (un par cœur CPU), chacune sur 3 combats,
  à vitesse maximale — des milliers de ticks de simulation par seconde.
  Les mini-arènes du HUD montrent ces combats en direct.
- **La sélection** : élitisme (les 3 meilleures équipes survivent intactes),
  tournois, croisement par blocs (chaque héros hérite de tous les gènes d'un
  même parent) et mutations gaussiennes. Deux génomes aléatoires par
  génération entretiennent la diversité.
- **La pression** : les monstres se renforcent à chaque vague, des « chasseurs »
  traquent le héros le plus blessé, et un enrage accélère les monstres si une
  vague s'éternise — impossible de kiter à l'infini. Toute équipe finit par
  céder : c'est la vague atteinte qui départage les stratégies.

## Ce qu'on voit à l'écran

- **La scène 3D** rejoue en continu le meilleur match connu (mêmes graines,
  simulation déterministe) pendant que l'évolution continue en arrière-plan.
- **Le panneau « Meilleure équipe »** montre les gènes appris par chaque héros —
  on y voit littéralement le guerrier apprendre le corps-à-corps et l'archère
  apprendre à garder ses distances.
- **La courbe de fitness** trace le record et la moyenne par génération.
- **Le journal d'apprentissage** raconte chaque record : quel gène a bougé,
  de combien, chez qui.

## Structure

```
arene/
├── index.html            # Coquille HTML + HUD
├── src/
│   ├── main.js           # Scène, rejeu du meilleur match, boucle de rendu
│   ├── style.css         # Interface (palette crème / terracotta)
│   ├── sim/engine.js     # Moteur de combat pur (sans three.js, déterministe)
│   ├── ga/worker.js      # Évaluation accélérée dans un Web Worker
│   ├── ga/evolution.js   # Algorithme génétique + pool de workers
│   ├── view/arena3d.js   # Arène, héros, monstres, effets low poly
│   └── ui/hud.js         # Mini-arènes, courbe, gènes, journal
```

## Pistes d'évolution

- Remplacer les gènes par un petit réseau de neurones (neuro-évolution NEAT-like)
- Nouvelles classes (voleur, paladin) et compositions d'équipe évolutives
- Monstres co-évolutifs (deux populations qui s'affrontent)
- Replays sauvegardés et partage de génomes champions
- Courbes par gène pour visualiser la convergence de chaque comportement
