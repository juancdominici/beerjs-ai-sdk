import type { ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';

const variants = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/80',
  outline: 'border-border bg-background hover:bg-muted',
  ghost: 'hover:bg-muted',
};

export function Button({
  className,
  variant = 'primary',
  size = 'default',
  type = 'button',
  ...props
}: ComponentProps<'button'> & {
  variant?: keyof typeof variants;
  size?: 'default' | 'sm';
}) {
  return (
    <button
      type={type}
      className={twMerge(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
