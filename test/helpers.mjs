// Shared test fixtures: the repository's data/api registry and a tiny synthetic one.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSite } from "../lib/blueprint/site.mjs";
import { ApiRegistry } from "../lib/blueprint/api.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const site = () => loadSite(root);

const T = (category, subtype = "", container = "none") => ({ category, subtype, subtypeDisplay: subtype.replace(/^[FUE]/, ""), container, valueType: null, byRef: false, const: false });
const pin = (id, name, type, extra = {}) => ({ id, name, type, default: "", advanced: false, tooltip: "", ...extra });
const node = (o) => ({
  subtitle: "", owner: "", member: "", category: "", tooltip: "", keywords: "", compactTitle: "",
  flags: { static: false, latent: false, deprecated: false, developmentOnly: false, callInEditor: false, compact: false },
  inputs: [], outputs: [], ...o,
});

/** A small registry with an event, a call, a pure function, a break node and a class hierarchy. */
export function tinyRegistry() {
  const r = new ApiRegistry();
  r.add({
    format: 1, plugin: "Tiny", version: "1.0.0", engine: "5.5", repository: "https://example.invalid/tiny", generator: "test", culture: "en",
    modules: [],
    classes: [
      { id: "UBase", displayName: "Base", kind: "component", parent: "UActorComponent", module: "Tiny", header: "", category: "", tooltip: "", flags: { abstract: true, blueprintType: true, blueprintable: true, spawnable: false, deprecated: false }, properties: [], nodes: ["UBase.Tick"] },
      { id: "UChild", displayName: "Child", kind: "component", parent: "UBase", module: "Tiny", header: "", category: "", tooltip: "", flags: { abstract: false, blueprintType: true, blueprintable: true, spawnable: true, deprecated: false }, properties: [], nodes: ["UChild.Fire", "UChild.GetValue", "UChild.OnHit"] },
    ],
    nodes: [
      node({ id: "Break:FData", kind: "break", title: "Break Data", inputs: [pin("Data", "Data", T("struct", "FData"))], outputs: [pin("Value", "Value", T("float")), pin("bOk", "Ok", T("bool")), pin("Items", "Items", T("int", "", "array"))] }),
      node({ id: "UBase.Tick", kind: "event", title: "Event Tick", owner: "UBase", member: "Tick", outputs: [pin("OutputDelegate", "Output Delegate", T("delegate")), pin("then", "", T("exec")), pin("DeltaSeconds", "Delta Seconds", T("float"))] }),
      node({ id: "UChild.Fire", kind: "call", title: "Fire", subtitle: "Target is Child", owner: "UChild", member: "Fire", inputs: [pin("execute", "", T("exec")), pin("self", "Target", T("object", "UChild")), pin("Power", "Power", T("float"), { default: "1.0" }), pin("Label", "Label", T("string"), { advanced: true })], outputs: [pin("then", "", T("exec")), pin("ReturnValue", "Return Value", T("bool"))] }),
      node({ id: "UChild.GetValue", kind: "pure", title: "Get Value", subtitle: "Target is Child", owner: "UChild", member: "GetValue", inputs: [pin("self", "Target", T("object", "UChild"))], outputs: [pin("ReturnValue", "Return Value", T("struct", "FData"))] }),
      node({ id: "UChild.OnHit", kind: "event", title: "On Hit", owner: "UChild", member: "OnHit", outputs: [pin("OutputDelegate", "Output Delegate", T("delegate")), pin("then", "", T("exec")), pin("Data", "Data", T("struct", "FData"))] }),
      node({ id: "K2Node_IfThenElse", kind: "node", title: "Branch", inputs: [pin("execute", "", T("exec")), pin("Condition", "Condition", T("bool"), { default: "true" })], outputs: [pin("then", "True", T("exec")), pin("else", "False", T("exec"))] }),
    ],
    structs: [{ id: "FData", displayName: "Data", module: "Tiny", header: "", tooltip: "", fields: [], make: "", break: "Break:FData" }],
    enums: [],
  }, "tiny.json");
  return r;
}
