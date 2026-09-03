interface CollectifyMarkProps {
  className?: string;
}

// The app's mark (style cleanup, 2026-09-02) — replaces the old plain "C"
// letter-in-a-box used in both the Sidebar header and LoginPage. Client
// asked for something with more "background"/story, in the spirit of
// Linear's mark (layered shapes at different opacities reading as one form
// with real depth), not another flat line icon. Four triangular facets of
// the same white, each a different opacity — reads as a cut gem/chip: the
// faceted-diamond language of gem-cutting, but doubling as a chip/circuit
// motif for the store's tech side (celulares, computadores, impresoras,
// software de facturación). Deliberately filled shapes with fill-opacity,
// not a stroked line icon like this app's other hand-rolled icons (e.g.
// Sidebar.tsx's IconBase) — this is a mark, not a nav icon, and needs the
// same layered-depth trick Linear's mark uses to not look flat.
// Shared between Sidebar.tsx and LoginPage.tsx so it's defined once — was
// only in Sidebar.tsx at first, but LoginPage had the same old "C" tile
// and the client asked for it there too.
export function CollectifyMark({ className = 'size-6' }: CollectifyMarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g fill="#f7f8f8">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" opacity="0.22" />
        <path d="M12 2 L22 12 L12 12 Z" opacity="0.95" />
        <path d="M12 12 L22 12 L12 22 Z" opacity="0.55" />
        <path d="M2 12 L12 12 L12 22 Z" opacity="0.75" />
      </g>
    </svg>
  );
}
