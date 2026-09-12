import type { SVGProps } from "react";

type GithubIconProps = SVGProps<SVGSVGElement> & { size?: number | string };

export function GithubIcon({ size = 18, width, height, ...props }: GithubIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width ?? size}
      height={height ?? size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .7a11.3 11.3 0 0 0-3.58 22.02c.57.1.78-.25.78-.55v-2.15c-3.18.69-3.85-1.35-3.85-1.35-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.73-1.53-2.54-.29-5.2-1.27-5.2-5.67 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.12 1.17A10.8 10.8 0 0 1 12 5.91c.97 0 1.95.13 2.86.38 2.16-1.48 3.11-1.17 3.11-1.17.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.07 0 4.41-2.67 5.37-5.21 5.66.41.35.78 1.04.78 2.1v3.11c0 .3.2.66.79.55A11.3 11.3 0 0 0 12 .7Z" />
    </svg>
  );
}
