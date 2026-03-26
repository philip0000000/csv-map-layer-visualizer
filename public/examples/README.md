# Examples

This folder contains example CSV files for the application.

The files are grouped into different folders based on their purpose:

- `debug/`  
  Test files used to check edge cases, errors, and performance.

- `medieval/`  
  Historical datasets for timeline and map examples.

- `present-day/`  
  Modern datasets for general use and demonstrations.

## How example loading works

Examples can be loaded using the `?example=` URL parameter.

There are two ways to reference a file:

### 1. Full path (recommended)

Use the full relative path from the `examples/` folder:
```
?example=present-day/books.csv
?example=debug/points_basic.csv
```
This always works and does not require any extra configuration.

### 2. Filename only

You can also use only the filename:

?example=books.csv

This only works if the file is listed in `examples-index.json`.

If you add a new file in a subfolder and want to use filename-only URLs,
you must also add the file path to `examples-index.json`.

## Recommendation

Always prefer using the full path. It is more explicit and works without updating any configuration.
