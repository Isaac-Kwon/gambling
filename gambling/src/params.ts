import { DEFAULT_SLOT_VARIANT, type SlotVariant } from "../../shared/config";
import { LANGS, type Lang } from "../../shared/i18n";

/** Parsed URL query. Hidden params: none of these are exposed in the UI. */
export interface AppParams {
  /** `?seed=` (non-empty). Present means mode "class". */
  seed: string | null;
  /** `?fx=off` gives "off", anything else "on". */
  fx: "on" | "off";
  /** `?sv=b` gives "b", anything else "a". */
  sv: SlotVariant;
  /** `?lang=` when it is one of the supported languages (first two letters), else null. */
  lang: Lang | null;
}

/** Pure: `search` is `location.search` (with or without the leading "?"). */
export function parseParams(search: string): AppParams {
  const q = new URLSearchParams(search ?? "");
  const seedRaw = q.get("seed");
  const seed = seedRaw !== null && seedRaw.trim() !== "" ? seedRaw.trim() : null;
  const fx = (q.get("fx") ?? "").trim().toLowerCase() === "off" ? "off" : "on";
  const sv: SlotVariant = (q.get("sv") ?? "").trim().toLowerCase() === "b" ? "b" : DEFAULT_SLOT_VARIANT;
  const l = (q.get("lang") ?? "").trim().toLowerCase().slice(0, 2);
  const lang = (LANGS as readonly string[]).includes(l) ? (l as Lang) : null;
  return { seed, fx, sv, lang };
}
