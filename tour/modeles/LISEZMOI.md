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

## Tu arrives avec des fichiers bruts d'un générateur

Deux outils, dans l'ordre.

**1. Reconnaître.** Dépose les fichiers dans `modeles-brut/` (ignoré par
git) avec leurs noms d'origine, puis :

```bash
node audit/identifier-glb.mjs
```

Il rend chaque modèle sur fond blanc sous trois angles dans
`audit/glb-apercu/`. Il n'y a plus qu'à regarder et à remplir
`audit/noms-modeles.json` : `nom de fichier` → `identifiant`. Une valeur
`null` écarte un fichier (doublon, raté).

**2. Dégraisser et renommer.**

```bash
node audit/degraisser-glb.mjs
```

Un modèle sorti d'un générateur pèse 15 à 20 Mo : quatre textures PBR en
2048², pour un pion qui fait **27 pixels de haut** à la caméra par défaut.
Le rendu du jeu est facetté et sans reflets — normales, rugosité et
occlusion ne changent rien du tout à l'image.

La couleur, elle, compte. Elle n'est donc pas jetée mais **reportée dans la
géométrie** : chaque triangle est échantillonné au centre de ses UV, et la
teinte obtenue devient celle de ses trois sommets. Le fichier ressort sans
la moindre image, la pose normalisée, et le look facetté est un gain, pas
une perte.

Mesuré sur les 18 premiers modèles : **284,5 Mo → 10,8 Mo**, soit 96 % en
moins, pour 4 500 à 6 500 triangles chacun — inchangés.

## Contraintes de modélisation

- **Y vers le haut, origine aux pieds, face au +Z.**
- **Pas d'armature.** Les monstres ne sont pas animés, et le geste
  d'attaque des héros est piloté par le code.
- **La hauteur exacte n'a pas d'importance** : le chargeur remet chaque
  modèle à l'échelle d'après `data.js` et replaque sa base sur le sol.
- **Pas de compression Draco.**
- **Pas d'armes ni de bras sur les héros** : l'arme est ajoutée par le code
  (`makeWeapon` dans `tower3d.js`) pour pouvoir être animée à la frappe.
  Une arme déjà modélisée sur le corps ferait doublon avec celle-ci.

## Deux conséquences

**Le build en fichier unique ne peut plus embarquer les modèles** — ce sont
des binaires. Servir `dist/` normalement.

**Le codage couleur des monstres disparaît** (vert ordinaire, or élite,
rouge boss) : les couleurs du modèle sont conservées. Seuls les états
restent signalés par une lueur ajoutée.
