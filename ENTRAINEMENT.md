# Faire tourner La Tour à fond

Guide pour lancer un entraînement long sur une machine de bureau. Écrit
pour un Ryzen 3600 (6 cœurs, 12 fils) sous Windows, mais rien n'y est
spécifique à ce processeur.

## 1. Récupérer le code

```powershell
cd D:\dev\PrestoOneGit
git pull origin claude/life-simulation-3d-lowpoly-zzpad0
```

Aucune dépendance n'a changé, `npm run setup` est inutile.

**La sauvegarde existante sera refusée** : le format passe à 7, les réseaux
ont changé de taille (164 entrées au lieu de 156). C'est voulu — reprendre
d'anciens agents avec des observations différentes donnerait n'importe
quoi. Si tu veux garder l'ancienne en archive : **Session → Exporter**
avant de mettre à jour.

## 2. Lancer

```powershell
npm run tour
```

Puis ouvrir dans Vivaldi (ou Chrome) :

```
http://localhost:5173/?pop=96&workers=11
```

Ce sont les deux seuls réglages qui comptent vraiment.

| paramètre | défaut | à mettre | pourquoi |
|---|---|---|---|
| `pop` | 32 | **96** | la vraie contrainte du projet |
| `workers` | cœurs − 1 | **11** | 12 fils, on en garde un pour l'affichage |
| `seeds` | 4 | 4 | mesuré comme optimal, ne pas y toucher |

Le panneau **Ascensions** affiche `11 ascensions en parallèle · population 96
par génération` : c'est la confirmation que les paramètres ont été pris.

### Pourquoi monter la population, et pas autre chose

L'audit a mesuré la contrainte : le génome d'une équipe fait **~21 900
paramètres** pour une population de 32, soit près de 700 paramètres par
individu évalué. Un algorithme génétique explore correctement quelques
centaines de paramètres à cette taille de population — au-delà, chaque
génération ne teste qu'une fraction infime de l'espace.

Ce n'est donc pas la vitesse par run qui bride le projet. Tripler la
vitesse donnerait le même plafond, plus vite. C'est le **nombre d'équipes
par génération** qui manque.

Contrepartie honnête : à `pop=96`, une génération prend trois fois plus
longtemps. Tu verras le compteur avancer plus lentement, mais chaque
génération vaudra davantage. Sur une nuit, c'est gagnant.

Au-delà de 128, l'intérêt retombe : les élites et les immigrants suivent la
population (12,5 % et 6 %), et le goulot redevient le temps de calcul.

## 3. Le laisser tourner la nuit

**Garder l'onglet au premier plan.** Les navigateurs brident violemment les
onglets en arrière-plan — jusqu'à un `requestAnimationFrame` par seconde.
Les Web Workers continuent, mais la boucle qui distribue le travail, non.
Une deuxième fenêtre sur un autre écran, ou simplement l'onglet actif et
la fenêtre réduite, suffisent.

**Empêcher la mise en veille** :

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

(à remettre à `20` et `10` ensuite si tu veux retrouver le comportement
normal)

**Réduire la charge d'affichage** : le bouton **Pions / Capsules / Deluxe**
bascule le niveau de détail. En **Capsules**, le rendu coûte presque rien.
Ça ne change RIEN à la vitesse d'apprentissage — l'évolution tourne dans
les workers, sur d'autres cœurs — mais ça laisse le processeur plus
tranquille.

**La sauvegarde est automatique** toutes les 10 générations, à la mise en
pause et à la fermeture de l'onglet. Rien à faire.

## 4. Le lendemain

Exporter la session : **Session → Exporter**. Le fichier fait plusieurs
mégaoctets et contient l'historique complet plus les cerveaux.

Puis, depuis `D:\dev\PrestoOneGit` :

```powershell
npm run verifier -- C:\chemin\vers\tour-session-genXXXX.json
```

Ce script recalcule dans Node les fitness annoncées par le navigateur.
**L'écart attendu est maintenant `0.00`** — c'était impossible avant que le
moteur soit rendu reproductible entre moteurs JavaScript. Si un écart
apparaît, c'est un vrai signal.

Et pour regarder ce que les agents ont appris :

```powershell
npm run verifier-moteurs      # Node et le navigateur calculent-ils pareil ?
node tour\audit\comportements.mjs   # formation, repos, dash, ressources
```

## 5. Voir ce qui se passe

- **½×** ralentit le rejeu de moitié : à vitesse normale un agent traverse
  le plateau en 5 secondes, c'est trop rapide pour lire les gestes.
- **Vidéo** enregistre l'ascension affichée en 60 images/s garanties. La
  capture se fait image par image, donc la vidéo est fluide même si la
  machine peine. Une ascension de 30 étages fait plusieurs minutes ; le
  bouton affiche l'avancement et permet d'arrêter quand tu veux.
- **Rapport** montre, pour chaque agent, l'ordre exact de ses choix au
  draft — c'est là qu'on voit ce que le réseau priorise.
- La **courbe de progression** est cliquable : n'importe quelle génération
  archivée se rejoue d'un clic.

## 6. Ce qu'il faut s'attendre à voir

D'après les mesures faites jusqu'ici, sur une population de 32 :

- les 30 premières générations restent brouillonnes ;
- vers la centaine, une méta se forme et se fige ;
- le regroupement de l'équipe met **des milliers** de générations à
  apparaître — à 30 générations, un champion est aussi dispersé qu'une
  équipe tirée au hasard ;
- l'économie des repos, elle, s'apprend en quelques dizaines de
  générations (de 89 % à 51 % de PV au moment de se reposer).

Avec `pop=96`, tout cela devrait arriver en moins de générations — mais
chaque génération coûtant trois fois plus, le temps de mur sera comparable.
Ce qui change, c'est le plafond atteignable.
