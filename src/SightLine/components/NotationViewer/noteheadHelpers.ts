import { safeCenterX } from "./svgHelpers";

export type PositionedElement = {
  node: Element;
  x: number;
};

export function getNoteheadNodes(container: HTMLElement): Element[] {
  let noteheads = Array.from(container.querySelectorAll("svg g.vf-notehead"));

  if (noteheads.length === 0) {
    noteheads = Array.from(container.querySelectorAll("svg .vf-notehead"));
  }

  return noteheads;
}

export function getPositionedNoteheads(
  container: HTMLElement,
): PositionedElement[] {
  return getNoteheadNodes(container)
    .map((node) => {
      const x = safeCenterX(node);
      return x === null ? null : { node, x };
    })
    .filter((entry): entry is PositionedElement => entry !== null)
    .sort((a, b) => a.x - b.x);
}

export function getOrderedNoteheads(container: HTMLElement): SVGElement[] {
  return getPositionedNoteheads(container).map(
    ({ node }) => node as SVGElement,
  );
}

export function getPaintTargets(notehead: Element): Element[] {
  return notehead.matches("path, ellipse, circle, polygon")
    ? [notehead]
    : Array.from(notehead.querySelectorAll("path, ellipse, circle, polygon"));
}

export function paintNoteheadElement(notehead: Element, color: string): void {
  const targets = getPaintTargets(notehead);

  for (const target of targets) {
    (target as SVGElement).style.setProperty("fill", color, "important");
    (target as SVGElement).style.setProperty("stroke", color, "important");
  }
}