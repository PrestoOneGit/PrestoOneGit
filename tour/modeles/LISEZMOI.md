# Dépose tes .glb ici

Un seul dossier, à plat. Pas de sous-dossiers, pas de manifeste.

Le **nom du fichier** est l'identifiant, et le chargeur devine tout seul
s'il s'agit d'un héros ou d'un monstre en le comparant au catalogue de
`src/sim/data.js`.

```
modeles/
  gobelin.glb
  Chevalier.GLB
  chauve-souris (1).glb
```

Casse, accents, tirets, espaces et suffixes `(1)` sont ignorés. Un fichier
dont le nom ne correspond à rien est signalé une fois dans la console et
laissé de côté — le pion procédural continue de servir.

## Noms reconnus

**Héros** : `chevalier`, `berserk`, `archere`, `mage`, `clerc`,
`occultiste`, `invocateur`, `necromancien`, `lutin`

**Monstres** : `gobelin`, `slime`, `squelette`, `loup`, `serpent`, `orc`,
`hobgobelin`, `chauve_souris`, `araignee`, `goule`, `golem_pierre`,
`spectre`, `troll`, `liche`

**Invocations** : `slime_allie`, `golem_allie`, `squelette_allie`

## Tu ne sais pas quel fichier est quoi ?

Dépose-les avec n'importe quel nom et lance :

```bash
node audit/identifier-glb.mjs
```

Il rend chaque modèle en image dans `audit/glb-apercu/`, avec un
contact-sheet récapitulatif. Il suffit alors de regarder et de renommer.

## Contraintes de modélisation

- **Y vers le haut, origine aux pieds, face au +Z.**
- **Pas d'armature.** Les monstres ne sont pas animés, et le geste
  d'attaque des héros est piloté par le code.
- **La hauteur exacte n'a pas d'importance** : le chargeur remet chaque
  modèle à l'échelle d'après `data.js` et replaque sa base sur le sol.
- **Pas de compression Draco.**

## Deux conséquences

**Le build en fichier unique ne peut plus embarquer les modèles** — ce sont
des binaires. Servir `dist/` normalement.

**Le codage couleur des monstres disparaît** (vert ordinaire, or élite,
rouge boss) : les couleurs du modèle sont conservées. Seuls les états
restent signalés par une lueur ajoutée.
