// Toutes les règles du jeu sous forme de données : états, classes,
// capacités, bestiaire, cartes de draft. Aucune logique ici — le moteur
// les interprète. Ce format est pensé pour être exporté tel quel en JSON
// lors du portage du moteur vers Python/GPU.

// ─────────────────────────── ÉTATS ───────────────────────────
// Un système unifié : toute entité (agent, monstre, invocation) porte les
// mêmes états. `dot` = dégâts par seconde. `stacks` = cumulable.

export const STATES = {
  // Négatifs
  burn: { label: 'En feu', dot: 6, duration: 3.5, negative: true },
  poison: { label: 'Empoisonné', dot: 2.6, duration: 6, negative: true, stacks: 5 },
  shock: { label: 'Électrifié', dot: 4, duration: 2.5, negative: true, spreads: true },
  freeze: { label: 'Gelé', duration: 2.2, negative: true, immobilizes: true },
  slow: { label: 'Ralenti', duration: 2.5, negative: true, speedMult: 0.6 },
  stun: { label: 'Étourdi', duration: 1.1, negative: true, immobilizes: true },
  vuln: { label: 'Vulnérable', duration: 5, negative: true, incomingMult: 1.3 },
  bleed: { label: 'Saignement', dot: 3, duration: 5, negative: true, worseWhenMoving: true },
  terror: { label: 'Terreur', duration: 2.6, negative: true, flees: true },
  // Positifs
  bless: { label: 'Béni', duration: 6, outgoingMult: 1.25 },
  haste: { label: 'Hâte', duration: 5, speedMult: 1.35, cooldownMult: 0.75 },
  shield: { label: 'Bouclier', duration: 8, absorbs: true },
  regen: { label: 'Régénération', duration: 6, heal: 7 },
  stance: { label: 'Posture', duration: 5, incomingMult: 0.65 },
  intangible: { label: 'Intangible', duration: 2.4, invulnerable: true, phases: true },
}

export const STATE_KEYS = Object.keys(STATES)

// Interactions élémentaires. Peu nombreuses mais lisibles : c'est là que
// naît la profondeur émergente, quand un agent apprend à geler avant de
// frapper lourd.
export const HEAVY_HIT_THRESHOLD = 30 // au-delà, un coup brise le gel

export const INTERACTIONS = {
  // Gelé + coup lourd → le gel se brise et le coup fait double
  freezeShatter: { multiplier: 2 },
  // En feu + Gelé s'annulent mutuellement
  fireCancelsFreeze: true,
  // Électrifié se propage à un ennemi proche ; sur une cible gelée, à deux
  shockChainRange: 3.5,
  shockChainOnFrozen: 2,
  // Empoisonné + En feu → combustion toxique, dégâts du poison doublés
  toxicCombustion: 2,
}

// ─────────────────────────── CLASSES ───────────────────────────
// Chaque classe a quatre capacités, mais un agent n'en connaît qu'UNE au
// départ : les autres s'obtiennent au draft. `starter` désigne celle qu'il
// possède au niveau 1.
//
// Types de capacités (`kind`) interprétés par le moteur :
//   bolt      projectile à cible unique, exige une ligne de vue
//   melee     coup au contact
//   aoe       zone centrée sur un point visé
//   selfAoe   zone centrée sur le lanceur
//   pierce    trait qui traverse tous les ennemis alignés
//   heal / aoeHeal / shieldAlly / buffSelf / buffTeam / zone
//   summon    invoque une créature
//   wall      pose un mur temporaire
//   trap      pose un piège
//   dash / charge / blink / swap
//   raise     relève les cadavres proches
//   corpseBoom fait exploser un cadavre
//   seal      ferme un portail
//   revive    relève un allié tombé

export const CLASSES = [
  {
    id: 'chevalier',
    label: 'Chevalier',
    color: '#8f9db0',
    hp: 320, mana: 70, manaRegen: 2.4,
    dmg: 13, range: 1.9, cooldown: 1.1, speed: 4.0,
    starter: 'frappe_bouclier',
    abilities: [
      { id: 'frappe_bouclier', label: 'Frappe de bouclier', kind: 'melee', cost: 10, cd: 2.8, range: 2.0, power: 30, applies: { stun: 1 } },
      { id: 'provocation', label: 'Provocation', kind: 'taunt', cost: 16, cd: 9, range: 8, duration: 3.5 },
      { id: 'mur_garde', label: 'Mur de garde', kind: 'wall', cost: 22, cd: 14, range: 5, duration: 8, length: 3 },
      { id: 'charge', label: 'Charge', kind: 'charge', cost: 14, cd: 8, range: 8, power: 24, applies: { stun: 1 } },
    ],
  },
  {
    id: 'berserk',
    label: 'Berserk',
    color: '#b0553a',
    hp: 240, mana: 55, manaRegen: 2.0,
    dmg: 24, range: 2.1, cooldown: 1.25, speed: 4.4,
    // Passif : plus il lui manque de PV, plus il frappe fort.
    passive: 'rageEchoes',
    starter: 'coup_taille',
    abilities: [
      { id: 'coup_taille', label: 'Coup de taille', kind: 'melee', cost: 8, cd: 3.4, range: 2.2, power: 36, heavy: true },
      { id: 'fauchage', label: 'Fauchage', kind: 'selfAoe', cost: 18, cd: 6.5, radius: 3.0, power: 32, heavy: true },
      { id: 'rage_noire', label: 'Rage noire', kind: 'buffSelf', cost: 10, cd: 16, buff: 'bless', selfDamage: 0.12, extra: 'frenzy' },
      { id: 'charge_brutale', label: 'Charge brutale', kind: 'charge', cost: 16, cd: 9, range: 9, power: 30, applies: { bleed: 1 } },
    ],
  },
  {
    id: 'archere',
    label: 'Archère',
    color: '#7a9e64',
    hp: 155, mana: 60, manaRegen: 2.3,
    dmg: 16, range: 10, cooldown: 0.85, speed: 4.8,
    starter: 'tir_precis',
    abilities: [
      { id: 'tir_precis', label: 'Tir précis', kind: 'bolt', cost: 9, cd: 2.6, range: 11, power: 31 },
      { id: 'fleche_perforante', label: 'Flèche perforante', kind: 'pierce', cost: 20, cd: 8, range: 12, power: 40 },
      { id: 'piege_machoires', label: 'Piège à mâchoires', kind: 'trap', cost: 16, cd: 11, range: 6, applies: { freeze: 1 }, damage: 18 },
      { id: 'roulade', label: 'Roulade', kind: 'dash', cost: 8, cd: 6, distance: 5, applies: { intangible: 0.5 } },
    ],
  },
  {
    id: 'mage',
    label: 'Mage',
    color: '#5d93b4',
    hp: 135, mana: 100, manaRegen: 3.2,
    dmg: 12, range: 9, cooldown: 1.0, speed: 4.0,
    starter: 'light_arrow',
    abilities: [
      { id: 'light_arrow', label: 'Trait de lumière', kind: 'bolt', cost: 8, cd: 2.2, range: 9.5, power: 28 },
      { id: 'freeze', label: 'Gel', kind: 'aoe', cost: 22, cd: 9, range: 8.5, radius: 2.2, power: 10, applies: { freeze: 1 } },
      { id: 'explosion', label: 'Explosion', kind: 'aoe', cost: 52, cd: 15, range: 8, radius: 4.2, power: 78, applies: { burn: 1 } },
      { id: 'shadow_step', label: 'Pas d’ombre', kind: 'blink', cost: 18, cd: 12, distance: 9, applies: { intangible: 1 } },
    ],
  },
  {
    id: 'clerc',
    label: 'Clerc',
    color: '#c9a96e',
    hp: 180, mana: 95, manaRegen: 3.2,
    dmg: 11, range: 7.5, cooldown: 1.05, speed: 4.2,
    starter: 'chatiment',
    abilities: [
      { id: 'chatiment', label: 'Châtiment', kind: 'bolt', cost: 8, cd: 2.4, range: 8, power: 24 },
      { id: 'soin', label: 'Soin', kind: 'heal', cost: 16, cd: 3.5, range: 8, power: 52 },
      { id: 'sanctuaire', label: 'Sanctuaire', kind: 'zone', cost: 34, cd: 16, range: 6, radius: 3.4, duration: 8, applies: { regen: 1 }, allies: true },
      { id: 'intervention', label: 'Intervention', kind: 'shieldAlly', cost: 24, cd: 12, range: 9, shield: 70, pull: true },
    ],
  },
  {
    id: 'occultiste',
    label: 'Occultiste',
    color: '#7a5f9e',
    hp: 150, mana: 90, manaRegen: 2.9,
    dmg: 12, range: 8.5, cooldown: 1.0, speed: 4.2,
    starter: 'eclat_ombre',
    abilities: [
      { id: 'eclat_ombre', label: 'Éclat d’ombre', kind: 'bolt', cost: 8, cd: 2.3, range: 9, power: 26 },
      { id: 'nuee_toxique', label: 'Nuée toxique', kind: 'zone', cost: 26, cd: 11, range: 8, radius: 2.8, duration: 7, applies: { poison: 1 }, damage: 5 },
      { id: 'malediction', label: 'Malédiction', kind: 'bolt', cost: 16, cd: 7, range: 9, power: 12, applies: { vuln: 1 }, siphon: true },
      { id: 'sceau_scellement', label: 'Sceau de scellement', kind: 'seal', cost: 30, cd: 20, range: 10, duration: 9 },
    ],
  },
  {
    id: 'invocateur',
    label: 'Invocateur',
    color: '#4f9e8e',
    hp: 145, mana: 100, manaRegen: 3.0,
    dmg: 11, range: 8, cooldown: 1.05, speed: 4.1,
    starter: 'eclat_invocation',
    abilities: [
      { id: 'eclat_invocation', label: 'Éclat d’invocation', kind: 'bolt', cost: 8, cd: 2.4, range: 8.5, power: 24 },
      { id: 'invoque_slime', label: 'Invoque un slime', kind: 'summon', cost: 15, cd: 7, summon: 'slime_allie', max: 2 },
      { id: 'invoque_golem', label: 'Invoque un golem', kind: 'summon', cost: 36, cd: 20, summon: 'golem_allie', max: 1 },
      { id: 'permutation', label: 'Permutation', kind: 'swap', cost: 12, cd: 8, applies: { intangible: 0.6 } },
    ],
  },
  {
    id: 'necromancien',
    label: 'Nécromancien',
    color: '#6b7f5e',
    hp: 150, mana: 95, manaRegen: 3.0,
    dmg: 11, range: 8, cooldown: 1.05, speed: 4.1,
    starter: 'eclat_os',
    abilities: [
      { id: 'eclat_os', label: 'Éclat d’os', kind: 'bolt', cost: 8, cd: 2.3, range: 8.5, power: 25 },
      { id: 'lever_morts', label: 'Lever les morts', kind: 'raise', cost: 20, cd: 12, range: 7, summon: 'squelette_allie', max: 4 },
      { id: 'explosion_cadavre', label: 'Explosion de cadavre', kind: 'corpseBoom', cost: 18, cd: 6, range: 8, radius: 3.0, power: 46 },
      { id: 'linceul_os', label: 'Linceul d’os', kind: 'buffSelf', cost: 20, cd: 14, buff: 'shield', shield: 60, consumesSummons: true },
    ],
  },
  {
    id: 'lutin',
    label: 'Lutin',
    color: '#c98fb4',
    hp: 120, mana: 85, manaRegen: 3.4,
    dmg: 10, range: 7, cooldown: 0.8, speed: 5.4,
    starter: 'dard',
    abilities: [
      { id: 'dard', label: 'Dard', kind: 'bolt', cost: 6, cd: 1.9, range: 7.5, power: 19 },
      { id: 'poussiere_entrain', label: 'Poussière d’entrain', kind: 'zone', cost: 20, cd: 14, range: 5, radius: 3.6, duration: 7, applies: { haste: 1 }, allies: true },
      { id: 'chant_bravoure', label: 'Chant de bravoure', kind: 'buffTeam', cost: 18, cd: 15, buff: 'bless', range: 12 },
      { id: 'bond_farceur', label: 'Bond farceur', kind: 'dash', cost: 10, cd: 7, distance: 6, blessAlly: true },
    ],
  },
]

export const CLASS_IDS = CLASSES.map((c) => c.id)

// ─────────────────────────── CARTES DE DRAFT ───────────────────────────
// À chaque niveau, trois cartes tirées au sort ; le réseau en choisit une.
// Trois natures : une capacité de classe encore inconnue, un passif commun,
// ou le renfort d'une capacité déjà possédée.

export const PASSIVES = [
  { id: 'celerite', label: 'Célérité', desc: '+14 % vitesse', mult: { speed: 1.14 } },
  { id: 'vivacite', label: 'Vivacité', desc: '−12 % cooldowns', mult: { cooldown: 0.88 } },
  { id: 'endurance', label: 'Endurance', desc: '+22 % PV max', mult: { hp: 1.22 } },
  { id: 'concentration', label: 'Concentration', desc: '+30 % mana et régén', mult: { mana: 1.3 } },
  { id: 'vampirisme', label: 'Vampirisme', desc: '8 % des dégâts soignent', lifesteal: 0.08 },
  { id: 'esquive', label: 'Esquive', desc: '12 % de chance d’ignorer un coup', dodge: 0.12 },
  { id: 'allonge', label: 'Allonge', desc: '+18 % portée', mult: { range: 1.18 } },
  { id: 'resilience', label: 'Résilience', desc: 'afflictions écourtées de 30 %', mult: { afflictionDuration: 0.7 } },
  { id: 'curee', label: 'Curée', desc: '+18 % dégâts sur cibles blessées', executeBonus: 0.18 },
  { id: 'pas_assure', label: 'Pas assuré', desc: 'immunisé au ralentissement', immune: ['slow'] },
]

// Renforts applicables à une capacité déjà possédée.
export const REINFORCEMENTS = [
  { id: 'ampleur', label: 'Ampleur', desc: '+35 % de rayon', field: 'radius', mult: 1.35, needs: 'radius' },
  { id: 'puissance', label: 'Puissance', desc: '+30 % de puissance', field: 'power', mult: 1.3, needs: 'power' },
  { id: 'promptitude', label: 'Promptitude', desc: '−30 % de recharge', field: 'cd', mult: 0.7 },
  { id: 'economie', label: 'Économie', desc: '−35 % de coût en mana', field: 'cost', mult: 0.65 },
  { id: 'portee_sort', label: 'Portée accrue', desc: '+30 % de portée', field: 'range', mult: 1.3, needs: 'range' },
]

export const CARDS_PER_LEVEL = 3
export const UPGRADE_EVERY = 1 // un draft à chaque étage franchi

// ─────────────────────────── BESTIAIRE ───────────────────────────
// Dark fantasy. Chaque entrée a un comportement propre : ce ne sont pas
// des sacs de points de vie interchangeables.
//
// ai : melee | ranged | healer | caster
// Traits spéciaux interprétés par le moteur : split, revive, packHunt,
// commands, flying, phasing, regen, webs, breaksWalls, summons.

export const MONSTERS = {
  gobelin: {
    label: 'Gobelin', hp: 42, dmg: 8, speed: 4.0, range: 1.2, cooldown: 0.9,
    size: 0.5, ai: 'melee', cost: 2, coward: true,
  },
  slime: {
    label: 'Slime', hp: 60, dmg: 9, speed: 2.4, range: 1.2, cooldown: 1.2,
    size: 0.6, ai: 'melee', cost: 4, split: 1,
  },
  squelette: {
    label: 'Squelette', hp: 55, dmg: 11, speed: 3.4, range: 1.3, cooldown: 1.0,
    size: 0.6, ai: 'melee', cost: 3, revive: 1,
  },
  loup: {
    label: 'Loup', hp: 48, dmg: 13, speed: 5.2, range: 1.2, cooldown: 0.85,
    size: 0.55, ai: 'melee', cost: 4, packHunt: true, applies: { bleed: 1 },
  },
  serpent: {
    label: 'Serpent', hp: 40, dmg: 8, speed: 4.6, range: 1.3, cooldown: 1.1,
    size: 0.45, ai: 'melee', cost: 3, applies: { poison: 1 }, hitAndRun: true,
  },
  orc: {
    label: 'Orc', hp: 130, dmg: 16, speed: 3.0, range: 1.6, cooldown: 1.3,
    size: 0.85, ai: 'melee', cost: 5,
  },
  hobgobelin: {
    label: 'Hobgobelin', hp: 165, dmg: 18, speed: 3.2, range: 1.7, cooldown: 1.2,
    size: 1.0, ai: 'melee', cost: 8, commands: 'gobelin',
  },
  chauve_souris: {
    label: 'Chauve-souris sanguine', hp: 45, dmg: 10, speed: 5.0, range: 1.2, cooldown: 0.9,
    size: 0.45, ai: 'melee', cost: 4, flying: true, drain: 0.6,
  },
  araignee: {
    label: 'Araignée', hp: 70, dmg: 11, speed: 4.0, range: 1.4, cooldown: 1.1,
    size: 0.65, ai: 'melee', cost: 5, webs: true, applies: { poison: 1 },
  },
  goule: {
    label: 'Goule', hp: 85, dmg: 15, speed: 4.4, range: 1.4, cooldown: 1.0,
    size: 0.7, ai: 'melee', cost: 6, revive: 1, feedsOnCorpses: true,
  },
  golem_pierre: {
    label: 'Golem de pierre', hp: 280, dmg: 20, speed: 2.0, range: 1.8, cooldown: 1.7,
    size: 1.15, ai: 'melee', cost: 9, armor: 0.4, breaksWalls: true,
  },
  spectre: {
    label: 'Spectre', hp: 90, dmg: 15, speed: 3.6, range: 6.5, cooldown: 1.5,
    size: 0.7, ai: 'ranged', cost: 7, phasing: true, pierceArmor: true,
  },
  troll: {
    label: 'Troll', hp: 340, dmg: 22, speed: 2.6, range: 1.9, cooldown: 1.5,
    size: 1.25, ai: 'melee', cost: 11, regen: 5,
  },
  liche: {
    label: 'Liche', hp: 200, dmg: 17, speed: 2.6, range: 8.5, cooldown: 1.8,
    size: 0.95, ai: 'caster', cost: 13, summons: 'squelette',
    spells: [
      { applies: { freeze: 1 }, radius: 2.2, power: 14 },
      { applies: { shock: 1 }, radius: 0, power: 22 },
    ],
  },
}

// Créatures invoquées par les agents. Même moteur que les monstres, camp
// opposé. Elles ne comptent PAS comme alliés pour les soins du Clerc.
export const SUMMONS = {
  slime_allie: {
    label: 'Slime', hp: 70, dmg: 8, speed: 3.6, range: 1.2, cooldown: 1.0,
    size: 0.55, color: '#4f9e8e', life: 22, applies: { slow: 1 },
  },
  golem_allie: {
    label: 'Golem', hp: 220, dmg: 16, speed: 2.2, range: 1.7, cooldown: 1.5,
    size: 1.05, color: '#5f7a72', life: 30, taunts: true,
  },
  squelette_allie: {
    label: 'Squelette', hp: 55, dmg: 12, speed: 3.6, range: 1.3, cooldown: 1.0,
    size: 0.6, color: '#a8a294', life: 18,
  },
}

// ─────────────────────────── PALIERS ───────────────────────────

export const TIERS = [
  { fromFloor: 1, pool: ['gobelin', 'slime', 'loup'], boss: 'hobgobelin', ambiance: '#3a3630' },
  { fromFloor: 5, pool: ['gobelin', 'squelette', 'serpent', 'araignee'], boss: 'orc', ambiance: '#38342e' },
  { fromFloor: 12, pool: ['orc', 'goule', 'chauve_souris', 'araignee'], boss: 'golem_pierre', ambiance: '#33322f' },
  { fromFloor: 22, pool: ['orc', 'spectre', 'golem_pierre', 'goule'], boss: 'troll', ambiance: '#2e3134' },
  { fromFloor: 35, pool: ['spectre', 'troll', 'golem_pierre', 'liche'], boss: 'liche', ambiance: '#2b2d38' },
]

export function tierForFloor(floor) {
  let tier = TIERS[0]
  for (const t of TIERS) if (floor >= t.fromFloor) tier = t
  return tier
}

// ─────────────────────────── DIFFICULTÉ ───────────────────────────
// Plus de croissance exponentielle des statistiques : c'est elle qui
// rendait la mort mathématiquement programmée vers l'étage 10 (les
// monstres gagnaient 5,5 % par étage contre 3,5 % pour les agents).
// La difficulté vient désormais du NOMBRE, de la VARIÉTÉ et de la
// CADENCE des portails — donc de problèmes tactiques, pas d'arithmétique.

// « Très léger » comme demandé : sur trente étages cela ne représente
// qu'un facteur 1,5, à comparer au facteur 4,7 de l'ancienne courbe qui
// rendait la mort arithmétiquement programmée.
export const MONSTER_GROWTH = 1.014
export const FLOOR_BUDGET = (floor) => 7 + floor * 3.4
export const ELITE_FROM_FLOOR = 4
export const ELITE_CHANCE = 0.22
export const ELITE_MULT = { hp: 1.7, dmg: 1.4 }
export const MAX_FLOOR = 100
export const RESTS_PER_RUN = 3

// Le chronomètre s'adapte au contenu de l'étage. Un plafond fixe mesurait
// surtout la patience : un étage plein de monstres et un étage presque
// vide avaient le même délai, et toutes les équipes finissaient par
// « enlisement » sans qu'on puisse les départager. Il reste là uniquement
// pour empêcher le kiting infini.
export const FLOOR_TIME_LIMIT = (floor) => 55 + FLOOR_BUDGET(floor) * 3.2

export const REGEN_BETWEEN_FLOORS = { hp: 0.3, mana: 0.6 }
export const REVIVES_PER_AGENT = 1 // un agent tombé peut être relevé une fois
