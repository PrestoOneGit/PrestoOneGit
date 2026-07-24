# Audit de l'entraînement

Ces scripts existent pour répondre à une seule question : **les résultats
affichés sont-ils réels ?** Ils sont écrits pour *pouvoir échouer* — et ils
ont effectivement échoué, ce qui a fait remonter trois défauts corrigés
depuis (voir « Ce que l'audit a trouvé »).

```bash
node audit/audit.mjs            # suite complète (~6 min)
node audit/audit.mjs --rapide   # version courte (~1 min)
node audit/diagnose-ga.mjs      # santé des mutations et de l'héritabilité
node audit/experiment-seeds.mjs # combien de graines par évaluation ?
node audit/cross-check.mjs session.json   # navigateur → Node
```

## Ce que chaque test cherche à réfuter

| Test | Ce qu'il détecterait s'il échouait |
|---|---|
| **Répétabilité** | Un moteur non déterministe : aucune comparaison entre générations n'aurait alors de sens. |
| **Entrelacement** | Une corruption due aux tampons d'observation partagés entre simulations. |
| **Sensibilité à la graine** | Une graine ignorée — tous les runs seraient le même combat déguisé. |
| **Travail par run** | Un compteur de générations qui s'incrémente sans rien simuler (une génération qui « coûte » 0 ms n'a pas été calculée). |
| **Poids à zéro / mélangés** | Des réseaux décoratifs : si un cerveau vidé jouait aussi bien, ce serait le moteur, pas l'apprentissage, qui produirait le résultat. |
| **Généralisation** | Un apprentissage par cœur sur les quelques graines d'entraînement, au lieu d'une vraie stratégie. |
| **Évolution > loterie** | Une « progression » qui ne serait que le maximum d'un grand nombre de tirages au hasard. |
| **Contrôle négatif** | Un progrès venu de la dérive et non de la sélection (même code, mêmes mutations, parents tirés au hasard). |
| **Contre-vérification** | Des chiffres fabriqués par l'interface : les fitness annoncées sont recalculées dans un processus Node indépendant. |

## Ce que l'audit a trouvé

Trois défauts réels, tous corrigés :

1. **Paysage de fitness en escalier.** Le score ne comptait que les étages
   franchis (×1000) et la progression de l'étage courant : 99,4 % de la
   variance venait du seul nombre *entier* d'étages. Aucune mutation ne
   pouvait être récompensée tant qu'elle ne faisait pas gagner un étage
   complet — mesuré : **0 enfant sur 280 ne battait son parent**, à toutes
   les intensités de mutation testées. Corrigé par des termes continus
   cumulés (monstres tués, dégâts, PV préservés, temps de survie).

2. **Trop peu de graines par évaluation.** Avec 2 graines, le champion est
   autant « chanceux sur ces deux configurations » que bon : 20 % de son
   score ne se transférait pas à des graines inédites, et cette part ne
   s'hérite pas. `experiment-seeds.mjs` a comparé 2, 4 et 8 graines à budget
   de calcul constant : **4 est l'optimum** (biais ramené à 3-4 %, avantage
   maximal sur une recherche aléatoire).

3. **Export de session destructeur.** Les génomes étaient écrits en JSON
   avec 4 décimales. La contre-vérification a montré que **1 run sur 20
   seulement se reproduisait** (écarts jusqu'à 2600 points). Ce n'est pas du
   chaos — perturber un seul poids de 1e-5 ne change rien — mais arrondir
   les ~12 000 poids à la fois suffit à faire basculer une décision de
   réseau, et le run diverge alors complètement. Corrigé par un encodage
   base64 des octets bruts : exact au bit près, et 30 % plus compact.

Un quatrième défaut concernait l'audit lui-même : le test « évolution contre
loterie » comparait *une* évolution à *un* tirage aléatoire, puis traitait
les 25 graines de test comme des répétitions. C'est de la pseudo-réplication
— on mesure la variabilité entre graines, pas entre méthodes, et le test ne
pouvait structurellement rien détecter. Il relance désormais chaque méthode
plusieurs fois avec des germes indépendants.

## Note de méthode

Les tests statistiques sont non paramétriques (Mann-Whitney, permutation) :
les distributions de fitness sont bornées, asymétriques et pleines d'ex æquo,
ce qui disqualifie un test de Student. La « vérité terrain » est toujours la
performance sur des graines **jamais vues à l'entraînement** — c'est la seule
mesure qui distingue une stratégie apprise d'un par-cœur.
