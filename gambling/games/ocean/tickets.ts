/**
 * Ticket printer (ARCHITECTURE §3): a big win comes out of the cabinet's ticket mouth as a continuous strip of
 * fictional paper vouchers (cream thermal paper, teal waves, a pearl-shell mark, the machine's own wording,
 * face 5,000, serial AL-000000 from the presentation stream, perforations between tickets).
 * The credits are paid to the wallet as always; the tickets are decoration only.
 *
 * The strip hangs from the mouth: new tickets are printed at the top and push the strip down (transform only).
 */
import { s, svgRoot } from "../../src/ui/svg";

export const TICKET_FACE = "5,000";

export interface TicketPrinter {
  /** Clipping box hanging under the ticket mouth (append it to the cabinet). */
  readonly el: HTMLElement;
  /** Prints one ticket; `ms` = feed time (0 = appears at once). */
  print(serial: number, ms: number): void;
  /** Tears the strip off (it drops away). */
  clear(): void;
  destroy(): void;
}

const pad6 = (n: number) => String(Math.max(0, Math.floor(n)) % 1_000_000).padStart(6, "0");

function shellMark(): SVGSVGElement {
  const ribs = [-50, -25, 0, 25, 50].map((a) => {
    const r = (a * Math.PI) / 180;
    return `M20 34L${(20 + Math.sin(r) * 15).toFixed(1)} ${(34 - Math.cos(r) * 22).toFixed(1)}`;
  }).join("");
  return svgRoot("0 0 40 40", [
    s("circle", { cx: 20, cy: 20, r: 18.5, fill: "none", stroke: "#0E8C8F", "stroke-width": 1.6 }),
    s("path", { d: "M5 30C4 16 11 8 20 8C29 8 36 16 35 30Z", fill: "#19D3C5", "fill-opacity": 0.28, stroke: "#06566A", "stroke-width": 1.6, "stroke-linejoin": "round" }),
    s("path", { d: ribs, stroke: "#06566A", "stroke-width": 1.2, "stroke-linecap": "round" }),
    s("path", { d: "M12 30H28L26 34H14Z", fill: "#06566A" }),
    s("circle", { cx: 20, cy: 24, r: 4.2, fill: "#FFC83D", stroke: "#8A5410", "stroke-width": 1 }),
    s("circle", { cx: 18.8, cy: 22.8, r: 1.2, fill: "#FFF6D0" }),
  ], { class: "ocean-tk__mark", "aria-hidden": "true" });
}

function ticketEl(title: string, serial: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "ocean-tk";
  const face = document.createElement("div");
  face.className = "ocean-tk__face";
  const head = document.createElement("span");
  head.className = "ocean-tk__title";
  head.textContent = title;
  const amt = document.createElement("span");
  amt.className = "ocean-tk__amt";
  amt.textContent = TICKET_FACE;
  const no = document.createElement("span");
  no.className = "ocean-tk__no";
  no.textContent = `AL-${pad6(serial)}`;
  face.append(head, amt, no);
  el.append(shellMark(), face);
  return el;
}

export function createTicketPrinter(o: { title: string }): TicketPrinter {
  const el = document.createElement("div");
  el.className = "ocean-tkbox";
  el.setAttribute("aria-hidden", "true");
  let roll: HTMLElement | null = null;
  let count = 0;
  const live = new Set<Animation>();

  const newRoll = (): HTMLElement => {
    const r = document.createElement("div");
    r.className = "ocean-tkroll";
    el.appendChild(r);
    return r;
  };

  return {
    el,
    print(serial, ms) {
      roll ??= newRoll();
      const t = ticketEl(o.title, serial);
      roll.prepend(t);
      count++;
      // the strip sways a little more as it gets longer
      roll.style.setProperty("--sway", `${Math.min(3, 0.6 + count * 0.25)}deg`);
      if (!(ms > 0) || typeof roll.animate !== "function") return;
      const hgt = t.offsetHeight || 56;
      const a = roll.animate(
        [{ transform: `translate3d(0, ${-hgt}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
        { duration: ms, easing: "cubic-bezier(.3,.1,.5,1)" },
      );
      live.add(a);
      a.onfinish = () => live.delete(a);
    },
    clear() {
      const r = roll;
      roll = null;
      count = 0;
      if (!r) return;
      for (const a of live) { try { a.finish(); } catch { /* ignore */ } }
      live.clear();
      if (typeof r.animate !== "function") { r.remove(); return; }
      const a = r.animate(
        [{ transform: "translate3d(0, 0, 0)", opacity: 1 }, { transform: "translate3d(0, 120%, 0) rotate(4deg)", opacity: 0 }],
        { duration: 420, easing: "cubic-bezier(.5,0,.9,.6)", fill: "forwards" },
      );
      a.onfinish = () => r.remove();
    },
    destroy() {
      for (const a of live) { try { a.cancel(); } catch { /* ignore */ } }
      live.clear();
      el.remove();
    },
  };
}
