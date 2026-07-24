#!/usr/bin/env bash
# Installation des dépendances des trois projets (Linux / macOS).
#
# Utilisation, depuis le dossier du dépôt :
#   bash install.sh

set -euo pipefail

echo
echo "Installation des simulations"
echo "----------------------------------------"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est introuvable."
  echo "Installer la version LTS depuis https://nodejs.org puis rouvrir le terminal."
  exit 1
fi

node_version="$(node --version)"
node_version="${node_version#v}"
major="${node_version%%.*}"
rest="${node_version#*.}"
minor="${rest%%.*}"

if ! { [ "$major" -gt 22 ] \
    || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; } \
    || [ "$major" -eq 21 ] \
    || { [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; }; }; then
  echo "Node $node_version est trop ancien."
  echo "Vite 7 demande Node 20.19+ ou 22.12+."
  exit 1
fi
echo "Node $node_version"

for projet in tour arene vallon; do
  echo
  echo "Installation de $projet..."
  npm --prefix "$projet" install --no-fund --no-audit
done

echo
echo "----------------------------------------"
echo "Installation terminée."
echo
echo "Commandes disponibles :"
echo "  npm run tour           lance La Tour       (http://localhost:5173)"
echo "  npm run arene          lance L'Arène"
echo "  npm run vallon         lance Vallon"
echo "  npm run audit:rapide   vérifie l'apprentissage (~1 min)"
echo "  npm run audit          suite complète 12/12    (~5 min)"
echo "  npm run build          fabrique le fichier autonome"
echo
echo "Ouvrir les pages dans Chrome (Web Workers et WebGPU y sont les plus rapides)."
echo
