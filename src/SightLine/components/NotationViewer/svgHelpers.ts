export function safeCenterX(element: Element): number | null {
  try {
    const box = (element as SVGGraphicsElement).getBBox();

    if (!Number.isFinite(box.x) || !Number.isFinite(box.width)) {
      return null;
    }

    return box.x + box.width / 2;
  } catch {
    return null;
  }
}

export function normalizeColorToken(color: string): string {
  return color.replace(/\s+/g, "").toLowerCase();
}

export function readPaintColor(target: SVGElement): string | null {
  const styleFill = target.style.getPropertyValue("fill");
  if (styleFill) return styleFill;

  const styleStroke = target.style.getPropertyValue("stroke");
  if (styleStroke) return styleStroke;

  const attrFill = target.getAttribute("fill");
  if (attrFill) return attrFill;

  const attrStroke = target.getAttribute("stroke");
  if (attrStroke) return attrStroke;

  return null;
}

export function clearPaintStyling(target: SVGElement): void {
  target.style.removeProperty("fill");
  target.style.removeProperty("stroke");
  target.removeAttribute("fill");
  target.removeAttribute("stroke");
}