# Conception — refonte du plateau, des classes et des états

> **Implémenté.** Ce document décrit le jeu tel qu'il tourne aujourd'hui.
> Les quatre questions ouvertes de la fin ont été tranchées, leurs réponses
> sont reportées en bas de page.

---

## 1. Le plateau

**Carré, ~32×32 unités.** Disposition tirée de la graine parmi quatre
archétypes, pour que la tactique change d'un étage à l'autre :

| Archétype | Forme | Ce que ça récompense |
|---|---|---|
| **Salle ouverte** | quelques piliers épars | mobilité, zones larges |
| **Colonnade** | grille de piliers réguliers | couvert, ligne de vue coupée |
| **Couloirs** | murs longs formant des goulots | tenir un passage, alignement |
| **Chambres** | 3-4 pièces reliées par des portes | combats fractionnés, repli |

Les murs bloquent **le déplacement et la ligne de vue**. Sans cette seconde
règle, un couloir n'a aucun intérêt tactique et Shadow Step ne sert à rien.

### Portails

2 à 4 par étage, posés sur les bords. Les monstres en **sortent par vagues**
au lieu d'apparaître d'un bloc. Un portail a une cadence propre : tant qu'il
crache, la pression ne retombe pas. Conséquences tactiques immédiates : tenir
le goulot devant un portail, ou le sceller (Occultiste).

### Pièges

Posés à la génération de l'étage, **déclenchés par les deux camps** — un
agent malin apprend à y attirer les monstres.

| Piège | Effet |
|---|---|
| Fosse à pointes | dégâts francs à l'entrée |
| Goudron | ralenti tant qu'on y reste |
| Rune arcanique | étourdit brièvement, se recharge |
| Braséro brisé | met en feu |

---

## 2. Les états

Système unifié : chaque entité (agent, monstre, invocation) porte une liste
d'états avec durée et cumuls.

### Négatifs

| État | Effet |
|---|---|
| **En feu** | dégâts sur la durée ; annulé par Gelé |
| **Empoisonné** | dégâts sur la durée, **cumulable** (jusqu'à 5) |
| **Électrifié** | dégâts, et **se propage** à un ennemi proche non électrifié |
| **Gelé** | immobilisé complètement ; **un coup lourd brise le gel** et inflige double |
| **Ralenti** | −40 % de vitesse |
| **Étourdi** | aucune action |
| **Vulnérable** | +30 % de dégâts subis |
| **Saignement** | dégâts qui augmentent quand la cible se déplace |
| **Terreur** | fuit au lieu d'attaquer |

### Positifs

| État | Effet |
|---|---|
| **Béni** | +25 % de dégâts infligés |
| **Hâte** | −25 % de cooldowns et +vitesse |
| **Bouclier** | absorbe un montant de dégâts |
| **Régénération** | soin sur la durée |
| **Posture** | −35 % de dégâts subis |
| **Intangible** | invincible, traverse murs et créatures |

### Interactions élémentaires

Peu nombreuses mais lisibles — c'est là que naît la profondeur émergente :

- **Gelé + coup lourd** → le gel se brise, dégâts doublés
- **En feu + Gelé** → les deux s'annulent
- **Électrifié + Gelé** → la propagation touche deux cibles au lieu d'une
- **Empoisonné + En feu** → combustion toxique, dégâts du poison doublés le temps du feu

---

## 3. Les classes

Neuf classes. Chaque kit suit le schéma de ton Mage : **un projectile bon
marché, un contrôle, un gros coûteux, une échappatoire** — et au moins une
capacité qui dialogue avec le terrain, sinon murs et portails resteraient
décoratifs.

> **Note** : « Berserk » remplace l'ancien « Berserker ». Si tu voulais garder
> les deux, dis-le.

### Chevalier — tient une ligne
| Capacité | Effet |
|---|---|
| Frappe de bouclier | mêlée bon marché, étourdit brièvement |
| Provocation | force les monstres alentour à le viser |
| **Mur de garde** | pose un obstacle temporaire qui bloque les monstres |
| Charge | se rue en ligne droite, renverse ce qu'il traverse |

### Berserk — épée à deux mains
| Capacité | Effet |
|---|---|
| Coup de taille | mêlée lente et lourde, **brise le gel** |
| Fauchage | arc large devant lui, touche plusieurs cibles |
| **Rage noire** | consomme ses PV, dégâts croissants avec les PV manquants |
| Charge brutale | traverse et renverse, franchit les obstacles bas |

### Archère — angles de tir
| Capacité | Effet |
|---|---|
| Tir précis | projectile bon marché |
| **Flèche perforante** | traverse plusieurs ennemis alignés |
| **Piège à mâchoires** | pose un piège qui immobilise |
| Roulade | dash court, ignore les projectiles pendant l'esquive |

### Mage — ta spec
| Capacité | Effet |
|---|---|
| Light Arrow | projectile bon marché |
| Freeze | petite zone, **gèle** les ennemis quelques secondes |
| Explosion | large rayon, coût de mana élevé, gros dégâts |
| Shadow Step | **intangible** : invisible, invincible, traverse les murs |

### Clerc — soutien de zone
| Capacité | Effet |
|---|---|
| Châtiment | projectile bon marché |
| Soin | cible unique |
| **Sanctuaire** | zone persistante qui régénère les alliés dedans |
| Intervention | bouclier sur un allié et le téléporte à soi |

### Occultiste — malédictions
| Capacité | Effet |
|---|---|
| Éclat d'ombre | projectile bon marché |
| Nuée toxique | zone empoisonnée persistante |
| Malédiction | vulnérabilité ; les dégâts subis par la cible le soignent |
| **Sceau de scellement** | ferme temporairement un portail |

### Invocateur — armée de poche
| Capacité | Effet |
|---|---|
| Éclat d'invocation | projectile bon marché |
| **Invoque un slime** | créature rapide qui colle aux ennemis et les ralentit |
| **Invoque un golem** | créature lente et massive, encaisse et provoque |
| **Permutation** | échange sa place avec une de ses invocations (échappatoire) |

### Nécromancien — profite des morts
| Capacité | Effet |
|---|---|
| Éclat d'os | projectile bon marché |
| **Lever les morts** | relève un squelette par cadavre proche |
| **Explosion de cadavre** | fait exploser un cadavre, dégâts de zone |
| **Linceul d'os** | bouclier d'absorption, consomme ses squelettes pour tenir |

### Lutin — accélère l'équipe
| Capacité | Effet |
|---|---|
| Dard | projectile bon marché |
| **Poussière d'entrain** | zone qui donne Hâte aux alliés dedans |
| Chant de bravoure | Béni sur toute l'équipe |
| Bond farceur | dash, et rend l'allié le plus proche brièvement intangible |

**Invocations et cadavres** sont deux nouveaux types d'entités. Les cadavres
persistent quelques secondes sur le plateau : ils deviennent une ressource
que le Nécromancien apprend à exploiter, et un facteur de positionnement.

---

## 4. Le draft roguelike

Chaque agent démarre avec son **attaque de base et une seule** capacité de
classe. À chaque niveau, **3 cartes tirées au sort**, le réseau en choisit une.

**Trois natures de cartes :**

1. **Capacité de classe** non encore possédée (les 3 restantes du kit)
2. **Passif commun**, ouvert à toutes les classes :
   Célérité (+vitesse) · Vivacité (−cooldowns) · Endurance (+PV) ·
   Concentration (+mana) · Vampirisme (soin sur dégâts) · Esquive ·
   Allonge (+portée) · Résilience (afflictions écourtées) ·
   Curée (+dégâts sur cibles blessées) · Pas assuré (immunité au ralentissement)
3. **Renfort d'une capacité possédée** : « Explosion +1 m de rayon »,
   « Freeze +1 s », « Golem +30 % PV »

**Plus de croissance de stats par niveau**, ni pour les agents ni pour les
monstres — c'est ce qui supprime le mur arithmétique diagnostiqué
(monstres +5,5 %/étage contre agents +3,5 %, mort programmée à l'étage 10).
La difficulté vient désormais du **nombre, de la variété et de la cadence
des portails**.

Effet secondaire heureux : comme un agent ne porte jamais plus de 4
capacités, l'espace d'action des réseaux reste borné malgré 36 capacités au
catalogue. Le draft résout le problème qu'il crée.

---

## 5. Le bestiaire

Dark fantasy, quatorze entrées, chacune avec un comportement propre — pas
juste des sacs de points de vie.

| Monstre | Comportement |
|---|---|
| **Gobelin** | faible, nombreux, lâche : fuit quand ses congénères tombent |
| **Slime** | lent ; **se scinde en deux petits** à sa mort |
| **Squelette** | moyen ; **se relève une fois** si on ne l'achève pas |
| **Loup** | rapide, chasse en meute, cible les agents les plus blessés |
| **Serpent** | rapide, frappe et recule, **empoisonne** |
| **Orc** | costaud, mêlée franche |
| **Hobgobelin** | élite ; **commande** : donne Béni aux gobelins autour de lui |
| **Chauve-souris sanguine** | vole (ignore les pièges au sol), se soigne en frappant |
| **Araignée** | pose des **toiles** qui ralentissent |
| **Goule** | rapide ; **ressuscite** si son cadavre n'est pas consommé |
| **Golem de pierre** | très lent, armure lourde, brise les murs temporaires |
| **Spectre** | **traverse les murs**, ignore l'armure |
| **Troll** | régénère continuellement ; seul le feu l'en empêche |
| **Liche** | élite/boss ; invoque des squelettes, lance Gel et Électrifié |

Répartition par paliers d'étages comme aujourd'hui, et boss tous les 10
étages construits sur ces bases.

---

## 6. Conséquences techniques

**Les réseaux changent de taille.** Il leur faut voir les murs (capteurs de
distance dans quelques directions), les portails, les pièges, leurs propres
invocations et les cadavres proches. Estimation : entrées ~66 → ~95, sorties
18 → ~24.

**L'entraînement en cours deviendra incompatible.** Le format de sauvegarde
sera incrémenté et l'ancienne session refusée proprement, avec message clair.
**Exporte ta session à 300 générations avant** si tu veux la garder en archive.

**L'équilibrage repart de zéro.** Sans croissance exponentielle, il faudra
recalibrer le nombre de monstres, la cadence des portails et la densité des
pièges pour que le plafond revienne — par la difficulté tactique cette fois.
L'audit et le diagnostic de plateau seront relancés pour situer le nouveau mur.

---

## 7. Ordre de construction proposé

Le chantier est gros. Découpé pour que tu voies quelque chose tourner vite :

1. **Terrain** — plateau carré, murs, ligne de vue, portails, pièges
2. **États** — système unifié + interactions élémentaires
3. **Draft** — level-up à 3 cartes, pools classe et commun
4. **Classes** — les 9 kits
5. **Bestiaire** — les 14 monstres et leurs comportements
6. **Entités nouvelles** — invocations, cadavres
7. **Réseaux** — nouvelles entrées/sorties, puis rééquilibrage et audit

---

## Questions tranchées

- **Berserk remplace** l'ancien Berserker. Le catalogue compte neuf classes,
  pas dix.
- **Les invocations ne comptent pas comme alliés** pour les soins du Clerc :
  l'Invocateur ne peut pas transformer le Clerc en pompe à soins gratuite.
- **Un agent tombé peut être relevé une fois** par run (`REVIVES_PER_AGENT = 1`).
  La seconde mort est définitive.
- **Les pièges ne sont pas tous visibles.** Fosse à pointes et goudron le sont ;
  rune arcanique et braséro brisé ne le sont pas — ni dans les observations des
  réseaux, ni à l'écran. Sur 25 étages mesurés : 65 visibles, 52 cachés. Les
  agents doivent donc apprendre à les subir puis à les éviter par mémoire de
  position, pas par perception directe.

L'ancienne session à 300 générations n'a pas été conservée : le format de
sauvegarde passe de 3 à 4 et l'entraînement repart de zéro.
