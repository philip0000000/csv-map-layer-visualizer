# Attribution

This distribution may combine historical boundary data from multiple sources.
The sources used in the current release are documented below. Source details
are recorded in `historical-country-border-sources.csv`. Each data shard has a
matching `.sources.csv` file that identifies the source used for each feature.

## Sources included in this release

### CShapes

CShapes is published by the International Conflict Research group at ETH Zurich:

https://icr.ethz.ch/data/cshapes/

Schvitz, Guy, Seraina Rüegger, Luc Girardin, Lars-Erik Cederman, Nils Weidmann,
and Kristian Skrede Gleditsch. 2022. “Mapping the International System,
1886-2017: The CShapes 2.0 Dataset.” Journal of Conflict Resolution 66(1):
144-161.

The project source file is locally labeled CShapes 2.1. The official citation
provided by ETH describes the CShapes 2.0 dataset.

### CShapes-Europe

Cederman, Lars-Erik, Luc Girardin, Carl Müller-Crepon, and Yannick Pengl. 2025.
Nationalism and the Transformation of the State: Border Change and Political
Violence in the Modern World. Cambridge University Press.

## Modifications

The upstream geometry and metadata were converted to row-per-vertex CSV files,
selected historical intervals were combined, display colors were reassigned,
and the final output was split into size-bounded shards. Features are kept
whole when files are split. These changes are not endorsed by the upstream
authors or ETH Zurich.
