// Rapports de run : rejoue un génome avec la journalisation détaillée et
// produit un objet structuré, pensé pour être lu par un LLM ou versé dans
// un tableur — plus un résumé markdown compact quand le JSON est trop long.

import { TICK, TowerRun } from './engine.js'
import { compositionList, describeComposition } from './brain.js'

// Rejoue un run complet en mode journalisé et renvoie le rapport.
export function analyzeRun({ genome, seed, generation = null, fitness = null }) {
  const run = new TowerRun(genome, seed, { logging: true })
  let guard = 0
  while (!run.finished && guard++ < 500000) run.step(TICK)
  return buildReport(run, { generation, fitness })
}

export function buildReport(run, { generation = null, fitness = null } = {}) {
  const agents = run.heroes.map((h) => ({
    slot: h.slot,
    classe: h.cls.id,
    label: h.cls.label,
    niveau: h.level,
    vivant: h.alive,
    etageDeMort: h.stats.deathFloor,
    degatsInfliges: Math.round(h.damage),
    soins: Math.round(h.healing),
    degatsSubis: Math.round(h.damageTaken),
    // La « build » draftée : capacités acquises et passifs pris.
    capacites: h.abilities.map((a) => a.label),
    passifs: h.passives.map((p) => p.label),
    cartesPrises: h.stats.cards,
    utilisation: {
      attaqueDeBase: h.stats.basic,
      capacites: Object.entries(h.stats.abilities).map(([id, fois]) => ({
        id,
        label: h.abilities.find((a) => a.id === id)?.label ?? id,
        fois,
      })),
      dash: h.stats.dash,
      course: h.stats.sprint,
      bond: h.stats.jump,
      invocations: h.stats.summoned,
    },
  }))

  const totalDamage = agents.reduce((s, a) => s + a.degatsInfliges, 0)
  const totalHealing = agents.reduce((s, a) => s + a.soins, 0)

  return {
    meta: {
      generation,
      graine: run.seed,
      fitness: fitness != null ? Math.round(fitness) : Math.round(run.fitness()),
      composition: compositionList(run.genome),
      compositionLisible: describeComposition(run.genome),
      etagesFranchis: run.floorsCleared,
      etageAtteint: run.floor,
      issue: run.endReason,
      dureeSecondes: Number(run.time.toFixed(1)),
      reposUtilises: 3 - run.restsLeft,
      survivants: run.heroes.filter((h) => h.alive).length,
      monstresTues: run.monstersKilled,
    },
    totaux: {
      degats: totalDamage,
      soins: totalHealing,
      degatsSubis: agents.reduce((s, a) => s + a.degatsSubis, 0),
      degatsParSeconde: Number((totalDamage / Math.max(run.time, 1)).toFixed(1)),
    },
    agents,
    etages: run.floorLog.map((f) => ({
      etage: f.floor,
      boss: f.boss,
      terrain: f.archetype,
      portails: f.portals,
      pieges: f.traps,
      duree: f.duration,
      monstres: f.monsters,
      degatsInfliges: Math.round(f.damageDealt),
      degatsSubis: Math.round(f.damageTaken),
      morts: f.deaths,
      reposApres: f.restTaken,
      cartesChoisies: f.cards,
      survivants: f.survivors,
      echec: f.failed ?? false,
    })),
    chronologie: run.timeline,
  }
}

// Résumé court et dense, à coller directement dans un prompt.
export function reportToMarkdown(report) {
  const m = report.meta
  const lines = []
  lines.push(`# Run tour — génération ${m.generation ?? '?'} (graine ${m.graine})`)
  lines.push('')
  lines.push(`**Résultat** : étage ${m.etageAtteint} atteint, ${m.etagesFranchis} franchis, issue « ${m.issue} », ${m.dureeSecondes}s, ${m.survivants}/5 survivants, ${m.monstresTues} monstres tués, ${m.reposUtilises} repos.`)
  lines.push(`**Composition** : ${m.compositionLisible}.`)
  lines.push(`**Totaux** : ${report.totaux.degats} dégâts (${report.totaux.degatsParSeconde}/s), ${report.totaux.soins} soins, ${report.totaux.degatsSubis} subis.`)
  lines.push('')
  lines.push('## Agents et builds draftées')
  lines.push('')
  lines.push('| Classe | Niv | Dégâts | Soins | Subis | Fin | Capacités | Passifs |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const a of report.agents) {
    lines.push(
      `| ${a.label} | ${a.niveau} | ${a.degatsInfliges} | ${a.soins} | ${a.degatsSubis} | ` +
        `${a.etageDeMort ? `étage ${a.etageDeMort}` : 'survit'} | ${a.capacites.join(', ')} | ${a.passifs.join(', ') || '—'} |`
    )
  }
  lines.push('')
  lines.push('## Capacités les plus utilisées')
  lines.push('')
  const uses = []
  for (const a of report.agents) {
    for (const c of a.utilisation.capacites) {
      if (c.fois > 0) uses.push({ agent: a.label, label: c.label, fois: c.fois })
    }
  }
  uses.sort((x, y) => y.fois - x.fois)
  for (const u of uses.slice(0, 10)) lines.push(`- ${u.label} (${u.agent}) : ${u.fois}×`)
  lines.push('')
  lines.push('## Étages')
  lines.push('')
  lines.push('| Étage | Terrain | Portails | Durée | Monstres | Dégâts | Subis | Pertes |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const f of report.etages) {
    const monstres = Object.entries(f.monstres).map(([k, v]) => `${v}× ${k}`).join(', ')
    const morts = f.morts.map((d) => d.agent).join(', ') || '—'
    lines.push(
      `| ${f.etage}${f.echec ? ' (échec)' : ''}${f.boss ? ' BOSS' : ''} | ${f.terrain} | ${f.portails} | ` +
        `${f.duree}s | ${monstres} | ${f.degatsInfliges} | ${f.degatsSubis} | ${morts} |`
    )
  }
  return lines.join('\n')
}

// Compare plusieurs rapports : utile pour demander à un LLM « qu'est-ce
// qui a changé entre la génération 20 et la 300 ? »
export function compareReports(reports) {
  return {
    runs: reports.map((r) => ({
      generation: r.meta.generation,
      etageAtteint: r.meta.etageAtteint,
      composition: r.meta.compositionLisible,
      issue: r.meta.issue,
      degats: r.totaux.degats,
      degatsParSeconde: r.totaux.degatsParSeconde,
      survivants: r.meta.survivants,
      monstresTues: r.meta.monstresTues,
      builds: r.agents.map((a) => ({
        classe: a.label,
        capacites: a.capacites,
        passifs: a.passifs,
      })),
      mobiliteTotale: r.agents.reduce(
        (s, a) => s + a.utilisation.dash + a.utilisation.course + a.utilisation.bond,
        0
      ),
    })),
  }
}
