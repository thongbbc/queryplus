import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ className, variant = "primary", size = "md", ...props }: Props) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md border text-sm font-medium transition",
        "focus:outline-none focus:ring-2 focus:ring-blue-500/40",
        size === "sm" ? "h-8 px-3" : "h-9 px-3.5",
        variant === "primary" &&
          "border-blue-500/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/28 active:bg-blue-500/35",
        variant === "ghost" && "border-white/10 bg-white/0 text-zinc-100 hover:bg-white/6 active:bg-white/10",
        variant === "danger" && "border-red-500/30 bg-red-500/15 text-red-100 hover:bg-red-500/22 active:bg-red-500/28",
        props.disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      {...props}
    />
  );
}

