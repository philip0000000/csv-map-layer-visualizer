# Litteraturkartan Example Dataset

This directory contains a geographic and literary metadata snapshot derived
from **Litteraturbanken's Litteraturkartan**.

The dataset is provided as a real-world example for
`csv-map-layer-visualizer` and demonstrates point visualization, categories,
custom markers, metadata display, and inline links.

This is an independently prepared example dataset. It is not an official
Litteraturbanken distribution and is not affiliated with or endorsed by
Litteraturbanken.

## Source

**Litteraturbanken – Litteraturkartan**

https://litteraturbanken.se/litteraturkartan/

Snapshot prepared: **2026-08-28**

The source dataset may change over time.

## Dataset structure

Litteraturkartan associates literary articles with geographic places.

The source data has been transformed so that each CSV row represents one
published article associated with one published geographic location.

This snapshot contains:

- 1,568 published places
- 2,059 article rows

A place may occur in several rows because multiple literary articles can
refer to the same geographic location.

Only records where both the place and article have published status are
included.

## CSV fields

The dataset contains:

- `articleId` – Litteraturkartan article identifier
- `placeId` – Litteraturkartan place identifier
- `placeName` – name of the geographic place
- `latitude` – latitude of the place
- `longitude` – longitude of the place
- `category` – Litteraturkartan article category
- `marker` – visualization marker added for this example
- `title` – article heading/title
- `articleAuthor` – structured article author/byline metadata when available
- `authorId` – structured author identifier when available
- `startYear` – structured start-year metadata when available
- `endYear` – structured end-year metadata when available
- `placeStatus` – publication status of the source place
- `articleStatus` – publication status of the source article
- `links` – inline links back to Litteraturkartan and, when available,
  an additional source supplied by the metadata

Optional metadata fields are blank when the source does not provide a
structured value.

## Metadata coverage

In this snapshot:

- `articleAuthor` is available for 1,282 of 2,059 rows
- `authorId` is available for 1,548 of 2,059 rows
- `startYear` is available for 1,662 of 2,059 rows
- `endYear` is available for 1,661 of 2,059 rows
- every row contains a link back to Litteraturkartan
- 1,441 of 2,059 rows also contain an additional source link

Years are taken only from structured metadata.

Years are not inferred from article titles. For example, a title such as
`Linné i Mariestad (1746)` remains a title unless structured year metadata
is also supplied by the source.

## Links

Every row contains a link back to its corresponding location in
Litteraturkartan.

For example:

```text
[Litteraturkartan](https://litteraturbanken.se/litteraturkartan/?id=1459)
```

When an additional source URL is supplied by Litteraturkartan metadata,
the field contains both links:

```text
[Litteraturkartan](https://litteraturbanken.se/litteraturkartan/?id=1459) · [Source](https://example.com/)
```

The inline-link formatting is added for use by `csv-map-layer-visualizer`.

The linked resources themselves are not redistributed by this dataset.
Content available at linked destinations may have its own copyright,
license, or usage terms.

## Categories and markers

The `marker` values were added specifically for visualization in
`csv-map-layer-visualizer`.

| Category | Marker |
|---|---|
| Person | 🟣 |
| Plats | 🟢 |
| Verk | 🔵 |
| Linnés resa | 🟡 |
| Resa | 🟠 |
| Missing or unknown category | 🔴 |

The marker colors are **not original Litteraturbanken metadata**.

A red marker indicates that the source category is missing or is not
currently mapped to one of the known visualization categories.

This snapshot contains one row with a missing category.

## Modifications

The source metadata has been transformed for use as CSV map data.

The transformations include:

- flattening nested place/article data to one article per CSV row
- representing source coordinates as `latitude` and `longitude`
- retaining only published places
- retaining only published articles
- retaining selected structured metadata
- adding visualization markers according to category
- excluding records without usable coordinates
- generating a consistent link back to Litteraturkartan
- preserving additional source links when supplied by the metadata
- formatting links using the inline-link syntax supported by
  `csv-map-layer-visualizer`

The dataset intentionally contains selected structured metadata only.

It does **not** intentionally contain:

- article body text
- `free_text`
- literary excerpts
- author introduction texts
- long-form editorial descriptions
- images
- media files
- other surrounding editorial texts

## Rights and licensing

This CSV is derived from metadata provided by
**Litteraturbanken / Litteraturkartan**.

Litteraturbanken's current rights information is available at:

https://litteraturbanken.se/om/rattigheter

Litteraturbanken states that its metadata describing works and authors is
provided under **CC0 1.0**:

https://creativecommons.org/publicdomain/zero/1.0/

Litteraturbanken also states that author introduction texts and other
surrounding texts are excluded from those metadata terms and remain subject
to copyright.

For this reason, this example dataset is intentionally limited to selected
identifiers, geographic information, classifications, dates, author
metadata, titles, and links. It does not attempt to redistribute literary
texts, article body text, introductions, images, or other editorial
material.

Other material available from Litteraturbanken or from external sites linked
by the dataset may have separate rights or usage conditions.

The software license of `csv-map-layer-visualizer` does not alter the
licensing or rights associated with source datasets or linked material.

## Attribution and provenance

CC0 does not require attribution, but the original source is documented
here for provenance, transparency, and acknowledgement of Litteraturbanken's
work.

**Data source:** Litteraturbanken / Litteraturkartan

https://litteraturbanken.se/litteraturkartan/
