// Toutes les règles du jeu sous forme de données : classes, capacités,
// afflictions, bestiaire, paliers. Aucune logique ici — le moteur les
// interprète. Ce format est pensé pour être exporté tel quel en JSON
// lors du portage du moteur vers Python/GPU.

// ---- Afflictions (négatives) et buffs (positifs) ----
// burn/poison : dégâts sur la durée. slow : -40 % vitesse. stun : aucune
// action. vuln : +30 % dégâts subis. shield : absorbe X dégâts.
// bless : +25 % dégâts infligés. stance : -35 % dégâts subis.

export const AFFLICTION_DURATIONS = { burn: 3, poison: 6, slow: 2.5, stun: 1.1, vuln: 5 }
export const BURN_DPS = 5
export const POISON_DPS_PER_STACK = 2.5
export const POISON_MAX_STACKS = 5
export const SLOW_FACTOR = 0.6
export const VULN_FACTOR = 1.3
export const BLESS_FACTOR = 1.25
export const STANCE_FACTOR = 0.65
export const BLESS_DURATION = 6
export const STANCE_DURATION = 5

// ---- Capacités ----
// target : enemy | ally | self | allies (zone autour du lanceur)
// kind   : dmg | aoe | heal | aoeheal | buff | taunt | drain
// applies : afflictions posées sur la/les cibles (ennemies) ; buff : sur soi/allié

export const CLASSES = [
  {
    id: 'chevalier',
    label: 'Chevalier',
    color: '#8f9db0',
    hp: 300, mana: 60, manaRegen: 2.2,
    dmg: 12, range: 1.9, cooldown: 1.1, speed: 4.0,
    abilities: [
      { id: 'coup_bouclier', label: 'Coup de bouclier', cost: 12, cd: 5, range: 1.9, kind: 'dmg', power: 18, applies: { stun: 1 } },
      { id: 'provocation', label: 'Provocation', cost: 15, cd: 9, range: 8, kind: 'taunt', power: 0, duration: 3.5 },
      { id: 'posture', label: 'Posture défensive', cost: 12, cd: 10, range: 0, kind: 'buff', buff: 'stance', target: 'self' },
    ],
  },
  {
    id: 'berserker',
    label: 'Berserker',
    color: '#b0553a',
    hp: 210, mana: 50, manaRegen: 2.0,
    dmg: 20, range: 1.9, cooldown: 0.95, speed: 4.6,
    // Passif : +40 % dégâts sous 35 % PV (géré par le moteur)
    abilities: [
      { id: 'frappe_lourde', label: 'Frappe lourde', cost: 12, cd: 4, range: 1.9, kind: 'dmg', power: 42 },
      { id: 'tourbillon', label: 'Tourbillon', cost: 18, cd: 7, range: 0, kind: 'aoe', power: 26, radius: 2.6, center: 'self' },
      { id: 'cri_guerre', label: 'Cri de guerre', cost: 14, cd: 12, range: 0, kind: 'buff', buff: 'bless', target: 'self' },
    ],
  },
  {
    id: 'archere',
    label: 'Archère',
    color: '#7a9e64',
    hp: 150, mana: 55, manaRegen: 2.2,
    dmg: 15, range: 10, cooldown: 0.85, speed: 4.8,
    abilities: [
      { id: 'tir_precis', label: 'Tir précis', cost: 12, cd: 4, range: 11, kind: 'dmg', power: 38 },
      { id: 'tir_handicapant', label: 'Tir handicapant', cost: 10, cd: 6, range: 10, kind: 'dmg', power: 14, applies: { slow: 1 } },
      { id: 'pluie_fleches', label: 'Pluie de flèches', cost: 20, cd: 9, range: 9, kind: 'aoe', power: 20, radius: 2.4 },
    ],
  },
  {
    id: 'mage',
    label: 'Mage',
    color: '#5d93b4',
    hp: 130, mana: 90, manaRegen: 3.0,
    dmg: 13, range: 8.5, cooldown: 1.0, speed: 4.0,
    abilities: [
      { id: 'boule_feu', label: 'Boule de feu', cost: 22, cd: 5, range: 8.5, kind: 'aoe', power: 30, radius: 2.4, applies: { burn: 1 } },
      { id: 'eclair_givre', label: 'Éclair de givre', cost: 14, cd: 4, range: 8.5, kind: 'dmg', power: 26, applies: { slow: 1 } },
      { id: 'nova', label: 'Nova arcanique', cost: 40, cd: 14, range: 0, kind: 'aoe', power: 55, radius: 3.6, center: 'self' },
    ],
  },
  {
    id: 'clerc',
    label: 'Clerc',
    color: '#c9a96e',
    hp: 170, mana: 85, manaRegen: 3.0,
    dmg: 10, range: 7, cooldown: 1.05, speed: 4.2,
    abilities: [
      { id: 'soin', label: 'Soin', cost: 16, cd: 3, range: 8, kind: 'heal', power: 45 },
      { id: 'cercle_soin', label: 'Cercle de soin', cost: 30, cd: 10, range: 0, kind: 'aoeheal', power: 26, radius: 4.5, center: 'self' },
      { id: 'benediction', label: 'Bénédiction', cost: 18, cd: 12, range: 8, kind: 'buff', buff: 'bless', target: 'ally' },
    ],
  },
  {
    id: 'occultiste',
    label: 'Occultiste',
    color: '#7a5f9e',
    hp: 145, mana: 80, manaRegen: 2.8,
    dmg: 12, range: 8, cooldown: 1.0, speed: 4.2,
    abilities: [
      { id: 'malediction', label: 'Malédiction', cost: 14, cd: 6, range: 8.5, kind: 'dmg', power: 10, applies: { vuln: 1 } },
      { id: 'nuee_toxique', label: 'Nuée toxique', cost: 20, cd: 7, range: 8, kind: 'aoe', power: 8, radius: 2.6, applies: { poison: 2 } },
      { id: 'drain', label: 'Drain de vie', cost: 16, cd: 5, range: 7.5, kind: 'drain', power: 24 },
    ],
  },
]

// ---- Bestiaire ----
// ai : melee (fonce au contact) | ranged (garde ses distances) |
//      healer (soigne le monstre le plus blessé) | boss
// Un scaling exponentiel par étage s'applique par-dessus (voir engine).

export const MONSTERS = {
  rat: { label: 'Rat géant', hp: 30, dmg: 6, speed: 4.4, range: 1.1, cooldown: 1.0, size: 0.4, ai: 'melee', cost: 1 },
  gobelin: { label: 'Gobelin', hp: 45, dmg: 8, speed: 3.9, range: 1.2, cooldown: 0.9, size: 0.5, ai: 'melee', cost: 2 },
  orc: { label: 'Orc', hp: 110, dmg: 14, speed: 3.0, range: 1.5, cooldown: 1.3, size: 0.8, ai: 'melee', cost: 4 },
  chaman: { label: 'Chaman', hp: 70, dmg: 8, speed: 3.2, range: 7, cooldown: 1.6, size: 0.6, ai: 'healer', heal: 18, cost: 5 },
  araignee: { label: 'Araignée', hp: 60, dmg: 9, speed: 4.6, range: 1.3, cooldown: 1.0, size: 0.6, ai: 'melee', applies: { poison: 1 }, cost: 4 },
  golem: { label: 'Golem', hp: 220, dmg: 16, speed: 2.2, range: 1.7, cooldown: 1.6, size: 1.1, ai: 'melee', armor: 0.35, cost: 7 },
  spectre: { label: 'Spectre', hp: 80, dmg: 13, speed: 3.8, range: 6.5, cooldown: 1.4, size: 0.7, ai: 'ranged', pierceArmor: true, cost: 6 },
  pyromant: { label: 'Pyromant', hp: 75, dmg: 12, speed: 3.0, range: 7.5, cooldown: 1.8, size: 0.65, ai: 'ranged', aoe: 2.0, applies: { burn: 1 }, cost: 7 },
  troll: { label: 'Troll', hp: 320, dmg: 20, speed: 2.6, range: 1.8, cooldown: 1.5, size: 1.25, ai: 'melee', regen: 4, cost: 10 },
  liche: { label: 'Liche', hp: 160, dmg: 16, speed: 2.8, range: 8, cooldown: 1.6, size: 0.9, ai: 'ranged', applies: { vuln: 1 }, cost: 11 },
}

// Boss : versions surdimensionnées avec capacité de zone périodique.
export const BOSSES = {
  roi_gobelin: { label: 'Roi gobelin', base: 'gobelin', hpMult: 14, dmgMult: 2.2, size: 1.3, slamCd: 7, slamRadius: 2.8, slamMult: 1.8 },
  chef_orc: { label: 'Chef de guerre orc', base: 'orc', hpMult: 10, dmgMult: 2.0, size: 1.5, slamCd: 6.5, slamRadius: 3.0, slamMult: 1.7 },
  matriarche: { label: 'Matriarche arachnide', base: 'araignee', hpMult: 12, dmgMult: 1.9, size: 1.5, slamCd: 6, slamRadius: 2.8, slamMult: 1.5, applies: { poison: 2 } },
  colosse: { label: 'Colosse de pierre', base: 'golem', hpMult: 7, dmgMult: 1.8, size: 1.7, slamCd: 8, slamRadius: 3.4, slamMult: 2.0 },
  seigneur_liche: { label: 'Seigneur liche', base: 'liche', hpMult: 9, dmgMult: 1.9, size: 1.5, slamCd: 6.5, slamRadius: 3.0, slamMult: 1.6, applies: { vuln: 1 } },
}

// ---- Paliers : quels monstres apparaissent à partir de quel étage ----

export const TIERS = [
  { fromFloor: 1, pool: ['rat', 'gobelin'], boss: 'roi_gobelin', ambiance: '#dbc394' },
  { fromFloor: 10, pool: ['gobelin', 'orc', 'chaman'], boss: 'chef_orc', ambiance: '#c9b490' },
  { fromFloor: 25, pool: ['orc', 'chaman', 'araignee', 'golem'], boss: 'matriarche', ambiance: '#a8b09a' },
  { fromFloor: 50, pool: ['araignee', 'golem', 'spectre', 'pyromant'], boss: 'colosse', ambiance: '#8f96a8' },
  { fromFloor: 75, pool: ['spectre', 'pyromant', 'troll', 'chaman'], boss: 'seigneur_liche', ambiance: '#7a7290' },
  { fromFloor: 100, pool: ['troll', 'liche', 'pyromant', 'golem'], boss: 'seigneur_liche', ambiance: '#5f5470' },
]

export function tierForFloor(floor) {
  let tier = TIERS[0]
  for (const t of TIERS) if (floor >= t.fromFloor) tier = t
  return tier
}

// ---- Scaling ----
// Les héros gagnent de la puissance à chaque étage franchi (montée en
// niveau automatique) ; les monstres grimpent un peu plus vite : le mur
// arrive progressivement, et le repousser demande de mieux jouer.

export const HERO_GROWTH = 1.04 // par étage franchi (PV, dégâts, mana)
export const MONSTER_GROWTH = 1.055 // par étage (PV, dégâts)
export const FLOOR_BUDGET = (floor) => 8 + floor * 3 // points de monstres
export const ELITE_FROM_FLOOR = 15
export const ELITE_CHANCE = 0.18
export const ELITE_MULT = { hp: 1.8, dmg: 1.5 }
export const MAX_FLOOR = 100 // cap du prototype (1000 pour la phase GPU)
export const RESTS_PER_RUN = 3
export const FLOOR_TIME_LIMIT = 45 // secondes sim par étage avant échec
export const REGEN_BETWEEN_FLOORS = { hp: 0.25, mana: 0.5 } // fraction du manquant
