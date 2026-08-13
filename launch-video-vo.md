# BodyMaps — "One Scan" · VO + shooting script

**Cut:** 2:56 · **Words:** 187 · **Pace:** ~145 wpm (`words ÷ 2.4 ≈ seconds`)
**Speech density:** 78s of voice across 176s — 44%. The silence is the point.

Every viewer URL takes `?hd=1`. Without it the app serves `?res=low` whenever the
JHU server is reachable, so having the tunnel up makes the picture *worse* unless
you ask for full res.

**SRV** marks a block that needs the tunnel.

---

## Shooting script

| Time | On screen | VO |
|---|---|---|
| 0:00 | `/cinematic/17?local=1&start=liver&hold=1800&step=160&speed=0.5` — press **R** to arm. The liver alone on ink, rotating. Holds 1.8s. | *(silence)* |
| 0:04 | Structures step in, one every 160ms, building outward. 23 in total; the lungs are excluded — truncated by the top of the volume, they read as broken geometry. | **One abdominal CT is a thousand images. Somewhere inside them is everything you need to know.** |
| 0:09 | Assembly settles. Cut to `/cards.html` card **1** — the mark resolves out of blur. | *(silence — let the title land)* |
| 0:12 | `/cards.html` press **2**. Four figures count up, ~350ms apart, in accent orange. | **Thirty-six thousand, three hundred ninety scans. A hundred and forty-five medical centers. Nearly a million labeled structures. Introducing BodyMaps.** |
| 0:20 | Cut to the library grid. Scroll it briefly, then move to Upload. | **You can open any one of them, or upload a scan of your own.** |
| 0:26 | **SRV** `/upload` — drag `~/Desktop/test-scan.nii.gz` onto the drop zone. Model picker appears. Start the run; speed-ramp the pipeline. | **Drop in a file, choose a model, and go.** |
| 0:38 | `/case/17?hd=1`, already warm. Three MPR panes, soft-tissue window. | **Thirty-two structures, labeled. Every organ, vessel and bone.** |
| 0:46 | Organ cascade plays out. Then drag the crosshair — all three panes track it, and the 3D pane orients with them. | **In three planes. Axial, coronal, sagittal. And in three dimensions.** |
| 0:56 | Window/level: Soft Tissue → Bone → Lung. Tissue drops away, skeleton resolves, then air. | **Adjust the window to bring out soft tissue, or bone, or lung.** |
| 1:04 | Scrub the slice slider through the stack — one continuous pass, no stutter. | **Scroll the whole volume.** |
| 1:10 | Draw a distance line, then an area. Let the HU readout settle. | **Measure anything. Distance, area, density in Hounsfield units.** |
| 1:18 | Cross the cursor over two or three structures; each names itself. | **Hover a structure and it names itself.** |
| 1:24 | Open the docked Segments panel. Brush a mask edge, smooth it, split a class. | **And where the model got it wrong, the masks are yours to edit.** |
| 1:34 | **SRV** Report opens. Timeline animates node by node; the pancreas row flags amber (`status: "check"`). | **Every case comes with its own report.** |
| 1:42 | **SRV** Select the pancreas finding — it highlights on the scan and in 3D. | **Select a finding and it highlights on the scan.** |
| 1:49 | **SRV** Toggle clinical → plain language. The impression rewrites in place. | **In clinical language. Or in plain English.** |
| 1:56 | `/compare-viewer?a=17&b=44`, pre-warmed. Enable linked slice position and scroll — both cases move together. | **Two scans, side by side. Scroll them as one.** |
| 2:04 | **SRV** Click copy-link, hold on the toast. Replace the URL in post — it copies `window.location.origin`, which off the dev server reads `localhost:5173`. | **Any view you build is a link.** |
| 2:08 | **SRV** Reading session: dictate a line, the draft assembles beneath it, export the bundle. | **Dictate as you read. The session assembles a draft report, and exports as a single bundle.** |
| 2:20 | `/wall?hero=17&n=1200&cols=20&local=1` — press **R**. Case 17's own tile fills the frame. | **That was one scan.** |
| 2:24 | Pull-back begins. The grid resolves around it. | *(beat)* |
| 2:30 | Scroll accelerates down through 1,200 tiles. | **BodyMaps has thirty-six thousand, three hundred and ninety.** |
| 2:34 | ~12s of music only. Scroll runs out, the tumour filter re-flows the grid, type resolves. | *(silence)* |
| 2:46 | `/cards.html` press **3**. Figures, then the mark, then the URL, then the institution. | *(silence)* |
| 2:56 | End. | |

---

## Continuous read

Record straight through with a beat of silence between paragraphs.

> One abdominal CT is a thousand images. Somewhere inside them is everything you need to know.
>
> Thirty-six thousand, three hundred ninety scans. A hundred and forty-five medical centers. Nearly a million labeled structures. Introducing BodyMaps.
>
> You can open any one of them, or upload a scan of your own.
>
> Drop in a file, choose a model, and go.
>
> Thirty-two structures, labeled. Every organ, vessel and bone.
>
> In three planes. Axial, coronal, sagittal. And in three dimensions.
>
> Adjust the window to bring out soft tissue, or bone, or lung.
>
> Scroll the whole volume.
>
> Measure anything. Distance, area, density in Hounsfield units.
>
> Hover a structure and it names itself.
>
> And where the model got it wrong, the masks are yours to edit.
>
> Every case comes with its own report. Select a finding and it highlights on the scan.
>
> In clinical language. Or in plain English.
>
> Two scans, side by side. Scroll them as one.
>
> Any view you build is a link.
>
> Dictate as you read. The session assembles a draft report, and exports as a single bundle.
>
> That was one scan.
>
> BodyMaps has thirty-six thousand, three hundred and ninety.

---

## Where the extra time went

Your draft ended at 2:04. Three additions bring it to 2:56:

| Added | Time | Why |
|---|---|---|
| Library reveal | 26s | Restores the payoff the cold open sets up. The hero tile is now correctly centred at index 610. |
| Reading session | 12s | 2:08–2:20. Dictate → draft → bundle. Verified working against the server. |
| "Open any one of them" + hover-to-name | 12s | Your line bridges stats → upload, and gives the library a reason to be on screen before the reveal. Hover was in an earlier cut and is a cheap delight. |

---

## Corrections made to the draft, and why

- **"thousands of images" → "a thousand images."** Case 17 is `shape [484,344,219]`: 219 axial slices, 1,047 across all three planes. "Thousands" overstated by 3–5× in the film's first factual claim.
- **"or vessels" → "or lung."** The viewer's window presets are Soft Tissue, Bone, Lung. There is no vessel preset — you'd have said a word the UI contradicts.
- **"Every organ, every difference" → "Scroll them as one."** Compare has no volume-delta readout; every "volume" in `CompareViewerPage` is Cornerstone's pixel array. The original line promised computed differences that don't exist.
- **"Tap a finding" → "Select a finding."** Desktop app, cursor, not touch.
- **"our many AI models" → "a model."** Four lesion models are visible on the upload page (pancreatic, liver, kidney, colon); the handoff claims six total. "Many" was vague and I could not verify a number — confirm on screen if you want to name one.
- Dropped the filler: "Like", "as well", "Lets" → "Let's", the doubled period.

## Keep off camera

In the organ-stats table, two rows are segmentation artifacts labelled "normal":

- `pancreas_body` — `mean_hu -804.4`, **volume 184.1 cc against the whole pancreas at 31.02 cc.** A sub-part six times its parent is the visible tell, more than the HU.
- `common_bile_duct` — `mean_hu -715.6`, also air density.

`lung_right` at `-802` is legitimate; lungs are air.

## On "Thirty-two structures"

32 is the model's class count, not what case 17 contains — it has 25 meshes, and the
cold open shows 23 after the lungs are excluded. It is fair as a capability claim.
If you would rather it describe what is on screen, "Every organ, vessel and bone,
labeled" costs the number and removes the gap.
