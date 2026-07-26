// Générateurs de noms médiéval-fantaisie. Tout passe par le rng du monde
// pour rester déterministe à graine égale.

const VILLAGE_PREFIXES = [
  'Bruyère', 'Pierre', 'Haut', 'Val', 'Font', 'Roche', 'Orme', 'Saule',
  'Brume', 'Clair', 'Mousse', 'Fenil', 'Aube', 'Ronce', 'Grève', 'Houx',
]

const VILLAGE_SUFFIXES = [
  '-le-Haut', '-sur-Lac', '-la-Forêt', 'bourg', 'mont', 'val',
  '-les-Landes', '-la-Grève', '-le-Vieux', 'fontaine', '-aux-Loups', 'lande',
]

const HOUSE_PREFIXES = [
  'Fer', 'Ombre', 'Brune', 'Clair', 'Vald', 'Mor', 'Aube', 'Ronce',
  'Cendre', 'Givre', 'Sombre', 'Orme', 'Roc', 'Lys', 'Corbe', 'Hêtre',
]

const HOUSE_SUFFIXES = [
  'val', 'lac', 'mont', 'bois', 'fort', 'lande', 'rive', 'garde',
  'feuille', 'marche', 'noire', 'vent',
]

const FIRST_NAMES = [
  'Aldric', 'Mérovée', 'Brunehilde', 'Ysolt', 'Garin', 'Odeline', 'Thibaut',
  'Aveline', 'Rombaut', 'Sigrid', 'Enguerrand', 'Maëlle', 'Aubin', 'Berthe',
  'Corentin', 'Douce', 'Évrard', 'Frida', 'Gautier', 'Héloïse', 'Isembart',
  'Jehanne', 'Léofric', 'Mahaut', 'Nivard', 'Orable', 'Perceval', 'Rosamonde',
  'Séverin', 'Tiphaine', 'Ulric', 'Vianne', 'Wistan', 'Ygerne', 'Bertrand',
  'Alix', 'Foulque', 'Ermengarde', 'Renaud', 'Basine',
]

const EPITHETS = [
  'le Sage', 'la Brave', 'le Taciturne', 'aux Mains d’Or', 'le Bâtisseur',
  'la Prudente', 'le Hardi', 'des Brumes', 'le Vieux', 'la Douce',
  'au Poing de Fer', 'le Rêveur', 'la Loyale', 'sans Terre',
]

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)]
}

export function makeNamePools(rng) {
  const usedVillages = new Set()
  const usedHouses = new Set()

  return {
    villageName() {
      for (let i = 0; i < 40; i++) {
        const name = pick(rng, VILLAGE_PREFIXES) + pick(rng, VILLAGE_SUFFIXES)
        if (!usedVillages.has(name)) {
          usedVillages.add(name)
          return name
        }
      }
      return `Hameau ${usedVillages.size + 1}`
    },

    houseName() {
      for (let i = 0; i < 40; i++) {
        const name = pick(rng, HOUSE_PREFIXES) + pick(rng, HOUSE_SUFFIXES)
        if (!usedHouses.has(name)) {
          usedHouses.add(name)
          return name
        }
      }
      return `Lignée ${usedHouses.size + 1}`
    },

    firstName() {
      return pick(rng, FIRST_NAMES)
    },

    epithet() {
      return pick(rng, EPITHETS)
    },
  }
}
