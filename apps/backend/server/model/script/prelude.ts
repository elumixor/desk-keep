import { LANGUAGE_SOURCE } from "./language";
import { methodOf, namespaces } from "./names";
import type { ScriptExtension } from "./types";

/**
 * The JavaScript a button's script runs after, inside the sandbox: `self`, `page(…)`, `workspace`, `findPages`, `Page`
 * and `Property`, `notify`, `open`, `ask`, `log` and `console` over the two functions the sandbox is given (`__call` asks the host and waits, `__out` tells it), and
 * a method per action of each extension. What it builds is what `model/script/types.ts` declares.
 */
const API = `
const __host = (op, ...args) => {
  const answer = JSON.parse(__call(op, JSON.stringify(args)));
  if ("error" in answer) throw new Error(answer.error);
  return answer.value;
};
const __text = (value) => (typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value)));
globalThis.console = {
  log: (...values) => __out("log", values.map(__text).join(" ")),
  warn: (...values) => __out("warn", values.map(__text).join(" ")),
  error: (...values) => __out("error", values.map(__text).join(" ")),
};
globalThis.log = globalThis.console.log;
globalThis.notify = (message) => __out("notify", __text(message));
globalThis.open = (url) => __out("open", String(url));
class Select {
  #options;
  constructor(options) { this.#options = Object.freeze(options); }
  get options() { return this.#options; }
}
globalThis.select = (ref) => new Select(__host("select", String(ref)));
globalThis.ask = (question, kind = "text") => {
  const asked = kind instanceof Select ? { kind: "options", options: [...kind.options] }
    : Array.isArray(kind) ? { kind: "options", options: kind.map(String) }
    : { kind: String(kind) };
  return __host("ask", String(question), asked);
};

/** A page given where an id is written (a relation), as its id. */
const __written = (value) => (value instanceof Page ? value.id : Array.isArray(value) ? value.map(__written) : value);

/**
 * A property: of a page (\`page.prop("Status")\`, its \`value\` read as it is now and assigned to write it, null
 * clearing it), or of a page to be made (\`new Property(name, type, value)\`, for \`new Page\`).
 */
class Property {
  #name;
  #type;
  #value;
  #owner;
  constructor(name, type, value, owner) {
    this.#name = String(name);
    this.#type = String(type);
    this.#value = __written(value);
    this.#owner = owner ?? null;
  }
  get name() { return this.#name; }
  get type() { return this.#type; }
  get value() {
    if (!this.#owner) return this.#value;
    const value = this.#owner.__value(this.#name);
    return this.#type === "relation" ? value.map((id) => page(id)) : value;
  }
  set value(value) {
    if (this.#owner) this.#owner.__write({ [this.#name]: __written(value) });
    else this.#value = __written(value);
  }
  toString() { return this.#name + ": " + String(this.value ?? ""); }
  toJSON() { return { name: this.#name, type: this.#type, value: this.#owner ? this.#owner.__value(this.#name) : this.#value }; }
}

/** The pages under one, added to (a page moved there, or a new one made there) and removed from (to the trash). */
const __children = (parent) => {
  const list = __host("children", parent.id).map(__page);
  Object.defineProperties(list, {
    add: { value: (child) => {
      if (!(child instanceof Page)) throw new Error("children.add() takes a page");
      child.__placeUnder(parent);
      return child;
    } },
    remove: { value: (child) => {
      if (!(child instanceof Page)) throw new Error("children.remove() takes a page");
      __host("trash", child.id);
    } },
  });
  return list;
};

/** Marks a page built from what the host read, not one a script makes. */
const __saved = Symbol("saved");
const __page = (data) => new Page(__saved, data);

class Page {
  #data;
  /** What a page not made yet is made from, when it is added under one. */
  #draft;
  constructor(init, data) {
    if (init === __saved) {
      this.#data = data;
      return;
    }
    const { title = "", traits = [], properties = [] } = init ?? {};
    this.#draft = { title: String(title), traits: [...traits].map(String), properties: [...properties].map((p) => (p instanceof Property ? p.toJSON() : p)) };
  }
  #saved() {
    if (!this.#data) throw new Error("This page is not made yet: add it to some page's children first");
    return this.#data;
  }
  get id() { return this.#saved().id; }
  get url() { return "https://keep.example.com/p/" + this.id; }
  /** Old name of \`url\`, for scripts written before. */
  get urn() { return this.url; }
  get title() { return this.#data ? this.#data.title : this.#draft.title; }
  get parent() { const { parentId } = this.#saved(); return parentId ? page(parentId) : null; }
  /** One of its properties, by name in any case; throws when it has none of that name. */
  prop(name) {
    const found = this.__property(String(name));
    if (!found) throw new Error(this.title + ' has no property "' + name + '"');
    return this.#data ? new Property(found.name, found.type, undefined, this) : new Property(found.name, found.type, found.value);
  }
  /** All its properties. */
  get props() { return this.__names().map((name) => this.prop(name)); }
  get children() { return __children(this); }
  /** A copy of this page, not made until it is added under one. */
  copy() {
    const copy = new Page({ title: this.title });
    copy.#draft.copyOf = this.id;
    return copy;
  }
  __property(name) {
    if (!this.#data) return this.#draft.properties.find((p) => p.name.toLowerCase() === name.toLowerCase());
    return this.#data.properties.find((p) => p.name.toLowerCase() === name.toLowerCase());
  }
  __names() { return (this.#data ?? this.#draft).properties.map((p) => p.name); }
  __value(name) { return this.__property(name)?.value ?? null; }
  __write(values) {
    if (!this.#data) throw new Error("This page is not made yet: add it to some page's children first");
    this.#data = __host("write", this.id, values);
  }
  __placeUnder(parent) {
    if (this.#data) this.#data = __host("move", this.id, parent.id);
    else this.#data = __host("create", parent.id, this.#draft);
  }
  /** Its title, wherever a page is put in a text. */
  toString() { return this.title; }
  toJSON() { return { id: this.#data?.id, title: this.title }; }
}
globalThis.Page = Page;
globalThis.Property = Property;

/** A page by id, address or exact title. */
globalThis.page = (ref) => {
  if (ref === undefined) throw new Error('page() looks a page up: page("<id or title>"); the pressed page is self');
  return __page(__host("read", String(ref)));
};
/** Read once, when first named. */
const __lazy = (name, read) => {
  let value;
  Object.defineProperty(globalThis, name, { get: () => (value ??= read()) });
};
__lazy("self", () => __page(__host("read")));
__lazy("workspace", () => __page(__host("workspace")));
globalThis.findPages = (query) => __host("search", String(query)).map(__page);
`;

function extensionsSource(extensions: readonly ScriptExtension[]) {
  const names = namespaces(extensions);
  const entries = extensions.map((extension) => {
    const methods = extension.manifest.actions.map(
      (action) =>
        `${JSON.stringify(methodOf(action.id))}: (target) => __host("action", ${JSON.stringify(extension.id)}, ${JSON.stringify(action.id)}, (target ?? self).id)`,
    );
    return { namespace: names.get(extension.id), methods };
  });
  const ext = entries.map((e) => `${JSON.stringify(e.namespace?.name)}: { ${e.methods.join(", ")} }`).join(",\n  ");
  const globals = entries
    .filter((e) => e.namespace?.global)
    .map((e) => `globalThis.${e.namespace?.name} = ext.${e.namespace?.name};`);
  return `globalThis.ext = {\n  ${ext}\n};\n${globals.join("\n")}\n`;
}

export const prelude = (extensions: readonly ScriptExtension[]) => LANGUAGE_SOURCE + API + extensionsSource(extensions);
