import * as THREE from 'three'
import { BOARD, HALF } from '../sim/terrain.js'
import { CLASSES, tierForFloor } from '../sim/data.js'
import { HAUTEUR_HEROS, hauteurMonstre, instancier } from './modeles.js'

// Niveaux de qualité — purement visuels. Le rendu se fait sur le fil
// principal + GPU, l'évolution dans les Web Workers : changer de qualité
// ne change RIEN à la vitesse d'apprentissage. Et sur les milliers de
// runs simulés, un seul est rendu (le rejeu).
export const QUALITY_LEVELS = [
  { id: 'capsules', label: 'Capsules', shadows: false, lathe: false, emblems: false, hitFx: false, seals: false },
  { id: 'pions', label: 'Pions', shadows: true, lathe: true, emblems: true, hitFx: false, seals: true },
  { id: 'deluxe', label: 'Deluxe', shadows: true, lathe: true, emblems: true, hitFx: true, seals: true },
]

// Profil tourné d'une pièce de jeu (socle, fût, collerette, tête).
const PION_PROFILE = [
  [0.0, 0.0], [0.4, 0.0], [0.42, 0.06], [0.34, 0.12], [0.26, 0.18],
  [0.17, 0.3], [0.15, 0.52], [0.23, 0.62], [0.24, 0.68], [0.15, 0.74],
  [0.24, 0.86], [0.27, 0.98], [0.2, 1.1], [0.0, 1.18],
]

const MONSTER_PROFILE = [
  [0.0, 0.0], [0.46, 0.0], [0.48, 0.08], [0.36, 0.16], [0.28, 0.26],
  [0.34, 0.44], [0.41, 0.6], [0.35, 0.74], [0.2, 0.86], [0.0, 0.94],
]

function latheGeometry(profile, segments) {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments)
}

const EMBLEMS = {
  chevalier: 'crown', berserk: 'horns', archere: 'bow', mage: 'hat',
  clerc: 'halo', occultiste: 'orb', invocateur: 'orb', necromancien: 'horns', lutin: 'halo',
}

// Armes. Une par classe, tenue devant le pion, et animée quand l'attaque
// part — c'est ce qui rend le combat lisible : on voit QUI frappe et QUAND,
// sans lire le journal.
//
// `swing` décrit le geste : 'slash' balaie horizontalement, 'chop' abat
// verticalement (les deux mains du Berserk), 'draw' tire une corde et
// relâche, 'cast' pointe vers l'avant. `reach` est la longueur du manche,
// `heavy` allonge le geste pour les armes lourdes.
const WEAPONS = {
  chevalier: { kind: 'sword', shield: true, swing: 'slash', len: 0.62, color: '#cfd4da' },
  berserk: { kind: 'greatsword', swing: 'chop', len: 1.35, color: '#b9bec4', heavy: true },
  archere: { kind: 'bow', swing: 'draw', len: 0.5, color: '#8a5a3b' },
  mage: { kind: 'staff', swing: 'cast', len: 1.15, color: '#6b5540', gem: '#7ec8ff' },
  clerc: { kind: 'mace', swing: 'chop', len: 0.66, color: '#d9c489' },
  occultiste: { kind: 'scythe', swing: 'slash', len: 1.1, color: '#4a3f56' },
  invocateur: { kind: 'staff', swing: 'cast', len: 1.0, color: '#3f6b63', gem: '#63e8cf' },
  necromancien: { kind: 'staff', swing: 'cast', len: 1.1, color: '#5a5b4a', gem: '#c9ffa8', skull: true },
  lutin: { kind: 'dagger', swing: 'slash', len: 0.34, color: '#e8d9b0' },
}

export class Tower3D {
  constructor(scene, quality = 'pions') {
    this.scene = scene
    this.group = new THREE.Group()
    this.heroMeshes = []
    this.monsterMeshes = new Map()
    this.summonMeshes = new Map()
    this.corpseMeshes = new Map()
    this.dropMeshes = new Map()
    this.zoneMeshes = new Map()
    this.vfx = []
    this.run = null
    this.terrainGroup = null
    this.builtFloor = -1
    this.quality = QUALITY_LEVELS.find((q) => q.id === quality) ?? QUALITY_LEVELS[1]
    this.geoCache = new Map()
    scene.add(this.group)
    this.buildStage()
  }

  geo(key, build) {
    if (!this.geoCache.has(key)) this.geoCache.set(key, build())
    return this.geoCache.get(key)
  }

  setQuality(id) {
    const level = QUALITY_LEVELS.find((q) => q.id === id)
    if (!level || level === this.quality) return
    this.quality = level
    for (const g of this.geoCache.values()) g.dispose()
    this.geoCache.clear()
    this.builtFloor = -1
    if (this.run) this.attach(this.run)
  }

  // ─── Décor fixe : le sol carré et les braseros d'angle ───

  buildStage() {
    const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 })

    this.floorMat = flat('#4c463c')
    const floor = new THREE.Mesh(new THREE.BoxGeometry(BOARD, 0.8, BOARD), this.floorMat)
    floor.position.y = -0.4
    floor.receiveShadow = true
    this.group.add(floor)

    // Quadrillage discret : donne l'échelle et lit les distances.
    const grid = new THREE.GridHelper(BOARD, BOARD / 2, 0x4a4a44, 0x36362f)
    grid.position.y = 0.01
    grid.material.transparent = true
    grid.material.opacity = 0.25
    this.group.add(grid)

    this.flames = []
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * (HALF - 0.6)
      const z = sz * (HALF - 0.6)
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4.2, 6), flat('#57534a'))
      pillar.position.set(x, 2.1, z)
      pillar.castShadow = true
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.38, 0.8, 6),
        new THREE.MeshStandardMaterial({
          color: '#ff9a3c', emissive: '#ff7a1c', emissiveIntensity: 1.6, flatShading: true,
        })
      )
      flame.position.set(x, 4.5, z)
      flame.userData.flicker = Math.random() * Math.PI * 2
      this.flames.push(flame)
      this.group.add(pillar, flame)
    }
  }

  // ─── Terrain de l'étage : murs, portails, pièges ───
  // Reconstruit à chaque changement d'étage. Les murs sont fusionnés en
  // un seul maillage instancié : une grille de 32×32 rendue en objets
  // séparés coûterait cher pour rien.

  buildTerrain(terrain) {
    if (this.terrainGroup) {
      this.group.remove(this.terrainGroup)
      this.terrainGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material?.dispose) o.material.dispose()
      })
    }
    const g = new THREE.Group()

    // Murs
    const cells = []
    for (let cz = 0; cz < BOARD; cz++) {
      for (let cx = 0; cx < BOARD; cx++) {
        if (terrain.grid[cz * BOARD + cx] === 1) cells.push([cx, cz])
      }
    }
    if (cells.length) {
      const wallMat = new THREE.MeshStandardMaterial({ color: '#5c5850', flatShading: true, roughness: 0.95 })
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2.4, 1), wallMat, cells.length)
      mesh.castShadow = this.quality.shadows
      mesh.receiveShadow = true
      const m = new THREE.Matrix4()
      const color = new THREE.Color()
      cells.forEach(([cx, cz], i) => {
        const [x, z] = terrain.centerOf(cz * BOARD + cx)
        // Bordure plus sombre que les obstacles intérieurs : on lit tout
        // de suite où sont les limites du plateau.
        // Les obstacles intérieurs restent plus bas que la bordure : ils
        // bloquent la vue des agents, pas celle du spectateur.
        const edge = cx === 0 || cz === 0 || cx === BOARD - 1 || cz === BOARD - 1
        m.makeTranslation(x, edge ? 1.5 : 0.95, z)
        m.scale(new THREE.Vector3(1, edge ? 1.25 : 0.79, 1))
        mesh.setMatrixAt(i, m)
        color.set(edge ? '#413e38' : '#68635a')
        mesh.setColorAt(i, color)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      g.add(mesh)
    }

    // Portails
    this.portalMeshes = []
    for (const p of terrain.portals) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.0, 0.14, 6, 18),
        new THREE.MeshStandardMaterial({
          color: '#8a5fd4', emissive: '#6b3fbf', emissiveIntensity: 1.1, flatShading: true,
        })
      )
      ring.position.set(p.x, 1.2, p.z)
      ring.rotation.x = Math.PI / 2
      const core = new THREE.Mesh(
        new THREE.CircleGeometry(0.95, 14),
        new THREE.MeshBasicMaterial({ color: '#2a1a4a', transparent: true, opacity: 0.7, side: THREE.DoubleSide })
      )
      core.position.set(p.x, 1.2, p.z)
      core.rotation.x = -Math.PI / 2
      g.add(ring, core)
      this.portalMeshes.push({ portal: p, ring, core })
    }

    // Pièges : les cachés ne sont PAS dessinés — l'agent ne les voit pas
    // dans ses observations, l'observateur non plus.
    this.trapMeshes = []
    for (const t of terrain.traps) {
      if (!t.stats.visible) continue
      const color = t.type === 'goudron' ? '#2f2a22' : '#8a6a3c'
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(t.stats.radius, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
      )
      disc.position.set(t.x, 0.05, t.z)
      disc.rotation.x = -Math.PI / 2
      g.add(disc)
      this.trapMeshes.push({ trap: t, disc })
    }

    this.group.add(g)
    this.terrainGroup = g
    this.builtFloor = terrain.floor
    this.tempWallMeshes = new Map()
  }

  // ─── Entités ───

  makeEmblem(classId, mat) {
    const kind = EMBLEMS[classId] ?? 'orb'
    const metal = new THREE.MeshStandardMaterial({ color: '#d8d2c4', flatShading: true, roughness: 0.45, metalness: 0.2 })
    const g = new THREE.Group()
    if (kind === 'crown') {
      const ring = new THREE.Mesh(this.geo('crown', () => new THREE.CylinderGeometry(0.19, 0.21, 0.1, 8)), metal)
      ring.position.y = 1.22
      g.add(ring)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        const spike = new THREE.Mesh(this.geo('crownSpike', () => new THREE.ConeGeometry(0.05, 0.14, 4)), metal)
        spike.position.set(Math.cos(a) * 0.16, 1.33, Math.sin(a) * 0.16)
        g.add(spike)
      }
    } else if (kind === 'horns') {
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(this.geo('horn', () => new THREE.ConeGeometry(0.07, 0.32, 5)), metal)
        horn.position.set(side * 0.15, 1.3, 0)
        horn.rotation.z = side * 0.5
        g.add(horn)
      }
    } else if (kind === 'bow') {
      const bow = new THREE.Mesh(
        this.geo('bow', () => new THREE.TorusGeometry(0.22, 0.035, 4, 12, Math.PI * 1.2)),
        new THREE.MeshStandardMaterial({ color: '#8a5a3b', flatShading: true, roughness: 1 })
      )
      bow.position.y = 1.32
      bow.rotation.y = Math.PI / 2
      bow.rotation.z = -0.3
      g.add(bow)
    } else if (kind === 'hat') {
      const hat = new THREE.Mesh(this.geo('hat', () => new THREE.ConeGeometry(0.24, 0.46, 7)), mat)
      hat.position.y = 1.38
      g.add(hat)
    } else if (kind === 'halo') {
      const halo = new THREE.Mesh(
        this.geo('halo', () => new THREE.TorusGeometry(0.2, 0.035, 4, 14)),
        new THREE.MeshStandardMaterial({ color: '#ffe9a3', emissive: '#e8c96a', emissiveIntensity: 0.9, flatShading: true })
      )
      halo.rotation.x = Math.PI / 2
      halo.position.y = 1.34
      g.add(halo)
    } else {
      const orb = new THREE.Mesh(
        this.geo('orb', () => new THREE.IcosahedronGeometry(0.13, 0)),
        new THREE.MeshStandardMaterial({ color: '#b78fe0', emissive: '#7a5f9e', emissiveIntensity: 1.1, flatShading: true })
      )
      orb.position.y = 1.36
      g.add(orb)
      g.userData.floating = orb
    }
    return g
  }

  // Construit l'arme d'une classe. Le groupe rendu tourne autour de
  // l'épaule : c'est lui qu'on anime, la géométrie reste figée.
  makeWeapon(classId) {
    const w = WEAPONS[classId]
    if (!w) return null
    const steel = new THREE.MeshStandardMaterial({ color: w.color, flatShading: true, roughness: 0.5, metalness: 0.35 })
    const wood = new THREE.MeshStandardMaterial({ color: '#6b5540', flatShading: true, roughness: 1 })

    // Le pion mesure 1,18 : la main tombe vers 0,66, pas à hauteur de tête.
    // Le pivot est l'épaule, `arm` porte l'arme, poignée à l'origine.
    const pivot = new THREE.Group()
    pivot.position.set(0.33, 0.66, 0.08)
    const arm = new THREE.Group()
    pivot.add(arm)

    const L = w.len
    if (w.kind === 'greatsword') {
      // Référence Guts : la lame dépasse le porteur.
      const blade = new THREE.Mesh(this.geo('gsBlade', () => new THREE.BoxGeometry(0.19, 0.92, 0.06)), steel)
      blade.position.y = 0.62
      const guard = new THREE.Mesh(this.geo('gsGuard', () => new THREE.BoxGeometry(0.34, 0.07, 0.09)), steel)
      guard.position.y = 0.17
      const grip = new THREE.Mesh(this.geo('gsGrip', () => new THREE.CylinderGeometry(0.05, 0.055, 0.28, 5)), wood)
      grip.position.y = 0.02
      arm.add(blade, guard, grip)
    } else if (w.kind === 'sword') {
      const blade = new THREE.Mesh(this.geo('swBlade', () => new THREE.BoxGeometry(0.11, 0.5, 0.05)), steel)
      blade.position.y = 0.34
      const guard = new THREE.Mesh(this.geo('swGuard', () => new THREE.BoxGeometry(0.24, 0.06, 0.07)), steel)
      guard.position.y = 0.12
      const grip = new THREE.Mesh(this.geo('swGrip', () => new THREE.CylinderGeometry(0.042, 0.046, 0.16, 5)), wood)
      grip.position.y = 0.02
      arm.add(blade, guard, grip)
    } else if (w.kind === 'dagger') {
      const blade = new THREE.Mesh(this.geo('dgBlade', () => new THREE.ConeGeometry(0.07, 0.3, 4)), steel)
      blade.position.y = 0.21
      const grip = new THREE.Mesh(this.geo('dgGrip', () => new THREE.CylinderGeometry(0.04, 0.044, 0.12, 5)), wood)
      grip.position.y = 0.02
      arm.add(blade, grip)
    } else if (w.kind === 'mace') {
      const head = new THREE.Mesh(this.geo('mcHead', () => new THREE.IcosahedronGeometry(0.15, 0)), steel)
      head.position.y = 0.46
      const shaft = new THREE.Mesh(this.geo('mcShaft', () => new THREE.CylinderGeometry(0.042, 0.046, 0.42, 5)), wood)
      shaft.position.y = 0.21
      arm.add(head, shaft)
    } else if (w.kind === 'bow') {
      const bow = new THREE.Mesh(
        this.geo('bwArc', () => new THREE.TorusGeometry(0.36, 0.05, 4, 12, Math.PI * 1.15)),
        new THREE.MeshStandardMaterial({ color: w.color, flatShading: true, roughness: 1 })
      )
      bow.position.y = 0.26
      bow.rotation.z = Math.PI / 2
      const string = new THREE.Mesh(this.geo('bwString', () => new THREE.BoxGeometry(0.012, 0.6, 0.012)), steel)
      string.position.set(0, 0.26, 0.3)
      arm.add(bow, string)
      arm.userData.string = string
    } else if (w.kind === 'scythe') {
      const shaft = new THREE.Mesh(this.geo('scShaft', () => new THREE.CylinderGeometry(0.042, 0.046, 0.82, 5)), wood)
      shaft.position.y = 0.36
      const blade = new THREE.Mesh(
        this.geo('scBlade', () => new THREE.TorusGeometry(0.22, 0.05, 3, 8, Math.PI * 0.7)),
        steel
      )
      blade.position.y = 0.78
      blade.rotation.y = Math.PI / 2
      arm.add(shaft, blade)
    } else {
      // Bâton : manche + gemme, éventuellement surmontée d'un crâne.
      const shaft = new THREE.Mesh(this.geo('stShaft', () => new THREE.CylinderGeometry(0.042, 0.046, 0.86, 5)), wood)
      shaft.position.y = 0.38
      arm.add(shaft)
      const gem = new THREE.Mesh(
        this.geo('stGem', () => new THREE.IcosahedronGeometry(0.13, 0)),
        new THREE.MeshStandardMaterial({
          color: w.gem, emissive: w.gem, emissiveIntensity: 1.2, flatShading: true,
        })
      )
      gem.position.y = 0.86
      arm.add(gem)
      arm.userData.gem = gem
      if (w.skull) {
        const skull = new THREE.Mesh(this.geo('stSkull', () => new THREE.IcosahedronGeometry(0.14, 0)),
          new THREE.MeshStandardMaterial({ color: '#ddd6c2', flatShading: true, roughness: 1 }))
        skull.position.y = 0.74
        arm.add(skull)
      }
    }

    // Bouclier du Chevalier : à l'autre main, il ne bouge pas.
    let shield = null
    if (w.shield) {
      shield = new THREE.Mesh(
        this.geo('shield', () => new THREE.BoxGeometry(0.08, 0.58, 0.44)),
        new THREE.MeshStandardMaterial({ color: '#7c8794', flatShading: true, roughness: 0.7, metalness: 0.25 })
      )
      shield.position.set(-0.36, 0.62, 0.1)
    }

    return { pivot, arm, shield, spec: w }
  }

  // Un modèle externe reçoit le même équipement qu'un pion : jauges, arme,
  // et les crochets d'animation. Seul le corps diffère, donc tout le reste
  // du fichier continue de fonctionner sans savoir d'où vient le maillage.
  habillerHeros(hero, corps, color) {
    const q = this.quality
    const g = new THREE.Group()
    g.add(corps)

    // On récupère un matériau du modèle pour que les effets d'état
    // (gelé, en feu) aient quelque chose à teinter.
    let mat = null
    corps.traverse((o) => { if (!mat && o.isMesh) mat = Array.isArray(o.material) ? o.material[0] : o.material })

    let weapon = null
    if (q.lathe) {
      weapon = this.makeWeapon(hero.cls.id)
      if (weapon) {
        g.add(weapon.pivot)
        if (weapon.shield) g.add(weapon.shield)
      }
    }
    const hpBar = this.makeBar(0.9, 1.85, '#57c46a')
    const manaBar = this.makeBar(0.9, 1.69, '#4a7fb5')
    g.add(hpBar, manaBar)
    g.userData = {
      hpBar, manaBar, mat, body: corps, emblem: null, weapon,
      baseColor: mat?.emissive?.clone() ?? new THREE.Color(color),
      lunge: 0, lungeDir: [0, 0], flash: 0, swing: 0, externe: true,
    }
    return g
  }

  // Idem pour un monstre. La couleur d'origine du modèle est CONSERVÉE :
  // le codage vert/or/rouge (ordinaire, élite, boss) est abandonné dès
  // qu'un modèle est fourni — un anneau au sol serait plus propre qu'un
  // filtre de couleur par-dessus le design.
  habillerMonstre(m, corps) {
    const g = new THREE.Group()
    g.add(corps)
    let mat = null
    corps.traverse((o) => { if (!mat && o.isMesh) mat = Array.isArray(o.material) ? o.material[0] : o.material })
    const hpBar = this.makeBar(0.7 + m.size * 0.5, m.size * 1.2 + 0.5, '#cf5f55')
    g.add(hpBar)
    g.userData = {
      hpBar, mat, body: corps,
      baseColor: mat?.emissive?.clone() ?? new THREE.Color('#000000'),
      bodyScale: 1, lunge: 0, lungeDir: [0, 0], flash: 0, externe: true,
    }
    return g
  }

  makeHeroMesh(hero) {
    const color = new THREE.Color(hero.cls.color)
    const q = this.quality
    // Un modèle .glb déposé dans public/modeles/heros/ remplace le pion
    // tourné. L'arme, les jauges et les animations restent identiques :
    // seul le corps change.
    const externe = q.lathe ? instancier('heros', hero.cls.id, HAUTEUR_HEROS) : null
    if (externe) return this.habillerHeros(hero, externe, color)
    const mat = new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: 0.75, metalness: q.lathe ? 0.15 : 0,
      emissive: color, emissiveIntensity: 0.14,
    })
    const g = new THREE.Group()
    let body
    if (q.lathe) {
      body = new THREE.Mesh(this.geo('pion', () => latheGeometry(PION_PROFILE, 12)), mat)
      const base = new THREE.Mesh(
        this.geo('pionBase', () => new THREE.CylinderGeometry(0.44, 0.5, 0.07, 12)),
        new THREE.MeshStandardMaterial({ color: '#26231f', flatShading: true, roughness: 0.9 })
      )
      base.position.y = 0.035
      g.add(base)
    } else {
      body = new THREE.Mesh(this.geo('capsule', () => new THREE.CapsuleGeometry(0.34, 0.75, 3, 8)), mat)
      body.position.y = 0.72
    }
    body.castShadow = q.shadows
    g.add(body)

    let emblem = null
    if (q.emblems) {
      emblem = this.makeEmblem(hero.cls.id, mat)
      g.add(emblem)
    }
    // L'arme n'existe qu'à partir du niveau « Pions » : en capsules, le
    // parti pris est justement de n'avoir aucune forme lisible.
    let weapon = null
    if (q.lathe) {
      weapon = this.makeWeapon(hero.cls.id)
      if (weapon) {
        g.add(weapon.pivot)
        if (weapon.shield) g.add(weapon.shield)
        weapon.pivot.castShadow = q.shadows
      }
    }
    const hpBar = this.makeBar(0.9, q.lathe ? 1.85 : 1.78, '#57c46a')
    const manaBar = this.makeBar(0.9, q.lathe ? 1.69 : 1.62, '#4a7fb5')
    g.add(hpBar, manaBar)
    g.userData = {
      hpBar, manaBar, mat, body, emblem, weapon,
      baseColor: color.clone(), lunge: 0, lungeDir: [0, 0], flash: 0,
      swing: 0, // 1 → 0 pendant le geste d'attaque
    }
    return g
  }

  makeBar(width, y, color) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.08), new THREE.MeshBasicMaterial({ color }))
    bar.position.y = y
    return bar
  }

  makeMonsterMesh(m) {
    const q = this.quality
    const externe = q.lathe ? instancier('monstres', m.type, hauteurMonstre(m.size)) : null
    if (externe) return this.habillerMonstre(m, externe)
    const color = m.boss ? '#7a3c3c' : m.elite ? '#8f6e3c' : '#6e8557'
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 })
    const g = new THREE.Group()
    const s = m.size
    let body
    if (q.lathe) {
      body = new THREE.Mesh(this.geo('mpion', () => latheGeometry(MONSTER_PROFILE, 9)), mat)
      body.scale.setScalar(0.85 + s * 0.55)
    } else {
      body = new THREE.Mesh(
        this.geo(`mcap${s.toFixed(2)}`, () => new THREE.CapsuleGeometry(0.3 * (0.9 + s), 0.4 * (0.7 + s), 3, 7)), mat
      )
      body.position.y = 0.55 * (0.7 + s)
    }
    body.castShadow = q.shadows
    g.add(body)
    if (m.boss || m.elite) {
      const crown = new THREE.Mesh(
        this.geo('mcrown', () => new THREE.ConeGeometry(0.16, 0.3, 5)),
        new THREE.MeshStandardMaterial({ color: '#e8c96a', emissive: '#a8873c', flatShading: true })
      )
      crown.position.y = (q.lathe ? 0.95 : 1.2) * s + 0.75
      g.add(crown)
    }
    const hpBar = this.makeBar(0.8 * (0.7 + s * 0.5), (q.lathe ? 1.05 : 1.2) * s + 0.95, '#d1584a')
    g.add(hpBar)
    g.userData = { hpBar, mat, body, baseColor: new THREE.Color(color), bodyScale: body.scale.x, lunge: 0, lungeDir: [0, 0], flash: 0 }
    return g
  }

  makeSummonMesh(s) {
    const mat = new THREE.MeshStandardMaterial({
      color: s.spec.color, flatShading: true, roughness: 0.8,
      emissive: s.spec.color, emissiveIntensity: 0.35, transparent: true, opacity: 0.85,
    })
    const g = new THREE.Group()
    const body = new THREE.Mesh(
      this.geo(`sum${s.spec.size.toFixed(2)}`, () => new THREE.IcosahedronGeometry(0.36 * (0.8 + s.spec.size), 0)),
      mat
    )
    body.position.y = 0.4 * (0.8 + s.spec.size)
    body.castShadow = this.quality.shadows
    g.add(body)
    const hpBar = this.makeBar(0.6, 1.1 * s.spec.size + 0.6, '#7fd4c4')
    g.add(hpBar)
    g.userData = { hpBar, mat, body }
    return g
  }

  attach(run) {
    for (const m of this.heroMeshes) this.group.remove(m)
    for (const map of [this.monsterMeshes, this.summonMeshes, this.corpseMeshes, this.zoneMeshes]) {
      for (const [, m] of map) this.group.remove(m)
      map.clear()
    }
    for (const v of this.vfx) this.group.remove(v.mesh)
    this.heroMeshes = []
    this.vfx = []
    this.run = run
    this.builtFloor = -1
    for (const hero of run.heroes) {
      const mesh = this.makeHeroMesh(hero)
      this.heroMeshes.push(mesh)
      this.group.add(mesh)
    }
  }

  // ─── Effets ───

  makeSeal(radius, color) {
    const g = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
    g.userData.materials = [mat]
    const outer = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 3, 40), mat)
    outer.rotation.x = -Math.PI / 2
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.022, 3, 32), mat)
    inner.rotation.x = -Math.PI / 2
    g.add(outer, inner)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), mat)
      tick.position.set(Math.cos(a) * 0.81, 0, Math.sin(a) * 0.81)
      tick.rotation.y = -a
      g.add(tick)
    }
    const tri = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.02, 3, 3), mat)
    tri.rotation.x = -Math.PI / 2
    g.add(tri)
    g.scale.setScalar(radius)
    return g
  }

  spawnVfx(kind, from, to, { radius = 1, color = '#fff4dd' } = {}) {
    let mesh
    let life = 0.3
    const basic = (c, size = 0.15) =>
      new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshBasicMaterial({ color: c }))

    switch (kind) {
      case 'arrow':
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#e8dcc0' }))
        life = 0.2
        break
      case 'bolt':
        mesh = basic(color)
        life = 0.22
        break
      case 'chain':
        mesh = basic('#9fd8ff', 0.12)
        life = 0.18
        break
      case 'seal':
        mesh = this.makeSeal(radius, color)
        life = 0.85
        break
      case 'pierce': {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 1),
          new THREE.MeshBasicMaterial({ color: '#e8dcc0', transparent: true })
        )
        life = 0.3
        break
      }
      case 'trail':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), new THREE.MeshBasicMaterial({ color, transparent: true }))
        life = 0.35
        break
      case 'aoe':
      case 'taunt':
      case 'zoneRing':
        mesh = new THREE.Mesh(
          new THREE.TorusGeometry(0.4, 0.07, 4, 20),
          new THREE.MeshBasicMaterial({ color: kind === 'taunt' ? '#e8c96a' : color, transparent: true })
        )
        mesh.rotation.x = -Math.PI / 2
        life = 0.45
        break
      case 'heal':
      case 'buff':
      case 'shield':
        mesh = new THREE.Mesh(
          new THREE.TorusGeometry(0.3, 0.05, 4, 12),
          new THREE.MeshBasicMaterial({ color: kind === 'heal' ? '#8fe89a' : color, transparent: true })
        )
        mesh.rotation.x = -Math.PI / 2
        life = 0.5
        break
      case 'die':
        mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.4, 0),
          new THREE.MeshBasicMaterial({ color: '#c9c2b4', transparent: true })
        )
        life = 0.4
        break
      case 'shatter':
        mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.5, 0),
          new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, wireframe: true })
        )
        life = 0.35
        break
      default:
        mesh = basic(kind === 'bite' ? '#d1584a' : '#fff4dd', 0.13)
        life = 0.15
    }
    const grounded = ['aoe', 'taunt', 'seal', 'trail', 'zoneRing'].includes(kind)
    mesh.position.set(from[0], grounded ? 0.12 : 0.9, from[1])
    this.group.add(mesh)
    this.vfx.push({ mesh, kind, life, maxLife: life, from, to, radius })
  }

  nearestMesh(list, x, z, maxDist = 1.4) {
    let best = null
    let bestD = maxDist * maxDist
    for (const { mesh, ex, ez } of list) {
      const d = (ex - x) ** 2 + (ez - z) ** 2
      if (d < bestD) {
        bestD = d
        best = mesh
      }
    }
    return best
  }

  reactToHits() {
    if (!this.quality.hitFx) return
    const heroes = this.run.heroes
      .map((h, i) => ({ mesh: this.heroMeshes[i], ex: h.x, ez: h.z }))
      .filter((e) => e.mesh)
    const monsters = []
    for (const m of this.run.monsters) {
      const mesh = this.monsterMeshes.get(m.id)
      if (mesh) monsters.push({ mesh, ex: m.x, ez: m.z })
    }
    const lunge = (mesh, from, to) => {
      if (!mesh) return
      const dx = to[0] - from[0]
      const dz = to[1] - from[1]
      const d = Math.hypot(dx, dz) || 1
      mesh.userData.lunge = 1
      mesh.userData.lungeDir = [dx / d, dz / d]
    }
    const flash = (mesh) => {
      if (mesh) mesh.userData.flash = 1
    }
    // Le geste d'attaque part sur l'agent qui frappe, quel que soit le
    // niveau de qualité : c'est lui qui rend le combat lisible.
    const strike = (mesh) => {
      if (mesh) mesh.userData.swing = 1
    }
    for (const ev of this.run.events) {
      switch (ev.t) {
        case 'slash':
        case 'arrow':
        case 'bolt':
        case 'pierce':
        case 'chain':
          if (ev.from) {
            const m = this.nearestMesh(heroes, ev.from[0], ev.from[1])
            strike(m)
            lunge(m, ev.from, ev.to)
          }
          flash(this.nearestMesh(monsters, ev.to[0], ev.to[1]))
          break
        case 'bite':
          flash(this.nearestMesh(heroes, ev.to[0], ev.to[1]))
          break
        case 'aoe':
          for (const e of monsters) {
            if (Math.hypot(e.ex - ev.at[0], e.ez - ev.at[1]) <= ev.r) flash(e.mesh)
          }
          break
      }
    }
  }

  // Le geste d'attaque. `swing` descend de 1 à 0 ; on en tire une courbe
  // en cloche pour l'armement puis la frappe. Quatre gestes distincts,
  // choisis pour qu'on reconnaisse la classe au mouvement seul.
  animateWeapon(mesh, dt) {
    const w = mesh.userData.weapon
    if (!w) return
    const u = mesh.userData
    if (u.swing > 0) u.swing = Math.max(0, u.swing - dt * (w.spec.heavy ? 2.4 : 4))

    const p = 1 - u.swing // 0 = début du geste, 1 = fini
    const arc = 4 * p * (1 - p) // cloche : 0 au départ, 1 au milieu, 0 à la fin
    const arm = w.arm

    switch (w.spec.swing) {
      case 'chop': {
        // Au repos, la lourde repose sur l'épaule, inclinée en arrière.
        // Le geste l'arme un peu plus haut puis l'abat vers l'avant.
        const rest = -0.55
        w.pivot.rotation.x = rest - u.swing * 0.7 + arc * 2.1
        w.pivot.rotation.z = 0.3 - arc * 0.3
        w.pivot.rotation.y = 0
        break
      }
      case 'slash': {
        // Lame tenue basse et légèrement écartée ; le geste balaie devant.
        w.pivot.rotation.x = -0.25 - arc * 0.35
        w.pivot.rotation.z = 0.35 - arc * 0.2
        w.pivot.rotation.y = -0.7 + arc * 1.5
        break
      }
      case 'draw':
        // Arc tenu à l'horizontale, corde tirée puis relâchée.
        w.pivot.rotation.x = -1.35
        w.pivot.rotation.z = 0
        w.pivot.rotation.y = arc * 0.2
        if (arm.userData.string) arm.userData.string.position.z = 0.3 + u.swing * 0.26
        break
      default:
        // Incantation : le bâton se redresse et la gemme s'embrase.
        w.pivot.rotation.x = -0.12 - arc * 0.9
        w.pivot.rotation.z = 0.12
        w.pivot.rotation.y = 0
        if (arm.userData.gem) {
          arm.userData.gem.material.emissiveIntensity = 1.2 + arc * 3.5
          arm.userData.gem.scale.setScalar(1 + arc * 0.5)
        }
    }
  }

  animateReaction(mesh, dt) {
    const u = mesh.userData
    if (!this.quality.hitFx) return [0, 0]
    let offX = 0
    let offZ = 0
    if (u.lunge > 0) {
      u.lunge = Math.max(0, u.lunge - dt * 5)
      const p = Math.sin(u.lunge * Math.PI)
      offX = u.lungeDir[0] * p * 0.35
      offZ = u.lungeDir[1] * p * 0.35
    }
    if (u.flash > 0) {
      u.flash = Math.max(0, u.flash - dt * 4.5)
      u.mat.emissive.copy(u.baseColor).lerp(new THREE.Color('#ffffff'), u.flash * 0.9)
      u.mat.emissiveIntensity = 0.18 + u.flash * 1.4
      if (u.body) u.body.scale.setScalar((u.bodyScale ?? 1) * (1 + u.flash * 0.12))
    } else if (u.mat && u.mat.emissiveIntensity !== 0.18) {
      u.mat.emissive.copy(u.baseColor)
      u.mat.emissiveIntensity = 0.18
      if (u.body) u.body.scale.setScalar(u.bodyScale ?? 1)
    }
    return [offX, offZ]
  }

  // ─── Boucle de rendu ───

  update(dt, elapsed, camera) {
    if (!this.run) return
    const q = this.quality
    const run = this.run

    if (run.terrain && this.builtFloor !== run.terrain.floor) this.buildTerrain(run.terrain)

    const tier = tierForFloor(Math.max(run.floor, 1))
    this.floorMat.color.lerp(new THREE.Color(tier.ambiance), 0.04)

    // Portails : pulsent, s'éteignent quand scellés ou taris
    for (const pm of this.portalMeshes ?? []) {
      const p = pm.portal
      const active = p.sealed <= 0 && p.remaining > 0
      pm.ring.material.emissiveIntensity = active ? 1.0 + Math.sin(elapsed * 4 + p.id) * 0.4 : 0.12
      pm.ring.material.color.set(p.sealed > 0 ? '#4a4a55' : '#8a5fd4')
      pm.ring.rotation.z += dt * (active ? 1.2 : 0.1)
      pm.core.material.opacity = active ? 0.7 : 0.2
    }
    // Pièges armés : ternes tant qu'ils rechargent
    for (const tm of this.trapMeshes ?? []) {
      tm.disc.material.opacity = tm.trap.armed > 0 ? 0.15 : 0.45
    }

    // Murs temporaires du Chevalier
    if (run.terrain) {
      for (const [cell, life] of run.terrain.temp) {
        let mesh = this.tempWallMeshes.get(cell)
        if (!mesh) {
          const [x, z] = run.terrain.centerOf(cell)
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 2.2, 1),
            new THREE.MeshStandardMaterial({
              color: '#9db0c4', flatShading: true, transparent: true, opacity: 0.7,
              emissive: '#4a6b8a', emissiveIntensity: 0.5,
            })
          )
          mesh.position.set(x, 1.1, z)
          this.group.add(mesh)
          this.tempWallMeshes.set(cell, mesh)
        }
        mesh.material.opacity = Math.min(0.7, life / 2)
      }
      for (const [cell, mesh] of this.tempWallMeshes) {
        if (!run.terrain.temp.has(cell)) {
          this.group.remove(mesh)
          mesh.geometry.dispose()
          mesh.material.dispose()
          this.tempWallMeshes.delete(cell)
        }
      }
    }

    // Monstres
    const seenM = new Set()
    for (const m of run.monsters) {
      seenM.add(m.id)
      let mesh = this.monsterMeshes.get(m.id)
      if (!mesh) {
        mesh = this.makeMonsterMesh(m)
        this.monsterMeshes.set(m.id, mesh)
        this.group.add(mesh)
      }
      const [ox, oz] = this.animateReaction(mesh, dt)
      mesh.position.set(m.x + ox, Math.abs(Math.sin(elapsed * 7 + m.id)) * 0.07, m.z + oz)
      mesh.userData.hpBar.scale.x = Math.max(m.hp / m.maxHp, 0.001)
      mesh.userData.hpBar.lookAt(camera.position)
      // Teinte selon l'état dominant : gelé, en feu, électrifié
      const st = m.st
      const tint = st.freeze > 0 ? '#7fc4ff' : st.burn > 0 ? '#ff8a3c' : st.shock > 0 ? '#ffe66a' : null
      if (tint && !mesh.userData.flash) mesh.userData.mat.emissive.set(tint)
      if (tint) mesh.userData.mat.emissiveIntensity = 0.5
      else if (!mesh.userData.flash) mesh.userData.mat.emissiveIntensity = 0
    }
    for (const [id, mesh] of this.monsterMeshes) {
      if (!seenM.has(id)) {
        this.group.remove(mesh)
        this.monsterMeshes.delete(id)
      }
    }

    // Invocations
    const seenS = new Set()
    for (const s of run.summons) {
      seenS.add(s.id)
      let mesh = this.summonMeshes.get(s.id)
      if (!mesh) {
        mesh = this.makeSummonMesh(s)
        this.summonMeshes.set(s.id, mesh)
        this.group.add(mesh)
      }
      mesh.position.set(s.x, Math.abs(Math.sin(elapsed * 6 + s.id)) * 0.1, s.z)
      mesh.userData.hpBar.scale.x = Math.max(s.hp / s.maxHp, 0.001)
      mesh.userData.hpBar.lookAt(camera.position)
      mesh.userData.mat.opacity = Math.min(0.85, s.life / 3)
    }
    for (const [id, mesh] of this.summonMeshes) {
      if (!seenS.has(id)) {
        this.group.remove(mesh)
        this.summonMeshes.delete(id)
      }
    }

    // Butin au sol : fiole qui flotte et tourne, pour qu'on la repère de
    // loin. Elle clignote quand elle est sur le point de disparaître —
    // c'est cette échéance qui force l'arbitrage.
    for (const d of run.drops ?? []) {
      let mesh = this.dropMeshes.get(d.id)
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.geo('drop', () => new THREE.OctahedronGeometry(0.28, 0)),
          new THREE.MeshStandardMaterial({
            color: d.spec.color, emissive: d.spec.color, emissiveIntensity: 1.2, flatShading: true,
          })
        )
        this.dropMeshes.set(d.id, mesh)
        this.group.add(mesh)
      }
      mesh.position.set(d.x, 0.55 + Math.sin(elapsed * 3 + d.id) * 0.12, d.z)
      mesh.rotation.y += dt * 2.2
      const fin = d.life < 4
      mesh.visible = !fin || Math.sin(elapsed * 14) > -0.3
      mesh.material.emissiveIntensity = fin ? 1.8 : 1.2
    }
    for (const [id, mesh] of this.dropMeshes) {
      if ((run.drops ?? []).some((d) => d.id === id)) continue
      this.group.remove(mesh)
      mesh.material.dispose()
      this.dropMeshes.delete(id)
    }

    // Cadavres : ressource du Nécromancien, donc visibles
    const seenC = new Set()
    for (const c of run.corpses) {
      seenC.add(c.id)
      let mesh = this.corpseMeshes.get(c.id)
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CircleGeometry(0.5, 8),
          new THREE.MeshBasicMaterial({ color: '#4a3f38', transparent: true, opacity: 0.6, side: THREE.DoubleSide })
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(c.x, 0.04, c.z)
        this.corpseMeshes.set(c.id, mesh)
        this.group.add(mesh)
      }
      mesh.material.opacity = Math.min(0.6, c.life / 4)
    }
    for (const [id, mesh] of this.corpseMeshes) {
      if (!seenC.has(id)) {
        this.group.remove(mesh)
        mesh.geometry.dispose()
        mesh.material.dispose()
        this.corpseMeshes.delete(id)
      }
    }

    // Zones persistantes (sanctuaire, nuée, poussière, toile)
    const seenZ = new Set()
    for (const z of run.zones) {
      seenZ.add(z.id)
      let mesh = this.zoneMeshes.get(z.id)
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CircleGeometry(z.radius, 20),
          new THREE.MeshBasicMaterial({ color: z.color ?? '#8fe89a', transparent: true, opacity: 0.16, side: THREE.DoubleSide })
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(z.x, 0.06, z.z)
        this.zoneMeshes.set(z.id, mesh)
        this.group.add(mesh)
      }
      mesh.material.opacity = 0.1 + 0.08 * Math.sin(elapsed * 3 + z.id)
    }
    for (const [id, mesh] of this.zoneMeshes) {
      if (!seenZ.has(id)) {
        this.group.remove(mesh)
        mesh.geometry.dispose()
        mesh.material.dispose()
        this.zoneMeshes.delete(id)
      }
    }

    this.reactToHits()

    // Agents
    run.heroes.forEach((hero, i) => {
      const mesh = this.heroMeshes[i]
      const [ox, oz] = this.animateReaction(mesh, dt)
      mesh.position.set(hero.x + ox, 0, hero.z + oz)
      const { hpBar, manaBar, mat, emblem } = mesh.userData
      const frac = Math.max(hero.hp / hero.maxHp, 0)
      hpBar.scale.x = Math.max(frac, 0.001)
      hpBar.material.color.set(frac > 0.5 ? '#57c46a' : frac > 0.25 ? '#e8b93c' : '#d1584a')
      manaBar.scale.x = Math.max(hero.mana / hero.maxMana, 0.001)
      hpBar.lookAt(camera.position)
      manaBar.lookAt(camera.position)
      this.animateWeapon(mesh, dt)
      if (emblem?.userData.floating) {
        emblem.userData.floating.position.y = 1.36 + Math.sin(elapsed * 2 + i) * 0.06
        emblem.userData.floating.rotation.y += dt * 1.5
      }
      if (!hero.alive) {
        mesh.rotation.z = Math.min(mesh.rotation.z + dt * 4, Math.PI / 2)
        mat.transparent = true
        mat.opacity = 0.45
      } else {
        const st = hero.st
        mesh.rotation.z = st.stun > 0 || st.freeze > 0 ? Math.sin(elapsed * 30) * 0.15 : 0
        mat.transparent = st.intangible > 0
        mat.opacity = st.intangible > 0 ? 0.35 : 1
        mesh.position.y = (hero.jumpHeight ?? 0) + Math.abs(Math.sin(elapsed * 8 + i)) * (q.lathe ? 0.04 : 0.06)
        if (q.lathe && run.monsters.length > 0) {
          let bx = 0
          let bz = 0
          let bd = Infinity
          for (const m of run.monsters) {
            const d = (m.x - hero.x) ** 2 + (m.z - hero.z) ** 2
            if (d < bd) {
              bd = d
              bx = m.x
              bz = m.z
            }
          }
          mesh.rotation.y = Math.atan2(bx - hero.x, bz - hero.z)
        }
      }
    })

    // Événements → effets
    for (const ev of run.events) {
      switch (ev.t) {
        case 'arrow': this.spawnVfx('arrow', ev.from, ev.to); break
        case 'bolt': this.spawnVfx('bolt', ev.from, ev.to, { color: ev.color }); break
        case 'chain': this.spawnVfx('chain', ev.from, ev.to); break
        case 'pierce': this.spawnVfx('pierce', ev.from, ev.to); break
        case 'aoe':
          this.spawnVfx('aoe', ev.at, ev.at, { radius: ev.r, color: ev.color })
          if (ev.seal && q.seals) this.spawnVfx('seal', ev.at, ev.at, { radius: ev.r, color: ev.color })
          break
        case 'zone': this.spawnVfx('zoneRing', ev.at, ev.at, { radius: ev.r, color: ev.color }); break
        case 'taunt': this.spawnVfx('taunt', ev.at, ev.at, { radius: ev.r }); break
        case 'heal': this.spawnVfx('heal', ev.to, ev.to); break
        case 'shield': this.spawnVfx('shield', ev.to, ev.to, { color: ev.color }); break
        case 'buff':
          this.spawnVfx('buff', ev.to, ev.to, { color: ev.color })
          if (q.seals) this.spawnVfx('seal', ev.to, ev.to, { radius: 1.1, color: ev.color })
          break
        case 'draft':
          if (q.seals) {
            const h = run.heroes[ev.slot]
            this.spawnVfx('seal', [h.x, h.z], [h.x, h.z], { radius: 1.3, color: '#3fb8a8' })
          }
          break
        case 'dash':
        case 'charge':
        case 'blink':
        case 'swap':
          this.spawnVfx('trail', ev.from, ev.to, { color: ev.color ?? '#e8dcc0' })
          break
        case 'jump': this.spawnVfx('trail', ev.from, ev.from, { color: '#e8dcc0' }); break
        case 'seal': this.spawnVfx('seal', ev.at, ev.at, { radius: 1.4, color: '#7a5f9e' }); break
        case 'summon':
        case 'raise': this.spawnVfx('seal', ev.at, ev.at, { radius: 1.2, color: ev.color ?? '#6b7f5e' }); break
        case 'shatter': this.spawnVfx('shatter', ev.at, ev.at); break
        case 'monsterDie':
        case 'summonDie': this.spawnVfx('die', ev.at, ev.at); break
        case 'trap': this.spawnVfx('aoe', ev.at, ev.at, { radius: 1.2, color: '#d1584a' }); break
        case 'slash':
        case 'bite': this.spawnVfx(ev.t, ev.to, ev.to); break
      }
    }

    // Animation des effets
    for (let i = this.vfx.length - 1; i >= 0; i--) {
      const v = this.vfx[i]
      v.life -= dt
      const p = 1 - v.life / v.maxLife
      switch (v.kind) {
        case 'arrow':
        case 'bolt':
        case 'chain':
          v.mesh.position.set(
            v.from[0] + (v.to[0] - v.from[0]) * p,
            0.9 + Math.sin(p * Math.PI) * 0.4,
            v.from[1] + (v.to[1] - v.from[1]) * p
          )
          if (v.kind === 'arrow') {
            v.mesh.lookAt(v.to[0], 0.9, v.to[1])
            v.mesh.rotateX(Math.PI / 2)
          }
          break
        case 'pierce': {
          const dx = v.to[0] - v.from[0]
          const dz = v.to[1] - v.from[1]
          const len = Math.hypot(dx, dz) || 1
          v.mesh.position.set(v.from[0] + dx / 2, 0.9, v.from[1] + dz / 2)
          v.mesh.scale.z = len
          v.mesh.lookAt(v.to[0], 0.9, v.to[1])
          v.mesh.material.opacity = 1 - p
          break
        }
        case 'seal':
          v.mesh.scale.setScalar(v.radius * (0.2 + Math.min(1, p * 4) * 0.8))
          v.mesh.rotation.y = p * 1.2
          for (const mat of v.mesh.userData.materials) mat.opacity = 0.85 * (1 - p * p)
          break
        case 'trail':
          v.mesh.position.set(
            v.from[0] + (v.to[0] - v.from[0]) * p, 0.12,
            v.from[1] + (v.to[1] - v.from[1]) * p
          )
          v.mesh.material.opacity = 0.55 * (1 - p)
          break
        case 'aoe':
        case 'taunt':
        case 'zoneRing': {
          const s = 0.4 + p * v.radius * 2.2
          v.mesh.scale.set(s, s, 1)
          v.mesh.material.opacity = 0.9 * (1 - p)
          break
        }
        case 'heal':
        case 'buff':
        case 'shield':
          v.mesh.position.y = 0.2 + p * 1.4
          v.mesh.material.opacity = 1 - p
          break
        case 'die':
        case 'shatter':
          v.mesh.scale.setScalar(1 + p * 1.6)
          v.mesh.material.opacity = 0.7 * (1 - p)
          break
        default:
          v.mesh.scale.setScalar(1 + p * 0.8)
      }
      if (v.life <= 0) {
        this.group.remove(v.mesh)
        v.mesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose()
          if (o.material?.dispose) o.material.dispose()
        })
        this.vfx.splice(i, 1)
      }
    }

    for (const f of this.flames) {
      f.scale.y = 1 + Math.sin(elapsed * 9 + f.userData.flicker) * 0.25
    }
  }
}
