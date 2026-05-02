import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import clsx from "clsx";

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        "h-9 w-full rounded-md border border-zinc-300/70 bg-white px-3 text-sm text-black",
        "placeholder:text-zinc-500 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
        className,
      )}
      {...props}
    />
  );
});
