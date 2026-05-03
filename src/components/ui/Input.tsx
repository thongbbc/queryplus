import type { InputHTMLAttributes, WheelEventHandler } from "react";
import { forwardRef } from "react";
import clsx from "clsx";

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, onWheel, type, ...props },
  ref,
) {
  const handleWheel: WheelEventHandler<HTMLInputElement> = (e) => {
    onWheel?.(e);
    if (type === "number") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <input
      ref={ref}
      type={type}
      className={clsx(
        "h-9 w-full rounded-md border border-zinc-300/70 bg-white px-3 text-sm text-black",
        "placeholder:text-zinc-500 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
        className,
      )}
      onWheel={type === "number" ? handleWheel : onWheel}
      {...props}
    />
  );
});
