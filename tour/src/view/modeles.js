// Chargement des modèles 3D externes (.glb).
//
// Principe : le jeu tourne SANS aucun modèle. Les pions tournés de
// `tower3d.js` restent la solution par défaut, et chaque `.glb` déposé
// vient remplacer l'un d'eux, un par un. Rien ne casse si un fichier
// manque, et on peut avancer classe par classe.
//
// Où déposer les fichiers :
//
//   tour/public/modeles/heros/chevalier.glb
//   tour/public/modeles/monstres/gobelin.glb
//
// et déclarer le nom dans `tour/public/modeles/manifeste.json`. Le
// manifeste évite d'aller chercher 23 fichiers dont la plupart n'existent
// pas encore — sans lui, la console se remplirait de 404 à chaque
// démarrage.
//
// Contraintes de modélisation :
//   — Y vers le haut, origine AUX PIEDS, face au +Z ;
//   — pas d'armature (les monstres ne sont pas animés, et le geste
//     d'attaque des héros est piloté par le code) ;
//   — la hauteur exacte n'a pas d'importance : le modèle est remis à
//     l'échelle d'après `data.js`.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const BASE = 'modeles'
const cache = new Map() // id → THREE.Object3D servant de patron
let charge = false

// Hauteur cible dans le monde du jeu. Un pion de héros mesure 1,18 ; les
// monstres sont dimensionnés par leur champ `size` dans data.js, à raison
// d'environ 1,2 unité de hauteur par unité de taille.
export const HAUTEUR_HEROS = 1.18
export const hauteurMonstre = (size) => size * 1.2

// Ramène le modèle à la hauteur voulue et pose son origine au sol, quelle
// que soit l'échelle à laquelle il a été exporté.
function normaliser(objet, hauteurCible) {
  const boite = new THREE.Box3().setFromObject(objet)
  const taille = new THREE.Vector3()
  boite.getSize(taille)
  if (taille.y > 1e-6) {
    const k = hauteurCible / taille.y
    objet.scale.multiplyScalar(k)
  }
  // Recalcul après mise à l'échelle : on plaque la base sur y = 0.
  const apres = new THREE.Box3().setFromObject(objet)
  objet.position.y -= apres.min.y
  return objet
}

// Charge tout ce que le manifeste déclare. Appelé une fois au démarrage ;
// l'absence de manifeste est le cas NORMAL au début du projet, pas une
// erreur — on repart alors sur les pions procéduraux.
export async function chargerModeles() {
  if (charge) return cache
  charge = true
  let manifeste
  try {
    const rep = await fetch(`${BASE}/manifeste.json`)
    if (!rep.ok) return cache
    manifeste = await rep.json()
  } catch {
    return cache
  }

  const loader = new GLTFLoader()
  const jobs = []
  for (const [famille, ids] of Object.entries(manifeste)) {
    if (!Array.isArray(ids)) continue
    for (const id of ids) {
      jobs.push(
        loader
          .loadAsync(`${BASE}/${famille}/${id}.glb`)
          .then((gltf) => {
            const racine = gltf.scene
            racine.traverse((o) => {
              if (!o.isMesh) return
              o.castShadow = true
              o.receiveShadow = true
              // Le look du jeu est facetté : on force le flat shading même
              // si le modèle est arrivé lissé.
              const mats = Array.isArray(o.material) ? o.material : [o.material]
              for (const m of mats) {
                if (!m) continue
                m.flatShading = true
                m.needsUpdate = true
              }
            })
            cache.set(`${famille}/${id}`, racine)
          })
          .catch((err) => {
            console.warn(`[modeles] ${famille}/${id}.glb introuvable ou illisible :`, err.message)
          })
      )
    }
  }
  await Promise.all(jobs)
  return cache
}

// Un exemplaire prêt à poser dans la scène, ou null si aucun modèle n'a
// été fourni pour cet identifiant. L'appelant retombe alors sur le pion.
export function instancier(famille, id, hauteurCible) {
  const patron = cache.get(`${famille}/${id}`)
  if (!patron) return null
  const copie = patron.clone(true)
  // Les matériaux sont clonés eux aussi : le moteur teinte les entités
  // individuellement (gelé, en feu, électrifié), donc deux monstres du
  // même type ne peuvent pas partager le leur.
  copie.traverse((o) => {
    if (!o.isMesh) return
    o.material = Array.isArray(o.material)
      ? o.material.map((m) => m.clone())
      : o.material.clone()
  })
  const pivot = new THREE.Group()
  pivot.add(normaliser(copie, hauteurCible))
  return pivot
}

export function modeleDisponible(famille, id) {
  return cache.has(`${famille}/${id}`)
}

export function nombreDeModeles() {
  return cache.size
}
