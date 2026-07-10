import { cn } from "@repo/ui";

type BrandMarkProps = {
  className?: string;
  decorative?: boolean;
};

export function BrandMark({ className, decorative = false }: BrandMarkProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
      data-brand-mark="optra-mark"
    >
      <img
        src="/optra-mark.svg"
        alt={decorative ? "" : "Optra logo"}
        aria-hidden={decorative ? "true" : undefined}
        className="h-full w-full outline-0"
      />
    </span>
  );
}
