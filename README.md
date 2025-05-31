# Firefox WebIDL Report

This tool clones the Firefox WebIDL directory and the W3C webref spec bundle, parses all `.webidl` files with `webidl2.js`, cross-references definitions, computes diffs, and outputs an HTML report.

## Usage

```bash
npm install
npm run start
```

This will sparse clone Firefox to fetch all the WebIDL files, then clone webref to fetch all available WebIDL and finally generate this report.
