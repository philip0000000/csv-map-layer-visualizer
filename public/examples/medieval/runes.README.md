# Runes dataset (derived from Samnordisk runtextdatabas)

## Source

This dataset is based on the **Samnordisk runtextdatabas (RUNDATA, 2014)**, but has been modified.

Original source:
http://www.nordiska.uu.se/forskn/samnord.htm

The original database is licensed under:

* Open Database License (ODbL)
* Database Contents License (DbCL)

## Attribution requirement

When using or displaying this dataset, you must reference:

"Samnordisk runtextdatabas"
http://www.nordiska.uu.se/forskn/samnord.htm

## About this dataset

This file (`runes.csv`) is a **modified and simplified derivative** created for visualization purposes in this project.

It is **not an authoritative or complete representation** of the original database.

## Transformations applied

The following transformations were applied:

* Converted original Excel data to CSV
* Rows with "=" in the `Signum` column were removed as part of preprocessing
* Coordinates:

  * Original coordinates preserved where available
  * Missing coordinates were partially filled using AI-assisted estimation
* Dates:

  * Normalized to numeric year values where possible
  * Approximate periods (e.g. "Viking age") mapped to representative years
* Some rows may still have missing coordinates or dates

## Data quality notes

* AI-inferred coordinates are approximate and may be inaccurate
* Some dates are estimated and should not be treated as precise historical values
* This dataset is intended for **visualization and demonstration purposes only**

## Naming

This dataset is a derived work and is **not the original Samnordisk runtextdatabas**.

## Intended use

This dataset is provided as an example dataset for map visualization and timeline exploration within this project.
