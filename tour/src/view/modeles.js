// Chargement des modèles 3D externes (.glb).
//
// Principe : le jeu tourne SANS aucun modèle. Les pions tournés de
// `tower3d.js` restent la solution par défaut, et chaque `.glb` déposé
// vient remplacer l'un d'eux, un par un. Rien ne casse si un fichier
// manque, et on peut avancer classe par classe.
//
// UN SEUL DOSSIER, PLAT : `tour/modeles/`. Pas de sous-dossiers à tenir,
// pas de manifeste à écrire. Le NOM DU FICHIER est l'identifiant, et le
// chargeur devine tout seul s'il s'agit d'un héros ou d'un monstre en le
// comparant au catalogue de `data.js`.
//
//   tour/modeles/gobelin.glb      → monstre « gobelin »
//   tour/modeles/Chevalier.GLB    → héros « chevalier »
//   tour/modeles/chauve-souris.glb → monstre « chauve_souris »
//
// Les noms sont normalisés avant comparaison : casse, accents, tirets,
// espaces et suffixes numériques sont ignorés. Un fichier dont le nom ne
// correspond à rien est signalé une fois dans la console et ignoré.
//
// Contraintes de modélisation :
//   — Y vers le haut, origine AUX PIEDS, face au +Z ;
//   — pas d'armature (les monstres ne sont pas animés, et le geste
//     d'attaque des héros est piloté par le code) ;
//   — la hauteur exacte n'a pas d'importance : le modèle est remis à
//     l'échelle d'après `data.js`.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { CLASSES, MONSTERS, SUMMONS } from '../sim/data.js'

// Vite résout ce motif à la compilation : aucun fichier n'est cherché à
// l'aveugle, donc aucune 404 dans la console.
const FICHIERS = import.meta.glob('../../modeles/*.glb', { query: '?url', import: 'default' })

const cache = new Map() // id → THREE.Object3D servant de patron
let charge = false

export const HAUTEUR_HEROS = 1.18
export const hauteurMonstre = (size) => size * 1.2

// « Chauve-Souris (1).glb » → « chauve_souris »
function normaliser(nom) {
  return nom
    .replace(/\.glb$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, '') // « (1) » ajouté par les téléchargements
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

const HEROS = new Set(CLASSES.map((c) => c.id))
const MONSTRES = new Set([...Object.keys(MONSTERS), ...Object.keys(SUMMONS)])

// Héros ou monstre ? Le catalogue tranche, pas l'arborescence.
function familleDe(id) {
  if (HEROS.has(id)) return 'heros'
  if (MONSTRES.has(id)) return 'monstres'
  return null
}

function ajusterEchelle(objet, hauteurCible) {
  const boite = new THREE.Box3().setFromObject(objet)
  const taille = new THREE.Vector3()
  boite.getSize(taille)
  if (taille.y > 1e-6) objet.scale.multiplyScalar(hauteurCible / taille.y)
  const apres = new THREE.Box3().setFromObject(objet)
  objet.position.y -= apres.min.y // base plaquée au sol
  return objet
}

export async function chargerModeles() {
  if (charge) return cache
  charge = true
  const inconnus = []
  const jobs = []
  const loader = new GLTFLoader()

  for (const [chemin, resoudre] of Object.entries(FICHIERS)) {
    const id = normaliser(chemin.split('/').pop())
    if (!familleDe(id)) { inconnus.push(chemin.split('/').pop()); continue }
    jobs.push(
      resoudre()
        .then((url) => loader.loadAsync(url))
        .then((gltf) => {
          const racine = gltf.scene
          racine.traverse((o) => {
            if (!o.isMesh) return
            o.castShadow = true
            o.receiveShadow = true
            // Le look du jeu est facetté : on le force même si le modèle
            // est arrivé lissé.
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            for (const m of mats) {
              if (!m) continue
              m.flatShading = true
              m.needsUpdate = true
            }
          })
          cache.set(id, racine)
        })
        .catch((err) => console.warn(`[modeles] ${id} illisible :`, err.message))
    )
  }
  await Promise.all(jobs)
  if (inconnus.length) {
    console.warn(
      `[modeles] ${inconnus.length} fichier(s) au nom non reconnu, ignoré(s) : ${inconnus.join(', ')}\n` +
        `Noms attendus : ${[...HEROS, ...MONSTRES].join(', ')}`
    )
  }
  return cache
}

// Un exemplaire prêt à poser dans la scène, ou null si aucun modèle n'a
// été fourni pour cet identifiant. L'appelant retombe alors sur le pion.
export function instancier(famille, id, hauteurCible) {
  const patron = cache.get(id)
  if (!patron || familleDe(id) !== famille) return null
  const copie = patron.clone(true)
  // Matériaux clonés : le moteur teinte les entités individuellement
  // (gelé, en feu, électrifié), deux monstres du même type ne peuvent donc
  // pas partager le leur.
  copie.traverse((o) => {
    if (!o.isMesh) return
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone()
  })
  const pivot = new THREE.Group()
  pivot.add(ajusterEchelle(copie, hauteurCible))
  return pivot
}

export function nombreDeModeles() {
  return cache.size
}

export function modelesCharges() {
  return [...cache.keys()]
}
