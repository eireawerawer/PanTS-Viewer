# BodyMaps — "One Scan" · VO script

**Cut:** 2:42 · **Words:** 199 · **Pace:** ~145 wpm (`words ÷ 2.4 ≈ seconds`)
**Speech density:** ~82s of voice across 162s of picture — roughly half. The silence
is the point; it is what makes it read as a launch film rather than a walkthrough.

## Reading notes

- **Flat and unhurried.** No upward inflection at line ends, no selling. The numbers
  carry the weight — say them plainly and let them sit.
- **Read numbers as written.** "Thirty-six thousand, three hundred ninety" is four
  beats, not a glance at a figure.
- **Land the line, then stop.** Every timing below has slack built in. If you finish
  early, do not fill.
- **Two full stops of real silence:** 0:00–0:09 and 2:19–2:29. Do not talk over the
  assemble or the pull-back.

---

## Shooting script

Every viewer URL takes `?hd=1`. Without it the app serves `?res=low` whenever the
JHU server is reachable — so having the tunnel up makes the picture *worse* unless
you ask for full res. The HuggingFace fallback is full res already.

**SRV** marks a block that cannot be shot without the tunnel.

| Time | On screen | VO |
|---|---|---|
| 0:00 | `/cinematic/17?local=1&start=liver&hold=1800&step=160&speed=0.5` — press **R** to arm. Black frame. The liver alone, rotating slowly. It holds 1.8s. | *(silence)* |
| 0:02 | Structures begin stepping in, one every 160ms, building the abdomen outward around the liver. 23 in total — the lungs are excluded, they're truncated by the top of the volume and read as broken. | *(silence)* |
| 0:09 | Assembly settles. Cut to `/cards.html` card **1** — wordmark rises out of blur. | **One scan. Twenty-five structures.** |
| 0:12 | `/cards.html` press **2**. Four figures count up in sequence, ~350ms apart. | **It's one of thirty-six thousand, three hundred ninety. From a hundred and forty-five hospitals.** |
| 0:20 | **SRV** `/upload` — drag `test-scan.nii.gz` onto the drop zone. File lands, model picker appears. Start the run; the pipeline steps through its stages. | **A new scan uploads once. Six segmentation models run in sequence — organs, vessels, pancreatic substructure, lesions — and return thirty-two labelled classes. No manual contouring.** |
| 0:34 | `/case/17?hd=1`, already warm in the tab. Three MPR panes, soft-tissue window, slice readouts visible. | **Every scan opens in three planes at once.** |
| 0:40 | Drag the crosshair in the axial pane. The other two panes track it live. | **Axial, coronal, sagittal — locked to one cursor.** |
| 0:46 | Toggle segmentation classes on one at a time. Colour builds over the greyscale. | **Structures build up a layer at a time.** |
| 0:52 | Window/level: drag from Soft Tissue toward Bone. Watch the tissue drop out and the skeleton resolve. | **Window the intensity, and soft tissue separates from bone.** |
| 0:59 | Scrub the slice slider fast through the stack — one continuous pass, don't stutter. | **Scrub the stack.** |
| 1:03 | Draw a distance line across an organ. Then an area. Let the HU readout land. | **Measure anything. Distance, area, density in Hounsfield units.** |
| 1:10 | Move the cursor over two or three structures. Each names itself as you cross it. | **Hover a structure and it names itself.** |
| 1:16 | Open the docked Segments panel. Brush a correction onto a mask edge, smooth it, split a class. | **Where the model got it wrong, correct the mask directly. Brush it, smooth it, split it.** |
| 1:25 | Hold on the corrected mask. | **The correction is the annotation.** |
| 1:30 | **SRV** Open the report. Findings timeline; the pancreas row sits amber — `status: "check"`. | **Findings arrive as a timeline. This pancreas is flagged for review.** |
| 1:40 | **SRV** Toggle clinical → plain language. The impression rewrites in place. | **Read it in clinical language — or switch to plain language for the patient.** |
| 1:47 | **SRV** Select the pancreas finding; the structure lights in the 3D pane. | **Select a finding, and the structure lights up in three dimensions.** |
| 1:52 | `/compare-viewer?a=17&b=44`, pre-warmed. Two cases side by side. Enable linked slice position and scroll — both move together. | **Put any two cases side by side. One crosshair, scrolling both at once.** |
| 2:00 | **SRV** Click copy-link. Hold on the confirmation toast. **Never show the URL bar** — it copies `window.location.origin`, which off the dev server reads `localhost:5173`. | **Every view has a link.** |
| 2:04 | **SRV** Reading session: dictate a line, the draft report assembles beneath it, export the bundle. | **Dictate while you read. The session assembles a draft report, and exports as a single bundle.** |
| 2:16 | `/wall?hero=17&n=1200&cols=20&local=1` — press **R**. Case 17's own tile fills the frame. | **That was one.** |
| 2:19 | Pull back. The grid resolves around it, then the scroll accelerates down through 1,200 tiles. Let the music carry this — no voice for ten seconds. | *(silence)* |
| 2:30 | Scroll settles; the tumour filter re-flows the grid. | **Thirty-six thousand, three hundred ninety more.** |
| 2:38 | `/cards.html` press **3**. Wordmark and institution. | **BodyMaps. Johns Hopkins University.** |

### On "Twenty-five structures"

Case 17 has 25 organ meshes; the shot shows 23 because both lungs are excluded.
Keep the line — the scan genuinely has 25 segmented structures and the cold open
is hiding two for looks, not overstating the data. Nobody counts meshes on screen.
If it nags you, "One scan. Every structure, mapped." costs the specificity but
removes the gap.

## Timed script

| In | Block | Line | Words |
|---|---|---|---|
| 0:09 | Cold open | One scan. Twenty-five structures. | 4 |
| 0:12 | Landing stats | It's one of thirty-six thousand, three hundred ninety. From a hundred and forty-five hospitals. | 14 |
| 0:20 | Upload | A new scan uploads once. Six segmentation models run in sequence — organs, vessels, pancreatic substructure, lesions — and return thirty-two labelled classes. No manual contouring. | 24 |
| 0:34 | Viewer · MPR | Every scan opens in three planes at once. | 8 |
| 0:40 | Viewer · MPR | Axial, coronal, sagittal — locked to one cursor. | 8 |
| 0:46 | Viewer · cascade | Structures build up a layer at a time. | 8 |
| 0:52 | Viewer · windowing | Window the intensity, and soft tissue separates from bone. | 10 |
| 0:59 | Viewer · cine | Scrub the stack. | 3 |
| 1:03 | Viewer · measure | Measure anything. Distance, area, density in Hounsfield units. | 9 |
| 1:10 | Viewer · hover | Hover a structure and it names itself. | 7 |
| 1:16 | Viewer · mask edit | Where the model got it wrong, correct the mask directly. Brush it, smooth it, split it. | 16 |
| 1:25 | Viewer · mask edit | The correction is the annotation. | 5 |
| 1:30 | Report | Findings arrive as a timeline. | 5 |
| 1:35 | Report | This pancreas is flagged for review. | 6 |
| 1:40 | Report | Read it in clinical language — or switch to plain language for the patient. | 14 |
| 1:47 | Report | Select a finding, and the structure lights up in three dimensions. | 11 |
| 1:52 | Compare | Put any two cases side by side. One crosshair, scrolling both at once. | 13 |
| 2:00 | Share | Every view has a link. | 5 |
| 2:04 | Reading session | Dictate while you read. The session assembles a draft report, and exports as a single bundle. | 16 |
| 2:16 | Library reveal | That was one. | 3 |
| 2:30 | Library reveal | Thirty-six thousand, three hundred ninety more. | 7 |
| 2:38 | Closing card | BodyMaps. Johns Hopkins. | 3 |

---

## Continuous read

Record straight through with a beat of silence between paragraphs; the editor
splits on those gaps.

> One scan. Twenty-five structures.
>
> It's one of thirty-six thousand, three hundred ninety. From a hundred and
> forty-five hospitals.
>
> A new scan uploads once. Six segmentation models run in sequence — organs,
> vessels, pancreatic substructure, lesions — and return thirty-two labelled
> classes. No manual contouring.
>
> Every scan opens in three planes at once. Axial, coronal, sagittal — locked to
> one cursor.
>
> Structures build up a layer at a time.
>
> Window the intensity, and soft tissue separates from bone.
>
> Scrub the stack.
>
> Measure anything. Distance, area, density in Hounsfield units.
>
> Hover a structure and it names itself.
>
> Where the model got it wrong, correct the mask directly. Brush it, smooth it,
> split it. The correction is the annotation.
>
> Findings arrive as a timeline. This pancreas is flagged for review.
>
> Read it in clinical language — or switch to plain language for the patient.
>
> Select a finding, and the structure lights up in three dimensions.
>
> Put any two cases side by side. One crosshair, scrolling both at once.
>
> Every view has a link.
>
> Dictate while you read. The session assembles a draft report, and exports as a
> single bundle.
>
> That was one.
>
> Thirty-six thousand, three hundred ninety more.
>
> BodyMaps. Johns Hopkins.

---

## Fallback: 2:28 cut (inference doesn't verify)

Drop the **Upload** line (0:20, 24 words) in full. Everything after it shifts
**14 seconds earlier**; no other wording changes. Word count becomes **174**.

The six-models claim is the only place the segmentation story is told, so if the
upload block dies, move the idea into the cold open instead:

> One scan. Twenty-five structures, found by six models.

That is the whole repair — 6 words, and the AI story survives without the
upload demo.

---

## Two wording decisions, flagged

**"Flagged for review," not the impression text.** Case 17's report reads
*"Enlarged pancreas."* and the screen will show it. The VO deliberately does not
say it. A voice track asserting a finding reads as a diagnostic claim; the same
words on screen read as software output. Keep the assertion in the UI where it
belongs.

**"Where the model got it wrong."** This is the strongest line in the script and
the one most likely to get challenged. Keep it. Showing a platform that assumes
its own segmentation is fallible — and hands you the brush — is more credible
than any accuracy number, and it sets up mask editing as a feature rather than an
apology. It also now matches the shipped UI: the docked Segments panel with
brush, smoothing and split landed on `main` this sprint.

---

**Compare is not a prior-study feature, and there are no volume deltas.** The beat
sheet said "Compare — volume deltas." That feature does not exist. `CompareViewerPage`
puts **two different cases** side by side (`?a=&b=`, picked by case number from the
library tray): two 3-plane MPR viewers, per-case crosshair, segmentation overlays,
window presets, and an optional link that syncs slice position across both. No
longitudinal/prior-study concept, no cm³ readout anywhere, and **3D is deliberately
omitted** on that page. The line above is rewritten to what the page actually does —
which is a better beat anyway, because synced scrolling across two patients is
visibly impressive in a way a number is not.

**Shoot the share beat on the compare page.** `?a=&b=` means the compare URL encodes
both cases, so "every view has a link" pays off hardest right after the compare
shot. It also chains the two blocks into one continuous 12-second move instead of
two disconnected ones.

## Headroom

198 words against a ~230 target leaves roughly **30 words** spare. If the
professor wants more coverage, the two places that can absorb it without
crowding are the **upload block** (0:20, 14s of picture for 10s of voice) and
the **report block** (1:30, 22s for 15s). Do not add words to the cold open or
the library reveal — those two run on silence by design.
