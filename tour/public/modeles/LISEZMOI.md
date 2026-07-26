# Où déposer les modèles 3D

```
public/modeles/
  manifeste.json          ← déclarer ici ce qui existe
  heros/
    chevalier.glb
    berserk.glb
    ...
  monstres/
    gobelin.glb
    slime.glb
    ...
```

## Marche à suivre

1. Déposer le `.glb` dans `heros/` ou `monstres/`.
2. Ajouter son identifiant dans `manifeste.json`.
3. Recharger la page.

Le jeu tourne **sans aucun modèle** : les pions tournés restent la solution
par défaut, et chaque fichier déposé en remplace un. Rien ne casse si un
modèle manque — on peut donc avancer classe par classe.

Le manifeste existe pour éviter d'aller chercher 23 fichiers dont la
plupart n'existent pas : sans lui, la console se remplirait de 404 à chaque
démarrage.

## Identifiants attendus

Ils doivent correspondre exactement à ceux de `src/sim/data.js`.

**Héros** : `chevalier`, `berserk`, `archere`, `mage`, `clerc`,
`occultiste`, `invocateur`, `necromancien`, `lutin`

**Monstres** : `gobelin`, `slime`, `squelette`, `loup`, `serpent`, `orc`,
`hobgobelin`, `chauve_souris`, `araignee`, `goule`, `golem_pierre`,
`spectre`, `troll`, `liche`

**Invocations** : `slime_allie`, `golem_allie`, `squelette_allie` — à poser
dans `monstres/`.

## Contraintes de modélisation

- **Y vers le haut, origine aux pieds, face au +Z.**
- **Pas d'armature.** Les monstres ne sont pas animés, et le geste
  d'attaque des héros est piloté par le code.
- **La hauteur exacte n'a pas d'importance** : le chargeur remet chaque
  modèle à l'échelle d'après `data.js`, et replaque sa base sur le sol.
- **Flat shading** : il est forcé au chargement de toute façon, mais
  exporter déjà facetté donne un meilleur résultat.
- **Pas de compression Draco** : à ces tailles elle complique le chargement
  sans rien gagner.

## Deux conséquences à connaître

**Le build en fichier unique ne pourra plus embarquer les modèles.**
`npm run build` produit aujourd'hui un `index.html` autonome ouvrable par
double-clic. Des `.glb` sont des binaires : il faudra servir `dist/`
normalement. Utiliser `npm --prefix tour run build` puis n'importe quel
serveur statique.

**Le code teinte les entités.** Aujourd'hui la couleur porte de
l'information : vert pour un monstre ordinaire, or pour une élite, rouge
pour un boss. Avec un modèle qui a ses propres couleurs, cette teinture de
base est abandonnée — seuls les états restent signalés, par une lueur
ajoutée (bleu gelé, orange en feu, jaune électrifié). Si tu veux garder la
distinction élite/boss, le plus propre est un anneau au sol plutôt qu'un
filtre de couleur par-dessus ton design.
