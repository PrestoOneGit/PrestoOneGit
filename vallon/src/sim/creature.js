import * as THREE from 'three'
import { WATER_LEVEL } from '../world/world.js'

export const STATES = {
  WANDER: 'se promène',
  SEEK_FOOD: 'cherche à manger',
  EAT: 'grignote des baies',
  SEEK_WATER: 'cherche à boire',
  DRINK: 'boit au bord de l’eau',
  SLEEP: 'dort',
  DEAD: 'a disparu',
}

const NAMES = [
  'Poum', 'Nima', 'Falo', 'Brindille', 'Ondine', 'Cachou', 'Mirtil', 'Sylve',
  'Pommelle', 'Grelot', 'Tourbe', 'Lichen', 'Noisette', 'Braise', 'Muscade',
  'Plume', 'Galet', 'Sorbet', 'Frimousse', 'Ronce', 'Pivoine', 'Tilleul',
  'Fenouil', 'Bruine', 'Cannelle', 'Osier', 'Mousse', 'Perlin', 'Sauge', 'Bulbe',
]

const BODY_HUES = [0.05, 0.09, 0.55, 0.62, 0.78, 0.32, 0.13]

const ADULT_AGE = 2.5 // en jours
const bodyGeo = new THREE.IcosahedronGeometry(0.55, 0)
const eyeGeo = new THREE.SphereGeometry(0.09, 6, 6)
const earGeo = new THREE.ConeGeometry(0.14, 0.4, 4)
const eyeMat = new THREE.MeshStandardMaterial({ color: '#2c2a24', roughness: 0.4 })

let nextId = 1

export class Creature {
  constructor(world, rng, position, ageDays = ADULT_AGE + rng() * 4) {
    this.id = nextId++
    this.name = NAMES[Math.floor(rng() * NAMES.length)]
    this.rng = rng
    this.ageDays = ageDays
    this.lifespanDays = 13 + rng() * 8
    this.state = STATES.WANDER
    this.faim = rng() * 30
    this.soif = rng() * 30
    this.energie = 70 + rng() * 30
    this.speed = 3.0 + rng() * 0.8
    this.reproCooldown = 20 + rng() * 20
    this.actionTimer = 0
    this.deathTimer = 0
    this.target = null
    this.targetBush = null
    this.wobble = rng() * Math.PI * 2

    const hue = BODY_HUES[Math.floor(rng() * BODY_HUES.length)] + (rng() - 0.5) * 0.04
    const color = new THREE.Color().setHSL(hue, 0.38, 0.62)
    this.bodyMat = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.85,
    })

    this.mesh = new THREE.Group()
    const body = new THREE.Mesh(bodyGeo, this.bodyMat)
    body.scale.set(1, 1.15, 1)
    body.castShadow = true
    this.mesh.add(body)

    const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
    eyeL.position.set(0.2, 0.22, 0.42)
    const eyeR = eyeL.clone()
    eyeR.position.x = -0.2
    this.mesh.add(eyeL, eyeR)

    const earL = new THREE.Mesh(earGeo, this.bodyMat)
    earL.position.set(0.24, 0.62, 0)
    earL.rotation.z = -0.25
    const earR = earL.clone()
    earR.position.x = -0.24
    earR.rotation.z = 0.25
    this.mesh.add(earL, earR)

    this.mesh.position.copy(position)
    // Les enfants du raycaster remontent jusqu'à la créature via userData.
    this.mesh.traverse((o) => (o.userData.creature = this))
  }

  get isAdult() {
    return this.ageDays >= ADULT_AGE
  }

  get isDead() {
    return this.state === STATES.DEAD
  }

  scaleForAge() {
    return 0.45 + 0.55 * Math.min(this.ageDays / ADULT_AGE, 1)
  }

  die() {
    this.state = STATES.DEAD
    this.deathTimer = 5
    this.bodyMat.transparent = true
  }

  pickWanderTarget(world) {
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2
      const r = 5 + this.rng() * 14
      const x = this.mesh.position.x + Math.cos(a) * r
      const z = this.mesh.position.z + Math.sin(a) * r
      const h = world.heightAt(x, z)
      if (h > WATER_LEVEL + 0.35 && h < 7.5) {
        this.target = new THREE.Vector3(x, h, z)
        return
      }
    }
    this.target = null
  }

  moveToward(target, dt, world) {
    const dx = target.x - this.mesh.position.x
    const dz = target.z - this.mesh.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.6) return true
    const speed = this.speed * (this.isAdult ? 1 : 0.65)
    const step = Math.min((speed * dt) / dist, 1)
    const nx = this.mesh.position.x + dx * step
    const nz = this.mesh.position.z + dz * step
    this.mesh.position.set(nx, world.heightAt(nx, nz), nz)
    this.mesh.rotation.y = Math.atan2(dx, dz)
    return false
  }

  update(dt, world, sim) {
    if (this.isDead) {
      this.deathTimer -= dt
      this.mesh.rotation.z = Math.min(this.mesh.rotation.z + dt * 3, Math.PI / 2)
      this.bodyMat.opacity = Math.max(this.deathTimer / 5, 0)
      return this.deathTimer <= 0 ? 'remove' : null
    }

    this.ageDays += dt / sim.daySeconds
    this.reproCooldown -= dt

    const activityCost = this.state === STATES.SLEEP ? 0 : 1
    this.faim = Math.min(this.faim + dt * 1.15 * activityCost + dt * 0.25, 100)
    this.soif = Math.min(this.soif + dt * 1.45 * activityCost + dt * 0.3, 100)
    if (this.state === STATES.SLEEP) {
      this.energie = Math.min(this.energie + dt * 6, 100)
    } else {
      this.energie = Math.max(this.energie - dt * 0.9, 0)
    }

    if (this.faim >= 100 || this.soif >= 100 || this.ageDays > this.lifespanDays) {
      this.die()
      return 'died'
    }

    const scale = this.scaleForAge()
    this.mesh.scale.setScalar(scale)

    switch (this.state) {
      case STATES.SLEEP: {
        this.mesh.position.y =
          world.heightAt(this.mesh.position.x, this.mesh.position.z) + 0.35 * scale
        if ((this.energie > 96 && !sim.isNight) || this.soif > 88 || this.faim > 88) {
          this.state = STATES.WANDER
        }
        return null
      }

      case STATES.EAT: {
        this.actionTimer -= dt
        if (this.actionTimer <= 0) {
          if (this.targetBush && this.targetBush.berries > 0) {
            this.targetBush.berries--
            world.syncBerries(this.targetBush)
            this.faim = Math.max(this.faim - 42, 0)
          }
          this.targetBush = null
          this.state = STATES.WANDER
        }
        break
      }

      case STATES.DRINK: {
        this.actionTimer -= dt
        if (this.actionTimer <= 0) {
          this.soif = 0
          this.state = STATES.WANDER
        }
        break
      }

      case STATES.SEEK_WATER: {
        if (!this.target) {
          this.state = STATES.WANDER
          break
        }
        if (this.moveToward(this.target, dt, world)) {
          this.state = STATES.DRINK
          this.actionTimer = 2.2
          this.target = null
        }
        break
      }

      case STATES.SEEK_FOOD: {
        if (!this.targetBush || this.targetBush.berries <= 0) {
          this.targetBush = world.nearestBushWithBerries(this.mesh.position)
          if (!this.targetBush) {
            this.state = STATES.WANDER
            break
          }
        }
        if (this.moveToward(this.targetBush.position, dt, world)) {
          this.state = STATES.EAT
          this.actionTimer = 1.8
        }
        break
      }

      default: {
        // Priorités : dormir la nuit, boire, manger, sinon flâner.
        if (sim.isNight && this.energie < 55) {
          this.state = STATES.SLEEP
          this.target = null
          break
        }
        if (this.soif > 55) {
          const shore = world.nearestShore(this.mesh.position)
          if (shore) {
            this.target = shore
            this.state = STATES.SEEK_WATER
            break
          }
        }
        if (this.faim > 55) {
          this.targetBush = world.nearestBushWithBerries(this.mesh.position)
          if (this.targetBush) {
            this.state = STATES.SEEK_FOOD
            break
          }
        }
        if (!this.target) this.pickWanderTarget(world)
        if (this.target && this.moveToward(this.target, dt, world)) {
          this.target = null
        }
        break
      }
    }

    // Petit rebond de marche
    if (this.state !== STATES.SLEEP) {
      this.wobble += dt * 9
      const h = world.heightAt(this.mesh.position.x, this.mesh.position.z)
      this.mesh.position.y = h + 0.62 * scale + Math.abs(Math.sin(this.wobble)) * 0.12 * scale
    }

    // Reproduction : adulte reposé et rassasié
    if (
      this.isAdult &&
      this.reproCooldown <= 0 &&
      this.faim < 45 &&
      this.soif < 45 &&
      this.energie > 45 &&
      sim.creatures.length < sim.maxPopulation &&
      this.rng() < dt * 0.035
    ) {
      this.reproCooldown = 45 + this.rng() * 30
      return 'birth'
    }

    return null
  }
}
