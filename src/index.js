import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import webidl from "webidl2";
const { parse: parseWebIDL } = webidl;
import ejs from "ejs";

// ——— CONFIG ———
const PROJECT_ROOT = process.cwd();
const CLONE_ROOT = path.resolve(PROJECT_ROOT, "clones");

const FIREFOX_DIR = path.join(CLONE_ROOT, "firefox");
const FIREFOX_WEBIDL_DIR = path.join(FIREFOX_DIR, "dom", "webidl");
const FIREFOX_REPO = "https://github.com/mozilla-firefox/firefox.git";
const FIREFOX_SUBDIR = "dom/webidl";

const WEBREF_DIR = path.join(CLONE_ROOT, "webref");
const WEBREF_IDL_DIR = path.join(WEBREF_DIR, "ed", "idlnames");
const WEBREF_REPO = "https://github.com/w3c/webref.git";
const WEBREF_BRANCH = "curated";
const WEBREF_SUBDIR = "ed/idlnames";

const TEMPLATE_PATH = path.resolve(PROJECT_ROOT, "src/template.ejs");

const DIST_DIR = path.resolve(PROJECT_ROOT, "dist");
const OUTPUT_HTML = path.join(DIST_DIR, "index.html");
const ASSETS = ["styles.css", "script.js"];

// ——— HELPERS ———

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sparseClone(repoUrl, destDir, subdir, branch = "main") {
  console.log(`→ sparse‐cloning ${repoUrl} (branch=${branch}) into ${destDir}`);
  execSync(
    [
      "git clone",
      "--depth=1",
      "--filter=blob:none",
      `--branch ${branch}`,
      "--sparse",
      repoUrl,
      destDir,
    ].join(" "),
    { stdio: "inherit" },
  );
  execSync(`git -C ${destDir} sparse-checkout set ${subdir}`, {
    stdio: "inherit",
  });
}

function getAllFiles(dir, ext = ".webidl") {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(getAllFiles(full, ext));
    } else if (e.isFile() && full.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

function tryParse(src, label) {
  let srcText = src
    // 1) remove “[...Exposed=...]” blocks (even multi-line) plus their newline
    .replace(/\[((?:(?!\]).)*?Exposed=[\s\S]*?)\]\r?\n?/g, "")
    // 2) remove any “interface Name;” declarations (no body) plus their newline
    .replace(/^\s*interface\s+[A-Za-z_$][\w$]*\s*;\r?\n?/gm, "")
    .replace(/\battribute\s+sequence</g, "attribute FrozenArray<")
    .replace(/^#.*\r?\n?/gm, "");

  try {
    return parseWebIDL(srcText);
  } catch (err) {
    console.error(`⚠️ Failed to parse ${label}: ${err.message}`);
    return [];
  }
}

// ——— MERGE-DEFINITION MAPS ———

function buildMultiMap(files) {
  const multi = new Map();
  let failed = 0;
  for (const fp of files) {
    const src = fs.readFileSync(fp, "utf8");
    const ast = tryParse(src, fp);
    if (ast.length === 0) {
      failed++;
    }
    ast.forEach((def) => {
      if (!def.name) return;
      const arr = multi.get(def.name) || [];
      arr.push(def);
      multi.set(def.name, arr);
    });
  }
  console.log(`Count of idls that failed to parse: ${failed}`);
  return multi;
}

function flattenMulti(multi) {
  const flat = new Map();
  for (const [name, defs] of multi) {
    if (defs.length === 1) {
      flat.set(name, defs[0]);
      continue;
    }
    const type = defs[0].type;
    let merged = null;
    if (type === "interface" || type === "mixin" || type === "dictionary") {
      const seen = new Set();
      const members = [];
      defs.forEach((d) => {
        d.members.forEach((m) => {
          const key =
            m.name +
            "|" +
            (m.arguments
              ? m.arguments.map((a) => a.idlType?.idlType || "").join(",")
              : "");
          if (!seen.has(key)) {
            seen.add(key);
            members.push(m);
          }
        });
      });
      merged = { ...defs[0], members };
    } else if (type === "enum") {
      const seen = new Set();
      const values = [];
      defs.forEach((d) => {
        d.values.forEach((v) => {
          if (!seen.has(v.value)) {
            seen.add(v.value);
            values.push(v);
          }
        });
      });
      merged = { ...defs[0], values };
    } else {
      merged = defs[0];
    }
    flat.set(name, merged);
  }
  return flat;
}

// ——— AST COMPARISON ———

function memberKey(m) {
  if (m.type === "operation") {
    const sig = m.arguments.map((a) => a.idlType?.idlType || "").join(",");
    return `${m.name}(${sig})`;
  }
  return m.name;
}

function diffObjects(a, b, path = "") {
  const diffs = [];

  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    if (Array.isArray(a) && Array.isArray(b)) {
      const maxLen = Math.max(a.length, b.length);
      for (let i = 0; i < maxLen; i++) {
        const subPath = `${path}[${i}]`;
        if (i in a && i in b) {
          diffs.push(...diffObjects(a[i], b[i], subPath));
        } else if (i in a) {
          diffs.push(
            `${subPath}: Firefox Type: ${JSON.stringify(a[i])} → <removed>`,
          );
        } else {
          diffs.push(
            `${subPath}: <added> → Spec Type: ${JSON.stringify(b[i])}`,
          );
        }
      }
      return diffs;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (let key of keys) {
      const subPath = path ? `${path}.${key}` : key;
      if (key in a && key in b) {
        diffs.push(...diffObjects(a[key], b[key], subPath));
      } else if (key in a) {
        diffs.push(
          `${subPath}: Firefox Type: ${JSON.stringify(a[key])} → <removed>`,
        );
      } else {
        diffs.push(
          `${subPath}: <added> → Spec Type: ${JSON.stringify(b[key])}`,
        );
      }
    }
    return diffs;
  }

  if (a !== b) {
    diffs.push(
      `${path}: Firefox Type: ${JSON.stringify(a)} → Spec Type: ${JSON.stringify(b)}`,
    );
  }
  return diffs;
}

function compareDefinitions(fxDefs, spDefs) {
  const rows = [];
  const names = new Set([...fxDefs.keys(), ...spDefs.keys()]);
  names.forEach((name) => {
    const fx = fxDefs.get(name),
      sp = spDefs.get(name);

    if (!fx) {
      rows.push({
        defName: name,
        defType: sp.type,
        change: "Missing IDL in Firefox",
      });
      return;
    }
    if (!sp) {
      rows.push({
        defName: name,
        defType: fx.type,
        change: "Extra IDL in Firefox",
      });
      return;
    }
    if (fx.type !== sp.type) {
      rows.push({
        defName: name,
        defType: `${fx.type} → ${sp.type}`,
        change: "Other change",
        detail: `Firefox Type: ${fx.type} → Spec Type: ${sp.type}`,
      });
      return;
    }

    switch (fx.type) {
      case "interface":
      case "mixin":
      case "dictionary":
        rows.push(...compareMembers(fx.members, sp.members, name, fx.type));
        break;
      case "enum":
        rows.push(...compareEnum(fx.values, sp.values, name, fx.type));
        break;
      case "callback":
      case "typedef":
        if (JSON.stringify(fx.idlType) !== JSON.stringify(sp.idlType)) {
          const diffs = diffObjects(fx.idlType, sp.idlType);
          const detail = diffs.length
            ? diffs.join("; ")
            : `${JSON.stringify(fx.idlType)} → ${JSON.stringify(sp.idlType)}`;
          rows.push({
            defName: name,
            defType: fx.type,
            change: "Other change",
            detail,
          });
        }
        break;
    }
  });
  return rows;
}

function compareMembers(fxM = [], spM = [], defName, defType) {
  const rows = [];
  const fxMap = new Map(fxM.map((m) => [memberKey(m), m]));
  const spMap = new Map(spM.map((m) => [memberKey(m), m]));
  new Set([...fxMap.keys(), ...spMap.keys()]).forEach((key) => {
    const mfx = fxMap.get(key),
      msp = spMap.get(key);
    if (!mfx) {
      rows.push({
        defName,
        defType,
        change: "Member missing in Firefox",
        member: key,
      });
    } else if (!msp) {
      rows.push({
        defName,
        defType,
        change: "Member additional in Firefox",
        member: key,
      });
    } else if (JSON.stringify(mfx.idlType) !== JSON.stringify(msp.idlType)) {
      const fxObj = mfx.idlType?.toJSON ? mfx.idlType.toJSON() : mfx.idlType;
      const spObj = msp.idlType?.toJSON ? msp.idlType.toJSON() : msp.idlType;
      const diffs = diffObjects(fxObj, spObj);
      const detail = diffs.length
        ? diffs.join("; ")
        : `Firefox Type: ${JSON.stringify(mfx.idlType)} → Spec Type: ${JSON.stringify(msp.idlType)}`;

      rows.push({
        defName,
        defType,
        change: "Member changed",
        member: key,
        detail,
      });
    }
  });
  return rows;
}

function compareEnum(fxV = [], spV = [], defName, defType) {
  const rows = [];
  const fxSet = new Set(fxV.map((v) => v.value));
  const spSet = new Set(spV.map((v) => v.value));
  spSet.forEach((v) => {
    if (!fxSet.has(v))
      rows.push({
        defName,
        defType,
        change: "Enum value missing in Firefox",
        member: v,
      });
  });
  fxSet.forEach((v) => {
    if (!spSet.has(v))
      rows.push({
        defName,
        defType,
        change: "Enum value additional in Firefox",
        member: v,
      });
  });
  return rows;
}

// ——— MAIN ———

async function main() {
  const cmd = process.argv[2] || "start";

  if (["clone", "start"].includes(cmd)) {
    ensureDir(CLONE_ROOT);
    if (!fs.existsSync(FIREFOX_WEBIDL_DIR)) {
      sparseClone(FIREFOX_REPO, FIREFOX_DIR, FIREFOX_SUBDIR);
    }
    if (!fs.existsSync(WEBREF_IDL_DIR)) {
      sparseClone(WEBREF_REPO, WEBREF_DIR, WEBREF_SUBDIR, WEBREF_BRANCH);
    }
  }

  if (["report", "start"].includes(cmd)) {
    console.log("→ Loading file lists…");
    const fxFiles = getAllFiles(FIREFOX_WEBIDL_DIR, ".webidl");
    const spFiles = getAllFiles(WEBREF_IDL_DIR, ".idl");

    console.log("→ Parsing & merging definitions…");
    const fxMulti = buildMultiMap(fxFiles, ".webidl");
    const spMulti = buildMultiMap(spFiles, ".idl");
    const fxDefs = flattenMulti(fxMulti);
    const spDefs = flattenMulti(spMulti);

    console.log("→ Comparing definitions…");
    const rows = compareDefinitions(fxDefs, spDefs);

    console.log(`→ Found ${rows.length} changes.`);
    const tpl = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const html = ejs.render(
      tpl,
      { rows, fxCount: fxFiles.length, spCount: spFiles.length },
      { rmWhitespace: true },
    );

    ensureDir(DIST_DIR);
    fs.writeFileSync(OUTPUT_HTML, html);
    console.log(`✔ Report written to ${OUTPUT_HTML}`);

    // Copy styles.css and script.js into dist/
    ASSETS.forEach((fname) => {
      const srcPath = path.resolve(PROJECT_ROOT, `static/${fname}`);
      const destPath = path.join(DIST_DIR, fname);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`✔ Copied ${fname} → ${destPath}`);
      } else {
        console.warn(`⚠️ ${fname} not found at ${srcPath}; skipping copy.`);
      }
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
