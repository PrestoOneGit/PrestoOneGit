# Démarrage sur ta machine

Guide pour installer les trois simulations en local et pouvoir modifier le
code. Rédigé pour Windows (`D:\dev`), l'équivalent Linux/macOS suit.

## Prérequis

| Outil | Version | Où |
|---|---|---|
| **Node.js** | 22.12+ (LTS) ou 20.19+ | https://nodejs.org — prendre « LTS », installateur `.msi` |
| **Git** | n'importe laquelle | https://git-scm.com/download/win |
| **Chrome** | à jour | Web Workers les plus rapides, et WebGPU pour la suite |

Après l'installation de Node, **rouvrir le terminal** : le `PATH` n'est
rechargé qu'au démarrage d'une nouvelle fenêtre.

## Installation (Windows)

Ouvrir PowerShell et coller :

```powershell
mkdir D:\dev -Force
cd D:\dev
git clone https://github.com/PrestoOneGit/PrestoOneGit.git
cd PrestoOneGit
git checkout claude/life-simulation-3d-lowpoly-zzpad0
npm run setup
```

`npm run setup` installe les dépendances des trois projets (Vite + Three.js,
une quinzaine de paquets chacun, quelques secondes).

Il existe aussi `.\install.ps1`, qui fait la même chose en vérifiant au
passage la version de Node et en affichant les commandes disponibles. Si
PowerShell refuse de l'exécuter :

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

(portée `Process` : valable pour cette fenêtre seulement, rien n'est modifié
durablement sur le système)

## Installation (Linux / macOS)

```bash
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/PrestoOneGit/PrestoOneGit.git
cd PrestoOneGit
git checkout claude/life-simulation-3d-lowpoly-zzpad0
bash install.sh
```

## Lancer

Toutes les commandes se lancent depuis `D:\dev\PrestoOneGit` :

```powershell
npm run tour      # La Tour       → http://localhost:5173
npm run arene     # L'Arène       → http://localhost:5173
npm run vallon    # Vallon        → http://localhost:5173
```

Un seul à la fois sur le port 5173 (`Ctrl+C` pour arrêter). Vite recharge la
page automatiquement à chaque modification du code.

## Mettre à jour

Depuis `D:\dev\PrestoOneGit` :

```powershell
git pull origin claude/life-simulation-3d-lowpoly-zzpad0
npm run tour
```

`npm run setup` n'est à refaire que si les dépendances ont changé — le
`git pull` te le dira en modifiant un `package.json`. Sinon, c'est inutile.

Si `git pull` refuse à cause de modifications locales que tu veux garder :

```powershell
git stash
git pull origin claude/life-simulation-3d-lowpoly-zzpad0
git stash pop
```

**Quand les règles changent, l'ancien entraînement est refusé.** C'est
volontaire : `SAVE_FORMAT` (dans `tour/src/ga/persistence.js`) est
incrémenté à chaque changement de taille de réseau ou de règles, et une
sauvegarde d'un format antérieur est écartée avec un message clair plutôt
que reprise avec des agents devenus incohérents. L'entraînement repart de
zéro, c'est normal. **Exporte ta session avant de mettre à jour** si tu veux
la garder en archive (**Session → Exporter**) — elle ne sera pas
réimportable dans la nouvelle version, mais reste lisible et rejouable avec
la version qui l'a produite.

Si l'ancienne session traîne encore dans le navigateur : **Session →
Effacer**.

Pour un entraînement long, voir [`ENTRAINEMENT.md`](ENTRAINEMENT.md) :
population, workers, veille, et ce qu'il faut s'attendre à observer.

## Vérifier que l'apprentissage est réel

Ces scripts ne demandent **aucune dépendance** — Node seul suffit, ils
tournent même sans avoir fait `npm run setup` :

```powershell
npm run audit:rapide    # ~1 min
npm run audit           # suite complète, 12 tests (~5 min chez toi)
npm run diagnostic      # santé des mutations et héritabilité
```

Les résultats de référence obtenus ici sont dans
`tour/audit/resultats-reference.txt` : tu devrais retrouver les mêmes
verdicts. Un test qui échoue chez toi alors qu'il passe dans ce fichier est
un vrai signal, pas du bruit.

Pour vérifier qu'une session entraînée dans ton navigateur n'est pas
inventée : bouton **Session → Exporter**, puis

```powershell
npm run verifier -- C:\chemin\vers\tour-session-gen200.json
```

Le script recalcule les fitness annoncées dans un processus Node séparé.
L'écart attendu est `0.00`.

## Fabriquer le fichier autonome

```powershell
npm run build
```

Produit `tour\dist-single\index.html` : l'application complète en un seul
fichier, ouvrable par double-clic, partageable tel quel.

## Où modifier quoi

| Envie | Fichier |
|---|---|
| Équilibrage, classes, sorts, monstres, paliers | `tour/src/sim/data.js` |
| Règles de combat, étages, repos, score | `tour/src/sim/engine.js` |
| Taille des réseaux, mutations, croisement | `tour/src/sim/brain.js` |
| Population, élites, graines par évaluation | `tour/src/ga/evolution.js` |
| Modèles 3D, effets, niveaux de détail | `tour/src/view/tower3d.js` |
| Interface, panneaux, rapports | `tour/src/ui/hud.js` |

**Après toute modification des règles ou des réseaux** : relancer
`npm run audit` avant de tirer des conclusions d'un entraînement — c'est ce
qui a évité une location de GPU sur un algorithme qui ne valait pas mieux
qu'un tirage au sort.

Penser aussi à incrémenter `SAVE_FORMAT` dans `tour/src/ga/persistence.js`
si tu changes la taille des réseaux ou les règles : les sauvegardes
existantes seront alors proprement refusées au lieu d'être reprises avec des
agents devenus incohérents.

## Deux pièges à connaître

**Les sauvegardes sont liées à l'adresse de la page.** `localhost:5173`, un
fichier `dist-single` ouvert en local et la version en ligne ont chacun leur
propre stockage IndexedDB. Trois entraînements séparés sans s'en rendre
compte, c'est vite arrivé — utiliser **Session → Exporter / Importer** pour
transporter une session de l'un à l'autre.

**Le port 5173 peut être déjà pris.** Vite passe alors automatiquement au
5174 : lire l'URL affichée dans le terminal plutôt que la taper de mémoire.
