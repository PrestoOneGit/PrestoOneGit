# Vallon — simulation de vie médiévale-fantaisie, 3D low poly

Un monde médiéval-fantaisie qui tourne dans le navigateur : à la création, un moteur
d'histoire simule **400 ans** de chroniques — fondations de villages, maisons nobles,
successions, guerres, famines, dragons et pierres de lune — puis la vue 3D low poly
montre l'île telle que ces siècles l'ont façonnée : villages, bourgs, bannières,
ruines, villageois qui vaquent le jour, faune sauvage et lucioles la nuit.

## Architecture de simulation (hybride multi-échelle)

- **Genèse (événementiel + agrégé)** : `HistoryEngine` avance année par année.
  Les populations sont des nombres (croissance logistique par site), ponctuées
  d'événements discrets consignés dans la chronique. 400 ans se calculent en
  quelques millisecondes.
- **Présent vivant (agents)** : la scène 3D rend l'état actuel — villageois qui
  déambulent, créatures sauvages avec besoins (faim, soif, énergie), cycle jour/nuit.
- **Deux vitesses de temps** : le présent s'écoule en continu (pause/x1/x3/x8),
  et le bouton « +10 ans » fait tourner le moteur d'histoire puis reconstruit
  les villages — l'histoire ne s'arrête jamais, elle change de résolution.

## Lancer le projet

```bash
cd vallon
npm install
npm run dev
```

Puis ouvrir l'adresse affichée (par défaut `http://localhost:5173`).

Pour une version de production :

```bash
npm run build
npm run preview
```

## Ce qu'on y trouve

- **Île procédurale** générée à partir d'une graine (bruit de valeur + fbm), rendu
  facetté flat-shading, plage, prairies, rochers et sommets.
- **400 ans d'histoire générée** : villages fondés, hameaux qui deviennent bourgs,
  maisons nobles (chefs nommés, successions, crises de lignée), guerres et sièges,
  mariages et alliances, famines, épidémies, merveilles (comètes, esprits du lac,
  lames qui chantent) et catastrophes fantastiques (dragon, drac du lac).
- **Chronique consultable** : chaque événement est daté et archivé, lisible dans
  le panneau « Chronique », avec le dernier événement en bandeau.
- **Villages en 3D** : maisons low poly, bannière aux couleurs de la maison
  régnante, ruines pour les sites abandonnés. Cliquer sur un village affiche
  son statut, sa population, sa maison et ses derniers événements.
- **Cycle jour/nuit** : le soleil tourne, le ciel passe de l'aube au crépuscule,
  les villageois rentrent chez eux et les lucioles s'allument.
- **Faune sauvage autonome** : créatures avec faim, soif et énergie, qui cherchent
  des baies, boivent au lac, dorment et se reproduisent. Cliquer pour en suivre une.
- **Contrôles** : pause / x1 / x3 / x8 pour le présent, « +10 ans » pour l'histoire,
  « Nouveau monde » pour régénérer une île et ses quatre siècles de passé.

## Structure

```
vallon/
├── index.html               # Coquille HTML + HUD
├── src/
│   ├── main.js              # Rendu, caméra, cycle jour/nuit, sélection
│   ├── style.css            # Interface (palette crème / terracotta)
│   ├── core/noise.js        # RNG déterministe + bruit de valeur / fbm
│   ├── history/names.js     # Noms de villages, maisons, personnages
│   ├── history/history.js   # Moteur d'histoire (années, événements, chronique)
│   ├── world/world.js       # Terrain, eau, flore, nuages, lucioles
│   ├── world/villages.js    # Bâtiments, bannières, ruines, villageois
│   ├── sim/creature.js      # Machine à états d'une créature sauvage
│   ├── sim/simulation.js    # Horloge du présent, faune
│   └── ui/hud.js            # Liaison DOM du HUD
```

## Pistes d'évolution

- Personnages notables incarnés dans la scène (chefs qu'on peut suivre comme la faune)
- Routes entre villages, champs cultivés autour des bourgs
- Généalogies consultables (arbres des maisons)
- Filtres de la chronique (par village, par maison, par type d'événement)
- Guerres visibles dans le présent (bannières en marche)
- Saisons et météo, graphique de population, graine partageable dans l'URL
