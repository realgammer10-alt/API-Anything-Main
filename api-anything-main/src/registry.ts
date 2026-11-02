/**
 * Sharing specs through the registry: this repository's `sites/` on GitHub. `pull` fetches one into
 * `~/.api-anything/registry`, `publish` opens a pull request adding one; the rules both apply are vet.ts's.
 */
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { returnedFields } from "./extract.js";
import { dropUnbound, loadSession, safeName, siteOf, writePrivate } from "./session.js";
import { type Operation, parseSite, type Site } from "./spec.js";
import { loadSite, registryDir } from "./store.js";
import { LIMITS, vetShared } from "./vet.js";

/** The GitHub repository whose `sites/` is the registry. */
export const REPO = "goodnight000/api-anything";
export const REGISTRY = `https://raw.githubusercontent.com/${REPO}/main`;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The registry's base URL: `API_ANYTHING_REGISTRY`, https (or http to this machine, for tests). */
export function registryBase(): string {
  const base = (process.env.API_ANYTHING_REGISTRY || REGISTRY).replace(/\/+$/, "");
  const u = new URL(base);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL.has(u.hostname)))
    throw new Error(`API_ANYTHING_REGISTRY must be https: ${base}`);
  return base;
}

/** The body of `url`, or undefined on a 404. Read while streaming, so a huge answer stops at `cap`. */
async function fetchCapped(url: string, cap: number, fetchImpl: typeof fetch): Promise<string | undefined> {
  // a redirect could move the fetch to any origin; the registry's files are served where they are
  const res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > cap) throw new Error(`${url} is over ${cap} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const hostsOf = (op: Operation) => {
  const urls = [op.request.url, op.trigger.url, op.trigger.softFrom];
  return [...new Set(urls.flatMap((u) => (u ? [new URL(u).hostname] : [])))];
};

/** One op as the person deciding whether to run it needs to see it. */
export function summarize(op: Operation) {
  const fields = returnedFields(op.response);
  return {
    op: `${op.name}(${op.params.map((p) => `${p.name}${p.required ? "" : "?"}`).join(", ")})${fields ? ` -> ${fields.join(", ")}` : ""}`,
    method: op.request.method.toUpperCase(),
    hosts: hostsOf(op),
    ...(op.readOnly ? {} : { write: true }),
    ...(op.learnedLoggedIn ? { login: true } : {}),
  };
}

export interface Pulled {
  site: string;
  from: string;
  sha256: string;
  operations: ReturnType<typeof summarize>[];
  warnings: string[];
  /** on a pull again: ops that are new, changed or gone since the last one */
  changed?: { added: string[]; changed: string[]; removed: string[] };
  /** the user's own copy, which wins over the pulled one */
  shadowedBy?: string;
}

const sitesOfSession = (name: string) => {
  const s = loadSession(name);
  return new Set([
    ...s.cookies.map((c) => siteOf(c.domain.replace(/^\./, ""))),
    ...(s.origins ?? []).map((o) => siteOf(new URL(o).hostname)),
  ]);
};

export async function pull(name: string, o: { fetchImpl?: typeof fetch } = {}): Promise<Pulled> {
  name = safeName(name);
  const fetchImpl = o.fetchImpl ?? fetch;
  const from = `${registryBase()}/sites/${name}.json`;
  const text = await fetchCapped(from, LIMITS.file, fetchImpl);
  if (text === undefined) throw new Error(`no shared spec for "${name}" in the registry`);
  let site: Site;
  try {
    site = parseSite(JSON.parse(text));
  } catch (e) {
    throw new Error(`${from}: ${(e as Error).message}`);
  }
  if (site.name.toLowerCase() !== name) throw new Error(`${from} is the spec of "${site.name}", not "${name}"`);
  const sha256 = createHash("sha256").update(text).digest("hex");
  site = { ...site, name, shared: { from, sha256 } };
  const notes = await fetchCapped(`${registryBase()}/sites/${name}.md`, LIMITS.notes, fetchImpl);
  const { errors, warnings } = vetShared(site, notes);
  if (errors.length) throw new Error(`the shared spec of "${name}" fails the shared rules: ${errors.join("; ")}`);

  // One name is one session: a spec on another site would inherit this one's cookies and values.
  const own = siteOf(new URL(site.baseUrl).hostname);
  let local: ReturnType<typeof loadSite>;
  try {
    local = loadSite(name);
  } catch {
    local = undefined; // an unreadable copy is replaced
  }
  if (local && siteOf(new URL(local.site.baseUrl).hostname) !== own)
    throw new Error(`a local spec "${name}" is for ${local.site.baseUrl}, not ${site.baseUrl}`);
  const held = sitesOfSession(name);
  if (held.size && !held.has(own))
    throw new Error(`the local session "${name}" belongs to ${[...held].join(", ")}, not ${own}`);

  dropUnbound(name);

  const path = join(registryDir(), `${name}.json`);
  const before = local?.site.shared ? local.site : undefined;
  // the notes first: a spec without its new notes beside it would load with the old ones
  const notesPath = join(registryDir(), `${name}.md`);
  if (notes !== undefined) writePrivate(notesPath, notes);
  else rmSync(notesPath, { force: true });
  writePrivate(path, `${JSON.stringify(site, null, 2)}\n`);

  return {
    site: name,
    from,
    sha256,
    operations: site.operations.map(summarize),
    warnings,
    ...(before ? { changed: changes(before, site) } : {}),
    ...(local?.source === "user" ? { shadowedBy: local.path } : {}),
  };
}

function changes(before: Site, after: Site) {
  const old = new Map(before.operations.map((op) => [op.name, JSON.stringify(op)]));
  const now = new Map(after.operations.map((op) => [op.name, JSON.stringify(op)]));
  return {
    added: [...now.keys()].filter((n) => !old.has(n)),
    changed: [...now].filter(([n, s]) => old.has(n) && old.get(n) !== s).map(([n]) => n),
    removed: [...old.keys()].filter((n) => !now.has(n)),
  };
}
