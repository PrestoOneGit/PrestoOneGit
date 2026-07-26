# Installation des dependances des trois projets (Windows, PowerShell).
#
# Utilisation, depuis le dossier du depot :
#   .\install.ps1
#
# Si PowerShell refuse d'executer le script, autoriser les scripts locaux
# pour cette session uniquement (aucune modification permanente) :
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host 'Installation des simulations' -ForegroundColor Cyan
Write-Host ('-' * 40)

# --- Verification de Node ---
try {
    $nodeVersion = (node --version).TrimStart('v')
} catch {
    Write-Host 'Node.js est introuvable.' -ForegroundColor Red
    Write-Host 'Installer la version LTS depuis https://nodejs.org puis rouvrir le terminal.'
    exit 1
}

$major = [int]($nodeVersion.Split('.')[0])
$minor = [int]($nodeVersion.Split('.')[1])
$ok = ($major -gt 22) -or ($major -eq 22 -and $minor -ge 12) -or ($major -eq 20 -and $minor -ge 19) -or ($major -eq 21)

if (-not $ok) {
    Write-Host "Node $nodeVersion est trop ancien." -ForegroundColor Red
    Write-Host 'Vite 7 demande Node 20.19+ ou 22.12+. Installer la LTS depuis https://nodejs.org'
    exit 1
}
Write-Host "Node $nodeVersion" -ForegroundColor Green

# --- Installation projet par projet ---
foreach ($projet in @('tour', 'arene', 'vallon')) {
    Write-Host ''
    Write-Host "Installation de $projet..." -ForegroundColor Yellow
    npm --prefix $projet install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Echec de l'installation de $projet." -ForegroundColor Red
        exit 1
    }
}

Write-Host ''
Write-Host ('-' * 40)
Write-Host 'Installation terminee.' -ForegroundColor Green
Write-Host ''
Write-Host 'Commandes disponibles :'
Write-Host '  npm run tour           lance La Tour       (http://localhost:5173)'
Write-Host '  npm run arene          lance L''Arene'
Write-Host '  npm run vallon         lance Vallon'
Write-Host '  npm run audit:rapide   verifie l''apprentissage (~1 min)'
Write-Host '  npm run audit          suite complete 12/12    (~5 min)'
Write-Host '  npm run build          fabrique le fichier autonome'
Write-Host ''
Write-Host 'Ouvrir les pages dans Chrome (Web Workers et WebGPU y sont les plus rapides).'
Write-Host ''
