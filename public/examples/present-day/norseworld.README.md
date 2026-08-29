# Norse World — Enriched CSV Demonstration Dataset

This directory contains an enriched CSV derived from the **Norse World** research resource:

**`norse-world-attestations-enriched-2026-08-28.csv`**

The file is provided as a real-world demonstration dataset for **csv-map-layer-visualizer**. It is intended to demonstrate features such as geographic points, timeline filtering, clickable links, marker customization, and handling of large historical datasets.

This is **not an official Norse World release**, and it should not be treated as a replacement for the original resource. For scholarly or research use, please consult and cite Norse World directly.

## Original source and attribution

The original data comes from **Norse World**, an interdisciplinary spatial-temporal resource for research on spatiality and worldviews in medieval literature from Sweden and Denmark.

- Norse World: https://norseworld.nordiska.uu.se/
- Project information: https://www.uu.se/en/research/norseworld
- Export documentation: https://www.uu.se/forskning/norseworld/how-to-use-norse-world/exporting-the-data
- Terms of use: https://www.uu.se/en/research/norseworld/terms-of-use

Required attribution from the Norse World terms of use:

> **© 2018-2020 Norse World**

Norse World is licensed under the **Creative Commons Attribution 4.0 International License (CC BY 4.0)**:

https://creativecommons.org/licenses/by/4.0/

The Norse World terms permit sharing and adaptation of the project's data and other material, subject to attribution. If this dataset or material derived from it is used in a publication, the Norse World terms also request that the project team be notified.

Please retain the Norse World attribution and license information when redistributing or adapting this dataset.

The license covering the surrounding visualization software is separate from the license covering the Norse World-derived data. A software license does not replace or remove the attribution requirements for this dataset.

## Source snapshot

The Norse World CSV exports used for this demonstration were downloaded on **2026-08-28**.

The principal source was the official **All attestations** export. Additional official Norse World exports were used only to enrich or verify information already represented in the resource:

- All locations
- All manuscripts
- All early prints
- All runic inscriptions
- Current search export, used as an official cross-check for text/encoding integrity

The final file contains **6,637 attestation rows**.

## Purpose of the derived file

The purpose of this derivative is practical visualization rather than editorial alteration of the Norse World scholarship.

The enrichment was deliberately conservative:

- original Norse World identifiers and row order were preserved;
- original coordinates were preserved where usable;
- ambiguous geographic cases were left unresolved rather than guessed;
- dates describe the **source containing the attestation**, not the historical date of the place or spatial reference;
- marker symbols are presentation metadata derived from existing Norse World locality categories;
- no general-purpose external geocoding was used;
- no external images were added.

## Changes made for the demonstration

### 1. CSV and text compatibility

The data was normalized to **UTF-8** for reliable use in the visualizer.

Encoding artifacts present in the bulk attestation export were repaired using corresponding official Norse World data as a reference. The official current-search export was used as a cross-check because its attestation identifiers corresponded to the same records.

A damaged Notes value was restored from the corresponding official Norse World current-search record.

These changes were intended to repair transport/encoding problems, not to rewrite or reinterpret the scholarly content.

The export metadata preamble was removed so that the first row of the demonstration file is the normal CSV header row.

### 2. Clickable links

Existing HTTP/HTTPS URLs were reformatted into the inline link syntax understood by csv-map-layer-visualizer.

For example:

```text
[Norse World](https://norseworld.nordiska.uu.se/...)
```

The destination URLs themselves were not replaced with independently sourced alternatives.

### 3. Geographic enrichment

Norse World's **All locations** export includes spatial metadata such as coordinates, `Located in`, and `Show as`.

Norse World documents `Show as` specifically as a way to visualize spatial references that lack their own coordinates. This derived dataset therefore uses `Show as` where a conservative match to a coordinate-bearing Norse World location can be established.

Geographic enrichment used:

- coordinates already present on the attestation;
- direct matching coordinates from an official Norse World location record;
- Norse World's `Show as` relationships;
- deeper `Show as` relationships where the official metadata formed an unambiguous chain;
- description metadata where it unambiguously distinguished otherwise duplicated location names;
- one punctuation/spacing-normalized `Show as` match;
- one case where a Norse World note explicitly disambiguated the intended `Jordan` location as the **Jordan River**.

`Located in` was **not** used as a general coordinate fallback. It often represents broad administrative or geographic containment and would place many references at misleading representative points.

No general external geocoder was used.

### Geographic coverage

Under strict numeric-coordinate validation:

- **6,304 / 6,637 rows** are plottable
- **333 rows** remain unresolved
- strict coordinate coverage is **94.98%**

Unresolved rows are retained because many are abstract non-names, fictional or unidentified places, broad geographic concepts, or records where the available Norse World metadata does not support a unique coordinate assignment.

One Norse World coordinate for **Deir al-Balah** is preserved exactly as supplied (`31.41783,` / `34.35033`). The trailing comma prevents it from passing the conservative strict-numeric validation used for the coverage figure. Applications with tolerant coordinate parsing may still display that point.

### Geographic provenance columns

Two columns were added to make geographic changes transparent:

#### `coordinateSource`

Possible values are:

| Value | Meaning |
|---|---|
| `source` | Coordinates were already present on the original attestation |
| `location` | Coordinates came from a directly matched Norse World location record |
| `show-as` | Coordinates came from the location named by Norse World's `Show as` metadata |
| `show-as-deep` | Coordinates were reached through a deeper unambiguous `Show as` chain |
| `show-as-description` | Official description metadata safely distinguished the intended `Show as` location |
| `show-as-normalized` | An intended `Show as` target was matched after a punctuation/spacing-only normalization |
| `show-as-note` | A Norse World note supplied the information needed to disambiguate the `Show as` destination |
| `unresolved` | No sufficiently safe coordinate assignment was made |

#### `mapLocation`

For enriched coordinates, `mapLocation` records the Norse World location used for visualization. It is blank when the original attestation coordinates were used or when the row remains unresolved.

## Timeline enrichment

Timeline fields were added from official Norse World **source metadata**.

The timeline represents the dating of the **manuscript, early print, or runic inscription containing the attestation**. It must not be interpreted as the date when a geographic place existed, when a place name was created, or when the referenced event occurred.

The following visualizer fields were added:

- `year`
- `yearFrom`
- `yearTo`

### Manuscripts

Attestation `Source` values were matched to Norse World manuscript shelf marks.

- `Dating, after year` → `yearFrom`
- `Dating, before year` → `yearTo`

One manuscript source, **A 34**, did not have a sufficiently defensible match in the downloaded manuscript export. Its 73 attestation rows were therefore deliberately left without timeline values.

### Early prints

All five Early print source values could be matched one-to-one with the corresponding official Norse World early-print records after punctuation/spacing normalization.

Where the official `Dating` value represented an exact year, it was placed in `year`.

For **Fragment of Floris and Blancheflour, LN 66**, the Norse World metadata gives `Dating = 1505` while its accompanying note explains that the exact publication date is unknown and was probably between **1505 and 1510**. The demonstration therefore represents this source as:

```text
yearFrom = 1505
yearTo   = 1510
```

rather than presenting 1505 as an exact year.

### Runic inscriptions

The three runic attestation sources were matched to their official Norse World signa.

- `Dating, after year` → `yearFrom`
- `Dating, before year` → `yearTo`

### Timeline coverage

- **6,564 / 6,637 rows** have timeline data
- **73 rows** remain untimed
- timeline coverage is **98.90%**
- represented source-date extent is **1100–1525**

Timeline value classes:

| Timeline representation | Rows |
|---|---:|
| Exact `year` | 489 |
| Closed `yearFrom`–`yearTo` range | 5,171 |
| Open `yearFrom` range | 904 |
| No timeline value | 73 |

## Emoji markers

The optional `marker` column was added to demonstrate custom point markers.

Emoji are used only where the existing Norse World **Type of locality** has a reasonably clear visual interpretation.

All **Non-name** records retain a blank `marker`, which causes the visualizer to use its normal/default marker. This avoids assigning arbitrary emoji to linguistic categories such as adjectives, inhabitant designations, language designations, origin designations, bynames, nouns, adverbs, and coin designations.

Broad or ambiguous locality classes also retain the default marker:

- country
- region
- continent
- other place of worship
- missing Type of locality

Approved visual marker families include:

| Norse World locality type | Marker |
|---|---|
| city, urban area | 🏙️ |
| village | 🏘️ |
| castle, fortification, tower, gate | 🏰 |
| church, monastery, bishopric, archbishopric | ⛪ |
| synagogue, other site of Jewish worship | 🕍 |
| mosque | 🕌 |
| river, sea, lake, strait, fjord, gulf, bay | 🌊 |
| spring, well | 💧 |
| island, peninsula, beach, shore | 🏝️ |
| mountain, hill, valley, pass | ⛰️ |
| volcano | 🌋 |
| cave | 🪨 |
| grave, cemetery | 🪦 |
| house | 🏠 |
| forest | 🌲 |
| tree | 🌳 |
| garden | 🌿 |
| field | 🌾 |
| harbour | ⚓ |
| road, street | 🛣️ |
| desert | 🏜️ |
| bath | ♨️ |

Marker totals:

- **2,366 rows** use an emoji marker
- **4,271 rows** use the normal/default marker
- **0 rows** are left without a deliberate marker policy

The marker is a visualization aid only. It does not change the underlying Norse World classification.

## Data integrity

The final demonstration file contains:

- **6,637 rows**
- **30 columns**

The original attestation identifiers and row order are retained.

Later enrichment stages were applied by adding presentation/provenance fields while preserving the pre-existing values. Ambiguous cases were intentionally retained rather than being silently assigned guessed coordinates or dates.

## Important limitations

This is a **derived demonstration snapshot**, not a canonical edition of Norse World.

Users should be aware that:

- Norse World may be updated after the 2026-08-28 snapshot used here.
- The demonstration includes transformation and visualization metadata that is not part of the original All attestations export.
- Coordinate enrichment represents visualization choices supported by the available Norse World metadata; it does not create new scholarly identifications.
- Timeline values refer to source dating.
- Emoji markers are a presentation layer only.
- Unresolved records have deliberately not been forced into geographic or temporal categories where the evidence was insufficient.

For authoritative definitions, contextual notes, current data, and scholarly interpretation, use the original Norse World resource.

## Citation and responsible reuse

When using or redistributing the Norse World-derived content, please credit the original resource prominently:

**© 2018-2020 Norse World**

Source:

https://norseworld.nordiska.uu.se/

License:

**Creative Commons Attribution 4.0 International (CC BY 4.0)**  
https://creativecommons.org/licenses/by/4.0/

Terms of use:

https://www.uu.se/en/research/norseworld/terms-of-use

This demonstration should be described as an **adapted/enriched visualization-oriented CSV derived from Norse World**, not as an official Norse World dataset.

Thank you to the Norse World project and its contributors for making this research resource openly available for reuse and adaptation.
