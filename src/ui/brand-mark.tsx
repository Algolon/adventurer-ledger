import { withBasePath } from "@/src/config/base-path";

type BrandMarkProps = {
  className?: string;
  decorative?: boolean;
  variant?: "default" | "inverse" | "monochrome";
};

const sources = {
  default: "/brand/runefolio-mark.svg",
  inverse: "/brand/runefolio-mark-inverse.svg",
  monochrome: "/brand/runefolio-mark-monochrome.svg",
} as const;

export function BrandMark({
  className,
  decorative = false,
  variant = "default",
}: BrandMarkProps) {
  return (
    <img
      alt={decorative ? "" : "Runefolio"}
      aria-hidden={decorative || undefined}
      className={className}
      height="256"
      src={withBasePath(sources[variant])}
      width="256"
    />
  );
}
