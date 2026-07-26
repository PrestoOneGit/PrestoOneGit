// Export vidéo d'une ascension, en 60 images par seconde.
//
// Le point délicat : `canvas.captureStream(60)` filme EN TEMPS RÉEL. Si le
// rendu tombe à 30 images/s, la vidéo perd la moitié de ses images. Or la
// simulation est déterministe, donc rien n'oblige à filmer en direct.
//
// On ouvre donc le flux avec `captureStream(0)` — aucune capture
// automatique — et on réclame chaque image à la main avec `requestFrame()`
// après avoir avancé la simulation d'exactement 1/60 de seconde. La vidéo
// est alors parfaitement fluide même si la machine met une seconde à
// calculer une image, et le fichier dure exactement le temps simulé.

const FPS = 60
const STEP = 1 / FPS

// MP4 en H.264 d'abord : c'est le format qu'un logiciel de montage accepte
// sans broncher. Les navigateurs de bureau (Chrome, Vivaldi, Edge) l'ont ;
// les versions dépouillées de Chromium, non — elles répondent alors
// `video/mp4` tout court et y mettent du VP9, ce qui reste lisible par VLC
// et les navigateurs mais pas par tous les montages. Dernier recours : WebM,
// que tout le monde sait produire.
const FORMATS = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
]

function meilleurFormat() {
  if (typeof MediaRecorder === 'undefined') return null
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) ?? null
}

export function enregistrementDisponible() {
  return meilleurFormat() !== null
}

export class Enregistreur {
  // `dessiner(dt)` doit avancer la simulation de dt puis rendre une image.
  // `terminee()` dit quand la run est finie.
  constructor({ canvas, dessiner, terminee, onProgress }) {
    this.canvas = canvas
    this.dessiner = dessiner
    this.terminee = terminee
    this.onProgress = onProgress
    this.actif = false
    this.annule = false
  }

  arreter() {
    this.annule = true
  }

  async enregistrer({ maxSecondes = 600 } = {}) {
    const format = meilleurFormat()
    if (!format) throw new Error('Ce navigateur ne sait pas encoder de vidéo (MediaRecorder absent).')

    const stream = this.canvas.captureStream(0) // 0 = aucune image automatique
    const track = stream.getVideoTracks()[0]
    if (!track?.requestFrame) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('Capture image par image indisponible sur ce navigateur.')
    }

    const morceaux = []
    const rec = new MediaRecorder(stream, {
      mimeType: format.mime,
      videoBitsPerSecond: 12_000_000,
    })
    rec.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data) }
    const fini = new Promise((resolve) => { rec.onstop = resolve })

    this.actif = true
    this.annule = false
    rec.start()

    const maxImages = Math.round(maxSecondes * FPS)
    let images = 0
    try {
      while (!this.terminee() && !this.annule && images < maxImages) {
        this.dessiner(STEP)
        track.requestFrame()
        images++
        // Rendre la main au navigateur régulièrement : sans ça l'onglet
        // gèle et l'encodeur n'a jamais l'occasion de vider sa file.
        if (images % 6 === 0) {
          this.onProgress?.(images / FPS)
          await new Promise((r) => setTimeout(r, 0))
        }
      }
    } finally {
      rec.stop()
      await fini
      stream.getTracks().forEach((t) => t.stop())
      this.actif = false
    }

    return {
      blob: new Blob(morceaux, { type: format.mime }),
      ext: format.ext,
      secondes: images / FPS,
      images,
    }
  }
}

export function telechargerVideo(blob, nom) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
