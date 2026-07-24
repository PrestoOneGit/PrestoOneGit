# Vallon — simulation de vie 3D low poly

Un petit monde vivant qui tourne dans le navigateur : une île procédurale en low poly,
peuplée de créatures autonomes qui mangent, boivent, dorment, naissent et disparaissent
au fil des jours.

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
- **Cycle jour/nuit** : le soleil tourne, le ciel passe de l'aube au crépuscule,
  les lucioles s'allument la nuit.
- **Créatures autonomes** : chaque habitant gère sa faim, sa soif et son énergie.
  Il cherche des baies dans les buissons, boit au bord de l'eau, dort la nuit,
  et se reproduit quand tout va bien. Les baies repoussent avec le temps.
- **Suivi d'un habitant** : cliquer sur une créature pour la suivre à la caméra
  et voir son état en direct (nom, âge, besoins).
- **Contrôles** : pause / x1 / x3 / x8, et bouton « Nouveau monde » pour régénérer
  une île avec une nouvelle graine.

## Structure

```
vallon/
├── index.html            # Coquille HTML + HUD
├── src/
│   ├── main.js           # Rendu, caméra, cycle jour/nuit, sélection
│   ├── style.css         # Interface (palette crème / terracotta)
│   ├── core/noise.js     # RNG déterministe + bruit de valeur / fbm
│   ├── world/world.js    # Terrain, eau, flore, nuages, lucioles
│   ├── sim/creature.js   # Machine à états d'une créature
│   ├── sim/simulation.js # Horloge du monde, naissances, population
│   └── ui/hud.js         # Liaison DOM du HUD
```

## Pistes d'évolution

- Prédateurs et chaîne alimentaire
- Traits hérités à la naissance (vitesse, longévité, couleur)
- Saisons et météo (pluie, brouillard)
- Graphique de population dans le HUD
- Sauvegarde de la graine dans l'URL pour partager un monde
