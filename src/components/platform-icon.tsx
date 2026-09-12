import { cn } from '@/lib/utils';

export type Platform = 'facebook' | 'instagram' | 'line' | string;

export default function PlatformIcon({
  platform,
  size = 'md',
  className,
}: {
  platform: Platform;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClasses = {
    xs: 'size-3.5',
    sm: 'size-4',
    md: 'size-5',
    lg: 'size-6',
  };

  const p = platform.toLowerCase();

  if (p === 'instagram') {
    return (
      <span
        aria-label="Instagram"
        title="Instagram"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden shadow-sm',
          sizeClasses[size],
          className,
        )}
      >
        <svg viewBox="0 0 24 24" className="size-full" fill="none">
          <defs>
            <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
              <stop offset="0%" stopColor="#fdf497" />
              <stop offset="5%" stopColor="#fdf497" />
              <stop offset="45%" stopColor="#fd5949" />
              <stop offset="60%" stopColor="#d6249f" />
              <stop offset="90%" stopColor="#285AEB" />
            </radialGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#ig-grad)" />
          <rect x="5.5" y="5.5" width="13" height="13" rx="3.5" stroke="#ffffff" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3.2" stroke="#ffffff" strokeWidth="1.8" />
          <circle cx="15.8" cy="8.2" r="0.9" fill="#ffffff" />
        </svg>
      </span>
    );
  }

  if (p === 'line') {
    return (
      <span
        aria-label="LINE"
        title="LINE"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden shadow-sm',
          sizeClasses[size],
          className,
        )}
      >
        <svg viewBox="0 0 24 24" className="size-full" fill="none">
          <rect width="24" height="24" rx="6" fill="#06C755" />
          <path
            d="M19.5 11.2c0-4-3.6-7.2-8-7.2s-8 3.2-8 7.2c0 3.5 3 6.5 7.1 7.1.3.1.7.2.8.5.1.3 0 .7-.1 1l-.3 1.2c-.1.4-.2.8.2 1 .3.2.7.1 1.1-.1l3.5-2.1c.3-.2.5-.2.8-.2 1.8 0 2.9-.6 2.9-1.4z"
            fill="#ffffff"
          />
        </svg>
      </span>
    );
  }

  // Default: Facebook / Messenger
  return (
    <span
      aria-label="Facebook"
      title="Facebook Messenger"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden shadow-sm',
        sizeClasses[size],
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-full" fill="none">
        <circle cx="12" cy="12" r="12" fill="#0866FF" />
        <path
          d="M16.5 12.5l-2.4 3.8c-.3.5-1 .6-1.5.2l-2-1.5c-.2-.1-.4-.1-.6 0l-2.7 2.1c-.4.3-.9-.1-.8-.6l2.4-3.8c.3-.5 1-.6 1.5-.2l2 1.5c.2.1.4.1.6 0l2.7-2.1c.4-.3.9.1.8.6z"
          fill="#ffffff"
        />
      </svg>
    </span>
  );
}
