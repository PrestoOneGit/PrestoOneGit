// Le terrain d'un étage : plateau carré, murs, portails et pièges.
//
// Les murs vivent dans une grille d'occupation d'une cellule par unité de
// monde. Deux règles en découlent, et ce sont elles qui donnent aux murs
// un intérêt tactique plutôt que décoratif :
//   — ils bloquent le déplacement ;
//   — ils bloquent la LIGNE DE VUE, donc les projectiles et le ciblage.
// Sans la seconde, un couloir ne vaut pas mieux qu'un terrain vide.

import { RAY_DIRS, TURNS, len2 } from './exact.js'

export const BOARD = 32 // côté du plateau, en unités de monde
export const HALF = BOARD / 2
export const CELL = 1 // taille d'une cellule de la grille

export const ARCHETYPES = ['ouvert', 'colonnade', 'couloirs', 'chambres']

// Pièges. `visible: false` = l'agent ne le voit pas dans ses observations ;
// il ne peut l'éviter qu'en ayant appris où ils se cachent d'ordinaire.
export const TRAPS = {
  pointes: { label: 'Fosse à pointes', damage: 26, radius: 1.1, rearm: 6, visible: true },
  goudron: { label: 'Goudron', applies: { slow: 2.5 }, radius: 1.6, rearm: 0, visible: true },
  rune: { label: 'Rune arcanique', applies: { stun: 1.1 }, radius: 1.2, rearm: 8, visible: false },
  brasero: { label: 'Brasero brisé', applies: { burn: 3 }, damage: 8, radius: 1.3, rearm: 4, visible: false },
}

export class Terrain {
  constructor(rng, floor) {
    this.rng = rng
    this.floor = floor
    this.size = BOARD
    this.grid = new Uint8Array(BOARD * BOARD) // 1 = mur permanent
    this.temp = new Map() // murs temporaires posés par le Chevalier : clé cellule → timer
    this.archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)]
    this.portals = []
    this.traps = []

    this.buildWalls()
    this.buildPortals()
    this.buildTraps()
  }

  // ---- Conversions monde ↔ grille ----

  cellOf(x, z) {
    const cx = Math.floor((x + HALF) / CELL)
    const cz = Math.floor((z + HALF) / CELL)
    return cx < 0 || cz < 0 || cx >= BOARD || cz >= BOARD ? -1 : cz * BOARD + cx
  }

  centerOf(cell) {
    const cx = cell % BOARD
    const cz = Math.floor(cell / BOARD)
    return [cx * CELL - HALF + CELL / 2, cz * CELL - HALF + CELL / 2]
  }

  setWall(cx, cz) {
    if (cx < 1 || cz < 1 || cx >= BOARD - 1 || cz >= BOARD - 1) return
    this.grid[cz * BOARD + cx] = 1
  }

  isWall(x, z) {
    const c = this.cellOf(x, z)
    if (c < 0) return true // hors plateau : traité comme un mur
    return this.grid[c] === 1 || this.temp.has(c)
  }

  // ---- Génération des murs ----

  buildWalls() {
    const rng = this.rng
    // Bordure pleine : le plateau est une salle close, on n'en sort pas.
    for (let i = 0; i < BOARD; i++) {
      this.grid[i] = 1
      this.grid[(BOARD - 1) * BOARD + i] = 1
      this.grid[i * BOARD] = 1
      this.grid[i * BOARD + BOARD - 1] = 1
    }

    switch (this.archetype) {
      case 'colonnade': {
        // Piliers réguliers : du couvert partout, aucune ligne longue.
        const step = 5
        for (let cz = 4; cz < BOARD - 4; cz += step) {
          for (let cx = 4; cx < BOARD - 4; cx += step) {
            const jx = Math.floor(rng() * 2)
            const jz = Math.floor(rng() * 2)
            this.setWall(cx + jx, cz + jz)
            this.setWall(cx + jx + 1, cz + jz + 1)
          }
        }
        break
      }
      case 'couloirs': {
        // Longs murs percés d'une ouverture : des goulots à tenir.
        // Deux barres suffisent : à trois, les agents se retrouvaient
        // cloisonnés dans des poches dont la sortie était hors de portée
        // de leurs capteurs.
        const bars = 2 + Math.floor(rng() * 2)
        for (let b = 0; b < bars; b++) {
          const horizontal = rng() < 0.5
          const at = 6 + Math.floor(rng() * (BOARD - 12))
          const gap = 4 + Math.floor(rng() * (BOARD - 12))
          const gapWidth = 6
          for (let i = 3; i < BOARD - 3; i++) {
            if (i >= gap && i < gap + gapWidth) continue
            horizontal ? this.setWall(i, at) : this.setWall(at, i)
          }
        }
        break
      }
      case 'chambres': {
        // Une croix de murs percée de portes : quatre pièces reliées.
        const mx = Math.floor(BOARD / 2) + Math.floor(rng() * 5) - 2
        const mz = Math.floor(BOARD / 2) + Math.floor(rng() * 5) - 2
        const doors = [
          4 + Math.floor(rng() * 6),
          BOARD - 10 + Math.floor(rng() * 6),
        ]
        for (let i = 2; i < BOARD - 2; i++) {
          if (!doors.some((d) => i >= d && i < d + 3)) {
            this.setWall(i, mz)
            this.setWall(mx, i)
          }
        }
        break
      }
      default: {
        // Salle ouverte : quelques blocs épars, juste de quoi casser les
        // lignes de tir sans jamais enfermer.
        const blocks = 5 + Math.floor(rng() * 5)
        for (let b = 0; b < blocks; b++) {
          const cx = 5 + Math.floor(rng() * (BOARD - 10))
          const cz = 5 + Math.floor(rng() * (BOARD - 10))
          const w = 1 + Math.floor(rng() * 3)
          const h = 1 + Math.floor(rng() * 3)
          for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) this.setWall(cx + i, cz + j)
        }
      }
    }

    // Le centre reste toujours dégagé : c'est là que l'équipe démarre.
    for (let cz = BOARD / 2 - 3; cz < BOARD / 2 + 3; cz++) {
      for (let cx = BOARD / 2 - 3; cx < BOARD / 2 + 3; cx++) {
        this.grid[cz * BOARD + cx] = 0
      }
    }
  }

  // ---- Portails ----

  buildPortals() {
    const rng = this.rng
    const count = 2 + Math.floor(rng() * 3) // 2 à 4
    // Mélange de Fisher-Yates. Surtout PAS `sort(() => rng() - 0.5)` : ce
    // comparateur n'est pas un ordre total, donc la norme laisse le résultat
    // à l'implémentation — et il consomme un nombre d'appels au générateur
    // qui dépend de l'algorithme de tri, ce qui décale tout le flux aléatoire
    // en aval. C'était la dernière source de divergence entre moteurs.
    const sides = [0, 1, 2, 3]
    for (let i = sides.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const t = sides[i]
      sides[i] = sides[j]
      sides[j] = t
    }
    sides.length = count
    for (const side of sides) {
      const along = 5 + rng() * (BOARD - 10)
      let x
      let z
      if (side === 0) {
        x = along - HALF
        z = -HALF + 1.6
      } else if (side === 1) {
        x = along - HALF
        z = HALF - 1.6
      } else if (side === 2) {
        x = -HALF + 1.6
        z = along - HALF
      } else {
        x = HALF - 1.6
        z = along - HALF
      }
      // On dégage la case du portail et son voisinage immédiat, sinon un
      // mur généré au même endroit l'obstruerait.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const c = this.cellOf(x + dx, z + dz)
          if (c >= 0) this.grid[c] = 0
        }
      }
      this.portals.push({
        id: this.portals.length,
        x,
        z,
        side,
        sealed: 0, // durée de scellement restante (Occultiste)
        cadence: 2.3 + rng() * 1.2,
        timer: 0.5 + rng() * 1.5,
        remaining: 0, // budget de monstres restant à cracher
      })
    }
  }

  // ---- Pièges ----

  buildTraps() {
    const rng = this.rng
    const types = Object.keys(TRAPS)
    const count = 3 + Math.floor(rng() * 4)
    let guard = 0
    while (this.traps.length < count && guard++ < 200) {
      const x = (rng() - 0.5) * (BOARD - 8)
      const z = (rng() - 0.5) * (BOARD - 8)
      if (this.isWall(x, z)) continue
      if (len2(x, z) < 5) continue // pas sur la zone de départ
      const type = types[Math.floor(rng() * types.length)]
      this.traps.push({
        id: this.traps.length,
        x,
        z,
        type,
        stats: TRAPS[type],
        armed: 0, // > 0 : en cours de rechargement
        triggered: false,
      })
    }
  }

  // ---- Ligne de vue ----
  // Bresenham sur la grille. Utilisé pour les projectiles et le ciblage :
  // on ne tire pas à travers un mur.

  hasLineOfSight(x0, z0, x1, z1) {
    let cx = Math.floor((x0 + HALF) / CELL)
    let cz = Math.floor((z0 + HALF) / CELL)
    const tx = Math.floor((x1 + HALF) / CELL)
    const tz = Math.floor((z1 + HALF) / CELL)
    const dx = Math.abs(tx - cx)
    const dz = Math.abs(tz - cz)
    const sx = cx < tx ? 1 : -1
    const sz = cz < tz ? 1 : -1
    let err = dx - dz
    let guard = 0
    while (guard++ < BOARD * 3) {
      if (cx === tx && cz === tz) return true
      if (cx < 0 || cz < 0 || cx >= BOARD || cz >= BOARD) return false
      // La case de départ ne bloque jamais : un agent collé à un mur doit
      // pouvoir tirer.
      if (guard > 1 && this.grid[cz * BOARD + cx] === 1) return false
      const e2 = 2 * err
      if (e2 > -dz) {
        err -= dz
        cx += sx
      }
      if (e2 < dx) {
        err += dx
        cz += sz
      }
    }
    return false
  }

  // ---- Déplacement ----
  // Glissement le long des murs : un agent qui pousse en diagonale contre
  // une paroi longe la paroi au lieu de se bloquer net. Sans ça les
  // réseaux passent leur temps coincés dans les coins.

  move(entity, dx, dz, radius = 0.35) {
    if (!this.blocked(entity.x + dx, entity.z + dz, radius)) {
      entity.x += dx
      entity.z += dz
      return true
    }
    // Contournement : on fait pivoter le vecteur demandé jusqu'à trouver un
    // passage. C'est de la mécanique de déplacement, pas de la décision —
    // l'agent choisit toujours OÙ aller, le corps se débrouille pour longer
    // l'obstacle. Sans ça, un agent poussant vers un coin concave y reste
    // coincé, ce qu'un simple glissement sur les deux axes ne résout pas.
    //
    // La déviation plafonne à un quart de tour. Au-delà, ce n'est plus
    // longer un mur, c'est faire demi-tour : c'était la cause du
    // tremblement (52 % des pas contre un mur repartaient à plus de 90°).
    //
    // Aucune trigonométrie ici : les couples (cos, sin) sont des constantes
    // et la rotation n'est que quatre multiplications — donc identique d'un
    // moteur JavaScript à l'autre, ce que `Math.cos` ne garantit pas.
    if (dx * dx + dz * dz < 1e-12) return false
    for (const [, c, s] of TURNS) {
      const nx = entity.x + (dx * c - dz * s)
      const nz = entity.z + (dx * s + dz * c)
      if (!this.blocked(nx, nz, radius)) {
        entity.x = nx
        entity.z = nz
        return true
      }
    }
    return false
  }

  blocked(x, z, radius) {
    return (
      this.isWall(x + radius, z) ||
      this.isWall(x - radius, z) ||
      this.isWall(x, z + radius) ||
      this.isWall(x, z - radius)
    )
  }

  // Un point libre au hasard, pour poser une entité sans la coincer.
  freePoint(rng, minDistFromCenter = 0) {
    for (let i = 0; i < 120; i++) {
      const x = (rng() - 0.5) * (BOARD - 6)
      const z = (rng() - 0.5) * (BOARD - 6)
      if (this.blocked(x, z, 0.5)) continue
      if (len2(x, z) < minDistFromCenter) continue
      return [x, z]
    }
    return [0, 0]
  }

  // ---- Murs temporaires (Mur de garde du Chevalier) ----

  addTempWall(x, z, duration) {
    const c = this.cellOf(x, z)
    if (c < 0 || this.grid[c] === 1) return false
    this.temp.set(c, duration)
    return true
  }

  // ---- Capteurs de distance aux murs ----
  // Six rayons autour de l'agent : c'est ainsi que le réseau « voit » le
  // terrain, sans qu'on lui donne la carte entière.

  wallSensors(x, z, out, maxDist = 8) {
    const RAYS = out.length
    for (let r = 0; r < RAYS; r++) {
      // Directions constantes, tabulées : voir exact.js.
      const [cos, sin] = RAY_DIRS[r]
      let d = 0.5
      while (d < maxDist) {
        if (this.isWall(x + cos * d, z + sin * d)) break
        d += 0.6
      }
      out[r] = Math.min(d / maxDist, 1)
    }
    return out
  }

  update(dt) {
    for (const [cell, t] of this.temp) {
      const left = t - dt
      left <= 0 ? this.temp.delete(cell) : this.temp.set(cell, left)
    }
    for (const trap of this.traps) if (trap.armed > 0) trap.armed -= dt
    for (const p of this.portals) if (p.sealed > 0) p.sealed -= dt
  }
}
