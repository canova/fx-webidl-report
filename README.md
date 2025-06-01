# Firefox WebIDL Report

A report for comparing Firefox's WebIDLs with the [Webref](https://github.com/w3c/webref) IDLs. I was curious, and wanted a tool like this one to see all the Firefox WebIDLs and inconsistencies of them compared to the specs. I also wanted to search for a specific term within those inconsistencies. This is a very simple HTML report that does exactly that. 

It's currently very rough, since I wanted something quickly. I may improve it later, or maybe not.

## Usage

```bash
npm install
npm run start
```

This will sparse clone Firefox to fetch all the WebIDL files, then clone webref to fetch all available WebIDL and finally diff them to generate this report.
