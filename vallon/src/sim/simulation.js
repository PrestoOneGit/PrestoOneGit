import * as THREE from 'three'
import { mulberry32 } from '../core/noise.js'
import { Creature } from './creature.js'

// Orchestration : temps qui passe, cycle jour/nuit, naissances et disparitions.
export class Simulation {
  constructor(world, seed) {
    this.world = world
    this.rng = mulberry32(seed ^ 0x9e3779b9)
    this.creatures = []
    this.group = new THREE.Group()
    this.daySeconds = 100 // durée d'une journée en secondes (à vitesse x1)
    this.dayTime = 0.32 // 0 = minuit, 0.5 = midi — on démarre le matin
    this.elapsedDays = 0
    this.speed = 1
    this.births = 0
    this.deaths = 0
    this.maxPopulation = 60

    for (let i = 0; i < 9; i++) this.spawn()
  }

  get isNight() {
    return this.dayTime < 0.22 || this.dayTime > 0.8
  }

  // Élévation du soleil : 1 à midi, négative la nuit.
  get sunElevation() {
    return Math.sin((this.dayTime - 0.25) * Math.PI * 2)
  }

  spawn(nearPosition = null) {
    const pos = nearPosition
      ? nearPosition.clone().add(new THREE.Vector3((this.rng() - 0.5) * 3, 0, (this.rng() - 0.5) * 3))
      : this.world.randomLandPoint(1.2, 5.5)
    if (!pos) return null
    pos.y = this.world.heightAt(pos.x, pos.z)
    const age = nearPosition ? 0 : undefined
    const creature = new Creature(this.world, this.rng, pos, age)
    this.creatures.push(creature)
    this.group.add(creature.mesh)
    return creature
  }

  update(rawDt) {
    const dt = Math.min(rawDt, 0.1) * this.speed
    if (dt <= 0) return

    this.dayTime += dt / this.daySeconds
    if (this.dayTime >= 1) {
      this.dayTime -= 1
    }
    this.elapsedDays += dt / this.daySeconds

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i]
      const event = c.update(dt, this.world, this)
      if (event === 'birth') {
        const baby = this.spawn(c.mesh.position)
        if (baby) this.births++
      } else if (event === 'died') {
        this.deaths++
      } else if (event === 'remove') {
        this.group.remove(c.mesh)
        this.creatures.splice(i, 1)
      }
    }
  }

  momentLabel() {
    const t = this.dayTime
    if (t < 0.22 || t > 0.85) return 'nuit'
    if (t < 0.35) return 'matin'
    if (t < 0.62) return 'journée'
    if (t < 0.8) return 'soir'
    return 'crépuscule'
  }

  dispose() {
    for (const c of this.creatures) {
      this.group.remove(c.mesh)
      c.bodyMat.dispose()
    }
    this.creatures = []
  }
}
